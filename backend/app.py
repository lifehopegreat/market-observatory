import asyncio
from contextlib import asynccontextmanager, suppress
import csv
import io
import time
from urllib.parse import urlparse

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware

from . import store, providers, updater
from .data import catalog, parse_import, stats
from .models import EvidenceInput, ImportRequest, ResearchInput, SearchRequest, SettingsInput, SyncRequest, UpdatePlan, UpdateRequest


@asynccontextmanager
async def lifespan(app):
    store.init()
    updater.init()
    scheduler = asyncio.create_task(updater.scheduler())
    try:
        yield
    finally:
        scheduler.cancel()
        with suppress(asyncio.CancelledError):
            await scheduler
        await updater.shutdown()


app = FastAPI(title='观澜 · 研究 API', version='0.1.0', lifespan=lifespan)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=['127.0.0.1', 'localhost', '[::1]', 'testserver'])
active = set()
last_call = {}


@app.middleware('http')
async def local_guard(request: Request, call_next):
    if request.method not in ('GET', 'HEAD', 'OPTIONS'):
        origin = request.headers.get('origin')
        if origin and (urlparse(origin).netloc != request.headers.get('host') or urlparse(origin).scheme not in ('http', 'https')):
            return JSONResponse({'detail': '拒绝跨来源写入'}, status_code=403)
        if request.headers.get('x-observatory-request') != '1':
            return JSONResponse({'detail': '缺少本地应用请求标记'}, status_code=403)
        if request.headers.get('content-type', '').split(';')[0] != 'application/json':
            return JSONResponse({'detail': '仅支持 JSON 写入'}, status_code=415)
        # Bound body before request validation, including chunked transfers.
        chunks, size = [], 0
        async for chunk in request.stream():
            size += len(chunk)
            if size > 3_000_000:
                return JSONResponse({'detail': '请求超过 3 MB'}, status_code=413)
            chunks.append(chunk)
        request._body = b''.join(chunks)
    response = await call_next(request)
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['Referrer-Policy'] = 'no-referrer'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Cache-Control'] = 'no-store' if request.url.path.startswith('/api') else 'no-cache'
    return response


@app.exception_handler(ValueError)
async def value_error(request, exc):
    return JSONResponse({'detail': str(exc)}, status_code=400)


@app.exception_handler(RequestValidationError)
async def validation_error(request, exc):
    # Pydantic's default input echo can expose a mistyped secret.
    return JSONResponse({'detail': [{k: e[k] for k in ('loc', 'msg', 'type')} for e in exc.errors()]}, status_code=422)


@app.get('/api/health')
def health():
    return {'application': 'guanlan', 'status': 'ok', 'time': store.now(), 'mode': 'local-only'}


@app.get('/api/bootstrap')
def bootstrap(region: str = 'CHN'):
    if region not in ('CHN', 'USA', 'WLD'):
        raise HTTPException(400, '不支持的地区')
    saved = {d['id']: d for d in store.listing('datasets') if d['region'] == region}
    base = [{**d, **saved.pop(d['id'], {})} for d in catalog(region)]
    with store.connect() as c:
        logs = [dict(r) for r in c.execute('SELECT * FROM sync_log ORDER BY id DESC LIMIT 15')]
    return {'datasets': base + list(saved.values()), 'evidence': [e for e in store.listing('evidence') if e['region'] == region],
            'reports': [r for r in store.listing('reports') if r['region'] == region],
            'settings': store.settings(), 'logs': logs, 'dimensions': store.DIMENSIONS}


def limit(key, seconds):
    if key in active:
        raise HTTPException(409, '同类请求正在执行，请等待完成')
    if time.monotonic() - last_call.get(key, 0) < seconds:
        raise HTTPException(429, '请求过于频繁，请稍后再试')
    last_call[key] = time.monotonic()
    active.add(key)


@app.post('/api/sync')
async def sync(req: SyncRequest):
    key = f'sync:{req.provider}:{req.region}'
    limit(key, 8)
    try:
        datasets = await providers.sync(req)
        message = f'成功更新 {len(datasets)} 个数据集；共 {sum(len(d["points"]) for d in datasets)} 条观测'
        if req.provider == 'fred' and req.region != 'USA':
            message += '。FRED 序列归入美国参照范围，请切换地区查看'
        if req.provider == 'tushare' and req.region != 'CHN':
            message += '。A股行情归入中国范围，请切换地区查看'
        store.sync_log(req.provider, True, message)
        return {'message': message}
    except ValueError as e:
        store.sync_log(req.provider, False, str(e))
        raise
    finally:
        active.discard(key)


@app.post('/api/import')
def import_data(req: ImportRequest):
    dataset = parse_import(req)
    store.save_datasets([dataset])
    return {'id': dataset['id'], 'message': f'已导入 {len(dataset["points"])} 行，原始数值与来源已保存'}


@app.get('/api/datasets/{id}/snapshots')
def snapshots(id: str):
    with store.connect() as c:
        rows = c.execute('SELECT id,fetched_at,digest FROM snapshots WHERE dataset_id=? ORDER BY id DESC LIMIT 100', (id,))
        return [dict(r) for r in rows]


@app.get('/api/snapshots/{id}')
def snapshot(id: int):
    with store.connect() as c:
        r = c.execute('SELECT payload FROM snapshots WHERE id=?', (id,)).fetchone()
    if not r:
        raise HTTPException(404, '快照不存在')
    import json
    return json.loads(r['payload'])


@app.get('/api/datasets/{id}/csv')
def export_csv(id: str):
    d = store.get('datasets', id)
    if not d:
        raise HTTPException(404, '数据集尚未采集')
    fields = ['date', 'open', 'high', 'low', 'close', 'volume'] if d['kind'] == 'ohlc' else ['date', 'category', 'value'] if d['kind'] == 'composition' else ['date', 'value']
    fields += ['unit', 'source_url', 'fetched_at']
    out = io.StringIO()
    w = csv.DictWriter(out, fields, extrasaction='ignore')
    w.writeheader()

    def cell(v):
        # Text from imported sources must not become spreadsheet formulas.
        return "'" + v if isinstance(v, str) and v.lstrip().startswith(('=', '+', '-', '@', '\t', '\r')) else v

    for p in d['points']:
        row = {**p, 'unit': d['unit'], 'source_url': d['source_url'], 'fetched_at': d['fetched_at']}
        w.writerow({k: cell(v) for k, v in row.items()})
    return Response(('\ufeff' + out.getvalue()).encode('utf-8'), media_type='text/csv; charset=utf-8', headers={'Content-Disposition': 'attachment; filename="observatory-data.csv"'})


@app.post('/api/evidence')
def create_evidence(req: EvidenceInput):
    return store.save('evidence', {**req.model_dump(mode='json'), 'id': store.uid('ev'), 'created_at': store.now()})


@app.put('/api/evidence/{id}')
def update_evidence(id: str, req: EvidenceInput):
    previous = store.get('evidence', id)
    if not previous:
        raise HTTPException(404, '证据不存在')
    return store.save('evidence', {**req.model_dump(mode='json'), 'id': id, 'created_at': previous['created_at'], 'updated_at': store.now()})


@app.delete('/api/evidence/{id}')
def delete_evidence(id: str):
    with store.connect() as c:
        c.execute('DELETE FROM evidence WHERE id=?', (id,))
    # Published research keeps its original evidence snapshot.
    return {'message': '已删除；已有报告仍保留生成时的证据快照'}


@app.post('/api/search')
async def search(req: SearchRequest):
    limit('search', 3)
    try:
        return await providers.search(req)
    finally:
        active.discard('search')


@app.get('/api/updates')
def updates():
    return updater.state()


@app.post('/api/updates', status_code=202)
async def start_update(req: UpdateRequest):
    return updater.start(req)


@app.put('/api/updates/plan')
def update_plan(req: UpdatePlan):
    return updater.save_plan(req)


@app.get('/api/updates/{id}')
def update_run(id: str):
    job = updater.get_job(id)
    if not job:
        raise HTTPException(404, '更新任务不存在')
    return job


@app.get('/api/evidence/{id}/source')
def evidence_source(id: str):
    result = updater.source(id)
    if not result:
        raise HTTPException(404, '该材料没有AI更新来源快照')
    return result


@app.get('/api/settings')
def settings():
    return store.settings()


@app.put('/api/settings')
def save_settings(req: SettingsInput):
    return store.save_settings(req.model_dump())


@app.post('/api/research')
async def research(req: ResearchInput):
    limit('research', 2)
    try:
        datasets = [d for d in store.listing('datasets') if d['region'] == req.region and (req.sector == '宏观' or d['sector'] in (req.sector, '宏观', '民生'))]
        evidence = [e for e in store.listing('evidence') if e['region'] == req.region and (req.sector == '宏观' or e['sector'] in (req.sector, '宏观'))]
        if not datasets and not evidence:
            raise ValueError('当前范围没有数据或证据，请先采集或录入材料')
        if len(evidence) > 100 or sum(len(d['points']) for d in datasets) > 25000:
            raise ValueError('研究上下文过大，请缩小到单个行业，避免静默截断证据')
        context = {'datasets': datasets, 'evidence': evidence}
        missing = [x for x in store.DIMENSIONS if x != '官方数据' and not any(e['dimension'] == x and e['verified'] for e in evidence)]
        if req.mode == 'ai':
            if not req.consent:
                raise ValueError('请确认将当前研究范围的数据与证据发送到已配置模型服务商')
            body = await providers.generate_ai(req.model_dump(mode='json'), context)
        else:
            claims = []
            for d in datasets:
                s = stats(d)
                if s and d['kind'] != 'composition':
                    claims.append({'text': f"{d['name']}：{s['latest_period']} 观测值 {s['latest']:.4g} {d['unit']}，覆盖 {s['first']}—{s['latest_period']}；不代表当前即时状态。", 'nature': '事实', 'refs': [d['id']]})
            body = {'summary': f'本简报整理了 {len(datasets)} 个已采集数据集和 {len(evidence)} 条证据。它是可复核的资料底稿，不自动给出趋势预测。',
                    'claims': claims, 'mechanism': ['核对增长、价格、信用与就业收入的历史变化', '对照政策执行、企业经营和居民行为验证传导链', '比较支持与反证，再形成有条件的情景判断'],
                    'scenarios': [], 'invalidation': ['数据修订或统计口径变化后，需重新核对结论', '政策未落实、订单或实际消费未响应时，不应外推政策意图'],
                    'missing': [f'{x}：缺少已人工核验的材料' for x in missing] + (['尚未配置模型研判；本次仅生成确定性的证据简报'] if req.mode == 'brief' else [])}
        report = {**req.model_dump(mode='json', exclude={'consent'}), 'id': store.uid('research'), 'created_at': store.now(),
                  'body': body, 'context': context, 'model': store.settings().get('model') if req.mode == 'ai' else None,
                  'warning': 'AI 叙述未经人工复核，引用存在不代表因果成立。' if req.mode == 'ai' else '资料整理不等于趋势预测。'}
        return store.save('reports', report)
    finally:
        active.discard('research')


@app.get('/api/research/{id}/export')
def export_report(id: str):
    r = store.get('reports', id)
    if not r:
        raise HTTPException(404, '研究不存在')
    b = r['body']
    lines = [f"# {r['question']}", f"\n生成时间：{r['created_at']}｜周期：{r['horizon']}｜范围：{r['sector']}", f"\n> {r['warning']}", '\n## 摘要', b['summary'], '\n## 判断与证据']
    lines.extend(f"- [{c['nature']}] {c['text']}（来源：{', '.join(c['refs'])}）" for c in b['claims'])
    lines += ['\n## 传导机制'] + [f'- {x}' for x in b['mechanism']]
    for s in b['scenarios']:
        lines += [f"\n## 情景：{s['name']}", s['assumptions'], f"验证指标：{s['triggers']}"]
    lines += ['\n## 反证条件'] + [f'- {x}' for x in b['invalidation']]
    lines += ['\n## 证据缺口'] + [f'- {x}' for x in b['missing']]
    lines += ['\n## 生成时来源快照']
    for d in r['context']['datasets']:
        lines.append(f"- {d['id']}：{d['name']}｜{d['source_url']}｜抓取 {d['fetched_at']}｜摘要 {d.get('digest', '用户导入')}")
    for e in r['context']['evidence']:
        lines.append(f"- {e['id']}：{e['title']}｜{e['url']}｜{e['summary']}")
    return Response('\n\n'.join(lines), media_type='text/markdown; charset=utf-8', headers={'Content-Disposition': 'attachment; filename="observatory-research.md"'})


dist = store.ROOT / 'dist'
if dist.exists():
    app.mount('/assets', StaticFiles(directory=dist / 'assets'), name='assets')


@app.get('/{path:path}')
def frontend(path: str):
    if path.startswith('api/'):
        raise HTTPException(404, '接口不存在')
    if path == 'favicon.svg':
        return FileResponse(store.ROOT / 'public' / 'favicon.svg')
    if not (dist / 'index.html').exists():
        raise HTTPException(503, '请先运行 npm run build，或使用 Vite 开发服务器')
    return FileResponse(dist / 'index.html')

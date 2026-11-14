import asyncio
from contextlib import suppress
from datetime import datetime, timedelta, timezone
import hashlib
import ipaddress
import json
import re
import sqlite3
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import httpx
from pydantic import ValidationError

from . import providers, store
from .models import EvidenceInput, SearchRequest, SyncRequest, UpdatePlan, UpdateRequest


SIGNALS = {'政策': '财政货币 扩内需 政策', '财报': '上市公司 季度报告', '市场预期': '经济展望 预测',
           '业内信息': '行业运行 产业景气', '民生': '就业 医保 民生保障', '公众意愿': '消费 就业 意愿 调查 论坛'}
TASKS = set()


def init():
    with store.connect() as c:
        c.executescript('''
        CREATE TABLE IF NOT EXISTS update_jobs(id TEXT PRIMARY KEY, status TEXT NOT NULL, payload TEXT NOT NULL);
        CREATE UNIQUE INDEX IF NOT EXISTS one_active_update ON update_jobs((1)) WHERE status IN ('queued','running');
        CREATE TABLE IF NOT EXISTS update_plan(id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS evidence_sources(evidence_id TEXT PRIMARY KEY, region TEXT NOT NULL,
          url TEXT NOT NULL, digest TEXT NOT NULL, payload TEXT NOT NULL, UNIQUE(region,url,digest));
        ''')
        # The local launcher runs one worker. Never replay a paid job after restart.
        for row in c.execute("SELECT payload FROM update_jobs WHERE status IN ('queued','running')").fetchall():
            job = json.loads(row['payload'])
            job.update(status='interrupted', finished_at=store.now(), stage='服务重启，任务中断；已入库内容保留，请手动重试')
            c.execute('UPDATE update_jobs SET status=?,payload=? WHERE id=?', ('interrupted', store.dumps(job), job['id']))


def canonical_url(value):
    p = urlsplit(value)
    host = (p.hostname or '').lower().rstrip('.')
    if p.scheme != 'https' or not host or p.username or p.password or p.port not in (None, 443) or len(value) > 2000:
        raise ValueError('来源URL不符合公开HTTPS契约')
    if '.' not in host or host.endswith(('.local', '.internal', '.localhost')):
        raise ValueError('不接收本地来源URL')
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        address = None
    if address and not address.is_global:
        raise ValueError('不接收私有地址')
    pairs = []
    for k, v in parse_qsl(p.query, keep_blank_values=True):
        if k.lower() in ('token', 'key', 'api_key', 'access_token', 'password', 'signature'):
            raise ValueError('来源URL含敏感参数')
        if not k.lower().startswith('utm_') and k.lower() not in ('fbclid', 'gclid'):
            pairs.append((k, v))
    return urlunsplit(('https', f'[{host}]' if ':' in host else host, p.path.rstrip('/') or '/', urlencode(sorted(pairs)), ''))


def digest(content):
    return hashlib.sha256(re.sub(r'\s+', ' ', content).strip().encode()).hexdigest()


def shingles(content):
    text = re.sub(r'\W+', '', content.lower())
    return {hash(text[i:i+24]) for i in range(max(0, len(text)-23))}


def same_article(left, right):
    common = len(left & right)
    return common >= 100 and common / max(1, min(len(left), len(right))) >= .90


def plan():
    with store.connect() as c:
        row = c.execute('SELECT payload FROM update_plan WHERE id=1').fetchone()
    return json.loads(row['payload']) if row else {**UpdatePlan().model_dump(), 'next_run_at': None, 'last_error': ''}


def ready():
    cfg = store.settings()
    if not cfg.get('model') or not cfg.get('model_key') and not cfg.get('model_base_url', '').startswith(('http://localhost:', 'http://127.0.0.1:')):
        return False, '请在数据与API设置中配置模型及密钥'
    if not cfg.get('tavily_key') and not (httpx.URL(cfg['model_base_url']).host == 'api.deepseek.com' and cfg.get('model_key')):
        return False, '请配置DeepSeek官方模型Key或Tavily检索Key'
    return True, ''


def save_plan(req: UpdatePlan):
    if req.enabled:
        if not req.consent:
            raise ValueError('开启每日更新需同意将主题和公开网页发送到已配置的服务，可能产生费用')
        ok, why = ready()
        if not ok:
            raise ValueError(why)
    old = plan()
    value = {**req.model_dump(), 'next_run_at': (old.get('next_run_at') if old.get('enabled') else None)
             or ((datetime.now(timezone.utc) + timedelta(days=1)).isoformat(timespec='seconds') if req.enabled else None), 'last_error': ''}
    if not req.enabled:
        value['next_run_at'] = None
    with store.connect() as c:
        c.execute('INSERT OR REPLACE INTO update_plan VALUES(1,?)', (store.dumps(value),))
    return value


def save_job(job):
    with store.connect() as c:
        c.execute('UPDATE update_jobs SET status=?,payload=? WHERE id=?', (job['status'], store.dumps(job), job['id']))


def state():
    with store.connect() as c:
        runs = [json.loads(r['payload']) for r in c.execute('SELECT payload FROM update_jobs ORDER BY rowid DESC LIMIT 8')]
        active = c.execute("SELECT payload FROM update_jobs WHERE status IN ('queued','running')").fetchone()
    ok, why = ready()
    return {'plan': plan(), 'runs': runs, 'active': json.loads(active['payload']) if active else None, 'ready': ok, 'reason': why}


def get_job(id):
    with store.connect() as c:
        row = c.execute('SELECT payload FROM update_jobs WHERE id=?', (id,)).fetchone()
    return json.loads(row['payload']) if row else None


def source(id):
    with store.connect() as c:
        row = c.execute('SELECT payload FROM evidence_sources WHERE evidence_id=?', (id,)).fetchone()
    return json.loads(row['payload']) if row else None


def start(req: UpdateRequest, trigger='manual'):
    if not req.consent:
        raise ValueError('AI更新会发送研究主题和公开网页到已配置的检索与模型服务，请同意后执行')
    ok, why = ready()
    if not ok:
        raise ValueError(why)
    job = {'id': store.uid('update'), 'status': 'queued', 'trigger': trigger, 'request': req.model_dump(),
           'created_at': store.now(), 'finished_at': None, 'stage': '等待后台执行', 'completed': 0,
           'total': 7 if req.sync_data else 6, 'added': 0, 'revised': 0, 'duplicates': 0, 'datasets': 0,
           'errors': [], 'items': [], 'steps': []}
    with store.connect() as c:
        c.execute('BEGIN IMMEDIATE')
        last = c.execute('SELECT payload FROM update_jobs ORDER BY rowid DESC LIMIT 1').fetchone()
        if last and (datetime.now(timezone.utc) - datetime.fromisoformat(json.loads(last['payload'])['created_at'])).total_seconds() < 60:
            raise ValueError('请至少间隔60秒再发起更新，避免重复消耗额度')
        try:
            c.execute('INSERT INTO update_jobs VALUES(?,?,?)', (job['id'], job['status'], store.dumps(job)))
        except sqlite3.IntegrityError:
            raise ValueError('已有更新任务正在执行，请等待完成') from None
    task = asyncio.create_task(run(job))
    TASKS.add(task)
    task.add_done_callback(TASKS.discard)
    return job


def remember(evidence, page, job_id):
    """Save a new evidence version and its bounded source snapshot in one transaction."""
    with store.connect() as c:
        c.execute('BEGIN IMMEDIATE')
        previous = c.execute('SELECT evidence_id,digest FROM evidence_sources WHERE region=? AND url=? ORDER BY rowid DESC LIMIT 1',
                             (evidence['region'], page['url'])).fetchone()
        duplicate = c.execute('SELECT evidence_id FROM evidence_sources WHERE region=? AND url=? AND digest=?',
                              (evidence['region'], page['url'], page['digest'])).fetchone()
        if duplicate:
            return 'duplicate', duplicate['evidence_id'], None
        previous_id = previous['evidence_id'] if previous else None
        if not previous_id:
            for row in c.execute('SELECT payload FROM evidence ORDER BY rowid DESC'):
                old = json.loads(row['payload'])
                try:
                    same = old['region'] == evidence['region'] and canonical_url(old['url']) == page['url']
                except ValueError:
                    same = False
                if same:
                    previous_id = old['id']
                    break
        id = store.uid('ev')
        saved = {**evidence, 'id': id, 'created_at': store.now()}
        provenance = {'evidence_id': id, 'previous_id': previous_id, 'run_id': job_id, 'url': page['url'],
                      'digest': page['digest'], 'retrieved_at': page['retrieved_at'], 'excerpt': page['content'],
                      'scope': (page.get('read_note') or '检索服务返回正文') + '；最多12000字符，可能不完整，未独立审计'}
        c.execute('INSERT INTO evidence VALUES(?,?)', (id, store.dumps(saved)))
        c.execute('INSERT INTO evidence_sources VALUES(?,?,?,?,?)', (id, evidence['region'], page['url'], page['digest'], store.dumps(provenance)))
    return 'revised' if previous_id else 'added', id, previous_id


def dated(value, quote, content):
    if not value:
        return None
    if not quote or quote not in content:
        return None
    forms = (value.isoformat(), f'{value.year}-{value.month}-{value.day}', value.strftime('%Y/%m/%d'),
             f'{value.year}年{value.month}月{value.day}日',
             f'{value.year}年{value.month:02}月{value.day:02}日', value.strftime('%B %d, %Y'),
             f'{value.strftime("%B")} {value.day}, {value.year}', value.strftime('%b %d, %Y'),
             f'{value.strftime("%b")} {value.day}, {value.year}', value.strftime('%d %B %Y'), value.strftime('%d %b %Y'))
    return value if any(f in quote for f in forms) else None


async def sync_existing(req, job):
    targets = [SyncRequest(region=req.region)]
    seen = {('worldbank', req.region)}
    for d in store.listing('datasets'):
        if d['region'] != req.region or d['provider'] not in ('fred', 'tushare'):
            continue
        key = (d['provider'], d['indicator'])
        if key not in seen:
            seen.add(key)
            targets.append(SyncRequest(provider=d['provider'], region=req.region,
                                       **({'series_id': d['indicator']} if d['provider'] == 'fred' else {'ts_code': d['indicator']})))
    for target in targets:
        try:
            result = await providers.sync(target)
            job['datasets'] += len(result)
            job['steps'].append({'dimension': '官方数据', 'message': f'{target.provider} 已同步{len(result)}个数据集'})
        except (ValueError, TimeoutError):
            job['errors'].append(f'官方数据/{target.provider} 同步失败；保留上次成功版本，请检查网络、权限及配额')
        save_job(job)


async def update_dimension(req, dimension, job):
    today = datetime.now(timezone(timedelta(hours=8))).date()
    since = today - timedelta(days=req.lookback_days)
    country = {'CHN': '中国', 'USA': '美国', 'WLD': '全球'}[req.region]
    signal = f'{today.year} 季度报告 业绩公告' if dimension == '财报' else SIGNALS[dimension]
    query = f'{country} {req.sector[:12]} {signal} after:{since.isoformat()}'
    results = await providers.search(SearchRequest(query=query, dimension=dimension, sector=req.sector, region=req.region), full_content=True)
    pages, seen = [], set()
    with store.connect() as c:
        known = {(r['url'], r['digest']) for r in c.execute('SELECT url,digest FROM evidence_sources WHERE region=?', (req.region,))}
        previous_pages = [json.loads(r['payload']) for r in c.execute('SELECT payload FROM evidence_sources WHERE region=? ORDER BY rowid DESC LIMIT 200', (req.region,))]
    comparisons = [(p['url'], shingles(p['excerpt'])) for p in previous_pages]
    pdf_attempts = 0
    results.sort(key=lambda r: str(r.get('search_date') or ''), reverse=True)
    for r in results:
        try:
            url = canonical_url(r['url'])
        except (ValueError, KeyError):
            continue
        if url in seen:
            continue
        seen.add(url)
        if dimension == '财报' and (urlsplit(url).hostname == 'irm.cninfo.com.cn' or re.search('问答|互动|股吧|提问', r['title'])):
            job['items'].append({'dimension': dimension, 'title': r['title'], 'url': url, 'status': 'skipped', 'message': '互动问答不是公司财务披露，跳过'})
            continue
        body = r.get('content', '').strip()[:12000]
        pdf_note = ''
        if len(body) < 200 and dimension == '财报' and urlsplit(url).path.lower().endswith('.pdf') and pdf_attempts < 2:
            pdf_attempts += 1
            try:
                body = (await providers.financial_pdf(url))[:12000]
                pdf_note = '交易所PDF前6页文本，表格数值需人工核对'
            except ValueError:
                pass
        if len(body) < 200:
            job['items'].append({'dimension': dimension, 'title': r['title'], 'url': url, 'status': 'skipped', 'message': '正文不足，未将检索摘要冒充原文'})
            continue
        fingerprint = digest(body)
        if (url, fingerprint) in known:
            job['duplicates'] += 1
            job['items'].append({'dimension': dimension, 'title': r['title'], 'url': url, 'status': 'duplicate', 'message': '已有同正文版本，跳过'})
            continue
        pieces = shingles(body)
        # Same-URL changes remain revisions; only different-URL near-reprints are skipped.
        if not any(old_url == url for old_url, _ in comparisons) and any(same_article(pieces, old) for old_url, old in comparisons if old_url != url):
            job['duplicates'] += 1
            job['items'].append({'dimension': dimension, 'title': r['title'], 'url': url, 'status': 'duplicate', 'message': '疑似同稿转载（正文高度重合），跳过；可人工复核补录'})
            continue
        pages.append({'source_id': f's{len(pages)+1}', 'url': url, 'title': r['title'], 'source_name': r['source_name'],
                      'content': body, 'digest': fingerprint, 'retrieved_at': store.now(), 'read_note': pdf_note})
        comparisons.append((url, pieces))
        if len(pages) == 2:
            break
    if not pages:
        job['steps'].append({'dimension': dimension, 'message': '未找到新的可读正文；不代表此维度没有变化'})
        return
    extracted = await providers.extract_materials(pages, dimension, req, today.isoformat())
    by_id = {p['source_id']: p for p in pages}
    used = set()
    for m in extracted:
        p = by_id.get(m.source_id)
        if not p:
            job['errors'].append(f'{dimension}：模型返回未知来源编号，已排除该条，不接收模型自造链接')
            continue
        if m.source_id in used:
            job['items'].append({'dimension': dimension, 'title': p['title'], 'url': p['url'], 'status': 'skipped', 'message': '模型重复引用同一来源，仅保留首条'})
            continue
        used.add(m.source_id)
        if m.basis_quote not in p['content']:
            job['items'].append({'dimension': dimension, 'title': p['title'], 'url': p['url'], 'status': 'skipped', 'message': '摘要依据未匹配正文，未入库'})
            continue
        publication = dated(m.published_at, m.date_quote, p['content'])
        if m.published_at and m.published_at > today or publication and publication < since:
            job['items'].append({'dimension': dimension, 'title': p['title'], 'url': p['url'], 'status': 'skipped', 'message': '发布日期不在本轮时间范围'})
            continue
        notes = m.sample_note + '｜AI整理，未人工核验；本次只读取来源正文的有限片段。'
        if p['read_note']:
            notes += p['read_note'] + '。'
        if not publication:
            notes += '发布日期未获正文支持，保持未知，不能保证为最新发布。'
        value = EvidenceInput(title=p['title'], dimension=dimension,
                              nature='观点' if dimension in ('市场预期', '公众意愿') else m.nature,
                              source_type='社区' if dimension == '公众意愿' and m.source_type == '社区' else m.source_type,
                              source_name=p['source_name'], url=p['url'], published_at=publication, sector=req.sector, region=req.region,
                              summary=m.summary, mechanism=m.mechanism, counterevidence=m.counterevidence, sample_note=notes[:1000],
                              policy_stage=m.policy_stage if dimension == '政策' else '不适用', verified=False).model_dump(mode='json')
        status, id, previous_id = remember(value, p, job['id'])
        job['duplicates' if status == 'duplicate' else status] += 1
        job['items'].append({'dimension': dimension, 'title': p['title'], 'url': p['url'], 'status': status,
                             'evidence_id': id, 'previous_id': previous_id,
                             'message': '新增版本，保留旧记录' if previous_id else '已入库，待人工核验'})
        save_job(job)
    job['steps'].append({'dimension': dimension, 'message': f'读取{len(pages)}份正文，AI采纳{len(extracted)}条；详见逐项结果'})


async def run(job):
    req = UpdateRequest.model_validate(job['request'])
    job.update(status='running', stage='准备更新')
    save_job(job)
    try:
        if req.sync_data:
            job['stage'] = '同步官方数据接口（AI不改写数值）'
            save_job(job)
            await sync_existing(req, job)
            job['completed'] += 1
        for dimension in SIGNALS:
            job['stage'] = f'检索与AI整理 · {dimension}'
            save_job(job)
            try:
                async with asyncio.timeout(180):
                    await update_dimension(req, dimension, job)
            except (ValueError, TimeoutError) as exc:
                message = '材料字段未通过契约校验' if isinstance(exc, ValidationError) else str(exc)[:220] or '处理超时'
                job['errors'].append(f'{dimension}更新失败：{message}；旧资料保留')
            except Exception:
                job['errors'].append(f'{dimension}处理异常；未覆盖旧资料')
            job['completed'] += 1
            save_job(job)
            await asyncio.sleep(.3)
        status = ('partial' if job['steps'] else 'failed') if job['errors'] else 'completed'
        job.update(status=status, stage='本轮已结束；新增材料待人工核验')
    except asyncio.CancelledError:
        job.update(status='interrupted', stage='服务关闭，任务中断；已保存结果保留')
        raise
    except Exception:
        job.update(status='failed', stage='更新中断；已保存结果保留', errors=job['errors'] + ['更新执行失败，请检查服务状态后重试'])
    finally:
        job['finished_at'] = store.now()
        save_job(job)


async def tick():
    current = plan()
    if not current['enabled'] or not current.get('next_run_at') or datetime.fromisoformat(current['next_run_at']) > datetime.now(timezone.utc):
        return
    if state()['active']:
        return
    # One catch-up only, not one paid run for every missed day.
    current['next_run_at'] = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(timespec='seconds')
    try:
        start(UpdateRequest.model_validate({k: current[k] for k in UpdateRequest.model_fields}), 'scheduled')
        current['last_error'] = ''
    except ValueError:
        current['last_error'] = '计划更新未启动：请检查模型/检索配置、配额及任务状态；下次按计划检查'
    with store.connect() as c:
        c.execute('INSERT OR REPLACE INTO update_plan VALUES(1,?)', (store.dumps(current),))


async def scheduler():
    while True:
        with suppress(Exception):
            await tick()
        await asyncio.sleep(30)


async def shutdown():
    tasks = list(TASKS)
    for task in tasks:
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)

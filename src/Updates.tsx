import { useEffect, useRef, useState } from 'react';
import { Clock3, RefreshCw, Sparkles } from 'lucide-react';
import { api, datetime, regions } from './types';

type Request = { region: string; sector: string; lookback_days: number; sync_data: boolean; consent: boolean };
type Plan = Request & { enabled: boolean; next_run_at: string | null; last_error: string };
type Item = { dimension: string; title: string; url: string; status: string; message: string; evidence_id?: string; previous_id?: string };
type Run = { id: string; status: string; trigger: string; request: Request; created_at: string; finished_at: string | null; stage: string; completed: number; total: number; added: number; revised: number; duplicates: number; datasets: number; errors: string[]; items: Item[]; steps: { dimension: string; message: string }[] };
type State = { plan: Plan; runs: Run[]; active: Run | null; ready: boolean; reason: string };
const statuses: Record<string, string> = { queued: '排队中', running: '更新中', completed: '本轮完成', partial: '部分失败', failed: '失败', interrupted: '已中断' };

export default function Updates({ region, onReload }: { region: string; onReload: () => Promise<void> }) {
  const [state, setState] = useState<State | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [sector, setSector] = useState('宏观'), [days, setDays] = useState(90), [sync, setSync] = useState(true);
  const initialized = useRef(false), lastRun = useRef(''), reload = useRef(onReload);
  reload.current = onReload;
  const running = !!state?.active;
  useEffect(() => {
    let stopped = false;
    const load = async () => {
      try {
        const result = await api<State>('/updates');
        if (stopped) return;
        setLoadError('');
        setState(result);
        if (!initialized.current) {
          initialized.current = true;
          if (result.plan.region === region) { setSector(result.plan.sector); setDays(result.plan.lookback_days); setSync(result.plan.sync_data); }
        }
        const latest = result.runs[0];
        if (latest && lastRun.current !== `${latest.id}:${latest.status}`) {
          const previous = lastRun.current;
          lastRun.current = `${latest.id}:${latest.status}`;
          if (previous && !['queued', 'running'].includes(latest.status)) await reload.current();
        }
      } catch (e) { if (!stopped) setLoadError((e as Error).message); }
    };
    void load();
    const timer = setInterval(() => void load(), running ? 2500 : 15000);
    return () => { stopped = true; clearInterval(timer); };
  }, [region, running]);
  const request = (): Request => ({ region, sector: sector.trim(), lookback_days: days, sync_data: sync, consent: true });
  async function start(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const job = await api<Run>('/updates', 'POST', request());
      lastRun.current = `${job.id}:${job.status}`;
      setState(s => s ? { ...s, active: job, runs: [job, ...s.runs.filter(r => r.id !== job.id)].slice(0, 8) } : s);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function schedule() {
    if (!state) return;
    setBusy(true); setError('');
    try {
      const { next_run_at: _next, last_error: _last, ...saved } = state.plan;
      const plan = await api<Plan>('/updates/plan', 'PUT', state.plan.enabled ? { ...saved, enabled: false } : { ...request(), enabled: true });
      setState(s => s ? { ...s, plan } : s);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const latest = state?.active ?? state?.runs[0];
  return <section className="update-panel panel" aria-labelledby="update-title">
    <div className="update-heading"><div><span className="section-label">资料更新 / 保留每次来路</span><h2 id="update-title"><Sparkles size={19}/>AI 更新资料</h2><p>六个维度自动检索、读取正文并整理入库；数值走数据接口，AI不改写观测值。每轮最多新增12份材料。</p></div><span className="pill gold-pill">增量更新 · 旧版本保留</span></div>
    <form className="update-controls" onSubmit={start}>
      <label>更新主题<input aria-label="AI更新主题" required minLength={1} maxLength={30} value={sector} onChange={e => setSector(e.target.value)} disabled={!state || busy || running}/></label>
      <label>检索时间范围<select aria-label="AI更新时间范围" value={days} onChange={e => setDays(Number(e.target.value))} disabled={!state || busy || running}><option value={30}>近30天</option><option value={90}>近90天</option><option value={180}>近半年</option><option value={365}>近一年</option></select></label>
      <label className="check-label"><input type="checkbox" checked={sync} onChange={e => setSync(e.target.checked)} disabled={!state || busy || running}/><span>同时同步已有API数据</span></label>
      <button className="button primary" type="submit" disabled={busy || running || !state?.ready}><RefreshCw size={15} className={running ? 'updating-icon' : ''}/>{running ? '后台更新中…' : '立即 AI 更新'}</button>
    </form>
    <p className="caption">点击更新或开启每日更新，即同意发送主题与检索到的公开网页到已配置服务商；每轮最多6次检索与6次模型整理，可能产生费用。只同步WDI及已接入的FRED/Tushare，不处理手动CSV。</p>
    {state && !state.ready && <p className="inline-error">{state.reason}；仍可手动记录材料。</p>}
    {error && <p className="inline-error" role="alert">{error}</p>}
    {loadError && <p className="inline-error" role="alert">状态连接失败：{loadError}；连接恢复后自动重试，后台任务不会因关闭页面取消。</p>}
    <div className="update-schedule"><Clock3 size={17}/><div><strong>{state?.plan.enabled ? '每日更新已开启' : '每日更新未开启'}</strong><p>{state?.plan.enabled ? `${regions[state.plan.region]} · ${state.plan.sector} · 每24小时检查一次；下次 ${datetime(state.plan.next_run_at)}` : '开启后按当前地区、主题与范围保存计划；项目需保持运行。'}<br/>关闭不取消正在执行的本轮；关机错过的计划，下次启动只补跑一轮。</p></div><button type="button" className="button secondary" onClick={() => void schedule()} disabled={busy || !state || !state.plan.enabled && (!state.ready || !sector.trim())}>{state?.plan.enabled ? '关闭每日更新' : '开启每日更新'}</button></div>
    {state?.plan.last_error && <p className="inline-error">{state.plan.last_error}</p>}
    {latest && <div className="update-progress" role="status" aria-live="polite"><div><strong>{statuses[latest.status]}</strong><span>{latest.stage}</span></div><progress aria-label="本轮更新进度" value={latest.completed} max={latest.total}/><p>新材料 {latest.added} · 修订版本 {latest.revised} · 重复跳过 {latest.duplicates} · 数据集同步 {latest.datasets} · 失败 {latest.errors.length}</p></div>}
    {!!state?.runs.length && <div className="update-history"><h3>更新记录</h3>{state.runs.map(job => <details key={job.id}><summary>{datetime(job.created_at)} · {statuses[job.status]} · {regions[job.request.region]} / {job.request.sector} · {job.trigger === 'scheduled' ? '计划执行' : '手动发起'}</summary><p className="caption">任务 {job.id}｜历史来源快照不随新版本覆盖；页面变化不必然代表经济事实发生变化。</p>{job.errors.map((v, i) => <p key={i} className="inline-error">{v}</p>)}<ul>{job.steps.map((s, i) => <li key={i}><strong>{s.dimension}：</strong>{s.message}</li>)}</ul><ul>{job.items.map((item, i) => <li key={i}><span className="pill">{item.dimension}</span> <a href={item.url} target="_blank" rel="noreferrer">{item.title}</a><span> — {item.message}</span>{item.evidence_id && item.status !== 'duplicate' && <> · <a href={`/api/evidence/${item.evidence_id}/source`} target="_blank" rel="noreferrer">来源快照{item.previous_id ? '与上一版本编号' : ''}</a></>}</li>)}</ul></details>)}</div>}
    <p className="caption">AI新增材料一律待人工核验；预测不是实绩，帖子不是全国民意。没有新结果不代表市场没有变化，旧研究报告不会被自动改写。</p>
  </section>;
}

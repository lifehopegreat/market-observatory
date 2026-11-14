import { useState } from 'react';
import { ArrowRight, Clock3, Download, FileText, Plus, Printer, ShieldAlert, Sparkles } from 'lucide-react';
import { api, datetime, fmt } from './types';
import type { Bootstrap, Research as ResearchType } from './types';
import { Empty, External, Modal, PageHeading } from './ui';

export function CreateResearch({ region, data, onClose, onCreated }: { region: string; data: Bootstrap; onClose: () => void; onCreated: () => Promise<void> }) {
  const [question, setQuestion] = useState('中国居民消费的长期变化由哪些因素驱动，哪些证据仍需验证？'), [sector, setSector] = useState('宏观'), [horizon, setHorizon] = useState('1—3年'), [mode, setMode] = useState('brief'), [consent, setConsent] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function submit(e: React.FormEvent) { e.preventDefault(); setBusy(true); setError(''); try { await api('/research', 'POST', { question, region, sector, horizon, mode, consent }); await onCreated(); onClose(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  return <Modal title="从一个值得研究的问题开始" subtitle="研究使用当前范围内已保存的数据与证据，同时保留生成时快照。" onClose={onClose}><form className="modal-body form-grid" onSubmit={submit}>
    <label className="span-2">研究问题<textarea required minLength={5} maxLength={1500} rows={3} value={question} onChange={e => setQuestion(e.target.value)}/></label>
    <label>研究范围<select value={sector} onChange={e => setSector(e.target.value)}>{[...new Set(['宏观', ...data.datasets.map(d => d.sector), ...data.evidence.map(e => e.sector)])].map(s => <option key={s}>{s}</option>)}</select></label>
    <label>观察周期<select value={horizon} onChange={e => setHorizon(e.target.value)}>{['3—6个月', '6—12个月', '1—3年', '3—5年'].map(s => <option key={s}>{s}</option>)}</select></label>
    <fieldset className="mode-options span-2"><legend>研究方式</legend><label className={mode === 'brief' ? 'selected' : ''}><input type="radio" name="mode" value="brief" checked={mode === 'brief'} onChange={() => setMode('brief')}/><FileText size={18}/><span><strong>证据简报</strong><small>本地确定性整理 · 不调用模型 · 不做预测</small></span></label><label className={mode === 'ai' ? 'selected' : ''}><input type="radio" name="mode" value="ai" checked={mode === 'ai'} onChange={() => setMode('ai')}/><Sparkles size={18}/><span><strong>模型辅助研判</strong><small>证据引用、传导机制、条件情景与反证</small></span></label></fieldset>
    {mode === 'ai' && <div className="callout span-2"><strong>{data.settings.model ? `当前模型：${data.settings.model}` : '尚未设置模型，请先到 API 设置配置'}</strong><p>当前范围的指标历史、原文摘录及笔记将发送到 {data.settings.model_base_url}。模型结论需人工复核，API 可能产生费用。</p><label className="check-label"><input required type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)}/><span>我同意将所选范围的研究材料发送给该模型服务商</span></label></div>}
    {error && <p className="inline-error span-2" role="alert">{error}</p>}<div className="form-footer span-2"><button type="button" className="button secondary" onClick={onClose}>取消</button><button className="button primary" disabled={busy}>{busy ? '整理研究中…' : mode === 'ai' ? '生成辅助研判' : '生成证据简报'}<ArrowRight size={15}/></button></div>
  </form></Modal>;
}

function ReportView({ report }: { report: ResearchType }) {
  const b = report.body;
  const refs = [...report.context.datasets.map(d => ({ id: d.id, title: d.name, url: d.source_url, text: `${d.source_name} · 抓取于 ${datetime(d.fetched_at)} · ${d.points.length} 条观测`, digest: d.digest })), ...report.context.evidence.map(e => ({ id: e.id, title: e.title, url: e.url, text: `${e.summary}\n${e.verified ? '人工核验' : '待核验'} · ${e.published_at ?? '发布日期未知'}`, digest: undefined }))];
  return <article className="report-paper panel"><div className="report-meta"><span className="pill gold-pill">{report.mode === 'ai' ? '模型辅助研判' : '证据简报'}</span><span>{report.sector} / {report.horizon}</span><span><Clock3 size={12}/>{datetime(report.created_at)}</span></div><h2>{report.question}</h2><div className="report-actions"><a className="text-button" href={`/api/research/${report.id}/export`}><Download size={14}/>导出 Markdown</a><button className="text-button" onClick={() => window.print()}><Printer size={14}/>打印 / PDF</button></div><div className="report-warning"><ShieldAlert size={16}/>{report.warning}</div>
    <section><div className="eyebrow">研究摘要</div><p className="report-summary">{b.summary}</p></section>
    <section><h3><span>01</span>观察与判断</h3>{b.claims.map((c, i) => <div className="claim" key={i}><span className="pill">{c.nature}</span><p>{c.text}</p><div className="claim-refs">{c.refs.map(id => { const r = refs.find(r => r.id === id); return r ? <a href={`#ref-${id}`} key={id}>{r.title}</a> : <span key={id}>无效引用</span>; })}</div></div>)}</section>
    <section><h3><span>02</span>传导机制</h3><ol className="report-mechanism">{b.mechanism.map((m, i) => <li key={i}>{m}</li>)}</ol></section>
    {b.scenarios.length > 0 && <section><h3><span>03</span>条件情景，而非确定预测</h3><div className="scenario-grid">{b.scenarios.map((s, i) => <div key={i}><span className="eyebrow">情景 {i + 1}</span><h4>{s.name}</h4><p>{s.assumptions}</p><strong>后续验证</strong><p>{s.triggers}</p></div>)}</div></section>}
    <section className="report-checks"><div><h3>反证与失效条件</h3><ul>{b.invalidation.map((x, i) => <li key={i}>{x}</li>)}</ul></div><div><h3>仍然未知的部分</h3><ul>{b.missing.map((x, i) => <li key={i}>{x}</li>)}</ul></div></section>
    <section><h3>来源与生成时快照</h3><p className="caption">此处材料不会随证据库后续修改而变化；数据快照不包含 API 密钥。</p>{refs.map(r => <details className="report-ref" key={r.id} id={`ref-${r.id}`}><summary>{r.title}<span>{r.id}</span></summary><p>{r.text}</p><External href={r.url}>打开原始来源</External>{r.digest && <small className="digest">SHA256 {r.digest}</small>}</details>)}<p className="caption">本报告使用 {report.context.datasets.reduce((n, d) => n + d.points.length, 0)} 条历史观测，原始数值保留在本地报告上下文中。示例：{report.context.datasets[0]?.name} 最近有效值 {fmt(report.context.datasets[0]?.points.filter(p => p.value != null).at(-1)?.value)}。</p></section>
  </article>;
}

export default function ResearchPage({ reports, onCreate }: { reports: ResearchType[]; onCreate: () => void }) {
  const [selected, setSelected] = useState('');
  const report = reports.find(r => r.id === selected) ?? reports[0];
  return <><PageHeading kicker="从信息，到可复核的判断" title="研究，不止于一个结论。" description="保留问题、证据、传导机制和反证。让下一次研究能够检验这一次判断。" action={<button className="button primary" onClick={onCreate}><Plus size={16}/>创建研究</button>}/>{!reports.length ? <div className="panel"><Empty title="把观察，沉淀成研究。" text="已有数据可先生成本地证据简报。配置模型后，再生成带引用与情景的辅助研判。" action={<button className="button primary" onClick={onCreate}>创建第一份研究<ArrowRight size={15}/></button>}/></div> : <div className="report-layout"><aside className="report-index">{reports.map(r => <button className={report.id === r.id ? 'selected' : ''} key={r.id} onClick={() => setSelected(r.id)}><span>{r.mode === 'ai' ? '辅助研判' : '证据简报'} · {r.sector}</span><strong>{r.question}</strong><small>{datetime(r.created_at)}</small></button>)}</aside><ReportView key={report.id} report={report}/></div>}</>;
}

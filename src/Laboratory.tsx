import { useState } from 'react';
import { ArrowRight, ChevronDown, Database, FileUp, History, SlidersHorizontal } from 'lucide-react';
import Chart from './Chart';
import { Empty, External, Modal, PageHeading } from './ui';
import type { Bootstrap, Dataset } from './types';
import { api, datetime, fmt, frequencyLabels } from './types';
import { summarize } from './chartMath';

export default function Laboratory({ data, theme, region, industry, selected, onSelect, onImport, onSync, busy }: { data: Bootstrap; theme: string; region: string; industry: boolean; selected: string; onSelect: (s: string) => void; onImport: () => void; onSync: () => void; busy: boolean }) {
  const [sector, setSector] = useState('制造业'), [snapshotList, setSnapshotList] = useState<{ id: number; fetched_at: string; digest: string }[] | null>(null), [snapshotData, setSnapshotData] = useState<Dataset | null>(null), [error, setError] = useState('');
  const sectors = [...new Set(data.datasets.map(d => d.sector))];
  const options = data.datasets.filter(d => !industry || d.sector === sector);
  const d = options.find(d => d.id === selected) ?? options[0];
  async function history() { if (!d) return; setError(''); try { setSnapshotList(await api(`/datasets/${encodeURIComponent(d.id)}/snapshots`)); } catch (e) { setError((e as Error).message); } }
  async function openSnapshot(id: number) { try { setSnapshotData(await api(`/snapshots/${id}`)); } catch (e) { setError((e as Error).message); } }
  return <>
    <PageHeading kicker={industry ? '从宏观，下钻产业' : '数据可视化 / 分析工作区'} title={industry ? '理解一个行业的来路与去向。' : '让数据，接受更仔细的观察。'} description={industry ? '从长期结构到当期经营，再用政策、供需与居民需求交叉验证。' : '口径先于图形。按数据语义选择可用图表，保留原始值与来源。'} action={<button className="button primary" onClick={onImport}><FileUp size={16}/>导入数据</button>}/>
    {industry && <div className="sector-tabs">{sectors.filter(s => !['宏观', '人口', '交易行情'].includes(s)).map(s => <button key={s} onClick={() => { setSector(s); }} className={sector === s ? 'selected' : ''}>{s}<ArrowRight size={14}/></button>)}</div>}
    <div className="lab-picker panel"><div className="picker-label"><SlidersHorizontal size={17}/><span>选择数据集</span></div><label className="dataset-picker"><select aria-label="分析数据集" value={d?.id ?? ''} onChange={e => onSelect(e.target.value)}>{options.map(d => <option key={d.id} value={d.id}>{d.name}{d.points.length ? '' : ' · 尚未采集'}</option>)}</select><ChevronDown size={15}/></label><span className="pill">{d ? frequencyLabels[d.frequency] : '暂无数据集'}</span><button className="text-button" onClick={history} disabled={!d?.points.length}><History size={15}/>历史快照</button></div>
    {error && <p role="alert" className="inline-error">{error}</p>}
    {d?.points.length ? <Chart key={d.id} dataset={d} datasets={data.datasets} theme={theme}/> : <div className="panel"><Empty title="这份观察，还缺一组数据" text="采集年度历史序列，或导入官方月频、行业财务、真实 OHLC、公众调查构成数据。" action={<><button className="button primary" onClick={onSync} disabled={busy}>采集历史序列</button><button className="button secondary" onClick={onImport}>导入 CSV</button></>}/></div>}
    {industry && <div className="industry-framework"><section className="panel"><div className="eyebrow">产业研究框架</div><h3>{sector} · 从结构到行为</h3><div className="mechanism-track">{['需求与收入', '订单与库存', '产能与投资', '利润与现金流', '政策与约束'].map((x, i) => <div key={x}><span>0{i + 1}</span><strong>{x}</strong><p>{['消费者需要什么，是否有购买能力', '意愿是否转化为真实订单与消化', '供给扩张是否超过需求增量', '收入增长能否转化为可持续盈利', '政策意图是否获得预算与执行'][i]}</p></div>)}</div></section><aside className="industry-caveat"><Database size={19}/><h3>占比变化 ≠ 景气判断</h3><p>当前行业分类来自已接入的数据集。年度增加值占比只能观察结构，不能替代近期订单、财报或产业链调研。细分行业可通过导入数据与证据库扩展。</p></aside></div>}
    {!industry && <div className="chart-guidelines"><h3>图表选择原则</h3><div><p><strong>折线 / 面积</strong>用于连续时间序列，缺失处保留断线。</p><p><strong>柱状图</strong>对比数值大小，纵轴包含零基线。</p><p><strong>K 线图</strong>仅用于真实 OHLC；宏观指标不能硬转。</p><p><strong>饼状图</strong>仅用于同一时点、互斥且非负的构成数据。</p></div></div>}
    <p className="caption">当前范围 {region}；同比仅对水平值按上年同期计算，不将增长率再次增长率化。全期均值不是趋势预测。</p>
    {snapshotList && <Modal title="数据修订与历史快照" subtitle="从首次采集开始记录内容变化；不能重建采集之前的历史已知值。" onClose={() => { setSnapshotList(null); setSnapshotData(null); }} wide><div className="modal-body">{snapshotList.length ? <div className="snapshot-list">{snapshotList.map(s => <button key={s.id} className="snapshot-row" onClick={() => openSnapshot(s.id)}><History size={16}/><span>{datetime(s.fetched_at)}<small>SHA256 {s.digest.slice(0, 18)}…</small></span><ArrowRight size={16}/></button>)}</div> : <Empty title="暂无快照" text="成功采集或导入后保存首份快照，数据内容变化才新增版本。"/>}{snapshotData && <><h3>{snapshotData.name}</h3><p>快照有效观测 {summarize(snapshotData.points).count} 条；最近有效值 {fmt(summarize(snapshotData.points).latest)} {snapshotData.unit}</p><External href={snapshotData.source_url}>原始来源</External><div className="data-table-wrap"><table><thead><tr><th>日期</th><th>值 / OHLC</th></tr></thead><tbody>{snapshotData.points.map((p, i) => <tr key={i}><td>{p.date}</td><td>{p.close !== undefined ? [p.open, p.high, p.low, p.close].join(' / ') : p.value == null ? '缺失' : fmt(p.value)}</td></tr>)}</tbody></table></div></>}</div></Modal>}
  </>;
}

import { ArrowDownRight, ArrowRight, ArrowUpRight, ChevronRight, CircleHelp, FileText, Layers3, RefreshCw, Sparkles } from 'lucide-react';
import Chart from './Chart';
import { Empty, External, PageHeading } from './ui';
import { dimensions, fmt, regions } from './types';
import type { Bootstrap, Dataset } from './types';
import { summarize, valueOf } from './chartMath';

function Sparkline({ dataset }: { dataset?: Dataset }) {
  const vals = dataset?.points.map(valueOf).filter((v): v is number => v !== null).slice(-14) ?? [];
  if (vals.length < 2) return <div className="spark-empty"/>;
  const min = Math.min(...vals), max = Math.max(...vals), extent = max - min || 1;
  const path = vals.map((v, i) => `${i * 100 / (vals.length - 1)},${30 - (v - min) / extent * 25}`).join(' ');
  return <svg className="sparkline" viewBox="0 0 100 35" aria-hidden="true"><polyline fill="none" points={path} stroke="currentColor" strokeWidth="1.6" vectorEffect="non-scaling-stroke"/></svg>;
}

export default function Overview({ data, region, theme, selected, onSelect, onPage, onSync, onResearch, busy }: { data: Bootstrap; region: string; theme: string; selected: string; onSelect: (id: string) => void; onPage: (p: string) => void; onSync: () => void; onResearch: () => void; busy: boolean }) {
  const ready = data.datasets.filter(d => d.points.length), dataset = data.datasets.find(d => d.id === selected) ?? data.datasets[0];
  const verified = data.evidence.filter(e => e.verified);
  const covered = dimensions.filter(d => d === '官方数据' ? ready.some(d => ['worldbank', 'fred'].includes(d.provider)) || verified.some(e => e.dimension === d) : verified.some(e => e.dimension === d));
  const kpis = ['gdp', 'cpi', 'unemployment', 'consumption'].map(slug => data.datasets.find(d => d.id === `wb:${region}:${slug}`));
  const latestYear = ready.flatMap(d => d.points.filter(p => valueOf(p) !== null).map(p => p.date)).sort().at(-1);
  return <>
    <PageHeading kicker="宏观与产业研究 / 总览" title="看见趋势，更看清依据。" description="以经济学为主线，在历史与现实之间建立可追溯的判断。" action={<><button className="button secondary" onClick={onSync} disabled={busy}><RefreshCw size={15} className={busy ? 'spin' : ''}/>刷新数据</button><button className="button primary" onClick={onResearch}><Sparkles size={15}/>开始研究</button></>}/>
    <section className="thesis-strip"><div className="thesis-index">01<span>研究视角</span></div><div className="thesis-copy"><h2>从经济运行，走向产业变化。</h2><p>历史数据建立坐标，政策与经营验证传导，居民行为检验需求。</p></div><div className="thesis-meta"><span>当前观察范围</span><strong>{regions[region]} <ArrowUpRight size={18}/></strong><small>{latestYear ? `最新有效观察期 ${latestYear}` : '等待首次采集'} · 不等于实时数据</small></div></section>
    <div className="section-label"><h2>经济基本面</h2><span>世界银行 WDI · 年度序列 · 各指标最近有效期可能不同 <CircleHelp size={13}/></span></div>
    <section className="kpi-grid" aria-label="经济基本面指标">{kpis.map((d, i) => {
      const s = d && summarize(d.points), p = d?.points.filter(p => valueOf(p) !== null).at(-1);
      const diff = s?.latest != null && s.previous != null ? s.latest - s.previous : null;
      return <button key={d?.id ?? i} className={`kpi ${dataset.id === d?.id ? 'kpi-active' : ''}`} onClick={() => d && onSelect(d.id)}><div className="kpi-name">{d?.name}<ArrowUpRight size={14}/></div><div className="kpi-value">{fmt(s?.latest)}<span>{d?.unit}</span></div><div className="kpi-tail"><div><span className={diff == null || Math.abs(diff) < .005 ? '' : diff >= 0 ? 'direction-up' : 'direction-down'}>{diff == null ? '等待数据' : Math.abs(diff) < .005 ? '较上期变化不足 0.01 个百分点' : <>{diff >= 0 ? <ArrowUpRight size={12}/> : <ArrowDownRight size={12}/>}较上期 {fmt(Math.abs(diff))} 个百分点</>}</span><small>{p?.date ?? '—'} · 年度观察</small></div><Sparkline dataset={d}/></div></button>;
    })}</section>
    <section className="evidence-rail" aria-label="七维证据覆盖">{dimensions.map((d, i) => <button key={d} onClick={() => onPage('evidence')}><span className={`rail-point ${covered.includes(d) ? 'filled' : ''}`}>{String(i + 1).padStart(2, '0')}</span><strong>{d}</strong><small>{covered.includes(d) ? '已有可追溯材料' : '待补充证据'}</small></button>)}</section>
    <div className="research-grid"><div className="primary-column"><div className="section-label"><h2>把当下，放回历史。</h2><label className="inline-select">观察指标<select aria-label="总览观察指标" value={dataset.id} onChange={e => onSelect(e.target.value)}>{data.datasets.map(d => <option key={d.id} value={d.id}>{d.name}{!d.points.length ? '（待采集）' : ''}</option>)}</select></label></div>
      {dataset.points.length ? <Chart key={dataset.id} dataset={dataset} datasets={data.datasets} theme={theme} compact/> : <div className="panel"><Empty title="用真实数据开始观察" text="一键采集世界银行 1990 年以来的年度序列。没有密钥也能建立历史基线，不使用填充数据。" action={<button className="button primary" onClick={onSync} disabled={busy}>采集历史数据<ArrowRight size={15}/></button>}/></div>}
    </div><aside className="research-margin"><div className="section-label"><h2>研究边注</h2><Layers3 size={15}/></div><section className="coverage-panel panel"><div className="eyebrow">先核对证据，再形成判断</div><div className="coverage-number">{covered.length}<span>/ 7</span></div><h3>维度已有材料覆盖</h3><div className="coverage-meter">{dimensions.map(d => <span key={d} className={covered.includes(d) ? 'filled' : ''}/>)}</div><p>这是资料覆盖，不是结论置信度。{covered.length < 7 ? '当前证据不足以独立支撑全面的市场趋势判断。' : '材料齐全仍需检查时效、样本和相互矛盾之处。'}</p><button className="text-button gold" onClick={() => onPage('evidence')}>查看证据缺口<ArrowRight size={14}/></button></section>
      <section className="method-note"><span className="note-number">方法 / 01</span><h3>政策是条件，不是结果。</h3><p>意图、预算、实施与效果需要分别验证。市场预期是观点，公众声量也不等同于民意。</p><button className="text-button" onClick={() => onPage('method')}>阅读研究方法<ArrowUpRight size={13}/></button></section>
    </aside></div>
    <div className="bottom-grid"><section className="panel sector-summary"><div className="section-label"><h2>产业结构的长期切面</h2><button className="text-button" onClick={() => onPage('industry')}>行业研究<ArrowUpRight size={14}/></button></div>{['manufacturing', 'services', 'agriculture'].map(slug => { const d = data.datasets.find(d => d.id === `wb:${region}:${slug}`), valid = d?.points.filter(p => p.value !== null), p = valid?.at(-1); return <div className="sector-row" key={slug}><span>{d?.sector}</span><div className="sector-track"><div style={{ width: `${Math.min(100, Math.max(0, p?.value ?? 0))}%` }}/></div><strong>{fmt(p?.value)}<small>%</small></strong><span className="muted">{p?.date ?? '待采集'}</span></div>; })}<p className="caption">各自占 GDP 的比重；制造业属于工业子集，不将这些数据直接拼成饼图。</p></section>
      <section className="panel recent-research"><div className="section-label"><h2>研究手记</h2><FileText size={16}/></div>{data.reports.length ? data.reports.slice(0, 2).map(r => <button className="research-link" key={r.id} onClick={() => onPage('research')}><span>{r.mode === 'ai' ? '模型研判 · 待复核' : '证据简报'}</span><strong>{r.question}</strong><ChevronRight size={16}/></button>) : <><h3>让每一次判断，留下依据。</h3><p>从一个问题开始，整理支持、反证与未知。生成时的数据和证据会一并保留。</p><button className="text-button gold" onClick={onResearch}>创建第一份研究<ArrowRight size={14}/></button></>}</section></div>
    <div className="source-note"><span className="status-dot"/>数据与来源可追溯 · <External href="https://data.worldbank.org">World Development Indicators</External><span>观察期不等于采集日，历史变化不保证未来延续。</span></div>
  </>;
}

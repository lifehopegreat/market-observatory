import { useState } from 'react';
import { ArrowUpRight, BookOpen, CheckCircle2, Circle, FilePlus2, Pencil, Search, ShieldCheck, Trash2 } from 'lucide-react';
import { api, dimensions, datetime } from './types';
import type { Evidence } from './types';
import { Empty, External, Modal, PageHeading } from './ui';
import Updates from './Updates';

export type EvidenceDraft = Omit<Evidence, 'id' | 'created_at'>;
const newEvidence = (region: string, dimension = '政策'): EvidenceDraft => ({ title: '', dimension, nature: '观点', source_type: '其他', source_name: '', url: '', published_at: null, effective_at: null, sector: '宏观', region, summary: '', mechanism: '', counterevidence: '', sample_note: '', policy_stage: '不适用', verified: false });
const sourceLinks = [{ name: '国家统计局', description: '历史统计与口径解释', url: 'https://www.stats.gov.cn/sj/' }, { name: '国务院政策文件库', description: '政策原文与实施依据', url: 'https://www.gov.cn/zhengce/zhengcewenjianku/' }, { name: '中国人民银行', description: '金融统计与调查', url: 'https://www.pbc.gov.cn/' }, { name: '巨潮资讯', description: '上市公司定期报告', url: 'https://www.cninfo.com.cn/' }, { name: '国家发展改革委', description: '产业政策与发展信息', url: 'https://www.ndrc.gov.cn/' }];

export function EvidenceForm({ initial, onClose, onSaved }: { initial: EvidenceDraft & { id?: string }; onClose: () => void; onSaved: () => Promise<void> }) {
  const [value, setValue] = useState(initial), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const field = (name: keyof EvidenceDraft, v: string | boolean | null) => setValue(prev => ({ ...prev, [name]: v }));
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    const { id, created_at: _created, updated_at: _updated, ...payload } = value as Evidence & { updated_at?: string };
    try { await api(id ? `/evidence/${id}` : '/evidence', id ? 'PUT' : 'POST', payload); await onSaved(); onClose(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <Modal title={initial.id ? '核对与更新证据' : '记录一条证据'} subtitle="把材料、解释和反证分开保存。核验是人工状态，不是系统自动背书。" onClose={onClose} wide><form onSubmit={save} className="modal-body form-grid">
    <label className="span-2">材料标题<input required minLength={2} maxLength={200} value={value.title} onChange={e => field('title', e.target.value)}/></label>
    <label>证据维度<select value={value.dimension} onChange={e => { field('dimension', e.target.value); if (e.target.value !== '政策') field('policy_stage', '不适用'); }}>{dimensions.map(d => <option key={d}>{d}</option>)}</select></label>
    <label>内容性质<select value={value.nature} onChange={e => field('nature', e.target.value)}>{['事实', '观点', '假设'].map(x => <option key={x}>{x}</option>)}</select></label>
    <label>来源类别<select value={value.source_type} onChange={e => field('source_type', e.target.value)}>{['官方机构', '公司披露', '研究机构', '行业组织', '调查', '社区', '其他'].map(x => <option key={x}>{x}</option>)}</select></label>
    <label>来源名称<input required maxLength={100} value={value.source_name} onChange={e => field('source_name', e.target.value)}/></label>
    <label className="span-2">原文链接（HTTPS）<input required type="url" value={value.url} onChange={e => field('url', e.target.value)} placeholder="https://"/></label>
    <label>发布日期（未知可留空）<input type="date" value={value.published_at ?? ''} onChange={e => field('published_at', e.target.value || null)}/></label>
    <label>生效日期（可选）<input type="date" value={value.effective_at ?? ''} onChange={e => field('effective_at', e.target.value || null)}/></label>
    <label>所属行业<input required value={value.sector} maxLength={60} onChange={e => field('sector', e.target.value)} placeholder="宏观 / 制造业 / 新能源…"/></label>
    <label>政策阶段<select disabled={value.dimension !== '政策'} value={value.policy_stage} onChange={e => field('policy_stage', e.target.value)}>{['不适用', '意图', '预算', '实施', '效果评估'].map(x => <option key={x}>{x}</option>)}</select></label>
    <label className="span-2">摘录与摘要<textarea required minLength={5} maxLength={12000} rows={4} value={value.summary} onChange={e => field('summary', e.target.value)} placeholder="记录原文所说的内容，而不是直接写成确定性结论。"/></label>
    <label>传导机制 / 你的解释<textarea rows={3} maxLength={2000} value={value.mechanism} onChange={e => field('mechanism', e.target.value)} placeholder="这份材料如何影响供给、需求、收入或预期？"/></label>
    <label>反证与限制<textarea rows={3} maxLength={2000} value={value.counterevidence} onChange={e => field('counterevidence', e.target.value)} placeholder="什么证据会削弱这个判断？"/></label>
    <label className="span-2">样本与代表性说明{value.dimension === '公众意愿' ? '（核验公众意愿时必填）' : '（可选）'}<input maxLength={1000} required={value.dimension === '公众意愿' && value.verified} value={value.sample_note} onChange={e => field('sample_note', e.target.value)} placeholder="样本数量、调查范围、抽样方法、平台偏差与未知项"/></label>
    <label className="check-label span-2"><input type="checkbox" checked={value.verified} onChange={e => field('verified', e.target.checked)}/><span>我已人工核对原文、时间与口径，并记录已知限制</span></label>
    {error && <div className="inline-error span-2" role="alert">{error}</div>}
    <footer className="form-footer span-2"><button type="button" className="button secondary" onClick={onClose}>取消</button><button className="button primary" disabled={busy}>{busy ? '保存中…' : '保存证据'}</button></footer>
  </form></Modal>;
}

export default function EvidencePage({ evidence, region, keyword, onReload, notify }: { evidence: Evidence[]; region: string; keyword: string; onReload: () => Promise<void>; notify: (msg: string) => void }) {
  const [dimension, setDimension] = useState('全部'), [draft, setDraft] = useState<(EvidenceDraft & { id?: string }) | null>(null), [expanded, setExpanded] = useState('');
  const [searchQuery, setSearchQuery] = useState(''), [searchDimension, setSearchDimension] = useState('政策'), [searchSector, setSearchSector] = useState('宏观');
  const [searching, setSearching] = useState(false), [candidates, setCandidates] = useState<{ title: string; url: string; summary: string; source_name: string }[]>([]), [error, setError] = useState('');
  const [deleting, setDeleting] = useState<Evidence | null>(null);
  const filtered = evidence.filter(e => (dimension === '全部' || dimension === e.dimension) && (!keyword || `${e.title} ${e.summary} ${e.sector}`.toLowerCase().includes(keyword.toLowerCase())));
  async function search(e: React.FormEvent) { e.preventDefault(); setSearching(true); setError(''); try { const result = await api<typeof candidates>('/search', 'POST', { query: searchQuery, dimension: searchDimension, sector: searchSector, region }); setCandidates(result); if (!result.length) notify('没有检索到结果，请调整关键词。'); } catch (e) { setError((e as Error).message); } finally { setSearching(false); } }
  async function remove() { if (!deleting) return; try { await api(`/evidence/${deleting.id}`, 'DELETE', {}); setDeleting(null); await onReload(); notify('证据已删除，已有研究的来源快照保留。'); } catch (e) { notify((e as Error).message); } }
  return <>
    <PageHeading kicker="资料不是判断 / 证据库" title="每一个观点，都有来处。" description="同一条经济主线，七个观察维度。支持与反证同样重要。" action={<button className="button primary" onClick={() => setDraft(newEvidence(region, dimension === '全部' ? '政策' : dimension))}><FilePlus2 size={16}/>记录证据</button>}/>
    <Updates key={region} region={region} onReload={onReload}/>
    <form className="evidence-search panel" onSubmit={search}><div><Search size={19}/><div><h3>寻找原始材料</h3><p>使用 DeepSeek 官方 Search（复用模型 Key）或已配置的 Tavily 检索；摘要一律待核验。检索词会发送给服务商，可能产生费用。</p></div></div><div className="search-fields"><label>材料维度<select value={searchDimension} onChange={e => setSearchDimension(e.target.value)}>{dimensions.map(d => <option key={d}>{d}</option>)}</select></label><label>行业<input value={searchSector} maxLength={60} onChange={e => setSearchSector(e.target.value)}/></label><label className="query-field">检索关键词<input required minLength={2} maxLength={128} value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="如：居民消费 支持政策 实施效果"/></label><button className="button primary" disabled={searching}>{searching ? '检索中…' : '检索材料'}<ArrowUpRight size={14}/></button></div>{error && <p role="alert" className="inline-error">{error}</p>}</form>
    {candidates.length > 0 && <section className="candidate-section"><div className="section-label"><h2>检索结果 · 待核验</h2><span>{candidates.length} 条材料，不代表证据已成立</span></div>{candidates.map((r, i) => <article className="candidate panel" key={i}><div><External href={r.url}>{r.title}</External><p>{r.summary}</p><span className="caption">发布日期未知，请打开原文核对</span></div><button className="button secondary" onClick={() => setDraft({ ...newEvidence(region, searchDimension), ...r, sector: searchSector })}>核对后入库</button></article>)}</section>}
    <div className="filter-tabs"><button className={dimension === '全部' ? 'selected' : ''} onClick={() => setDimension('全部')}>全部<span>{evidence.length}</span></button>{dimensions.map(d => <button key={d} className={dimension === d ? 'selected' : ''} onClick={() => setDimension(d)}>{d}<span>{evidence.filter(e => e.dimension === d).length}</span></button>)}</div>
    <div className="evidence-layout"><section><div className="section-label"><h2>可追溯材料</h2><span>{filtered.length} 条 · {filtered.filter(e => e.verified).length} 条人工核验</span></div>{filtered.length ? filtered.map(e => <article className="evidence-card panel" key={e.id}><div className="evidence-card-meta"><span className="pill gold-pill">{e.dimension}</span><span className="pill">{e.nature}</span><span className={`verification ${e.verified ? 'verified' : ''}`}>{e.verified ? <CheckCircle2 size={13}/> : <Circle size={13}/>}{e.verified ? '人工已核验' : '待核验'}</span><div className="push-right"><button className="icon-button" onClick={() => setDraft(e)} aria-label={`编辑${e.title}`}><Pencil size={15}/></button><button className="icon-button" onClick={() => setDeleting(e)} aria-label={`删除${e.title}`}><Trash2 size={15}/></button></div></div><h3><a href={e.url} target="_blank" rel="noreferrer">{e.title}<ArrowUpRight size={15}/></a></h3><p>{e.summary}</p><div className="evidence-card-footer"><span>{e.source_name} · {e.published_at ?? '发布日期未知'}</span><span>{e.sector}{e.policy_stage !== '不适用' ? ` · ${e.policy_stage}` : ''}</span><button className="text-button" onClick={() => setExpanded(expanded === e.id ? '' : e.id)}>{expanded === e.id ? '收起' : '机制与反证'}<ArrowUpRight size={12}/></button></div>{expanded === e.id && <div className="evidence-details"><p><strong>传导机制：</strong>{e.mechanism || '尚未记录，不自动推断因果。'}</p><p><strong>反证与限制：</strong>{e.counterevidence || '尚未补充反证。'}</p><p><strong>样本说明：</strong>{e.sample_note || '未提供，不能据此推断公众比例。'}</p><p><strong>生效时间：</strong>{e.effective_at ?? '未知 / 不适用'}</p><p><strong>录入时间：</strong>{datetime(e.created_at)}</p></div>}</article>) : <div className="panel"><Empty title={keyword ? '没有匹配的材料' : '好的判断，始于足够好的证据。'} text="录入政策原文、财报、行业资料或调查。没有材料的维度保持空白，不用生成内容填补。" action={<button className="button secondary" onClick={() => setDraft(newEvidence(region, dimension === '全部' ? '政策' : dimension))}>记录第一条证据</button>}/></div>}</section>
      <aside><div className="section-label"><h2>可信来源导航</h2><BookOpen size={15}/></div><div className="panel source-directory">{sourceLinks.map(s => <a key={s.name} href={s.url} target="_blank" rel="noreferrer"><div><strong>{s.name}</strong><span>{s.description}</span></div><ArrowUpRight size={15}/></a>)}</div><div className="method-note"><ShieldCheck size={20}/><h3>来源权威，不等于解释唯一。</h3><p>官方统计也有口径与修订；机构判断可能有立场；社区样本可能偏斜。记录限制，比给材料打一个神秘分数更有价值。</p></div></aside></div>
    {draft && <EvidenceForm initial={draft} onClose={() => setDraft(null)} onSaved={onReload}/>}
    {deleting && <Modal title="删除这条证据？" onClose={() => setDeleting(null)}><div className="modal-body"><p>{deleting.title}</p><p className="muted">已有报告会保留生成时的材料快照。</p><div className="form-footer"><button className="button secondary" onClick={() => setDeleting(null)}>取消</button><button className="button danger" onClick={remove}>确认删除</button></div></div></Modal>}
  </>;
}

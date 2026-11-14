import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, BookOpen, ChartNoAxesCombined, ChevronDown, CircleHelp, Compass, Database, FileText, FlaskConical, Globe2, Layers3, Menu, Moon, Search, Settings2, ShieldCheck, Sun, X } from 'lucide-react';
import type { Bootstrap } from './types';
import { api, datetime, regions } from './types';
import Overview from './Overview';
import Laboratory from './Laboratory';
import EvidencePage from './Evidence';
import ResearchPage, { CreateResearch } from './Research';
import SettingsPage, { ImportModal } from './Settings';
import Method from './Method';
import { Empty } from './ui';

const navigation = [
  { id: 'overview', label: '宏观总览', icon: Compass, section: '观察与研判' },
  { id: 'industry', label: '行业研究', icon: Layers3 },
  { id: 'lab', label: '图表实验室', icon: ChartNoAxesCombined },
  { id: 'evidence', label: '七维证据库', icon: Database, section: '研究资产' },
  { id: 'research', label: '研究室', icon: FileText },
  { id: 'settings', label: '数据与 API', icon: Settings2, section: '工作台' }
];
function getTheme() { try { return localStorage.getItem('guanlan-theme') ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); } catch { return 'light'; } }
export default function App() {
  const [theme, setTheme] = useState(getTheme), [page, setPage] = useState(() => navigation.some(n => n.id === location.hash.slice(1)) || location.hash === '#method' ? location.hash.slice(1) : 'overview');
  const [region, setRegion] = useState('CHN'), [data, setData] = useState<Bootstrap | null>(null), [initialError, setInitialError] = useState(''), [busy, setBusy] = useState('');
  const [keyword, setKeyword] = useState(''), [selected, setSelected] = useState('wb:CHN:gdp'), [mobile, setMobile] = useState(false), [toast, setToast] = useState('');
  const [importOpen, setImportOpen] = useState(false), [researchOpen, setResearchOpen] = useState(false);
  const requestId = useRef(0), search = useRef<HTMLInputElement>(null);
  useEffect(() => { document.documentElement.dataset.theme = theme; try { localStorage.setItem('guanlan-theme', theme); } catch { /* Theme still works when storage is unavailable. */ } }, [theme]);
  useEffect(() => { const h = () => { const v = location.hash.slice(1); if (navigation.some(n => n.id === v) || v === 'method') { setPage(v); setMobile(false); } }; window.addEventListener('hashchange', h); return () => window.removeEventListener('hashchange', h); }, []);
  useEffect(() => { const key = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); search.current?.focus(); } if (e.key === 'Escape') { setKeyword(''); setMobile(false); } }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key); }, []);
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(''), 8000); return () => clearTimeout(id); }, [toast]);
  const reload = useCallback(async () => { const id = ++requestId.current; try { const result = await api<Bootstrap>(`/bootstrap?region=${region}`); if (id === requestId.current) { setData(result); setInitialError(''); } } catch (e) { if (id === requestId.current) setInitialError((e as Error).message); throw e; } }, [region]);
  useEffect(() => { setData(null); setSelected(`wb:${region}:gdp`); void reload().catch(() => {}); }, [reload, region]);
  function navigate(p: string) { setPage(p); location.hash = p; setMobile(false); window.scrollTo({ top: 0, behavior: 'instant' }); }
  async function sync(provider = 'worldbank', extra: Record<string, string> = {}) { if (busy) return; setBusy('sync'); try { const r = await api<{ message: string }>('/sync', 'POST', { provider, region, ...extra }); await reload(); setToast(r.message); } catch (e) { setToast((e as Error).message); } finally { setBusy(''); } }
  const latest = data?.datasets.map(d => d.fetched_at).filter((v): v is string => !!v).sort().at(-1);
  const foundDatasets = keyword ? data?.datasets.filter(d => d.name.toLowerCase().includes(keyword.toLowerCase())).slice(0, 5) ?? [] : [];
  const foundEvidence = keyword ? data?.evidence.filter(e => `${e.title} ${e.summary}`.toLowerCase().includes(keyword.toLowerCase())).slice(0, 3) ?? [] : [];
  return <div className="app-shell">
    {mobile && <button className="sidebar-backdrop" aria-label="关闭导航" onClick={() => setMobile(false)}/>}
    <aside className={`sidebar ${mobile ? 'mobile-open' : ''}`}><a className="brand" href="#overview" aria-label="观澜首页"><svg width="37" height="37" viewBox="0 0 40 40" fill="none" aria-hidden="true"><rect x="1" y="1" width="38" height="38" rx="9" stroke="currentColor" strokeOpacity=".35"/><circle cx="20" cy="20" r="10" stroke="currentColor" strokeWidth="1.4"/><path d="M7 20h26M20 7v26M10 28l20-16" stroke="currentColor" strokeWidth="1.4"/></svg><div><strong>观澜<span>OBSERVATORY</span></strong><small>宏观与产业研究工作台</small></div></a>
      <div className="workspace-label"><span className="status-dot"/>个人研究空间<ChevronDown size={13}/></div>
      <nav aria-label="主导航">{navigation.map(n => <div key={n.id}>{n.section && <div className="nav-section-label">{n.section}</div>}<button onClick={() => navigate(n.id)} className={`nav-item ${page === n.id ? 'selected' : ''}`} aria-label={n.label} aria-current={page === n.id ? 'page' : undefined}><n.icon size={18} strokeWidth={1.6}/><span>{n.label}</span>{n.id === 'evidence' && !!data?.evidence.length && <small>{data.evidence.length}</small>}{page === n.id && <span className="nav-selected-dot"/>}</button></div>)}</nav>
      <div className="sidebar-bottom"><div className="sidebar-note"><FlaskConical size={19} strokeWidth={1.4}/><strong>以依据，代替直觉。</strong><p>先观察，再解释。<br/>让每个判断都可以被检验。</p><button className="text-button gold" onClick={() => navigate('method')}>研究方法<ArrowRight size={13}/></button></div><button className="sidebar-help" onClick={() => navigate('method')}><CircleHelp size={16}/><span>方法与使用边界</span><BookOpen size={13}/></button><div className="local-status"><ShieldCheck size={14}/><span>本地运行 · 数据由你掌握</span></div></div>
    </aside>
    <div className="main-shell"><header className="topbar"><button className="icon-button mobile-menu" onClick={() => setMobile(!mobile)} aria-label="展开导航"><Menu size={21}/></button><div className="breadcrumb">研究工作台<span>/</span><strong>{navigation.find(n => n.id === page)?.label ?? '研究方法'}</strong></div><div className="global-search"><Search size={15}/><input ref={search} aria-label="全局搜索指标与证据" placeholder="搜索指标、行业或证据" value={keyword} onChange={e => setKeyword(e.target.value)}/>{keyword ? <button className="icon-button" aria-label="清除搜索" onClick={() => setKeyword('')}><X size={12}/></button> : <kbd>Ctrl K</kbd>}{keyword && <div className="search-results"><strong>指标与证据</strong>{foundDatasets.map(d => <button key={d.id} onClick={() => { setSelected(d.id); navigate('lab'); setKeyword(''); }}><ChartNoAxesCombined size={15}/><span>{d.name}<small>{d.source_name}</small></span><ArrowRight size={13}/></button>)}{foundEvidence.map(e => <button key={e.id} onClick={() => navigate('evidence')}><FileText size={15}/><span>{e.title}<small>{e.dimension}</small></span></button>)}{!foundDatasets.length && !foundEvidence.length && <p>没有匹配的指标或材料。</p>}</div>}</div><div className="topbar-actions"><label className="region-picker"><Globe2 size={15}/><select aria-label="观察地区" value={region} onChange={e => setRegion(e.target.value)}>{Object.entries(regions).map(([k, v]) => <option key={k} value={k}>{v}市场</option>)}</select></label><span className="topbar-separator"/><button className="icon-button theme-switch" aria-label={theme === 'dark' ? '切换日间模式' : '切换夜间模式'} title={theme === 'dark' ? '日间模式' : '夜间模式'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={18}/> : <Moon size={18}/>}</button><div className="avatar" title="本地个人研究空间">研</div></div></header>
      <main id="main-content"><div className="workspace-topline"><span><span className="status-dot"/>{latest ? `数据快照 ${datetime(latest)}` : '数据等待首次采集'}</span><span>{new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Shanghai' })} · 本地研究</span></div>
        {initialError && <div className="inline-error" role="alert">{initialError}<button className="text-button" onClick={() => void reload().catch(() => {})}>重试连接</button></div>}
        {!data && !initialError && <div className="page-loading"><span className="loading-ring"/><h2>打开你的研究工作台</h2><p>读取本地数据、来源与研究记录…</p></div>}
        {!data && initialError && <Empty title="暂时无法连接本地服务" text="请确认后端已启动，默认地址为 127.0.0.1:8765。已有数据不会因此被清除。"/>}
        {data && <>{page === 'overview' && <Overview data={data} region={region} theme={theme} selected={selected} onSelect={setSelected} onPage={navigate} onSync={() => void sync()} onResearch={() => setResearchOpen(true)} busy={!!busy}/>}
        {(page === 'industry' || page === 'lab') && <Laboratory key={page + region} data={data} region={region} theme={theme} industry={page === 'industry'} selected={selected} onSelect={setSelected} onImport={() => setImportOpen(true)} onSync={() => void sync()} busy={!!busy}/>}
        {page === 'evidence' && <EvidencePage evidence={data.evidence} region={region} keyword={keyword} onReload={reload} notify={setToast}/>}
        {page === 'research' && <ResearchPage reports={data.reports} onCreate={() => setResearchOpen(true)}/>}
        {page === 'settings' && <SettingsPage key={region} data={data} onReload={reload} onImport={() => setImportOpen(true)} region={region} onSync={sync} busy={!!busy} notify={setToast}/>}
        {page === 'method' && <Method/>}</>}
      </main><footer className="app-footer"><span>观澜 · 把趋势放进证据里</span><span>历史不等于未来 · 材料不等于结论</span></footer>
    </div>
    {toast && <div className="toast" role="status"><span>{toast}</span><button className="icon-button" aria-label="关闭提示" onClick={() => setToast('')}><X size={15}/></button></div>}
    {importOpen && <ImportModal region={region} onClose={() => setImportOpen(false)} onImported={async id => { await reload(); setSelected(id); navigate('lab'); setToast('数据验证通过，已保存来源和首份快照。'); }}/>}
    {researchOpen && data && <CreateResearch region={region} data={data} onClose={() => setResearchOpen(false)} onCreated={async () => { await reload(); navigate('research'); setToast('研究已保存，生成时的数据与证据快照一并保留。'); }}/>}
  </div>;
}

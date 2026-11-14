export type Point = { date: string; value?: number | null; category?: string; open?: number; high?: number; low?: number; close?: number; volume?: number };
export type Dataset = { id: string; name: string; indicator?: string; provider: string; source_name: string; source_url: string; unit: string; semantic: 'rate' | 'level' | 'index' | 'share'; frequency: string; kind: 'timeseries' | 'ohlc' | 'composition'; region: string; sector: string; points: Point[]; fetched_at?: string; source_updated?: string; published_at?: string | null; note?: string; digest?: string };
export type Evidence = { id: string; title: string; dimension: string; nature: string; source_type: string; source_name: string; url: string; published_at: string | null; effective_at: string | null; sector: string; region: string; summary: string; mechanism: string; counterevidence: string; sample_note: string; policy_stage: string; verified: boolean; created_at?: string };
export type Settings = { model_base_url: string; model: string; model_key: boolean; fred_key: boolean; tavily_key: boolean; tushare_key: boolean; trust_proxy: boolean; key_storage: string };
export type ReportBody = { summary: string; claims: { text: string; nature: string; refs: string[] }[]; mechanism: string[]; scenarios: { name: string; assumptions: string; triggers: string }[]; invalidation: string[]; missing: string[] };
export type Research = { id: string; question: string; region: string; sector: string; horizon: string; mode: string; created_at: string; model?: string; warning: string; body: ReportBody; context: { datasets: Dataset[]; evidence: Evidence[] } };
export type Bootstrap = { datasets: Dataset[]; evidence: Evidence[]; reports: Research[]; settings: Settings; logs: { id: number; at: string; provider: string; success: boolean; message: string }[]; dimensions: string[] };
export const dimensions = ['官方数据', '政策', '财报', '市场预期', '业内信息', '民生', '公众意愿'];
export const regions: Record<string, string> = { CHN: '中国', USA: '美国', WLD: '全球' };
export const frequencyLabels: Record<string, string> = { annual: '年频', quarterly: '季频', monthly: '月频', daily: '日频', snapshot: '同一时点' };
export function fmt(v: number | null | undefined, digits = 2) { return v == null ? '—' : new Intl.NumberFormat('zh-CN', { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(v); }
export function datetime(v?: string | null) { return v ? new Date(v).toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' }) : '未知'; }
export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const r = await fetch('/api' + path, { method, headers: { 'Content-Type': 'application/json', 'X-Observatory-Request': '1' }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!r.ok) {
    let message = `请求失败（HTTP ${r.status}）`;
    try { const j = await r.json(); message = typeof j.detail === 'string' ? j.detail : Array.isArray(j.detail) ? j.detail.map((x: { loc: string[]; msg: string }) => `${x.loc.slice(1).join('.')}：${x.msg}`).join('；') : message; } catch { /* The status is useful even when the proxy returns HTML. */ }
    throw new Error(message);
  }
  return r.json();
}

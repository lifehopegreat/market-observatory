import type { Dataset, Point } from './types';
export type ChartType = 'line' | 'bar' | 'area' | 'candlestick' | 'pie';
export type Transform = 'raw' | 'index' | 'yoy';
export function allowedCharts(d: Dataset): ChartType[] {
  return d.kind === 'composition' ? ['pie', 'bar'] : d.kind === 'ohlc' ? ['candlestick', 'line', 'bar'] : ['line', 'bar', 'area'];
}
export function canTransform(d: Dataset) { return d.kind === 'timeseries' && d.semantic === 'level'; }
export function valueOf(p: Point) { return p.value !== undefined ? p.value : p.close ?? null; }
function periodOrdinal(period: string, frequency: string) {
  if (frequency === 'annual') return Number(period);
  if (frequency === 'monthly') return Number(period.slice(0, 4)) * 12 + Number(period.slice(5)) - 1;
  if (frequency === 'quarterly') return Number(period.slice(0, 4)) * 4 + Number(period.slice(-1)) - 1;
  return Date.parse(period) / 86400000;
}
function ordinalPeriod(i: number, frequency: string) {
  if (frequency === 'annual') return String(i);
  if (frequency === 'monthly') return `${Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, '0')}`;
  return `${Math.floor(i / 4)}-Q${i % 4 + 1}`;
}
export function continuous(d: Dataset): Point[] {
  if (d.kind !== 'timeseries' || !d.points.length || !['annual', 'monthly', 'quarterly'].includes(d.frequency)) return d.points;
  const sorted = [...d.points].sort((a, b) => a.date.localeCompare(b.date));
  const start = periodOrdinal(sorted[0].date, d.frequency), end = periodOrdinal(sorted.at(-1)!.date, d.frequency);
  if (end - start > 20000) return sorted;
  const lookup = new Map(sorted.map(p => [p.date, p]));
  return Array.from({ length: end - start + 1 }, (_, k) => { const date = ordinalPeriod(start + k, d.frequency); return lookup.get(date) ?? { date, value: null }; });
}
export function transformPoints(d: Dataset, transform: Transform): Point[] {
  const points = continuous(d);
  if (transform === 'raw') return points;
  if (!canTransform(d)) throw new Error('只有水平值序列支持基期标准化或同比转换；不对增速、占比或指数重复计算');
  if (transform === 'index') {
    const first = points.find(p => valueOf(p) !== null);
    const base = first && valueOf(first);
    if (base == null || base <= 0) throw new Error('基期值必须大于零');
    return points.map(p => ({ ...p, value: valueOf(p) === null ? null : valueOf(p)! / base * 100 }));
  }
  if (!['annual', 'monthly', 'quarterly'].includes(d.frequency)) throw new Error('同比仅适用于年、季、月频水平序列');
  const lookup = new Map(points.map(p => [p.date, valueOf(p)]));
  return points.map(p => { const prior = lookup.get(String(Number(p.date.slice(0, 4)) - 1) + p.date.slice(4)); const value = valueOf(p); return { ...p, value: prior == null || prior <= 0 || value == null ? null : (value / prior - 1) * 100 }; });
}
export function movingAverage(values: (number | null)[], window: number) {
  return values.map((_, i) => { const part = values.slice(i - window + 1, i + 1); return i < window - 1 || part.some(v => v === null) ? null : (part as number[]).reduce((a, b) => a + b, 0) / window; });
}
export function regression(values: (number | null)[]) {
  const points = values.map((y, x) => ({ x, y })).filter((p): p is { x: number; y: number } => p.y !== null);
  if (points.length < 3) return values.map(() => null);
  const n = points.length, sx = points.reduce((s, p) => s + p.x, 0), sy = points.reduce((s, p) => s + p.y, 0);
  const xx = points.reduce((s, p) => s + p.x * p.x, 0), xy = points.reduce((s, p) => s + p.x * p.y, 0);
  const slope = (n * xy - sx * sy) / (n * xx - sx * sx), intercept = (sy - slope * sx) / n;
  return values.map((v, x) => v === null ? null : intercept + slope * x);
}
export function summarize(points: Point[]) {
  const valid = points.map(valueOf).filter((v): v is number => v !== null);
  return { count: valid.length, missing: points.length - valid.length, latest: valid.at(-1), previous: valid.at(-2), mean: valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null, min: valid.length ? Math.min(...valid) : null, max: valid.length ? Math.max(...valid) : null };
}

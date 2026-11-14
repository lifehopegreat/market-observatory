import { describe, expect, it } from 'vitest';
import { allowedCharts, canTransform, continuous, movingAverage, regression, summarize, transformPoints } from './chartMath';
import type { Dataset } from './types';
const dataset: Dataset = { id: 'test', name: 'test', provider: 'test', source_name: 'test', source_url: 'https://example.com', unit: '人', semantic: 'level', frequency: 'annual', kind: 'timeseries', region: 'CHN', sector: '宏观', points: [{ date: '2022', value: 100 }, { date: '2024', value: 121 }, { date: '2025', value: 133.1 }] };
describe('honest chart encodings', () => {
  it('never offers candlesticks or pies for macro series', () => { expect(allowedCharts(dataset)).toEqual(['line', 'bar', 'area']); });
  it('only offers pie for composition', () => { expect(allowedCharts({ ...dataset, kind: 'composition' })).toEqual(['pie', 'bar']); });
  it('fills missing calendar periods with null, not zero or interpolated values', () => { expect(continuous(dataset)[1]).toEqual({ date: '2023', value: null }); });
  it('yoy matches calendar year rather than last available row', () => { const v = transformPoints(dataset, 'yoy'); expect(v[2].value).toBeNull(); expect(v[3].value).toBeCloseTo(10); });
  it('does not compute growth rates of growth rates', () => { const d = { ...dataset, semantic: 'rate' as const }; expect(canTransform(d)).toBe(false); expect(() => transformPoints(d, 'yoy')).toThrow(); });
  it('normalizes first valid positive value to 100', () => { const v = transformPoints(dataset, 'index'); expect(v[0].value).toBe(100); expect(v[1].value).toBeNull(); expect(v[2].value).toBe(121); });
  it('rejects nonpositive rebasing denominators', () => { expect(() => transformPoints({ ...dataset, points: [{ date: '2024', value: 0 }] }, 'index')).toThrow(); });
  it('moving average preserves missing windows', () => { expect(movingAverage([1, null, 3, 4, 5], 3)).toEqual([null, null, null, null, 4]); });
  it('regression is in sample and keeps gaps', () => { expect(regression([2, 4, null, 8])).toEqual([2, 4, null, 8]); });
  it('summaries do not treat null as zero', () => { const s = summarize(continuous(dataset)); expect(s.count).toBe(3); expect(s.missing).toBe(1); expect(s.min).toBe(100); });
  it('quarterly and monthly gaps are preserved', () => { expect(continuous({ ...dataset, frequency: 'quarterly', points: [{ date: '2024-Q4', value: 1 }, { date: '2025-Q2', value: 2 }] })[1].date).toBe('2025-Q1'); expect(continuous({ ...dataset, frequency: 'monthly', points: [{ date: '2024-12', value: 1 }, { date: '2025-02', value: 2 }] })[1].date).toBe('2025-01'); });
});

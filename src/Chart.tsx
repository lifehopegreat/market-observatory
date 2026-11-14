import { useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts/core';
import { LineChart, BarChart, PieChart, CandlestickChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, ToolboxComponent, BrushComponent, MarkLineComponent, AriaComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { CandlestickChart as CandleIcon, ChartColumn, ChartLine, ChartPie, ChartArea, Crosshair, Download, Maximize2, RotateCcw, Table2, TrendingUp, Ruler, ImageDown, X } from 'lucide-react';
import { allowedCharts, canTransform, movingAverage, regression, summarize, transformPoints, valueOf } from './chartMath';
import type { ChartType, Transform } from './chartMath';
import type { Dataset, Point } from './types';
import { fmt, datetime, frequencyLabels } from './types';

echarts.use([LineChart, BarChart, PieChart, CandlestickChart, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, ToolboxComponent, BrushComponent, MarkLineComponent, AriaComponent, CanvasRenderer]);
const chartNames = { line: '折线图', bar: '柱状图', area: '面积图', candlestick: 'K线图', pie: '饼状图' };
const chartIcons = { line: ChartLine, bar: ChartColumn, area: ChartArea, candlestick: CandleIcon, pie: ChartPie };
export default function Chart({ dataset, datasets, theme, compact = false }: { dataset: Dataset; datasets: Dataset[]; theme: string; compact?: boolean }) {
  const div = useRef<HTMLDivElement>(null), chart = useRef<echarts.EChartsType | null>(null);
  const [type, setType] = useState<ChartType>(dataset.kind === 'composition' ? 'pie' : dataset.kind === 'ohlc' ? 'candlestick' : 'line');
  const [transform, setTransform] = useState<Transform>('raw'), [ma, setMa] = useState(0), [trend, setTrend] = useState(false), [table, setTable] = useState(false), [full, setFull] = useState(false);
  const [compare, setCompare] = useState(''), [range, setRange] = useState('全部'), [cross, setCross] = useState(true), [brushing, setBrushing] = useState(false), [selection, setSelection] = useState<[number, number] | null>(null);
  const [chartError, setChartError] = useState('');
  const points = useMemo(() => {
    const all = transformPoints(dataset, transform);
    if (range === '全部' || dataset.kind === 'composition') return all;
    const cutoff = Number(all.at(-1)?.date.slice(0, 4) ?? 0) - Number(range) + 1;
    return all.filter(p => Number(p.date.slice(0, 4)) >= cutoff);
  }, [dataset, transform, range]);
  const selected = selection ? points.slice(selection[0], selection[1] + 1) : points;
  const summary = summarize(selected);
  const compatible = datasets.filter(d => d.id !== dataset.id && d.kind === 'timeseries' && dataset.kind === 'timeseries' && d.frequency === dataset.frequency && d.unit === dataset.unit && d.semantic === dataset.semantic && d.points.length);
  const comp = compatible.find(d => d.id === compare);
  const unit = transform === 'yoy' ? '%' : transform === 'index' ? '基期=100' : dataset.unit;

  useEffect(() => {
    if (!div.current) return;
    const instance = echarts.init(div.current, undefined, { renderer: 'canvas' });
    chart.current = instance;
    const resize = new ResizeObserver(() => instance.resize());
    resize.observe(div.current);
    instance.on('brushSelected', (e: unknown) => {
      const batch = (e as { batch?: { areas?: { coordRange?: number[] }[] }[] }).batch;
      const r = batch?.[0]?.areas?.[0]?.coordRange;
      setSelection(r ? [Math.max(0, Math.floor(r[0])), Math.ceil(r[1])] : null);
    });
    return () => { resize.disconnect(); instance.dispose(); chart.current = null; };
  }, []);

  useEffect(() => {
    const c = chart.current;
    if (!c) return;
    const dark = theme === 'dark', fg = dark ? '#b6bcc4' : '#5b6269', grid = dark ? '#30363b' : '#e9ebed';
    const gold = dark ? '#d7b77d' : '#9b732f', blue = dark ? '#88a7c9' : '#4f789e';
    const values = points.map(valueOf), dates = points.map(p => p.date);
    const series: Record<string, unknown>[] = [];
    if (type === 'pie') {
      series.push({ type: 'pie', name: dataset.name, radius: ['42%', '70%'], center: ['50%', '47%'], minAngle: 1, avoidLabelOverlap: true,
        itemStyle: { borderWidth: 3, borderColor: dark ? '#1b1f22' : '#ffffff' }, label: { color: fg, formatter: '{b}\n{d}%' },
        data: points.map(p => ({ name: p.category, value: p.value })) });
    } else if (type === 'candlestick') {
      series.push({ name: '真实 OHLC', type: 'candlestick', data: points.map(p => [p.open, p.close, p.low, p.high]), itemStyle: { color: '#ac6561', color0: '#598d80', borderColor: '#ac6561', borderColor0: '#598d80' } });
    } else {
      series.push({ name: dataset.name, type: type === 'bar' ? 'bar' : 'line', data: values, showSymbol: points.length < 50, symbolSize: 5, connectNulls: false, smooth: false,
        lineStyle: { width: 2.3 }, itemStyle: { color: gold, borderRadius: type === 'bar' ? [3, 3, 0, 0] : 0 }, barMaxWidth: 30,
        ...(type === 'area' ? { areaStyle: { opacity: 0.1 } } : {}) });
    }
    if (type !== 'pie') {
      if (ma) series.push({ name: `${ma}期移动平均`, type: 'line', data: movingAverage(values, ma), showSymbol: false, connectNulls: false, lineStyle: { width: 1.5, color: blue, type: 'dashed' }, itemStyle: { color: blue } });
      if (trend) series.push({ name: '线性拟合 · 非预测', type: 'line', data: regression(values), symbol: 'none', connectNulls: false, lineStyle: { width: 1.3, type: 'dotted', color: '#8c8a9e' }, itemStyle: { color: '#8c8a9e' } });
      if (comp) {
        const comparePoints = transformPoints(comp, transform);
        // Rebased comparisons require a shared base period, not each series' own first year.
        let aligned = comparePoints;
        if (transform === 'index') {
          const baseDate = dataset.points.find(p => valueOf(p) !== null)?.date;
          const base = comp.points.find(p => p.date === baseDate)?.value;
          aligned = base && base > 0 ? comp.points.map(p => ({ ...p, value: p.value == null ? null : p.value / base * 100 })) : [];
        }
        const map = new Map(aligned.map(p => [p.date, valueOf(p)]));
        series.push({ name: comp.name, type: 'line', data: dates.map(d => map.get(d) ?? null), showSymbol: false, connectNulls: false, lineStyle: { color: blue, width: 2 }, itemStyle: { color: blue } });
      }
    }
    try {
      c.setOption({ animation: !window.matchMedia('(prefers-reduced-motion: reduce)').matches, animationDuration: 350,
        backgroundColor: 'transparent', textStyle: { fontFamily: 'Bahnschrift, Microsoft YaHei, sans-serif', color: fg },
        color: [gold, blue, '#73958b', '#a997b5', '#c4876a', '#97a16c'], aria: { enabled: true }, toolbox: { show: false },
        tooltip: { trigger: type === 'pie' ? 'item' : 'axis', renderMode: 'richText', confine: true, backgroundColor: dark ? '#282e33' : '#fff', borderColor: grid, textStyle: { color: fg }, axisPointer: { type: cross ? 'cross' : 'line' }, valueFormatter: (v: unknown) => typeof v === 'number' ? fmt(v) + ' ' + unit : String(v ?? '缺失') },
        legend: { show: type !== 'pie', bottom: 5, textStyle: { color: fg, fontSize: 11 }, itemWidth: 18, itemHeight: 5 },
        grid: { left: 15, right: 24, top: 30, bottom: 85, containLabel: true },
        ...(type === 'pie' ? {} : {
          xAxis: { type: 'category', data: type === 'bar' && dataset.kind === 'composition' ? points.map(p => p.category) : dates, boundaryGap: type === 'bar' || type === 'candlestick', axisLine: { lineStyle: { color: grid } }, axisTick: { show: false }, axisLabel: { color: fg, margin: 14, hideOverlap: true } },
          yAxis: { type: 'value', name: unit, nameTextStyle: { color: fg, align: 'left', padding: [0, 0, 0, 0] }, scale: type === 'candlestick', splitNumber: 4, splitLine: { lineStyle: { color: grid, type: 'dashed' } }, axisLabel: { color: fg, formatter: (v: number) => new Intl.NumberFormat('zh-CN', { notation: Math.abs(v) > 1e6 ? 'compact' : 'standard' }).format(v) } },
          dataZoom: dataset.kind === 'composition' ? [] : [{ type: 'inside', zoomOnMouseWheel: 'ctrl', moveOnMouseMove: true }, { type: 'slider', height: 18, bottom: 33, borderColor: 'transparent', fillerColor: dark ? '#d7b77d1a' : '#9b732f12', handleStyle: { color: gold }, textStyle: { color: fg }, dataBackground: { lineStyle: { color: fg }, areaStyle: { color: grid } } }],
          brush: { toolbox: [], xAxisIndex: 0, brushMode: 'single', brushStyle: { color: '#9b732f20', borderColor: gold }, throttleType: 'debounce', throttleDelay: 100 }
        }), series }, { notMerge: true });
      setSelection(null); setBrushing(false); setChartError('');
    } catch { setChartError('图表渲染失败，请核对数据格式或切换到数据表。'); }
  }, [points, dataset, type, theme, ma, trend, comp, transform, cross, unit]);

  useEffect(() => { chart.current?.resize(); }, [full, table]);
  function downloadImage() {
    const c = chart.current; if (!c) return;
    const url = c.getDataURL({ pixelRatio: 2, backgroundColor: theme === 'dark' ? '#1b1f22' : '#fff' });
    const a = document.createElement('a'); a.download = `观澜-${dataset.name}.png`; a.href = url; a.click();
  }
  function brush() { const next = !brushing; chart.current?.dispatchAction({ type: 'takeGlobalCursor', key: 'brush', brushOption: { brushType: next ? 'lineX' : false, brushMode: 'single' } }); setBrushing(next); }
  const columns = dataset.kind === 'ohlc' ? ['date', 'open', 'high', 'low', 'close', 'volume'] : dataset.kind === 'composition' ? ['date', 'category', 'value'] : ['date', 'value'];
  const labels: Record<string, string> = { date: '观察期', open: '开盘', high: '最高', low: '最低', close: '收盘', volume: '成交量', value: unit, category: '分类' };
  return <section className={`chart-card panel ${full ? 'chart-fullscreen' : ''}`} aria-label="交互分析图表">
    <div className="chart-heading"><div><div className="eyebrow">历史序列 / {frequencyLabels[dataset.frequency]}</div><h3>{dataset.name}</h3></div><div className="chart-heading-actions"><button className="icon-button" onClick={() => setFull(!full)} title={full ? '退出全屏' : '全屏图表'} aria-label={full ? '退出全屏' : '全屏图表'}>{full ? <X size={17}/> : <Maximize2 size={17}/>}</button></div></div>
    <div className="chart-toolbar"><div className="segmented chart-types">{(Object.keys(chartNames) as ChartType[]).map(t => { const Icon = chartIcons[t]; const allowed = allowedCharts(dataset).includes(t); return <button key={t} disabled={!allowed} className={type === t ? 'selected' : ''} onClick={() => setType(t)} title={allowed ? chartNames[t] : t === 'pie' ? '需要同一时点、互斥且非负的构成数据' : '需要真实开高低收数据'} aria-label={chartNames[t]}><Icon size={16}/>{!compact && <span>{t === 'candlestick' ? 'K线' : chartNames[t].replace('状图', '').replace('图', '')}</span>}</button>; })}</div>
      {dataset.kind !== 'composition' && <div className="range-tabs">{['5', '10', '全部'].map(r => <button key={r} onClick={() => setRange(r)} className={range === r ? 'selected' : ''}>{r === '全部' ? r : `${r}年`}</button>)}</div>}
    </div>
    {!compact && <div className="chart-controls"><label>数值口径<select aria-label="数值口径" value={transform} onChange={e => { setTransform(e.target.value as Transform); setCompare(''); }}><option value="raw">原始值</option><option value="index" disabled={!canTransform(dataset) || !(dataset.points.find(p => valueOf(p) !== null)?.value! > 0)}>基期 = 100</option><option value="yoy" disabled={!canTransform(dataset) || !['annual', 'monthly', 'quarterly'].includes(dataset.frequency)}>同比变化率</option></select></label>
      <label>同口径比较<select aria-label="比较指标" value={compare} disabled={!compatible.length || transform === 'index'} onChange={e => setCompare(e.target.value)}><option value="">不叠加</option>{compatible.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
      <label>移动平均<select aria-label="移动平均" value={ma} disabled={dataset.kind === 'composition'} onChange={e => setMa(Number(e.target.value))}><option value={0}>关闭</option>{[3, 5, 12, 20].map(n => <option key={n} value={n}>{n} 期</option>)}</select></label>
      <button className={`small-button ${trend ? 'active' : ''}`} disabled={dataset.kind === 'composition'} onClick={() => setTrend(!trend)}><TrendingUp size={14}/>统计拟合</button>
    </div>}
    {chartError && <p className="inline-error" role="alert">{chartError}</p>}
    <div className="plot" ref={div} role="img" aria-label={`${dataset.name}，${chartNames[type]}，单位${unit}。下方可切换数据表读取全部数值。`} style={{ display: table ? 'none' : 'block', height: full ? '55vh' : compact ? 280 : 350 }}/>
    {table && <div className="data-table-wrap chart-data-table"><table><thead><tr>{columns.map(k => <th key={k}>{labels[k]}</th>)}</tr></thead><tbody>{points.map((p, i) => <tr key={`${p.date}-${i}`}>{columns.map(k => <td key={k}>{p[k as keyof Point] == null ? '缺失' : typeof p[k as keyof Point] === 'number' ? fmt(p[k as keyof Point] as number) : p[k as keyof Point]}</td>)}</tr>)}</tbody></table></div>}
    <div className="chart-bottom-tools"><div><button className={`icon-button ${cross ? 'active' : ''}`} onClick={() => setCross(!cross)} aria-label="切换十字线" title="十字线"><Crosshair size={16}/></button><button className={`icon-button ${brushing ? 'active' : ''}`} disabled={type === 'pie' || dataset.kind === 'composition'} onClick={brush} aria-label="框选区间统计" title="框选区间统计"><Ruler size={16}/></button><button className="icon-button" onClick={() => { chart.current?.dispatchAction({ type: 'dataZoom', start: 0, end: 100 }); chart.current?.dispatchAction({ type: 'brush', areas: [] }); setSelection(null); }} aria-label="重置视图" title="重置视图"><RotateCcw size={15}/></button><span className="toolbar-divider"/><button className={`icon-button ${table ? 'active' : ''}`} onClick={() => setTable(!table)} aria-label={table ? '查看图表' : '查看数据表'} title="切换数据表"><Table2 size={16}/></button></div><div><button className="text-button" onClick={downloadImage}><ImageDown size={15}/>PNG</button><a className="text-button" href={`/api/datasets/${encodeURIComponent(dataset.id)}/csv`}><Download size={14}/>CSV</a></div></div>
    <div className="chart-stats">{[[dataset.kind === 'composition' ? '有效分类' : '有效观测', String(summary.count)], [dataset.kind === 'composition' ? '分类均值' : selection ? '区间均值' : '全期均值', fmt(summary.mean)], ['最小值', fmt(summary.min)], ['最大值', fmt(summary.max)], ['缺失值', String(summary.missing)]].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
    <footer className="chart-source"><a href={dataset.source_url} target="_blank" rel="noreferrer">来源：{dataset.source_name}</a><span>{dataset.fetched_at ? `采集于 ${datetime(dataset.fetched_at)}` : '尚未采集'}</span><p>来源更新：{dataset.source_updated ?? '未知'}；首次发布日期：{dataset.published_at ?? '未知'}。{dataset.note} {trend ? '拟合为当前显示区间普通最小二乘趋势，不是因果或预测。' : ''}{ma ? ` 移动平均窗口 ${ma} 期，缺失窗口不计算。` : ''}{transform !== 'raw' ? ` 转换：${transform === 'index' ? '首个有效正值=100' : '(当期÷上年同期−1)×100，分母必须为正数'}。` : ''}{dataset.kind === 'composition' ? ' 饼图占比以本表合计为分母。' : ''}</p></footer>
  </section>;
}

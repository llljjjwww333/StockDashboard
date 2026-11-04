import { isChinaTicker } from '../lib/instrumentIdentity.ts';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { CandlestickSeries, ColorType, CrosshairMode, HistogramSeries, LineSeries, LineStyle, PriceScaleMode,
  TrackingModeExitMode, createChart, createSeriesMarkers, createTextWatermark,
  type CandlestickData, type IChartApi, type IPriceLine, type ISeriesApi, type ISeriesMarkersPluginApi,
  type SeriesMarker, type Time, type UTCTimestamp, type ITextWatermarkPluginApi } from 'lightweight-charts';
import { t, getLocale, useLanguage } from '../lib/i18n';
import { pricePrecision } from '../lib/pricePrecision';
import { useAppearance } from '../store/appearanceStore';
import { calculateIndicators } from './indicators';
import { useIndicators } from './indicatorStore';
import { formatCompact, formatSigned } from './useTerminalData';
import { candleUpdatePlan, chartCandles, readPriceLevels } from './professionalChartData';
import type { MarketChartProps } from './MarketChart';
import './professionalChart.css';

type ExtraSeries = { api: ISeriesApi<'Line'> | ISeriesApi<'Histogram'>; key: string; panel?: string };
type Engine = { chart: IChartApi; price: ISeriesApi<'Candlestick'>; markers: ISeriesMarkersPluginApi<Time>;
  extra: ExtraSeries[]; previous: CandlestickData<UTCTimestamp>[];
  indices: Map<number, number>; manualLines: IPriceLine[]; aiLines: IPriceLine[]; drawing: boolean;
  trends: Map<string, ISeriesApi<'Line'>>; focusedAnnotation?: string;
  annotationIds: Set<string>; onAnnotation?: (id: string) => void; precision: number; initialized: boolean;
  captions: Array<{ key: string; api: ITextWatermarkPluginApi<Time> }> };
type ToolName = 'reset' | 'latest' | 'level' | 'clear' | 'camera' | 'expand';
function ToolIcon({ name }: { name: ToolName }) {
  const paths: Record<ToolName, string> = {
    reset: 'M3 7a6 6 0 1 1 0 4M3 3v4h4', latest: 'M3 4v10M6 9h10m-4-4 4 4-4 4',
    level: 'M2 9h14M5 5v8', clear: 'M4 5h10M7 2h4M5 5l1 11h6l1-11M8 8v5m2-5v5',
    camera: 'M2 5h4l1-2h4l1 2h4v10H2ZM12 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0', expand: 'M2 7V2h5m4 0h5v5m0 4v5h-5m-4 0H2v-5',
  };
  return <svg width="17" height="17" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><path d={paths[name]} /></svg>;
}
const cssColor = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export const ProfessionalChart = memo(function ProfessionalChart({ data, ticker, period, interval = '1d', warmup = [],
  annotations = [], trendlines = [], immersive = false, selectedAnnotation, onSelectAnnotation, source, adjustment }: MarketChartProps) {
  const { language } = useLanguage();
  const { theme, priceColors } = useAppearance();
  const { overlays, panels } = useIndicators();
  const outer = useRef<HTMLDivElement>(null), container = useRef<HTMLDivElement>(null), engine = useRef<Engine | null>(null);
  const [hover, setHover] = useState<UTCTimestamp | null>(null);
  const [view, setView] = useState<{ from: number; to: number } | null>(null);
  const [scale, setScale] = useState<'normal' | 'log' | 'percent'>('normal');
  const [drawing, setDrawing] = useState(false), [expanded, setExpanded] = useState(false);
  const [levels, setLevels] = useState(() => readPriceLevels(ticker));
  const [width, setWidth] = useState(1000);
  const [rendered, setRendered] = useState({ candles: 0, panes: 1, overlays: 0, volume: false });
  const [markerCount, setMarkerCount] = useState(0);
  const [trendCount, setTrendCount] = useState(0);
  const rows = useMemo(() => chartCandles(data, ticker), [data, ticker]);
  const indices = useMemo(() => new Map(rows.map((row, index) => [row.time, index])), [rows]);
  const indicators = useMemo(() => calculateIndicators(data, warmup), [data, warmup]);
  const intraday = period === '1d' || period === '5d';
  const pointFormatter = useMemo(() => new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en-US', {
    timeZone: isChinaTicker(ticker) ? 'Asia/Shanghai' : 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    ...(intraday ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}),
  }), [ticker, intraday, language]);
  const selectedIndex = (hover === null ? undefined : indices.get(hover)) ?? data.length - 1;
  const precision = pricePrecision(ticker, data[data.length - 1]?.close ?? 1);
  const paneCount = panels.length;
  const hasData = data.length > 0;
  const sessionCount = useMemo(() => new Set(rows.map(row => Math.floor(row.time / 86400))).size, [rows]);

  useEffect(() => {
    if (!container.current) return;
    const chart = createChart(container.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: cssColor('--ink') }, textColor: cssColor('--muted'),
        fontFamily: getComputedStyle(document.documentElement).fontFamily, fontSize: 11, attributionLogo: true,
        panes: { separatorColor: cssColor('--line'), separatorHoverColor: cssColor('--orange-soft'), enableResize: true } },
      grid: { vertLines: { color: cssColor('--line-soft') }, horzLines: { color: cssColor('--line-soft') } },
      crosshair: { mode: CrosshairMode.Magnet },
      rightPriceScale: { borderColor: cssColor('--line'), minimumWidth: 74 },
      timeScale: { borderColor: cssColor('--line'), timeVisible: period === '1d' || period === '5d', secondsVisible: false,
        rightOffset: 5, barSpacing: 8, minBarSpacing: 2, shiftVisibleRangeOnNewBar: true, lockVisibleTimeRangeOnResize: true },
      handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: { time: true, price: true }, axisDoubleClickReset: true },
      trackingMode: { exitMode: TrackingModeExitMode.OnNextTap },
    });
    const price = chart.addSeries(CandlestickSeries, { upColor: cssColor('--up'), downColor: cssColor('--down'),
      borderVisible: false, wickUpColor: cssColor('--up'), wickDownColor: cssColor('--down'), priceLineStyle: LineStyle.Dashed });
    const current: Engine = { chart, price, markers: createSeriesMarkers(price), extra: [], previous: [], indices: new Map(),
      manualLines: [], aiLines: [], trends: new Map(), drawing: false, annotationIds: new Set(), precision: 2, initialized: false, captions: [] };
    engine.current = current;
    chart.subscribeCrosshairMove(event => {
      setHover(typeof event.time === 'number' && current.indices.has(event.time) ? event.time : null);
    });
    chart.timeScale().subscribeVisibleLogicalRangeChange(range => {
      if (range) setView(previous => previous?.from === range.from && previous?.to === range.to ? previous : { from: range.from, to: range.to });
    });
    chart.subscribeClick(event => {
      if (current.drawing && event.point && (event.paneIndex === undefined || event.paneIndex === 0)) {
        const value = price.coordinateToPrice(event.point.y);
        if (value !== null && value > 0) setLevels(previous => [...previous.slice(-11), +value.toFixed(current.precision)]);
        setDrawing(false);
      } else if (typeof event.hoveredObjectId === 'string' && current.annotationIds.has(event.hoveredObjectId)) {
        current.onAnnotation?.(event.hoveredObjectId);
      } else if (event.hoveredSeries) {
        const trend = [...current.trends].find(([, api]) => api === event.hoveredSeries);
        if (trend) current.onAnnotation?.(trend[0]);
      }
    });
    const observer = new ResizeObserver(entries => setWidth(Math.round(entries[0].contentRect.width)));
    observer.observe(container.current);
    return () => { observer.disconnect(); engine.current = null; chart.remove(); };
  }, [ticker, period, interval, hasData]);

  // Keep the price series and camera alive when toggling overlays or receiving quotes.
  useEffect(() => {
    const current = engine.current;
    if (!current) return;
    const range = current.chart.timeScale().getVisibleLogicalRange();
    for (const caption of current.captions) caption.api.detach();
    current.captions = [];
    for (const item of current.extra) current.chart.removeSeries(item.api);
    current.extra = [];
    for (const key of overlays) for (const line of indicators.overlays[key]) {
      current.extra.push({ key: line.name, api: current.chart.addSeries(LineSeries, { color: cssColor(line.color.slice(4, -1)),
        lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }) });
    }
    panels.forEach((key, index) => {
      const pane = index + 1, panel = indicators.panels[key];
      if (panel.bars) current.extra.push({ key: `${key}:bars`, panel: key, api: current.chart.addSeries(HistogramSeries,
        { priceFormat: { type: key === 'volume' ? 'volume' : 'price' }, priceLineVisible: false, lastValueVisible: false, base: 0 }, pane) });
      for (const line of panel.lines) current.extra.push({ key: line.name, panel: key, api: current.chart.addSeries(LineSeries,
        { color: cssColor(line.color.slice(4, -1)), lineWidth: 1, priceLineVisible: false, lastValueVisible: false }, pane) });
      const guideSeries = current.extra.find(item => item.panel === key)?.api;
      for (const price of panel.guides ?? []) guideSeries?.createPriceLine({ price, color: cssColor('--dim'), lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false });
      current.chart.panes()[pane]?.setStretchFactor(key === 'volume' ? 1 : 1.35);
      current.chart.priceScale('right', pane).applyOptions({ scaleMargins: { top: .23, bottom: .10 } });
      current.captions.push({ key, api: createTextWatermark(current.chart.panes()[pane], { horzAlign: 'left', vertAlign: 'top', lines: [] }) });
    });
    current.chart.panes()[0]?.setStretchFactor(4.6);
    if (range) current.chart.timeScale().setVisibleLogicalRange(range);
    // Indicator values update separately without rebuilding panes on each fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlays, panels, ticker, period, interval, hasData]);

  useEffect(() => {
    const current = engine.current;
    if (!current || !rows.length) return;
    current.indices = indices;
    current.precision = precision;
    current.price.applyOptions({ priceFormat: { type: 'price', precision, minMove: 10 ** -precision } });
    const update = candleUpdatePlan(current.previous, rows);
    if (update.replace) current.price.setData(update.rows);
    else for (const row of update.rows) current.price.update(row);
    current.previous = rows;
    const up = cssColor('--up'), down = cssColor('--down');
    for (const item of current.extra) {
      if (item.api.seriesType() === 'Histogram') {
        const panel = indicators.panels[item.panel as keyof typeof indicators.panels];
        (item.api as ISeriesApi<'Histogram'>).setData((panel.bars ?? []).flatMap((value, index) => value === null ? [] : [{ time: rows[index].time, value,
          color: item.panel === 'volume' ? (data[index].close >= data[index].open ? up : down) : value >= 0 ? up : down }]));
      } else {
        const line = item.panel ? indicators.panels[item.panel as keyof typeof indicators.panels].lines.find(line => line.name === item.key)
          : Object.values(indicators.overlays).flat().find(line => line.name === item.key);
        (item.api as ISeriesApi<'Line'>).setData((line?.values ?? []).map((value, index) => value === null ? { time: rows[index].time } : { time: rows[index].time, value }));
      }
    }
    if (!current.initialized) {
      current.chart.timeScale().setVisibleLogicalRange({ from: Math.max(-1, rows.length - 120), to: rows.length + 4 });
      current.initialized = true;
    }
    const next = { candles: current.price.data().length, panes: current.chart.panes().length,
      overlays: current.extra.filter(item => !item.panel).length, volume: current.extra.some(item => item.panel === 'volume') };
    setRendered(previous => Object.keys(next).every(key => previous[key as keyof typeof next] === next[key as keyof typeof next]) ? previous : next);
  }, [data, rows, indices, indicators, precision, overlays, panels, theme, priceColors]);

  useEffect(() => {
    const current = engine.current;
    if (!current) return;
    current.chart.applyOptions({ layout: { background: { type: ColorType.Solid, color: cssColor('--ink') }, textColor: cssColor('--muted'),
      fontFamily: getComputedStyle(document.documentElement).fontFamily, panes: { separatorColor: cssColor('--line') } },
      grid: { vertLines: { color: cssColor('--line-soft') }, horzLines: { color: cssColor('--line-soft') } },
      rightPriceScale: { borderColor: cssColor('--line') }, timeScale: { borderColor: cssColor('--line') },
      localization: { locale: getLocale(), dateFormat: language === 'zh' ? 'yyyy/MM/dd' : 'dd MMM yyyy' } });
    current.price.applyOptions({ upColor: cssColor('--up'), downColor: cssColor('--down'), wickUpColor: cssColor('--up'), wickDownColor: cssColor('--down') });
    for (const item of current.extra) if (item.api.seriesType() === 'Line') {
      const line = item.panel ? indicators.panels[item.panel as keyof typeof indicators.panels].lines.find(line => line.name === item.key)
        : Object.values(indicators.overlays).flat().find(line => line.name === item.key);
      if (line) item.api.applyOptions({ color: cssColor(line.color.slice(4, -1)) });
    }
  }, [theme, priceColors, language, indicators, overlays, panels]);

  useEffect(() => {
    const current = engine.current;
    if (!current) return;
    current.chart.priceScale('right').applyOptions({ mode: scale === 'log' ? PriceScaleMode.Logarithmic : scale === 'percent' ? PriceScaleMode.Percentage : PriceScaleMode.Normal, autoScale: true });
  }, [scale, hasData]);

  useEffect(() => {
    const current = engine.current;
    if (!current) return;
    current.drawing = drawing;
    for (const line of current.manualLines) current.price.removePriceLine(line);
    current.manualLines = levels.map((price, index) => current.price.createPriceLine({ price, color: cssColor('--indicator-blue'),
      lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: `${t('水平线')} ${index + 1}` }));
    try { localStorage.setItem(`marketdesk:levels:${ticker}`, JSON.stringify(levels)); } catch { /* Memory drawing remains available. */ }
  }, [levels, drawing, ticker, theme, language, hasData]);

  useEffect(() => {
    const current = engine.current;
    if (!current) return;
    current.onAnnotation = onSelectAnnotation;
    const valid = annotations.filter(point => data[point.index]?.timestamp === point.timestamp && Number.isFinite(point.price));
    current.annotationIds = new Set(valid.map(point => point.id));
    const markers: SeriesMarker<Time>[] = valid.map(point => ({ id: point.id, time: rows[point.index].time,
      position: point.kind === 'support' || point.kind === 'reversal' ? 'belowBar' : 'aboveBar',
      shape: point.kind === 'support' ? 'arrowUp' : point.kind === 'resistance' ? 'arrowDown' : 'circle',
      color: point.id === selectedAnnotation ? cssColor('--text') : cssColor('--orange'), text: point.label, size: point.id === selectedAnnotation ? 1.5 : 1 }));
    current.markers.setMarkers(markers.sort((a, b) => +a.time - +b.time));
    setMarkerCount(current.markers.markers().length);
    for (const line of current.aiLines) current.price.removePriceLine(line);
    current.aiLines = valid.filter(point => point.kind === 'support' || point.kind === 'resistance').map(point => current.price.createPriceLine({ price: point.price,
      color: cssColor('--orange'), lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: point.label }));
    for (const [id, api] of current.trends) {
      if (trendlines.some(line => line.id === id)) continue;
      current.chart.removeSeries(api);
      current.trends.delete(id);
    }
    for (const line of trendlines) {
      const color = cssColor(line.kind === 'support' ? '--indicator-blue' : '--indicator-purple');
      const api = current.trends.get(line.id) ?? current.chart.addSeries(LineSeries, {
        priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, pointMarkersVisible: true,
        autoscaleInfoProvider: () => null,
      });
      current.trends.set(line.id, api);
      api.applyOptions({ color, lineWidth: line.id === selectedAnnotation ? 3 : 2 });
      api.setData([{ time: rows[line.startIndex].time, value: line.start.price }, { time: rows[line.endIndex].time, value: line.end.price }]);
    }
    setTrendCount(current.trends.size);
    const selected = valid.find(point => point.id === selectedAnnotation);
    const trend = trendlines.find(line => line.id === selectedAnnotation);
    const anchor = selected ?? (trend ? { index: trend.endIndex, price: trend.end.price } : undefined);
    if (!anchor) current.focusedAnnotation = undefined;
    else if (current.focusedAnnotation !== selectedAnnotation) {
      current.focusedAnnotation = selectedAnnotation ?? undefined;
      const { index, price } = anchor;
      const range = current.chart.timeScale().getVisibleLogicalRange();
      if (range && (index < range.from || index > range.to)) {
        const half = (range.to - range.from) / 2;
        current.chart.timeScale().setVisibleLogicalRange({ from: index - half, to: index + half });
      }
      current.chart.setCrosshairPosition(price, rows[index].time, current.price);
      setHover(rows[index].time);
    }
  }, [annotations, trendlines, selectedAnnotation, onSelectAnnotation, rows, data, theme]);

  useEffect(() => {
    const current = engine.current;
    if (!current) return;
    const index = Math.max(0, selectedIndex);
    const format = (value: number | null | undefined) => value == null ? '--' : Math.abs(value) >= 10000 ? formatCompact(value) : value.toFixed(2);
    for (const caption of current.captions) {
      const panel = indicators.panels[caption.key as keyof typeof indicators.panels];
      const values = panel.lines.map(line => `${line.name} ${format(line.values[index])}`).join('   ');
      const bars = panel.bars ? ` ${format(panel.bars[index])}` : '';
      caption.api.applyOptions({ lines: [{ text: `  ${t(panel.label)}${bars}   ${values}`, color: cssColor('--muted'), fontSize: 11,
        fontFamily: getComputedStyle(document.documentElement).fontFamily }] });
    }
  }, [selectedIndex, indicators, panels, language, theme]);

  useEffect(() => {
    if (!expanded) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setExpanded(false); } };
    window.addEventListener('keydown', escape, true);
    return () => { document.body.style.overflow = previous; window.removeEventListener('keydown', escape, true); };
  }, [expanded]);

  const point = data[selectedIndex];
  if (!point) return <div className="chart-empty">{t('暂无行情')}</div>;
  const previous = data[selectedIndex - 1]?.close ?? point.open;
  const delta = point.close - previous, change = delta / Math.max(previous, .000001) * 100;
  const time = pointFormatter.format(new Date(point.timestamp));
  const selectedPoint = annotations.find(item => item.id === selectedAnnotation);
  const selectedTrend = trendlines.find(item => item.id === selectedAnnotation);
  const reset = () => { engine.current?.chart.timeScale().fitContent(); engine.current?.chart.priceScale('right').applyOptions({ autoScale: true }); };
  const screenshot = () => {
    const canvas = engine.current?.chart.takeScreenshot(true, false);
    canvas?.toBlob(blob => {
      if (!blob) return;
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = `${ticker}-${interval}-${new Date().toISOString().slice(0, 10)}.png`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  };
  const tools: Array<{ name: ToolName; label: string; onClick: () => void; active?: boolean; disabled?: boolean }> = [
    { name: 'reset', label: '重置视图', onClick: reset },
    { name: 'latest', label: '回到最新', onClick: () => engine.current?.chart.timeScale().scrollToRealTime() },
    { name: 'level', label: '水平线', active: drawing, onClick: () => setDrawing(value => !value) },
    { name: 'clear', label: '清除画线', disabled: !levels.length, onClick: () => setLevels([]) },
    { name: 'camera', label: '保存图表', onClick: screenshot },
    { name: 'expand', label: expanded ? '退出全屏' : '全屏图表', onClick: () => setExpanded(value => !value) },
  ];
  return <div ref={outer} className={`market-chart professional-chart${expanded ? ' is-expanded' : ''}${drawing ? ' is-drawing' : ''}`}
    data-engine="lightweight-charts" data-mode="candles" data-period={period} data-interval={interval} data-points={data.length} data-sessions={sessionCount}
    data-candle-count={rendered.candles} data-active-index={selectedIndex} data-pane-count={rendered.panes} data-overlay-count={rendered.overlays} data-volume-enabled={rendered.volume}
    data-visible-from={view?.from.toFixed(2)} data-visible-to={view?.to.toFixed(2)} data-price-scale={scale} data-level-count={levels.length} data-annotation-count={markerCount} data-trend-count={trendCount}>
    <div className="chart-readout"><div><span>{ticker}</span><strong>{point.close.toFixed(precision)}</strong><em className={delta >= 0 ? 'positive' : 'negative'} title={t('较前一根')}>{formatSigned(delta, precision)} ({formatSigned(change)}%)</em></div>
      <dl>{[['开', point.open], ['高', point.high], ['低', point.low], ['收', point.close]].map(([label, value]) => <div key={label}><dt>{t(label as string)}</dt><dd>{(value as number).toFixed(precision)}</dd></div>)}<div><dt>{t('量')}</dt><dd>{formatCompact(point.volume)}</dd></div></dl>
    </div>
    <div className="chart-meta-row"><div className="chart-context"><time title={source}>{time} · {t(interval === '1d' ? '日K' : interval === '1h' ? '60分钟' : `${parseInt(interval)}分钟`)}{adjustment === 'qfq' ? ` · ${t('前复权')}` : ''}</time></div>
      <div className="indicator-legend">{overlays.flatMap(key => indicators.overlays[key]).map(line => <span key={line.name} style={{ color: line.color }}>{line.name} {line.values[selectedIndex]?.toFixed(precision) ?? '--'}</span>)}</div>
    </div>
    <div className="professional-tools" role="group" aria-label={t('图表工具')}>
      <select aria-label={t('价格刻度')} value={scale} onChange={event => setScale(event.target.value as typeof scale)}>
        <option value="normal">{t('普通')}</option><option value="log">{t('对数')}</option><option value="percent">%</option>
      </select>
      <div>{tools.map(tool => <button key={tool.name} type="button" title={t(tool.label)} aria-label={t(tool.label)} aria-pressed={tool.active} disabled={tool.disabled} onClick={tool.onClick}><ToolIcon name={tool.name} /></button>)}</div>
      <small>{t('{count} 根K线', { count: data.length })}</small>
    </div>
    <div ref={container} className="professional-canvas" role="img" tabIndex={0} aria-label={t('{ticker} 价格走势', { ticker })}
      style={{ height: expanded ? 'calc(100dvh - 170px)' : immersive ? `max(${330 + paneCount * 66}px, calc(100dvh - 250px))` : (width < 600 ? 330 : 420) + paneCount * 116, minHeight: 320 }}
      onKeyDown={event => {
        const current = engine.current;
        if (!current) return;
        const index = event.key === 'ArrowLeft' ? Math.max(0, selectedIndex - 1) : event.key === 'ArrowRight' ? Math.min(data.length - 1, selectedIndex + 1)
          : event.key === 'Home' ? 0 : event.key === 'End' ? data.length - 1 : null;
        if (index !== null) { event.preventDefault(); current.chart.setCrosshairPosition(data[index].close, rows[index].time, current.price); setHover(rows[index].time); }
        if (event.key === 'Escape') { event.preventDefault(); current.chart.clearCrosshairPosition(); setHover(null); setDrawing(false); }
      }} />
    {selectedPoint && <div className="annotation-detail" role="status"><strong>{selectedPoint.label}</strong><span>{selectedPoint.detail}</span></div>}
    {selectedTrend && <div className="annotation-detail" role="status"><strong>{selectedTrend.label} · {selectedTrend.start.price.toFixed(precision)} → {selectedTrend.end.price.toFixed(precision)}</strong><span>{selectedTrend.detail}</span></div>}
  </div>;
});

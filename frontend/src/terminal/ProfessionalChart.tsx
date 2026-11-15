import { isCryptoTicker, isChinaTicker } from '../lib/instrumentIdentity.ts';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { CandlestickSeries, ColorType, CrosshairMode, HistogramSeries, LineSeries, LineStyle, PriceScaleMode,
  TrackingModeExitMode, createChart, createSeriesMarkers, createTextWatermark,
  type CandlestickData, type IChartApi, type IPaneApi, type IPriceLine, type ISeriesApi, type ISeriesMarkersPluginApi,
  type MouseEventParams, type SeriesMarker, type Time, type UTCTimestamp, type ITextWatermarkPluginApi } from 'lightweight-charts';
import { t, getLocale, useLanguage } from '../lib/i18n';
import { pricePrecision } from '../lib/pricePrecision';
import { formatVolume } from '../lib/volumePresentation';
import { useAppearance } from '../store/appearanceStore';
import { useChartPreferences, type PriceScale } from '../store/chartPreferenceStore';
import { calculateIndicators, indicatorPrecision, type PanelKey } from './indicators';
import { useIndicators } from './indicatorStore';
import { formatCompact } from './useTerminalData';
import { ChartChange } from './ChartChange';
import { candleUpdatePlan, chartCandles, formatPercentagePrice, indicatorUpdatePlan, percentageReference, rangeAfterCandleReplacement, type IndicatorRow } from './professionalChartData';
import { priceLevelHistory } from './priceLevelHistory';
import { ProfessionalChartTools, type ChartTool } from './ProfessionalChartTools';
import { PriceLevelEditor } from './PriceLevelEditor';
import { PriceLevelList } from './PriceLevelList';
import type { MarketChartProps } from './MarketChart';
import { volumeDirection } from './volumeDirection';
import './professionalChart.css';

type ExtraSeries = { api: ISeriesApi<'Line'> | ISeriesApi<'Histogram'>; key: string; panel?: PanelKey; previous?: IndicatorRow[] };
type Cursor = { time: UTCTimestamp; panel?: PanelKey; price?: number };
type Engine = { chart: IChartApi; price: ISeriesApi<'Candlestick'>; markers: ISeriesMarkersPluginApi<Time>;
  extra: ExtraSeries[]; previous: CandlestickData<UTCTimestamp>[];
  indices: Map<number, number>; manualLines: IPriceLine[]; aiLines: IPriceLine[]; drawing: boolean;
  trends: Map<string, ISeriesApi<'Line'>>; focusedAnnotation?: string;
  annotationIds: Set<string>; onAnnotation?: (id: string) => void; precision: number; initialized: boolean;
  captions: Array<{ key: PanelKey; pane: IPaneApi<Time>; api: ITextWatermarkPluginApi<Time> }>; cursor: Cursor | null; cursorFrame: number | null; updating: boolean;
  scale: PriceScale; percentageBase: number | null; percentageLine: IPriceLine | null };
const cssColor = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function applyPriceAxis(current: Engine) {
  const format = current.price.options().priceFormat;
  const minMove = 10 ** -current.precision;
  if (current.scale === 'percent') {
    // Native percentage mode rebases each series independently. Keep raw price geometry
    // shared by candles, indicators and AI lines; only format axis labels as percentages.
    const reference = percentageReference(current.previous, current.chart.timeScale().getVisibleLogicalRange()?.from);
    if (format.type !== 'custom' || format.minMove !== minMove || current.percentageBase !== reference) {
      current.percentageBase = reference;
      const formatter = (price: number) => formatPercentagePrice(price, reference);
      current.price.applyOptions({ priceFormat: { type: 'custom', minMove, formatter, tickmarksFormatter: (prices: number[]) => prices.map(formatter) } });
    }
    if (reference !== null) {
      if (!current.percentageLine) current.percentageLine = current.price.createPriceLine({ price: reference,
        color: cssColor('--dim'), lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false });
      else if (current.percentageLine.options().price !== reference) current.percentageLine.applyOptions({ price: reference });
    } else if (current.percentageLine) {
      current.price.removePriceLine(current.percentageLine);
      current.percentageLine = null;
    }
  } else {
    if (format.type !== 'price' || format.precision !== current.precision || format.minMove !== minMove) {
      current.price.applyOptions({ priceFormat: { type: 'price', precision: current.precision, minMove } });
    }
    if (current.percentageLine) current.price.removePriceLine(current.percentageLine);
    current.percentageLine = null;
    current.percentageBase = null;
  }
}

export const ProfessionalChart = memo(function ProfessionalChart({ data, ticker, period, interval = '1d', warmup = [],
  annotations = [], trendlines = [], immersive = false, selectedAnnotation, onSelectAnnotation, source, adjustment }: MarketChartProps) {
  const { language } = useLanguage();
  const { theme, priceColors } = useAppearance();
  const volumeMarket = isCryptoTicker(ticker) ? 'CRYPTO' : isChinaTicker(ticker) ? 'CN' : 'US';
  const volumeFormatter = useMemo(() => {
    const locale = language === 'zh' ? 'zh-CN' : 'en-US';
    return (value: number) => formatVolume(value, volumeMarket, locale, false);
  }, [volumeMarket, language]);
  const { overlays, panels } = useIndicators();
  const outer = useRef<HTMLDivElement>(null), container = useRef<HTMLDivElement>(null), engine = useRef<Engine | null>(null);
  const [hover, setHover] = useState<UTCTimestamp | null>(null);
  const setCursor = useCallback((current: Engine, cursor: Cursor | null) => {
    current.cursor = cursor;
    setHover(cursor?.time ?? null);
  }, []);
  const syncCursor = useCallback((current: Engine, afterRangeChange: boolean) => {
    if (current.cursorFrame !== null) cancelAnimationFrame(current.cursorFrame);
    const restore = () => {
      current.cursorFrame = null;
      const cursor = current.cursor;
      if (cursor) {
        const index = current.indices.get(cursor.time);
        const range = current.chart.timeScale().getVisibleLogicalRange();
        if (index === undefined || (range && (index < Math.floor(range.from) || index > Math.ceil(range.to)))) {
          current.chart.clearCrosshairPosition();
          setCursor(current, null);
        } else {
          const paneSeries = cursor.panel ? current.extra.find(item => item.panel === cursor.panel &&
            item.previous?.some(row => row.time === cursor.time && row.value !== undefined)) : undefined;
          const paneValue = paneSeries?.previous?.find(row => row.time === cursor.time)?.value;
          current.chart.setCrosshairPosition(paneValue ?? cursor.price ?? current.previous[index].close, cursor.time, paneSeries?.api ?? current.price);
        }
      }
      current.updating = false;
    };
    if (afterRangeChange && current.cursor) current.cursorFrame = requestAnimationFrame(restore);
    else restore();
  }, [setCursor]);
  const [view, setView] = useState<{ from: number; to: number } | null>(null);
  const { priceScale: scale, setPriceScale: setScale } = useChartPreferences();
  const [drawing, setDrawing] = useState(false), [expanded, setExpanded] = useState(false);
  const [levelSelection, setLevelSelection] = useState<{ index: number; value: number } | null>(null);
  const [levelListOpen, setLevelListOpen] = useState(false);
  const levelStore = useMemo(() => priceLevelHistory(ticker), [ticker]);
  const { present: levels, past, future, setLevels, undo, redo } = useStore(levelStore);
  const selectedLevel = levelSelection && levels[levelSelection.index] === levelSelection.value ? levelSelection : null;
  useEffect(() => levelStore.subscribe(state => {
    setLevelSelection(selected => selected && state.present[selected.index] === selected.value ? selected : null);
  }), [levelStore]);
  const [width, setWidth] = useState(1000);
  const [rendered, setRendered] = useState({ candles: 0, panes: 1, overlays: 0, volume: false });
  const [markerCount, setMarkerCount] = useState(0);
  const [trendCount, setTrendCount] = useState(0);
  const rows = useMemo(() => chartCandles(data, ticker), [data, ticker]);
  const indices = useMemo(() => new Map(rows.map((row, index) => [row.time, index])), [rows]);
  const indicators = useMemo(() => calculateIndicators(data, warmup), [data, warmup]);
  const intraday = period === '1d' || period === '5d';
  const pointFormatter = useMemo(() => new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en-US', {
    timeZone: isCryptoTicker(ticker) ? 'UTC' : isChinaTicker(ticker) ? 'Asia/Shanghai' : 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    ...(intraday ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}),
  }), [ticker, intraday, language]);
  const lastIndex = data.length - 1;
  const lastVisible = view ? Math.min(lastIndex, Math.max(0, Math.floor(view.to + 1e-7))) : lastIndex;
  const selectedIndex = (hover === null ? undefined : indices.get(hover)) ?? lastVisible;
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
    chart.panes()[0].setStretchFactor(4.6);
    const current: Engine = { chart, price, markers: createSeriesMarkers(price), extra: [], previous: [], indices: new Map(),
      manualLines: [], aiLines: [], trends: new Map(), drawing: false, annotationIds: new Set(), precision: 2, initialized: false, captions: [],
      cursor: null, cursorFrame: null, updating: false, scale: 'normal', percentageBase: null, percentageLine: null };
    engine.current = current;
    chart.subscribeCrosshairMove(event => {
      if (current.updating && !event.sourceEvent) return;
      const time = typeof event.time === 'number' && current.indices.has(event.time) ? event.time : null;
      if (!event.sourceEvent && time === current.cursor?.time) return;
      const panel = current.captions[(event.paneIndex ?? 0) - 1]?.key;
      setCursor(current, time === null ? null : { time, panel });
    });
    chart.timeScale().subscribeVisibleLogicalRangeChange(range => {
      if (range) {
        setView(previous => previous?.from === range.from && previous?.to === range.to ? previous : { from: range.from, to: range.to });
        if (current.scale === 'percent') applyPriceAxis(current);
      }
    });
    const selectAtPoint = (event: MouseEventParams<Time>) => {
      setLevelListOpen(false);
      if (current.drawing && event.point && (event.paneIndex === undefined || event.paneIndex === 0)) {
        const value = price.coordinateToPrice(event.point.y);
        if (value !== null && value > 0) setLevels(previous => [...previous.slice(-11), +value.toFixed(current.precision)]);
        current.drawing = false;
        setDrawing(false);
      } else {
        const savedLevels = levelStore.getState().present;
        let closest = -1, distance = matchMedia('(pointer: coarse)').matches ? 14 : 7;
        if (event.point && (event.paneIndex === undefined || event.paneIndex === 0)) {
          savedLevels.forEach((value, index) => {
            const y = current.price.priceToCoordinate(value);
            if (y !== null && Math.abs(y - event.point!.y) <= distance) { closest = index; distance = Math.abs(y - event.point!.y); }
          });
        }
        if (closest >= 0) {
          setLevelSelection({ index: closest, value: savedLevels[closest] });
          container.current?.focus({ preventScroll: true });
        } else {
          setLevelSelection(null);
          if (typeof event.hoveredObjectId === 'string' && current.annotationIds.has(event.hoveredObjectId)) current.onAnnotation?.(event.hoveredObjectId);
          else if (event.hoveredSeries) {
            const trend = [...current.trends].find(([, api]) => api === event.hoveredSeries);
            if (trend) current.onAnnotation?.(trend[0]);
          }
        }
      }
    };
    chart.subscribeClick(selectAtPoint);
    chart.subscribeDblClick(selectAtPoint);
    const observer = new ResizeObserver(entries => setWidth(Math.round(entries[0].contentRect.width)));
    observer.observe(container.current);
    return () => {
      if (current.cursorFrame !== null) cancelAnimationFrame(current.cursorFrame);
      observer.disconnect(); engine.current = null; chart.remove();
    };
  }, [ticker, period, interval, hasData, setCursor, setLevels, levelStore]);

  // Reconcile indicators without replacing retained panes, their scales or manual sizing.
  useEffect(() => {
    const current = engine.current;
    if (!current) return;
    current.updating = true;
    const range = current.chart.timeScale().getVisibleLogicalRange();
    const wantedOverlays = overlays.flatMap(key => indicators.overlays[key]);
    const overlayNames = new Set(wantedOverlays.map(line => line.name));
    const panelKeys = new Set(panels);
    for (const caption of current.captions) if (!panelKeys.has(caption.key)) caption.api.detach();
    current.extra = current.extra.filter(item => {
      if (item.panel ? panelKeys.has(item.panel) : overlayNames.has(item.key)) return true;
      current.chart.removeSeries(item.api);
      return false;
    });
    for (const line of wantedOverlays) {
      if (current.extra.some(item => !item.panel && item.key === line.name)) continue;
      current.extra.push({ key: line.name, api: current.chart.addSeries(LineSeries, { color: cssColor(line.color.slice(4, -1)),
        lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }) });
    }
    const retained = new Map(current.captions.filter(caption => panelKeys.has(caption.key)).map(caption => [caption.key, caption]));
    current.captions = panels.map((key, index) => {
      const existing = retained.get(key);
      if (existing) { existing.pane.moveTo(index + 1); return existing; }
      const pane = current.chart.addPane(), panel = indicators.panels[key];
      if (panel.bars) current.extra.push({ key: `${key}:bars`, panel: key, api: pane.addSeries(HistogramSeries,
        { priceFormat: { type: key === 'volume' ? 'volume' : 'price' }, priceLineVisible: false, lastValueVisible: false, base: 0 }) });
      for (const line of panel.lines) current.extra.push({ key: line.name, panel: key, api: pane.addSeries(LineSeries,
        { color: cssColor(line.color.slice(4, -1)), lineWidth: 1, priceLineVisible: false, lastValueVisible: false }) });
      const guideSeries = current.extra.find(item => item.panel === key)?.api;
      for (const price of panel.guides ?? []) guideSeries?.createPriceLine({ price, color: cssColor('--dim'), lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false });
      pane.setStretchFactor(key === 'volume' ? 1 : 1.35);
      pane.priceScale('right').applyOptions({ scaleMargins: { top: .23, bottom: .10 } });
      pane.moveTo(index + 1);
      return { key, pane, api: createTextWatermark(pane, { horzAlign: 'left', vertAlign: 'top', lines: [] }) };
    });
    if (current.cursor?.panel && !panelKeys.has(current.cursor.panel)) current.cursor = { time: current.cursor.time };
    if (range) current.chart.timeScale().setVisibleLogicalRange(range);
    // Indicator values update separately without rebuilding panes on each fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlays, panels, ticker, period, interval, hasData]);

  useEffect(() => {
    const current = engine.current;
    if (!current || !rows.length) return;
    // Series updates recalculate the crosshair at the previous pixel, which can now mean a different bar.
    current.updating = true;
    current.indices = indices;
    current.precision = precision;
    const update = candleUpdatePlan(current.previous, rows);
    const timeScale = current.chart.timeScale();
    const visible = update.replace && current.initialized ? timeScale.getVisibleLogicalRange() : null;
    const restored = visible ? rangeAfterCandleReplacement(current.previous, rows, visible) : null;
    if (update.replace) current.price.setData(update.rows);
    else for (const row of update.rows) current.price.update(row);
    current.previous = rows;
    applyPriceAxis(current);
    const up = cssColor('--up'), down = cssColor('--down');
    const volumeColors = { up, down, muted: cssColor('--muted') };
    for (const item of current.extra) {
      const digits = item.panel ? indicatorPrecision(item.panel, precision) : precision;
      const volumeSeries = item.panel === 'volume' || item.panel === 'obv';
      const previousFormat = item.api.options().priceFormat;
      if (volumeSeries) {
        if (previousFormat.type !== 'custom' || previousFormat.formatter !== volumeFormatter) {
          item.api.applyOptions({ priceFormat: { type: 'custom', minMove: 1, formatter: volumeFormatter,
            tickmarksFormatter: (values: number[]) => values.map(volumeFormatter) } });
        }
      } else if (previousFormat.type !== 'price' || previousFormat.precision !== digits || previousFormat.minMove !== 10 ** -digits) {
        item.api.applyOptions({ priceFormat: { type: 'price', precision: digits, minMove: 10 ** -digits } });
      }
      let nextRows: IndicatorRow[];
      if (item.api.seriesType() === 'Histogram') {
        const panel = indicators.panels[item.panel as keyof typeof indicators.panels];
        nextRows = (panel.bars ?? []).flatMap((value, index) => value === null ? [] : [{ time: rows[index].time, value,
          color: item.panel === 'volume' ? volumeColors[volumeDirection(data[index].close, data[index].open)] : value >= 0 ? up : down }]);
      } else {
        const line = item.panel ? indicators.panels[item.panel as keyof typeof indicators.panels].lines.find(line => line.name === item.key)
          : Object.values(indicators.overlays).flat().find(line => line.name === item.key);
        nextRows = (line?.values ?? []).map((value, index) => value === null ? { time: rows[index].time } : { time: rows[index].time, value });
      }
      const indicatorUpdate = indicatorUpdatePlan(item.previous ?? [], nextRows);
      if (indicatorUpdate.replace) item.api.setData(indicatorUpdate.rows);
      else for (const row of indicatorUpdate.rows) item.api.update(row);
      item.previous = nextRows;
    }
    if (!current.initialized) {
      timeScale.setVisibleLogicalRange({ from: Math.max(-1, rows.length - 120), to: rows.length + 4 });
      current.initialized = true;
    } else if (restored) timeScale.setVisibleLogicalRange(restored);
    syncCursor(current, Boolean(restored));
    const next = { candles: current.price.data().length, panes: current.chart.panes().length,
      overlays: current.extra.filter(item => !item.panel).length, volume: current.extra.some(item => item.panel === 'volume') };
    setRendered(previous => Object.keys(next).every(key => previous[key as keyof typeof next] === next[key as keyof typeof next]) ? previous : next);
  }, [data, rows, indices, indicators, precision, overlays, panels, theme, priceColors, syncCursor, volumeFormatter]);

  useEffect(() => {
    const current = engine.current;
    if (!current) return;
    current.chart.applyOptions({ layout: { background: { type: ColorType.Solid, color: cssColor('--ink') }, textColor: cssColor('--muted'),
      fontFamily: getComputedStyle(document.documentElement).fontFamily, panes: { separatorColor: cssColor('--line') } },
      grid: { vertLines: { color: cssColor('--line-soft') }, horzLines: { color: cssColor('--line-soft') } },
      rightPriceScale: { borderColor: cssColor('--line') }, timeScale: { borderColor: cssColor('--line') },
      localization: { locale: getLocale(), dateFormat: language === 'zh' ? 'yyyy/MM/dd' : 'dd MMM yyyy' } });
    current.price.applyOptions({ upColor: cssColor('--up'), downColor: cssColor('--down'), wickUpColor: cssColor('--up'), wickDownColor: cssColor('--down') });
    current.percentageLine?.applyOptions({ color: cssColor('--dim') });
    for (const item of current.extra) if (item.api.seriesType() === 'Line') {
      const line = item.panel ? indicators.panels[item.panel as keyof typeof indicators.panels].lines.find(line => line.name === item.key)
        : Object.values(indicators.overlays).flat().find(line => line.name === item.key);
      if (line) item.api.applyOptions({ color: cssColor(line.color.slice(4, -1)) });
    }
  }, [theme, priceColors, language, indicators, overlays, panels]);

  useEffect(() => {
    const current = engine.current;
    if (!current) return;
    current.scale = scale;
    current.chart.priceScale('right').applyOptions({ mode: scale === 'log' ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal, autoScale: true });
    applyPriceAxis(current);
  }, [scale, hasData]);

  useEffect(() => {
    const current = engine.current;
    if (!current) return;
    current.drawing = drawing;
    for (const line of current.manualLines) current.price.removePriceLine(line);
    current.manualLines = levels.map((price, index) => current.price.createPriceLine({ price, color: cssColor('--indicator-blue'),
      lineWidth: selectedLevel?.index === index ? 2 : 1, lineStyle: selectedLevel?.index === index ? LineStyle.Solid : LineStyle.Dashed,
      axisLabelVisible: true, title: `${t('水平线')} ${index + 1}` }));
  }, [levels, selectedLevel, drawing, ticker, theme, language, hasData]);

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
        priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        autoscaleInfoProvider: () => null,
      });
      current.trends.set(line.id, api);
      api.applyOptions({ color, lineWidth: line.id === selectedAnnotation ? 3 : 2,
        priceFormat: { type: 'price', precision, minMove: 10 ** -precision },
        pointMarkersVisible: line.clippedStartPrice === undefined && line.clippedEndPrice === undefined });
      api.setData([
        { time: rows[line.startIndex].time, value: line.clippedStartPrice ?? line.start.price },
        { time: rows[line.endIndex].time, value: line.clippedEndPrice ?? line.end.price },
      ]);
    }
    setTrendCount(current.trends.size);
    const selected = valid.find(point => point.id === selectedAnnotation);
    const trend = trendlines.find(line => line.id === selectedAnnotation);
    const anchor = selected ?? (trend ? { index: trend.endIndex, price: trend.clippedEndPrice ?? trend.end.price } : undefined);
    if (!anchor) current.focusedAnnotation = undefined;
    else if (current.focusedAnnotation !== selectedAnnotation) {
      current.focusedAnnotation = selectedAnnotation ?? undefined;
      const { index, price } = anchor;
      const range = current.chart.timeScale().getVisibleLogicalRange();
      const scroll = range && (index < range.from || index > range.to);
      current.updating = true;
      if (range && scroll) {
        const half = (range.to - range.from) / 2;
        current.chart.timeScale().setVisibleLogicalRange({ from: index - half, to: index + half });
      }
      setCursor(current, { time: rows[index].time, price });
      syncCursor(current, Boolean(scroll));
    }
  }, [annotations, trendlines, selectedAnnotation, onSelectAnnotation, rows, data, theme, precision, setCursor, syncCursor]);

  useEffect(() => {
    const current = engine.current;
    if (!current) return;
    const index = Math.max(0, selectedIndex);
    for (const caption of current.captions) {
      const digits = indicatorPrecision(caption.key, precision);
      const format = (value: number | null | undefined) => value == null ? '--'
        : caption.key === 'volume' || caption.key === 'obv' ? formatVolume(value, volumeMarket, getLocale())
        : Math.abs(value) >= 10000 ? formatCompact(value) : value.toFixed(digits);
      const panel = indicators.panels[caption.key as keyof typeof indicators.panels];
      const values = panel.lines.map(line => `${line.name} ${format(line.values[index])}`).join('   ');
      const bars = panel.bars ? ` ${format(panel.bars[index])}` : '';
      caption.api.applyOptions({ lines: [{ text: `  ${t(panel.label)}${bars}   ${values}`, color: cssColor('--muted'), fontSize: 11,
        fontFamily: getComputedStyle(document.documentElement).fontFamily }] });
    }
  }, [selectedIndex, indicators, panels, language, theme, precision, volumeMarket]);

  useEffect(() => {
    if (!expanded) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector('dialog[open]') && !outer.current?.querySelector('.professional-overflow-menu, .professional-level-editor, .professional-level-list')) {
        event.preventDefault(); event.stopPropagation(); setExpanded(false);
      }
    };
    window.addEventListener('keydown', escape, true);
    return () => { document.body.style.overflow = previous; window.removeEventListener('keydown', escape, true); };
  }, [expanded]);

  const point = data[selectedIndex];
  if (!point) return <div className="chart-empty">{t('暂无行情')}</div>;
  const previous = data[selectedIndex - 1]?.close ?? warmup.at(-1)?.close;
  const time = pointFormatter.format(new Date(point.timestamp));
  const selectedPoint = annotations.find(item => item.id === selectedAnnotation);
  const selectedTrend = trendlines.find(item => item.id === selectedAnnotation);
  const closeLevelEditor = () => { setLevelSelection(null); container.current?.focus({ preventScroll: true }); };
  const closeLevelList = () => { setLevelListOpen(false); container.current?.focus({ preventScroll: true }); };
  const editSelectedLevel = (value: number | null) => {
    if (!selectedLevel) return;
    setLevels(previous => previous[selectedLevel.index] !== selectedLevel.value ? previous
      : value === null ? previous.filter((_, index) => index !== selectedLevel.index)
      : previous.map((price, index) => index === selectedLevel.index ? value : price));
    closeLevelEditor();
  };
  const reset = () => { engine.current?.chart.timeScale().fitContent(); engine.current?.chart.priceScale('right').applyOptions({ autoScale: true }); };
  const goToLatest = () => {
    const current = engine.current;
    if (!current) return;
    setCursor(current, null);
    current.chart.clearCrosshairPosition();
    current.price.priceScale().applyOptions({ autoScale: true });
    const timeScale = current.chart.timeScale();
    timeScale.scrollToPosition(timeScale.options().rightOffset, false);
  };
  const screenshot = () => {
    const canvas = engine.current?.chart.takeScreenshot(true, false);
    canvas?.toBlob(blob => {
      if (!blob) return;
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = `${ticker}-${interval}-${new Date().toISOString().slice(0, 10)}.png`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  };
  const tools: ChartTool[] = [
    { name: 'reset', label: '重置视图', onClick: reset },
    { name: 'latest', label: '回到最新', onClick: goToLatest },
    { name: 'level', label: '水平线', active: drawing, onClick: () => { setLevelListOpen(false); setLevelSelection(null); setDrawing(value => !value); } },
    { name: 'undo', label: '撤销画线', disabled: !past.length, shortcut: 'Control+Z Meta+Z', onClick: () => { setDrawing(false); setLevelSelection(null); undo(); } },
    { name: 'redo', label: '重做画线', disabled: !future.length, overflow: true, shortcut: 'Control+Shift+Z Meta+Shift+Z Control+Y Meta+Y', onClick: () => { setDrawing(false); setLevelSelection(null); redo(); } },
    { name: 'drawings', label: '画线列表', active: levelListOpen, disabled: !levels.length && !levelListOpen, overflow: true,
      onClick: () => { setDrawing(false); setLevelSelection(null); setLevelListOpen(value => !value); } },
    { name: 'camera', label: '保存图表', overflow: true, onClick: screenshot },
    { name: 'expand', label: expanded ? '退出全屏' : '全屏图表', overflow: true, onClick: () => setExpanded(value => !value) },
  ];
  return <div ref={outer} className={`market-chart professional-chart${expanded ? ' is-expanded' : ''}${drawing ? ' is-drawing' : ''}`}
    data-engine="lightweight-charts" data-mode="candles" data-period={period} data-interval={interval} data-points={data.length} data-sessions={sessionCount}
    data-candle-count={rendered.candles} data-active-index={selectedIndex} data-pane-count={rendered.panes} data-overlay-count={rendered.overlays} data-volume-enabled={rendered.volume}
    data-visible-from={view?.from.toFixed(2)} data-visible-to={view?.to.toFixed(2)} data-price-scale={scale} data-level-count={levels.length}
    data-undo-count={past.length} data-redo-count={future.length} data-selected-level={selectedLevel?.index}
    data-annotation-count={markerCount} data-trend-count={trendCount}
    onKeyDown={event => {
      const target = event.target as HTMLElement;
      if (event.nativeEvent.isComposing || event.altKey ||
        target.closest('input, textarea, select, [contenteditable="true"]') || document.querySelector('dialog[open]')) return;
      if (event.key === 'Escape' && levelListOpen) { event.preventDefault(); event.stopPropagation(); closeLevelList(); return; }
      if (event.key === 'Escape' && selectedLevel) { event.preventDefault(); event.stopPropagation(); closeLevelEditor(); return; }
      if (event.defaultPrevented) return;
      if (!event.ctrlKey && !event.metaKey) {
        if ((event.key === 'Delete' || event.key === 'Backspace') && selectedLevel) {
          event.preventDefault(); event.stopPropagation(); editSelectedLevel(null);
        }
        return;
      }
      const key = event.key.toLowerCase();
      if (key !== 'z' && key !== 'y') return;
      event.preventDefault(); event.stopPropagation(); setDrawing(false); setLevelSelection(null);
      if (key === 'y' || event.shiftKey) redo(); else undo();
    }}>
    <div className="chart-readout"><div><span>{ticker}</span><strong>{point.close.toFixed(precision)}</strong>
      <ChartChange price={point.close} base={previous ?? point.open} basis={previous === undefined ? '较本根开盘' : '较前一根'} digits={precision} /></div>
      <dl>{[['开', point.open], ['高', point.high], ['低', point.low], ['收', point.close]].map(([label, value]) => <div key={label}><dt>{t(label as string)}</dt><dd>{(value as number).toFixed(precision)}</dd></div>)}<div><dt>{t('量')}</dt><dd>{formatVolume(point.volume, volumeMarket, getLocale())}</dd></div></dl>
    </div>
    <div className="chart-meta-row"><div className="chart-context"><time title={source}>{time} · {t(interval === '1d' ? '日K' : interval === '1h' ? '60分钟' : `${parseInt(interval)}分钟`)}{adjustment === 'qfq' ? ` · ${t('前复权')}` : ''}</time></div>
      <div className="indicator-legend">{overlays.flatMap(key => indicators.overlays[key]).map(line => <span key={line.name} style={{ color: line.color }}>{line.name} {line.values[selectedIndex]?.toFixed(precision) ?? '--'}</span>)}</div>
    </div>
    <ProfessionalChartTools scale={scale} setScale={setScale} tools={tools} count={data.length} onOpenMenu={() => { setDrawing(false); setLevelSelection(null); setLevelListOpen(false); }} />
    <div className="professional-plot">
    <div ref={container} className="professional-canvas" role="img" tabIndex={0} aria-label={t('{ticker} 价格走势', { ticker })}
      style={{ height: expanded ? 'calc(100dvh - 170px)' : immersive ? `max(${330 + paneCount * 66}px, calc(100dvh - 250px))` : (width < 600 ? 330 : 420) + paneCount * 116, minHeight: 320 }}
      onKeyDown={event => {
        const current = engine.current;
        if (!current) return;
        const index = event.key === 'ArrowLeft' ? Math.max(0, selectedIndex - 1) : event.key === 'ArrowRight' ? Math.min(data.length - 1, selectedIndex + 1)
          : event.key === 'Home' ? 0 : event.key === 'End' ? data.length - 1 : null;
        if (index !== null) {
          event.preventDefault();
          const timeScale = current.chart.timeScale();
          const range = timeScale.getVisibleLogicalRange();
          const scroll = range && (index < range.from || index > range.to);
          current.updating = true;
          if (range && scroll) {
            const shift = index < range.from ? index - range.from - 1 : index - range.to + 1;
            timeScale.setVisibleLogicalRange({ from: range.from + shift, to: range.to + shift });
          }
          setCursor(current, { time: rows[index].time });
          syncCursor(current, Boolean(scroll));
        }
        if (event.key === 'Escape') { event.preventDefault(); current.chart.clearCrosshairPosition(); setCursor(current, null); setDrawing(false); }
      }} />
    {selectedLevel && <PriceLevelEditor key={`${selectedLevel.index}:${selectedLevel.value}`} value={selectedLevel.value}
      precision={precision} onApply={editSelectedLevel} onDelete={() => editSelectedLevel(null)} onClose={closeLevelEditor} />}
    {levelListOpen && <PriceLevelList levels={levels} precision={precision} onSelect={index => {
      setLevelSelection({ index, value: levels[index] }); closeLevelList();
    }} onClear={() => { setLevelSelection(null); setLevels([]); }} onClose={closeLevelList} onDismiss={() => setLevelListOpen(false)} />}
    </div>
    {selectedPoint && <div className="annotation-detail" role="status"><strong>{selectedPoint.label} · {selectedPoint.price.toFixed(precision)}</strong><span>{selectedPoint.detail}</span></div>}
    {selectedTrend && <div className="annotation-detail" role="status"><strong>{selectedTrend.label} · {selectedTrend.start.price.toFixed(precision)} → {selectedTrend.end.price.toFixed(precision)}</strong><span>{selectedTrend.detail}</span></div>}
  </div>;
});

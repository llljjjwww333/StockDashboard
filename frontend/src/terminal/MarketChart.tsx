import { isChinaIndex, isChinaTicker } from '../lib/instrumentIdentity.ts';
import { t, getLocale, useLanguage } from '../lib/i18n';
import { lazy, memo, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { pricePrecision } from '../lib/pricePrecision';
import type { HistoryPoint, PeriodKey } from './types';
import type { Annotation, PlottedTrendline } from '../ai/types';
import { formatCompact, formatSigned } from './useTerminalData';
import { calculateIndicators, seriesPath } from './indicators';
import { useIndicators } from './indicatorStore';
import { IndicatorPanel } from './IndicatorPanel';
import { areaPaths, buildChartLayout, CHART_LEFT, CHART_RIGHT } from './chartLayout';
import { useChartInteraction } from './useChartInteraction';

export type MarketChartProps = {
  data: HistoryPoint[];
  ticker: string;
  period: PeriodKey;
  mode?: 'line' | 'candles';
  interval?: string;
  warmup?: HistoryPoint[];
  annotations?: Annotation[];
  trendlines?: PlottedTrendline[];
  immersive?: boolean;
  selectedAnnotation?: string | null;
  onSelectAnnotation?: (id: string) => void;
  referencePrice?: number | null;
  adjustment?: string;
  source?: string;
};

const PAD_TOP = 14;

const ProfessionalChart = lazy(() => import('./ProfessionalChart').then(module => ({ default: module.ProfessionalChart })));
export const MarketChart = memo(function ChartRouter(props: MarketChartProps) {
  return props.mode === 'candles' ? <Suspense fallback={<div className="loading-block"><i /><span>{t('加载中')}</span></div>}><ProfessionalChart {...props} /></Suspense> : <SvgMarketChart {...props} />;
});

const SvgMarketChart = memo(function MarketChart({ data, ticker, period, mode = 'line', interval = '1d', warmup = [], annotations = [], trendlines = [], immersive = false, selectedAnnotation, onSelectAnnotation, referencePrice, adjustment, source }: MarketChartProps) {
  useLanguage();
  const [hoveredTime, setHoveredTime] = useState<string | null>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const [plotWidth, setPlotWidth] = useState(1000);
  const [viewportHeight, setViewportHeight] = useState(() => window.innerHeight);
  const { overlays, panels } = useIndicators();
  const indicators = useMemo(() => calculateIndicators(data, warmup), [data, warmup]);
  const intraday = period === '1d' || period === '5d';
  const snapshot = intraday && mode === 'line';
  const intervalMinutes = mode === 'candles' ? ({ '1m': 1, '5m': 5, '15m': 15, '30m': 30, '1h': 60 }[interval] ?? 1) : 1;
  const layout = useMemo(() => buildChartLayout(data, ticker, intraday, CHART_LEFT, plotWidth - CHART_RIGHT, intervalMinutes), [data, ticker, intraday, plotWidth, intervalMinutes]);
  const hasData = data.length > 0;
  const selected = annotations.find(point => point.id === selectedAnnotation && data[point.index]?.timestamp === point.timestamp);
  const selectedTrend = trendlines.find(line => line.id === selectedAnnotation);
  const hoveredIndex = hoveredTime === null ? -1 : data.findIndex(point => point.timestamp === hoveredTime);
  const activeIndex = Math.max(0, hoveredIndex >= 0 ? hoveredIndex : selected?.index ?? selectedTrend?.endIndex ?? data.length - 1);
  const selectIndex = (index: number | null) => setHoveredTime(index === null ? null : data[index]?.timestamp ?? null);
  const interaction = useChartInteraction(layout.positions, plotWidth, activeIndex, selectIndex);
  useEffect(() => {
    const node = chartRef.current;
    if (!node) return;
    const observer = new ResizeObserver(entries => setPlotWidth(Math.max(300, Math.round(entries[0].contentRect.width))));
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasData]);
  useEffect(() => {
    const resize = () => setViewportHeight(window.innerHeight);
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  if (!data.length) {
    return <div className="chart-empty">{t('暂无行情')}</div>;
  }

  const WIDTH = plotWidth;
  const HEIGHT = immersive ? Math.max(330, viewportHeight - 205) : WIDTH < 600 ? 330 : 390;
  const VOLUME_TOP = HEIGHT - 88;
  const VOLUME_BOTTOM = HEIGHT - 30;
  const plotRight = WIDTH - CHART_RIGHT;
  const showVolume = panels.includes('volume');
  const PRICE_BOTTOM = showVolume ? HEIGHT - 110 : HEIGHT - 38;
  const overlayLines = overlays.flatMap(key => indicators.overlays[key]);
  const overlayValues = overlayLines.flatMap(line => line.values).filter((v): v is number => v !== null);
  const averageValues = intraday && !isChinaIndex(ticker) ? data.map(p => p.average_price ?? null) : [];
  const hasAverage = averageValues.some(value => value !== null);
  if (hasAverage) overlayValues.push(...averageValues.filter((v): v is number => v !== null));
  const closes = data.map((point) => point.close);
  const baseline = intraday && referencePrice && referencePrice > 0 ? referencePrice : null;
  const rawMinimum = Math.min(...data.map((point) => point.low), ...overlayValues, ...(baseline ? [baseline] : []));
  const rawMaximum = Math.max(...data.map((point) => point.high), ...overlayValues, ...(baseline ? [baseline] : []));
  const padding = Math.max((rawMaximum - rawMinimum) * .07, rawMaximum * .0005);
  const minimum = rawMinimum - padding;
  const maximum = rawMaximum + padding;
  const range = maximum - minimum;
  const innerWidth = plotRight - CHART_LEFT;
  const step = layout.step;
  const volumeWidth = Math.max(.4, Math.min(step * .56, 28));
  const maxVolume = Math.max(...data.map((point) => point.volume), 1);
  const getX = (index: number) => layout.positions[index];
  const getY = (value: number) => PAD_TOP + ((maximum - value) / range) * (PRICE_BOTTOM - PAD_TOP);
  const linePath = seriesPath(closes, getX, getY, layout.breaks);
  const fills = areaPaths(closes, getX, getY, PRICE_BOTTOM, layout.breaks);
  const visibleAnnotations = annotations.filter(point => point.index >= 0 && point.index < data.length && data[point.index].timestamp === point.timestamp && Number.isFinite(point.price));
  const activePoint = data[activeIndex];
  const firstClose = baseline ?? data[0].close;
  const positive = data[data.length - 1].close >= firstClose;
  const periodChange = ((activePoint.close - firstClose) / Math.max(firstClose, 0.01)) * 100;
  const axisIndexes = [...new Set([0, 0.25, 0.5, 0.75, 1].map((ratio) => Math.min(Math.round((data.length - 1) * ratio), data.length - 1)))];
  const timeZone = isChinaTicker(ticker) ? 'Asia/Shanghai' : 'America/New_York';
  const priceDigits = pricePrecision(ticker, data[data.length - 1].close);
  const formatValue = (value: number) => value.toFixed(priceDigits);
  const pointTime = new Intl.DateTimeFormat(getLocale(), {
    timeZone, month: '2-digit', day: '2-digit',
    hour: intraday ? '2-digit' : undefined, minute: intraday ? '2-digit' : undefined, hour12: false,
  }).format(new Date(activePoint.timestamp));

  const formatAxisTime = (value: string) => new Intl.DateTimeFormat(getLocale(), {
    month: period === '1d' ? undefined : '2-digit',
    day: period === '1d' ? undefined : '2-digit',
    hour: period === '1d' ? '2-digit' : undefined,
    minute: period === '1d' ? '2-digit' : undefined,
    hour12: false,
    timeZone,
  }).format(new Date(value));

  return (
    <div ref={chartRef} data-period={period} data-interval={interval} data-mode={mode} data-points={data.length} data-sessions={layout.sessions.length} className={`market-chart ${positive ? 'is-positive' : 'is-negative'}`}>
      <div className="chart-readout">
        <div>
          <span>{ticker}</span>
          <strong>{formatValue(activePoint.close)}</strong>
          <em title={t(period === '1d' && baseline ? '较昨收' : '区间变化')} className={periodChange >= 0 ? 'positive' : 'negative'}>{formatSigned(periodChange)}%</em>
        </div>
        <dl>
          {!snapshot && <><div><dt>{t("开")}</dt><dd>{formatValue(activePoint.open)}</dd></div>
          <div><dt>{t("高")}</dt><dd>{formatValue(activePoint.high)}</dd></div>
          <div><dt>{t("低")}</dt><dd>{formatValue(activePoint.low)}</dd></div>
          <div><dt>{t("收")}</dt><dd>{formatValue(activePoint.close)}</dd></div></>}
          <div><dt>{t("量")}</dt><dd>{formatCompact(activePoint.volume)}</dd></div>
        </dl>
      </div>
      <div className="chart-meta-row">
        <div className="chart-context"><time title={source}>{pointTime} {intraday ? `${t('{count}分钟', { count: intervalMinutes })} · ` : `${t('日线 · ')}${adjustment === 'qfq' ? t('前复权 · ') : ''}`}{timeZone === 'Asia/Shanghai' ? t("北京时间") : t("美东时间")}</time></div>
        <div className="indicator-legend">{overlayLines.map(line => <span key={line.name} style={{ color: line.color }}>{line.name} {line.values[activeIndex] === null ? '--' : line.values[activeIndex].toFixed(2)}</span>)}
          {hasAverage && <span style={{ color: 'var(--indicator-gold)' }}>{t('均价')} {activePoint.average_price ? formatValue(activePoint.average_price) : '--'}</span>}
        </div>
      </div>
      <svg className="price-svg"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        {...interaction}
        style={{ ...interaction.style, height: HEIGHT }} preserveAspectRatio="none"
        data-active-index={activeIndex}
        role="img"
        aria-label={t("{ticker} 价格走势", { ticker })}
      >
        <defs>
          <linearGradient id="price-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-color)" stopOpacity="0.09" />
            <stop offset="100%" stopColor="var(--chart-color)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const y = PAD_TOP + (PRICE_BOTTOM - PAD_TOP) * ratio;
          const price = maximum - range * ratio;
          return (
            <g key={ratio}>
              <line className="chart-grid-line" x1={CHART_LEFT} y1={y} x2={plotRight} y2={y} />
              {Math.abs(y - getY(data[data.length - 1].close)) > 19 && <text className="chart-axis-label" x={WIDTH - 8} y={y + 4} textAnchor="end">{formatValue(price)}</text>}
            </g>
          );
        })}
        {baseline && <line className="chart-reference-line" x1={CHART_LEFT} x2={plotRight} y1={getY(baseline)} y2={getY(baseline)} />}
        <g className="last-price-tag">
          <line x1={getX(data.length - 1)} x2={plotRight + 4} y1={getY(data[data.length - 1].close)} y2={getY(data[data.length - 1].close)} />
          <rect x={plotRight + 4} y={getY(data[data.length - 1].close) - 11} width={CHART_RIGHT - 8} height="22" rx="3" />
          <text x={WIDTH - 8} y={getY(data[data.length - 1].close) + 4} textAnchor="end">{formatValue(data[data.length - 1].close)}</text>
        </g>
        {intraday && layout.sessions.slice(1).map(session => <line key={session.date} className="session-divider" x1={session.divider} x2={session.divider} y1={PAD_TOP} y2={VOLUME_BOTTOM} />)}

        {showVolume && data.map((point, index) => {
          const barHeight = (point.volume / maxVolume) * (VOLUME_BOTTOM - VOLUME_TOP);
          return (
            <rect
              key={`${point.timestamp}-${index}`}
              className="volume-bar"
              style={{ fill: (snapshot ? point.close >= (data[index - 1]?.close ?? baseline ?? point.close) : point.close >= point.open) ? 'var(--up)' : 'var(--down)' }}
              x={getX(index) - volumeWidth / 2}
              y={VOLUME_BOTTOM - barHeight}
              width={volumeWidth}
              height={barHeight}
            />
          );
        })}

        {mode === 'line' ? <>{fills.map((fill, i) => <path key={i} className="chart-area" d={fill} />)}<path className="chart-price-line" d={linePath} /></> : data.map((point, index) => {
          const color = point.close >= point.open ? 'var(--up)' : 'var(--down)';
          const width = Math.max(.5, Math.min(step * 0.66, 28));
          return <g className="candle" key={point.timestamp} stroke={color} fill={color}><line x1={getX(index)} y1={getY(point.high)} x2={getX(index)} y2={getY(point.low)} /><rect x={getX(index) - width / 2} y={getY(Math.max(point.open, point.close))} width={width} height={Math.max(Math.abs(getY(point.close) - getY(point.open)), 1)} /></g>;
        })}
        {mode === 'line' && data.length === 1 && <circle cx={getX(0)} cy={getY(data[0].close)} r="3" fill="var(--chart-color)" />}
        {overlayLines.map(line => <path key={line.name} data-overlay={line.name} className={`price-overlay${line.name.startsWith('BOLL') ? ' boll' : ''}`} style={{ stroke: line.color }} d={seriesPath(line.values, getX, getY, layout.breaks)} />)}
        {hasAverage && <path className="price-overlay" data-overlay="VWAP" style={{ stroke: 'var(--indicator-gold)' }} d={seriesPath(averageValues, getX, getY, layout.breaks)} />}

        {trendlines.map(line => {
          const x1 = getX(line.startIndex), y1 = getY(line.start.price);
          const x2 = getX(line.endIndex), y2 = getY(line.end.price);
          return <g key={line.id} className={`chart-trendline ${line.kind}${line.id === selectedAnnotation ? ' selected' : ''}`}
            role="button" tabIndex={0} aria-label={line.label} onClick={() => onSelectAnnotation?.(line.id)}
            onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelectAnnotation?.(line.id); } }}>
            <title>{line.label} · {line.detail}</title>
            <line className="trend-hit" x1={x1} y1={y1} x2={x2} y2={y2} />
            <line className="trend-stroke" x1={x1} y1={y1} x2={x2} y2={y2} />
            <circle cx={x1} cy={y1} r="3" /><circle cx={x2} cy={y2} r="3" />
          </g>;
        })}

        {visibleAnnotations.map((point, index) => {
          const x = getX(point.index);
          const y = getY(point.price);
          const level = point.kind === 'support' || point.kind === 'resistance';
          const labelX = Math.min(Math.max(x, CHART_LEFT + 38), plotRight - 38);
          const labelY = y < PAD_TOP + 38 ? y + 31 : y - 17;
          const select = () => { setHoveredTime(point.timestamp); onSelectAnnotation?.(point.id); };
          return <g key={point.id} className={`chart-annotation ${point.kind}${selectedAnnotation === point.id ? ' selected' : ''}`} role="button" tabIndex={0}
            aria-label={`${point.label} ${point.price.toFixed(2)}`} onClick={select} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(); } }}>
            <title>{point.label} · {point.price.toFixed(2)} · {point.detail}</title>
            {level && <line className="annotation-level" x1={x} y1={y} x2={plotRight} y2={y} />}
            <circle cx={x} cy={y} r="9" /><text className="annotation-number" x={x} y={y + 3} textAnchor="middle">{index + 1}</text>
            <rect className="annotation-label-bg" x={labelX - 40} y={labelY - 13} width="80" height="21" rx="3" />
            <text className="annotation-label" x={labelX} y={labelY + 1} textAnchor="middle">{point.label.slice(0, getLocale() === 'en-US' ? 12 : 7)}</text>
          </g>;
        })}

        {hoveredIndex >= 0 ? (
          <g className="chart-crosshair">
            <line x1={getX(activeIndex)} y1={PAD_TOP} x2={getX(activeIndex)} y2={VOLUME_BOTTOM} />
            <line x1={CHART_LEFT} y1={getY(activePoint.close)} x2={plotRight} y2={getY(activePoint.close)} />
            <circle cx={getX(activeIndex)} cy={getY(activePoint.close)} r="4" />
          </g>
        ) : null}

        {intraday ? (period === '5d' ? layout.sessions.map(session => <text key={session.date} className="chart-axis-label" x={session.center} y={HEIGHT - 7} textAnchor="middle">{session.date.slice(5).replace('-', '/')}</text>) :
          [0, .5, 1].map((ratio, i) => <text key={ratio} className="chart-axis-label" x={CHART_LEFT + innerWidth * ratio} y={HEIGHT - 7} textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}>{timeZone === 'Asia/Shanghai' ? ['09:30', '11:30/13:00', '15:00'][i] : ['09:30', '12:45', '16:00'][i]}</text>)) : axisIndexes.map((index, i) => (
          <text key={data[index].timestamp} className="chart-axis-label" x={getX(index)} y={HEIGHT - 7} textAnchor={i === 0 ? 'start' : i === axisIndexes.length - 1 ? 'end' : 'middle'}>
            {formatAxisTime(data[index].timestamp)}
          </text>
        ))}
      </svg>
      {panels.filter(key => key !== 'volume' && (!snapshot || !['atr', 'kdj', 'cci'].includes(key))).map(key => <IndicatorPanel key={key} panel={indicators.panels[key]} width={plotWidth} positions={layout.positions} breaks={layout.breaks} activeIndex={activeIndex} onHover={selectIndex} />)}
      {selected && <div className="annotation-detail" role="status"><strong>{selected.label} · {selected.price.toFixed(2)}</strong><span>{selected.detail}</span></div>}
      {selectedTrend && <div className="annotation-detail" role="status"><strong>{selectedTrend.label} · {formatValue(selectedTrend.start.price)} → {formatValue(selectedTrend.end.price)}</strong><span>{selectedTrend.detail}</span></div>}
    </div>
  );
});

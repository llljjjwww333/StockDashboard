import { t } from '../lib/i18n';
import type { IndicatorPanel as PanelData } from './indicators';
import { seriesPath } from './indicators';
import { formatCompact } from './useTerminalData';
import { CHART_LEFT, CHART_RIGHT } from './chartLayout';
import { useChartInteraction } from './useChartInteraction';

export function IndicatorPanel({ panel, activeIndex, width, onHover, positions, breaks }: {
  panel: PanelData; activeIndex: number; width: number; onHover: (index: number | null) => void;
  positions: number[]; breaks: ReadonlySet<number>;
}) {
  const interaction = useChartInteraction(positions, width, activeIndex, onHover);
  const left = CHART_LEFT, right = width - CHART_RIGHT, top = 12, bottom = 118;
  const count = panel.lines[0]?.values.length ?? panel.bars?.length ?? 0;
  const observed = [...panel.lines.flatMap(line => line.values), ...(panel.bars ?? [])].filter((v): v is number => v !== null && Number.isFinite(v));
  const values = [...observed, ...(panel.guides ?? []), ...(panel.bars ? [0] : [])];
  let minimum = Math.min(...values), maximum = Math.max(...values);
  if (panel.id === 'rsi') { minimum = 0; maximum = 100; }
  if (minimum === maximum) { const pad = Math.max(Math.abs(minimum) * .05, .01); minimum -= pad; maximum += pad; }
  const range = maximum - minimum;
  const x = (i: number) => positions[i];
  const y = (v: number) => bottom - (v - minimum) / range * (bottom - top);
  const format = (value: number | null | undefined) => value === null || value === undefined ? '--' : Math.abs(value) >= 10000 ? formatCompact(value) : value.toFixed(2);
  return <section className="indicator-panel" data-indicator={panel.id}>
    <header><strong>{t(panel.label)}</strong><div>{panel.lines.map(line => <span key={line.name} style={{ color: line.color }}>{line.name} {format(line.values[activeIndex])}</span>)}{panel.bars && <span>{panel.id === 'macd' ? t("柱 ") : ''}{format(panel.bars[activeIndex])}</span>}</div></header>
    {observed.length ? <svg {...interaction} viewBox={`0 0 ${width} 140`} role="img" aria-label={t("{name} 指标图", { name: t(panel.label) })}>
      {[0, .5, 1].map(ratio => {
        const value = minimum + ratio * range;
        return <g key={ratio}><line className="chart-grid-line" x1={left} x2={right} y1={y(value)} y2={y(value)} /><text className="chart-axis-label" x={width - 4} y={y(value) + 3} textAnchor="end">{format(value)}</text></g>;
      })}
      {(panel.guides ?? []).map(value => <line className="indicator-guide" key={value} x1={left} x2={right} y1={y(value)} y2={y(value)} />)}
      {panel.bars?.map((value, i) => value === null ? null : <rect key={i} className="indicator-histogram" x={x(i) - Math.max((right - left) / count * .3, .6)} y={Math.min(y(value), y(0))} width={Math.max((right - left) / count * .6, 1)} height={Math.max(Math.abs(y(value) - y(0)), .5)} fill={value >= 0 ? 'var(--up)' : 'var(--down)'} />)}
      {panel.lines.map(line => <path key={line.name} className="indicator-line" style={{ stroke: line.color }} d={seriesPath(line.values, x, y, breaks)} />)}
      <line className="indicator-cursor" x1={x(activeIndex)} x2={x(activeIndex)} y1={top} y2={bottom} />
    </svg> : <div className="indicator-empty">{t("数据不足")}</div>}
  </section>;
}

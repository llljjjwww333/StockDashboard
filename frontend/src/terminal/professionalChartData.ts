import { isCryptoTicker, isChinaTicker } from '../lib/instrumentIdentity.ts';
import type { CandlestickData, UTCTimestamp } from 'lightweight-charts';
import type { HistoryPoint } from './types';

// The engine displays UTC. Encode exchange-local wall time so its axes follow
// New York DST and Shanghai sessions while the original source timestamps remain intact.
export function chartCandles(data: HistoryPoint[], ticker: string): CandlestickData<UTCTimestamp>[] {
  const format = new Intl.DateTimeFormat('en-CA', { timeZone: isCryptoTicker(ticker) ? 'UTC' : isChinaTicker(ticker) ? 'Asia/Shanghai' : 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  return data.map(point => {
    const parts = Object.fromEntries(format.formatToParts(new Date(point.timestamp)).map(p => [p.type, p.value]));
    return { time: (Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) / 1000) as UTCTimestamp,
      open: point.open, high: point.high, low: point.low, close: point.close };
  });
}

export function percentageReference(rows: readonly { close: number }[], visibleFrom?: number): number | null {
  if (visibleFrom !== undefined && !Number.isFinite(visibleFrom)) return null;
  // Include the partially visible left bar, matching the chart's strict visible range.
  const price = rows[Math.max(0, Math.floor(visibleFrom ?? 0))]?.close;
  return typeof price === 'number' && Number.isFinite(price) && price > 0 ? price : null;
}

export function formatPercentagePrice(price: number, reference: number | null) {
  if (reference === null || !Number.isFinite(reference) || reference <= 0 || !Number.isFinite(price)) return '--';
  const change = (price - reference) / reference * 100;
  return `${(Math.abs(change) < .005 ? 0 : change).toFixed(2)}%`;
}

function seriesUpdatePlan<Row extends { time: number }>(
  previous: readonly Row[], next: Row[], sameValue: (a: Row, b: Row) => boolean,
) {
  if (!previous.length || next.length < previous.length) return { replace: true, rows: next };
  const equal = (a: Row, b: Row) => a.time === b.time && sameValue(a, b);
  const tail = previous.length - 1;
  if (previous[tail].time !== next[tail].time) return { replace: true, rows: next };
  for (let i = 0; i < previous.length - 1; i++) {
    if (!equal(previous[i], next[i])) return { replace: true, rows: next };
  }
  const start = equal(previous[tail], next[tail]) ? previous.length : tail;
  return { replace: false, rows: next.slice(start) };
}

export function candleUpdatePlan(previous: CandlestickData<UTCTimestamp>[], next: CandlestickData<UTCTimestamp>[]) {
  return seriesUpdatePlan(previous, next, (a, b) => a.open === b.open && a.high === b.high && a.low === b.low && a.close === b.close);
}

export type IndicatorRow = { time: UTCTimestamp; value?: number; color?: string };

export function indicatorUpdatePlan(previous: readonly IndicatorRow[], next: IndicatorRow[]) {
  return seriesUpdatePlan(previous, next, (a, b) => a.value === b.value && a.color === b.color);
}

export function rangeAfterCandleReplacement(
  previous: readonly { time: number }[],
  next: readonly { time: number }[],
  range: { from: number; to: number },
) {
  if (!previous.length || !next.length) return range;
  let shift = next.length - previous.length;
  if (range.to < previous.length - 1) {
    const anchor = Math.max(0, Math.min(previous.length - 1, Math.round((range.from + range.to) / 2)));
    const match = next.findIndex(row => row.time >= previous[anchor].time);
    // If the old session has expired, anchor to the nearest surviving edge.
    shift = (match === -1 ? next.length - 1 : match) - anchor;
  }
  return { from: range.from + shift, to: range.to + shift };
}

export function readPriceLevels(ticker: string, storage?: Pick<Storage, 'getItem'>): number[] {
  try {
    const values = JSON.parse((storage ?? localStorage).getItem(`marketdesk:levels:${ticker}`) ?? '[]');
    return Array.isArray(values) ? values.filter(value => typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 1e12).slice(-12) : [];
  } catch { return []; }
}

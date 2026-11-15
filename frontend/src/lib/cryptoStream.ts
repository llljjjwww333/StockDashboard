import type { HistoryPoint, HistoryResponse, Quote } from '../terminal/types';

export type DepthEvent = { ticker: string; book: NonNullable<Quote['order_book']>; sequence: number; received_at: string };
export type CandleEvent = { ticker: string; interval: string; event_time: number; closed: boolean; point: HistoryPoint };
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export function isDepthEvent(value: unknown): value is DepthEvent {
  if (!value || typeof value !== 'object') return false;
  const d = value as DepthEvent;
  return typeof d.ticker === 'string' && finite(d.sequence) && typeof d.received_at === 'string' &&
    [d.book?.bids, d.book?.asks].every(rows => Array.isArray(rows) && rows.length <= 10 && rows.every(r =>
      finite(r.level) && finite(r.price) && r.price > 0 && finite(r.volume) && r.volume >= 0));
}

export function isCandleEvent(value: unknown): value is CandleEvent {
  if (!value || typeof value !== 'object') return false;
  const d = value as CandleEvent, p = d.point;
  return typeof d.ticker === 'string' && typeof d.interval === 'string' && finite(d.event_time) &&
    !!p && Number.isFinite(Date.parse(p.timestamp)) && [p.open, p.high, p.low, p.close].every(n => finite(n) && n > 0) &&
    finite(p.volume) && p.volume >= 0 && p.high >= Math.max(p.open, p.close) && p.low <= Math.min(p.open, p.close);
}

// Candle volumes belong to the UTC candle, never to the rolling 24-hour ticker.
export function mergeCryptoCandles(history: HistoryResponse | null, ticker: string | null,
  events: CandleEvent[] = [], now = Date.now()): HistoryResponse | null {
  if (!history?.data.length || !ticker || (history.ticker && history.ticker !== ticker) || history.price_type === 'snapshot') return history;
  const step = ({ '1m': 60000, '5m': 300000, '15m': 900000, '30m': 1800000, '1h': 3600000,
    '1d': 86400000, '1wk': 604800000 } as Record<string, number>)[history.interval ?? ''];
  if (!step) return history;
  let data = history.data, newest = 0;
  for (const e of events) {
    if (e.ticker !== ticker || e.interval !== history.interval) continue;
    const tail = data.at(-1)!, stamp = Date.parse(e.point.timestamp), previous = Date.parse(tail.timestamp);
    if (stamp < previous || stamp > previous + step || e.point.volume < (stamp === previous ? tail.volume : 0)) continue;
    if (stamp === previous && Date.parse(history.fetched_at ?? '') > e.event_time && tail.volume >= e.point.volume) continue;
    data = stamp === previous ? [...data.slice(0, -1), e.point] : [...data, e.point];
    newest = Math.max(newest, e.event_time);
  }
  if (data === history.data) return history;
  return { ...history, data, as_of: new Date(newest).toISOString(),
    fetched_at: new Date(newest).toISOString(), stale: Boolean(history.stale && now - newest > 10000) };
}

import { isCryptoTicker, isChinaTicker } from '../lib/instrumentIdentity.ts';
import { pricePrecision } from '../lib/pricePrecision.ts';
import { marketHours } from '../lib/marketCalendar.ts';
import type { StockQuote } from '../store/stockStore';
import type { HistoryResponse } from './types';

const clock = (timeZone: string) => new Intl.DateTimeFormat('en-CA', {
  timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
const chinaClock = clock('Asia/Shanghai'), usClock = clock('America/New_York');

function session(format: Intl.DateTimeFormat, timestamp: string) {
  const time = Date.parse(timestamp);
  if (!Number.isFinite(time)) return null;
  const parts = Object.fromEntries(format.formatToParts(time).map(part => [part.type, part.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const minute = Number(parts.hour) * 60 + Number(parts.minute);
  const offset = Math.round((Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) - time) / 60000);
  const zone = `${offset < 0 ? '-' : '+'}${String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0')}:${String(Math.abs(offset) % 60).padStart(2, '0')}`;
  return { date, minute, clock: `${parts.hour}:${parts.minute}:${parts.second}`, zone, time };
}

function nextSession(market: 'CN' | 'US', previous: string, next: string) {
  const first = Date.parse(`${previous}T00:00:00Z`), last = Date.parse(`${next}T00:00:00Z`);
  if (last <= first || last - first > 31 * 86400000) return false;
  for (let time = first + 86400000; time < last; time += 86400000) {
    if (marketHours(market, new Date(time).toISOString().slice(0, 10))) return false;
  }
  return true;
}

export function liveDailyHistory(ticker: string | null, history: HistoryResponse | null, live?: StockQuote): HistoryResponse | null {
  if (ticker && isCryptoTicker(ticker)) return history;
  const quote = live?.snapshot;
  if (!ticker || !history?.data.length || history.interval !== '1d' || history.price_type !== 'ohlc'
    || (history.adjustment && !['none', 'qfq'].includes(history.adjustment)) || !quote || quote.ticker !== ticker
    || (history.ticker && history.ticker !== ticker) || !quote.as_of) return history;
  const cn = isChinaTicker(ticker), format = cn ? chinaClock : usClock;
  const current = session(format, quote.as_of), previous = history.data.at(-1)!;
  const tail = session(format, previous.timestamp);
  if (!current || !tail || current.date < tail.date) return history;
  const hours = marketHours(cn ? 'CN' : 'US', current.date);
  if (!hours || current.minute < 570 || (!cn && current.minute > hours.regular)) return history;
  const { price, open_price: open, high_price: high, low_price: low, volume } = quote;
  if (![price, open, high, low].every(value => typeof value === 'number' && Number.isFinite(value) && value > 0)
    || !Number.isFinite(volume) || volume < 0) return history;
  if (high! < Math.max(open!, price) || low! > Math.min(open!, price)) return history;
  const tick = 10 ** -pricePrecision(ticker, price) + 1e-8;
  const sameDay = current.date === tail.date;
  if (sameDay) {
    // Full-day snapshots must agree on the open and extend the observed session, never rewind it.
    if (Math.abs(open! - previous.open) > tick || volume < previous.volume
      || high! < previous.high - tick || low! > previous.low + tick) return history;
    const capturedAt = Date.parse(history.fetched_at ?? '');
    if (volume === previous.volume && (!Number.isFinite(capturedAt) || current.time < capturedAt)) return history;
    if (price === previous.close && open === previous.open && high === previous.high && low === previous.low && volume === previous.volume) return history;
  } else if (!nextSession(cn ? 'CN' : 'US', tail.date, current.date) || quote.previous_close == null
    || Math.abs(quote.previous_close - previous.close) > tick) return history;
  const point = { timestamp: sameDay ? previous.timestamp : `${current.date}T${tail.clock}${current.zone}`,
    open: open!, high: high!, low: low!, close: price, volume };
  const data = sameDay ? [...history.data.slice(0, -1), point] : [...history.data, point];
  const source = quote.source && quote.source !== history.source ? [history.source, quote.source].filter(Boolean).join(' + ') : history.source;
  return { ...history, data, source, as_of: quote.as_of, fetched_at: quote.fetched_at ?? history.fetched_at,
    stale: Boolean(history.stale || live?.stale) };
}

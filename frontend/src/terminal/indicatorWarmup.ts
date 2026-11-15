import { isChinaTicker } from '../lib/instrumentIdentity.ts';
import { pricePrecision } from '../lib/pricePrecision.ts';
import type { HistoryPoint, HistoryResponse } from './types';

const noHistory: HistoryPoint[] = [];
const shanghaiDay = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' });
const newYorkDay = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/New_York' });
const priceFields = ['open', 'high', 'low', 'close'] as const;

export function compatibleIndicatorHistory(ticker: string, visible: HistoryResponse | null, warmup: HistoryResponse | null) {
  if (!visible?.data.length || !warmup?.data.length || visible.adjustment !== warmup.adjustment ||
    [visible, warmup].some(feed => (feed.interval && feed.interval !== '1d') || (feed.price_type && feed.price_type !== 'ohlc'))) {
    return noHistory;
  }

  const day = isChinaTicker(ticker) ? shanghaiDay : newYorkDay;
  const byDay = new Map(warmup.data.map(bar => [day.format(new Date(bar.timestamp)), bar]));
  let compared = 0;
  // The current daily candle can still change while the two requests are in flight.
  for (let index = visible.data.length - 2; index >= 0 && compared < 3; index--) {
    const bar = visible.data[index];
    const earlier = byDay.get(day.format(new Date(bar.timestamp)));
    if (!earlier) continue;
    const tick = 10 ** -pricePrecision(ticker, bar.close);
    if (priceFields.some(field => Math.abs(bar[field] - earlier[field]) > tick + 1e-8)) return noHistory;
    compared++;
  }
  if (!compared) return noHistory;

  const first = day.format(new Date(visible.data[0].timestamp));
  return [...byDay].filter(([date]) => date < first).map(([, bar]) => bar);
}

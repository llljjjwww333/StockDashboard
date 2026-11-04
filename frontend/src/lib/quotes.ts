import type { Quote } from '../terminal/types';
import type { StockQuote } from '../store/stockStore';

export function toStoredQuote(quote: Quote): StockQuote {
  return {
    price: quote.price, changePercent: quote.change_percent, volume: quote.volume,
    source: quote.source, asOf: quote.as_of, fetchedAt: quote.fetched_at,
    stale: quote.stale, snapshot: quote,
  };
}

export function isOlderQuote(incoming: StockQuote, current?: StockQuote) {
  if (!current) return false;
  const nextTime = Date.parse(incoming.asOf ?? '');
  const currentTime = Date.parse(current.asOf ?? '');
  if (Number.isFinite(nextTime) && Number.isFinite(currentTime) && nextTime !== currentTime) return nextTime < currentTime;
  const nextFetch = Date.parse(incoming.fetchedAt ?? '');
  const currentFetch = Date.parse(current.fetchedAt ?? '');
  return Number.isFinite(nextFetch) && Number.isFinite(currentFetch) && nextFetch < currentFetch;
}

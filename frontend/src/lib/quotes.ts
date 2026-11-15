import type { Quote } from '../terminal/types';
import type { StockQuote } from '../store/stockStore';
import { isCryptoTicker, isChinaTicker } from './instrumentIdentity.ts';
import { marketPhase } from '../terminal/marketSession.ts';

export function toStoredQuote(quote: Quote, receivedAt?: number): StockQuote {
  return {
    price: quote.price, changePercent: quote.change_percent, volume: quote.volume,
    source: quote.source, asOf: quote.as_of, fetchedAt: quote.fetched_at,
    stale: quote.stale, receivedAt, snapshot: quote,
  };
}

export function quoteFreshness(ticker: string, quote: StockQuote | undefined, now: number) {
  if (!quote) return null;
  const fetchedAt = Date.parse(quote.fetchedAt ?? '');
  const lastConfirmation = Number.isFinite(fetchedAt) ? fetchedAt : quote.receivedAt;
  // The stream polls every 30 seconds outside trading hours.
  if (quote.stale || (lastConfirmation !== undefined && now - lastConfirmation >= 75000)) return 'cached';
  // Use the exchange timestamp only during continuous trading in China.
  const marketAge = now - Date.parse(quote.asOf ?? '');
  if (isCryptoTicker(ticker) && marketAge >= 30000) return 'old';
  if (isChinaTicker(ticker) && marketAge >= 90000 && marketPhase(ticker, new Date(now)) === '交易时段') return 'old';
  return null;
}

export function isOlderQuote(incoming: StockQuote, current?: StockQuote) {
  if (!current) return false;
  const nextTime = Date.parse(incoming.asOf ?? '');
  const currentTime = Date.parse(current.asOf ?? '');
  if (Number.isFinite(nextTime) && Number.isFinite(currentTime) && nextTime !== currentTime) return nextTime < currentTime;
  if (Number.isFinite(nextTime) !== Number.isFinite(currentTime)) return Number.isFinite(currentTime);
  const nextFetch = Date.parse(incoming.fetchedAt ?? '');
  const currentFetch = Date.parse(current.fetchedAt ?? '');
  if (Number.isFinite(nextFetch) && Number.isFinite(currentFetch) && nextFetch !== currentFetch) return nextFetch < currentFetch;
  if (Number.isFinite(nextFetch) !== Number.isFinite(currentFetch)) return Number.isFinite(currentFetch);
  return Boolean(incoming.stale && !current.stale && current.snapshot && incoming.snapshot !== current.snapshot);
}

export function mergeStoredQuotes(current: Record<string, StockQuote>, updates: Record<string, StockQuote>) {
  let next = current;
  for (const [ticker, payload] of Object.entries(updates)) {
    const previous = current[ticker];
    if (isOlderQuote(payload, previous)) continue;
    const streamConfirmedAt = payload.streamConfirmedAt === undefined ? previous?.streamConfirmedAt : payload.streamConfirmedAt;
    if (previous && previous.price === payload.price && previous.changePercent === payload.changePercent &&
      previous.volume === payload.volume && previous.asOf === payload.asOf && previous.source === payload.source &&
      previous.stale === payload.stale && previous.fetchedAt === payload.fetchedAt && previous.receivedAt === payload.receivedAt &&
      previous.streamConfirmedAt === streamConfirmedAt && previous.snapshot === payload.snapshot) continue;
    if (next === current) next = { ...current };
    next[ticker] = { ...payload, streamConfirmedAt };
  }
  return next;
}

import { isInstrumentTicker } from './instrumentIdentity.ts';
import type { WatchlistStock } from '../store/stockStore';

const QUOTE_LIMIT = 100;

export function streamQuoteTickers(watchlist: WatchlistStock[], activeTicker: string | null) {
  const tickers = [activeTicker, ...watchlist.map(stock => stock.ticker)].filter(isInstrumentTicker);
  return new Set([...new Set(tickers)].slice(0, QUOTE_LIMIT));
}

export function pollQuoteBatches(watchlist: WatchlistStock[], activeTicker: string | null, connected: boolean,
  fallbackTickers: ReadonlySet<string> = new Set()) {
  const streamed = connected ? streamQuoteTickers(watchlist, activeTicker) : new Set<string>();
  const tickers = [...new Set(watchlist.map(stock => stock.ticker))].filter(ticker =>
    ticker !== activeTicker && (!streamed.has(ticker) || fallbackTickers.has(ticker)) && isInstrumentTicker(ticker));
  const batches: string[] = [];
  for (let index = 0; index < tickers.length; index += QUOTE_LIMIT) {
    batches.push(tickers.slice(index, index + QUOTE_LIMIT).join(','));
  }
  return batches;
}

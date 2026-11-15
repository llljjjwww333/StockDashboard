import { useEffect, useMemo } from 'react';
import { isMarketQuote } from '../lib/marketPayload';
import { pollQuoteBatches } from '../lib/quoteSubscriptions';
import { toStoredQuote } from '../lib/quotes';
import { stockWebSocketService } from '../services/stockWebSocketService';
import { useStockQuoteStore, type WatchlistStock } from '../store/stockStore';
import { useWatchlistQuotes } from './useTerminalData';
import { useWatchlistStreamFallback } from './useMarketPhase';

function QuoteBatch({ batch }: { batch: string }) {
  const { data, savedAt, requestedAt, error, failedRequestAt } = useWatchlistQuotes(batch);
  useEffect(() => {
    const store = useStockQuoteStore.getState();
    if (!navigator.onLine) return;
    const requested = new Set(batch.split(','));
    if (failedRequestAt !== undefined) {
      for (const ticker of requested) {
        if (!stockWebSocketService.hasHealthySubscription(ticker)) store.markQuoteStale(ticker, failedRequestAt);
      }
      return;
    }
    if (!data || data.stale || error) return;
    const received = new Set<string>();
    for (const quote of data.quotes) {
      if (!isMarketQuote(quote) || !requested.has(quote.ticker) || stockWebSocketService.hasHealthySubscription(quote.ticker)) continue;
      received.add(quote.ticker);
      const current = store.quotes[quote.ticker];
      if (current?.snapshot === quote || (!quote.as_of && !quote.fetched_at &&
          (current?.receivedAt ?? 0) > (requestedAt ?? savedAt ?? 0))) continue;
      store.updateStockQuote(quote.ticker, toStoredQuote(quote, savedAt));
    }
    if (requestedAt === undefined) return;
    for (const ticker of data.unavailable) {
      if (!requested.has(ticker) || received.has(ticker) || stockWebSocketService.hasHealthySubscription(ticker)) continue;
      store.markQuoteStale(ticker, requestedAt);
    }
  }, [batch, data, savedAt, requestedAt, error, failedRequestAt]);
  return null;
}

export function WatchlistQuoteFallback({ watchlist, activeTicker, connected }: {
  watchlist: WatchlistStock[]; activeTicker: string | null; connected: boolean;
}) {
  const fallback = useWatchlistStreamFallback(watchlist, activeTicker, connected);
  const batches = useMemo(() => pollQuoteBatches(watchlist, activeTicker, connected, new Set(fallback.split(','))),
    [watchlist, activeTicker, connected, fallback]);
  return batches.map(batch => <QuoteBatch key={batch} batch={batch} />);
}

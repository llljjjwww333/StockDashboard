import { useSyncExternalStore } from 'react';
import { isActivePhase, marketPhase } from './marketSession';
import { isCryptoTicker, isChinaTicker } from '../lib/instrumentIdentity';
import { stockWebSocketService } from '../services/stockWebSocketService';
import { useStockQuoteStore } from '../store/stockStore';
import { quoteFreshness } from '../lib/quotes';
import type { StockQuote, WatchlistStock } from '../store/stockStore';

const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;
const CLOCK_STEP_MS = 5000;

function updateClock() {
  clearTimeout(timer);
  if (document.hidden || !listeners.size) return;
  timer = setTimeout(updateClock, CLOCK_STEP_MS - Date.now() % CLOCK_STEP_MS);
  for (const listener of listeners) listener();
}

function onPageShow(event: PageTransitionEvent) { if (event.persisted) updateClock(); }

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    document.addEventListener('visibilitychange', updateClock);
    window.addEventListener('online', updateClock);
    window.addEventListener('offline', updateClock);
    window.addEventListener('pageshow', onPageShow);
    updateClock();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size) return;
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', updateClock);
    window.removeEventListener('online', updateClock);
    window.removeEventListener('offline', updateClock);
    window.removeEventListener('pageshow', onPageShow);
  };
}

export function useMarketPhase(ticker: string) {
  return useSyncExternalStore(subscribe, () => marketPhase(ticker, new Date()));
}

export function useQuoteStreamHealth(connected: boolean, lastPush: number | null | undefined, active: boolean) {
  // Outside active sessions the server can wait 30 seconds between updates.
  const silenceLimit = active ? 10000 : 40000;
  return useSyncExternalStore(subscribe, () => connected && lastPush != null && Date.now() - lastPush < silenceLimit);
}

function subscribeFeedHealth(listener: () => void) {
  const stopClock = subscribe(listener), stopQuotes = useStockQuoteStore.subscribe(listener);
  const stopHealth = stockWebSocketService.subscribeHealth(listener);
  return () => { stopClock(); stopQuotes(); stopHealth(); };
}

export function useWatchlistStreamFallback(watchlist: WatchlistStock[], activeTicker: string | null, connected: boolean) {
  const cnActive = isActivePhase(useMarketPhase('SH000001')), usActive = isActivePhase(useMarketPhase('AAPL'));
  return useSyncExternalStore(subscribeFeedHealth, () => {
    if (!connected) return '';
    const now = Date.now();
    return watchlist.filter(({ ticker }) => ticker !== activeTicker && stockWebSocketService.hasSubscription(ticker) &&
      !stockWebSocketService.hasHealthySubscription(ticker, now, isCryptoTicker(ticker) ? true : isChinaTicker(ticker) ? cnActive : usActive)).map(({ ticker }) => ticker).join(',');
  });
}

const browserQuoteFreshness = (ticker: string, quote: StockQuote | undefined, now: number) =>
  quote && !navigator.onLine ? 'cached' : quoteFreshness(ticker, quote, now);

export function useQuoteFreshness(ticker: string, quote?: StockQuote) {
  return useSyncExternalStore(subscribe, () => browserQuoteFreshness(ticker, quote, Date.now()));
}

export function useAgedWatchlistQuotes(watchlist: WatchlistStock[], quotes: Record<string, StockQuote>, enabled: boolean) {
  return useSyncExternalStore(subscribe, () => {
    if (!enabled) return '';
    const now = Date.now();
    return watchlist.filter(({ ticker }) => browserQuoteFreshness(ticker, quotes[ticker], now)).map(({ ticker }) => ticker).join(',');
  });
}

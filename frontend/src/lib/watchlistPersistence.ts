import { instrumentMarket, isInstrumentTicker } from './instrumentIdentity.ts';
import type { WatchlistStock } from '../store/stockStore';

type WatchlistState = { watchlist: WatchlistStock[]; selectedTicker: string | null };
export { createBrowserStorage as createWatchlistStorage, type StorageIssue as WatchlistStorageIssue } from './browserStorage.ts';

export function normalizeWatchlistState(value: unknown, fallback: WatchlistState): WatchlistState {
  const saved = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const rows: unknown[] = Array.isArray(saved.watchlist) ? saved.watchlist : fallback.watchlist;
  const watchlist: WatchlistStock[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const item = row as Record<string, unknown>;
    const ticker = typeof item.ticker === 'string' ? item.ticker.trim().toUpperCase() : '';
    if (!isInstrumentTicker(ticker) || seen.has(ticker)) continue;
    seen.add(ticker);
    watchlist.push({ ticker, name: typeof item.name === 'string' && item.name.trim() ? item.name.trim().slice(0, 200) : ticker,
      market: instrumentMarket(ticker) });
  }
  const selected = typeof saved.selectedTicker === 'string' ? saved.selectedTicker.trim().toUpperCase() : fallback.selectedTicker;
  return { watchlist, selectedTicker: watchlist.some(stock => stock.ticker === selected) ? selected : watchlist[0]?.ticker ?? null };
}


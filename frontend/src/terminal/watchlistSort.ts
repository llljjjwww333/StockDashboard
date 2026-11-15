import type { StockQuote, WatchlistStock } from '../store/stockStore';

export type WatchSort = 'manual' | 'change-desc' | 'change-asc';
export const watchSortKey = 'marketdesk:watch-sort:v1';

export function loadWatchSort(): WatchSort {
  try {
    const saved = localStorage.getItem(watchSortKey);
    if (saved === 'change-desc' || saved === 'change-asc') return saved;
  } catch { /* Storage may be unavailable. */ }
  return 'manual';
}

export function sortWatchlist(watchlist: WatchlistStock[], quotes: Record<string, StockQuote>, sort: WatchSort, agedTickers?: ReadonlySet<string>) {
  if (sort === 'manual') return watchlist;
  const direction = sort === 'change-asc' ? 1 : -1;
  return watchlist.map(stock => {
    const quote = quotes[stock.ticker];
    const valid = quote && Number.isFinite(quote.price) && quote.price > 0 && Number.isFinite(quote.changePercent);
    const group = valid ? (agedTickers?.has(stock.ticker) ? 1 : 0) : 2;
    return { stock, change: valid ? quote.changePercent : 0, group };
  }).sort((left, right) => {
    return left.group - right.group || direction * (left.change - right.change);
  }).map(item => item.stock);
}

import type { StockQuote, WatchlistStock } from '../store/stockStore';

export type WatchlistFilter = { query: string; market: 'ALL' | 'US' | 'CN' };
export function filterWatchlist(stocks: WatchlistStock[], quotes: Record<string, StockQuote>, filter: WatchlistFilter) {
  const query = filter.query.normalize('NFKC').trim().toLocaleLowerCase('en-US');
  return stocks.filter(stock => (filter.market === 'ALL' || stock.market === filter.market) &&
    `${stock.ticker} ${stock.name} ${quotes[stock.ticker]?.snapshot?.name ?? ''}`.normalize('NFKC').toLocaleLowerCase('en-US').includes(query));
}

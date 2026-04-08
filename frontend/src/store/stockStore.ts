import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type MarketType = 'US' | 'CN';

export interface WatchlistStock {
  ticker: string;
  name: string;
  market: MarketType;
  price: number;
  changePercent: number;
  volume: number;
}

interface StockStore {
  watchlist: WatchlistStock[];
  selectedTicker: string | null;
  addToWatchlist: (stock: WatchlistStock) => void;
  removeFromWatchlist: (ticker: string) => void;
  selectStock: (ticker: string | null) => void;
  updateStockQuote: (
    ticker: string,
    payload: Pick<WatchlistStock, 'price' | 'changePercent' | 'volume'>,
  ) => void;
}

const defaultWatchlist: WatchlistStock[] = [
  { ticker: 'AAPL', name: 'Apple Inc.', market: 'US', price: 180, changePercent: 0.5, volume: 10000000 },
  { ticker: 'NVDA', name: 'NVIDIA Corporation', market: 'US', price: 910, changePercent: 1.6, volume: 42000000 },
  { ticker: 'TSLA', name: 'Tesla Inc.', market: 'US', price: 250, changePercent: -0.8, volume: 31000000 },
  { ticker: '600519', name: 'Kweichow Moutai', market: 'CN', price: 1700, changePercent: 0.9, volume: 3200000 },
  { ticker: '300059', name: 'East Money', market: 'CN', price: 15, changePercent: 1.1, volume: 18500000 },
];

export const useStockStore = create<StockStore>()(
  persist(
    (set) => ({
      watchlist: defaultWatchlist,
      selectedTicker: defaultWatchlist[0]?.ticker ?? null,
      addToWatchlist: (stock) =>
        set((state) => {
          if (state.watchlist.some((item) => item.ticker === stock.ticker)) {
            return state;
          }

          return {
            watchlist: [...state.watchlist, stock],
            selectedTicker: state.selectedTicker ?? stock.ticker,
          };
        }),
      removeFromWatchlist: (ticker) =>
        set((state) => {
          const nextWatchlist = state.watchlist.filter((item) => item.ticker !== ticker);
          const nextSelectedTicker =
            state.selectedTicker === ticker ? (nextWatchlist[0]?.ticker ?? null) : state.selectedTicker;

          return {
            watchlist: nextWatchlist,
            selectedTicker: nextSelectedTicker,
          };
        }),
      selectStock: (ticker) => set({ selectedTicker: ticker }),
      updateStockQuote: (ticker, payload) =>
        set((state) => ({
          watchlist: state.watchlist.map((item) =>
            item.ticker === ticker
              ? {
                  ...item,
                  ...payload,
                }
              : item,
          ),
        })),
    }),
    {
      name: 'stock-dashboard-watchlist',
    },
  ),
);

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Quote } from '../terminal/types';
import { isOlderQuote } from '../lib/quotes';

export type MarketType = 'US' | 'CN';

export interface WatchlistStock {
  ticker: string;
  name: string;
  market: MarketType;
}

export interface StockQuote {
  price: number;
  changePercent: number;
  volume: number;
  source?: string | null;
  asOf?: string | null;
  stale?: boolean;
  fetchedAt?: string | null;
  snapshot?: Quote;
}

interface StockStore {
  watchlist: WatchlistStock[];
  selectedTicker: string | null;
  addToWatchlist: (stock: WatchlistStock & StockQuote) => void;
  removeFromWatchlist: (ticker: string) => void;
  selectStock: (ticker: string | null) => void;
}

interface StockQuoteStore {
  quotes: Record<string, StockQuote>;
  connectionStatus: 'connecting' | 'connected' | 'disconnected';
  setConnectionStatus: (status: 'connecting' | 'connected' | 'disconnected') => void;
  seedQuote: (ticker: string, payload: StockQuote) => void;
  removeQuote: (ticker: string) => void;
  updateStockQuote: (ticker: string, payload: StockQuote) => void;
}

const defaultWatchlist: WatchlistStock[] = [
  { ticker: 'AAPL', name: 'Apple Inc.', market: 'US' },
  { ticker: 'NVDA', name: 'NVIDIA Corporation', market: 'US' },
  { ticker: 'TSLA', name: 'Tesla Inc.', market: 'US' },
  { ticker: '600519', name: 'Kweichow Moutai', market: 'CN' },
  { ticker: '300059', name: 'East Money', market: 'CN' },
];

export const useStockQuoteStore = create<StockQuoteStore>()((set) => ({
  quotes: {},
  connectionStatus: 'connecting',
  setConnectionStatus: (connectionStatus) => set({ connectionStatus }),
  seedQuote: (ticker, payload) =>
    set((state) => ({
      quotes: state.quotes[ticker] || payload.price <= 0
        ? state.quotes
        : {
            ...state.quotes,
            [ticker]: payload,
          },
    })),
  removeQuote: (ticker) =>
    set((state) => {
      if (!(ticker in state.quotes)) {
        return state;
      }

      const nextQuotes = { ...state.quotes };
      delete nextQuotes[ticker];
      return { quotes: nextQuotes };
    }),
  updateStockQuote: (ticker, payload) =>
    set((state) => {
      const current = state.quotes[ticker];
      if (isOlderQuote(payload, current)) return state;
      if (
        current &&
        current.price === payload.price &&
        current.changePercent === payload.changePercent &&
        current.volume === payload.volume &&
        current.asOf === payload.asOf &&
        current.source === payload.source &&
        current.stale === payload.stale &&
        current.fetchedAt === payload.fetchedAt &&
        current.snapshot === payload.snapshot
      ) {
        return state;
      }

      return {
        quotes: {
          ...state.quotes,
          [ticker]: payload,
        },
      };
    }),
}));

export const useStockStore = create<StockStore>()(
  persist(
    (set) => ({
      watchlist: defaultWatchlist.map(({ ticker, name, market }) => ({ ticker, name, market })),
      selectedTicker: defaultWatchlist[0]?.ticker ?? null,
      addToWatchlist: (stock) =>
        set((state) => {
          if (state.watchlist.some((item) => item.ticker === stock.ticker)) {
            return state;
          }

          useStockQuoteStore.getState().seedQuote(stock.ticker, {
            price: stock.price,
            changePercent: stock.changePercent,
            volume: stock.volume,
          });

          return {
            watchlist: [
              ...state.watchlist,
              { ticker: stock.ticker, name: stock.name, market: stock.market },
            ],
            selectedTicker: state.selectedTicker ?? stock.ticker,
          };
        }),
      removeFromWatchlist: (ticker) =>
        set((state) => {
          const nextWatchlist = state.watchlist.filter((item) => item.ticker !== ticker);
          const nextSelectedTicker =
            state.selectedTicker === ticker ? (nextWatchlist[0]?.ticker ?? null) : state.selectedTicker;
          useStockQuoteStore.getState().removeQuote(ticker);

          return {
            watchlist: nextWatchlist,
            selectedTicker: nextSelectedTicker,
          };
        }),
      selectStock: (ticker) => set({ selectedTicker: ticker }),
    }),
    {
      name: 'stock-dashboard-watchlist',
    },
  ),
);

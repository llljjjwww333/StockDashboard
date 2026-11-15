import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Quote } from '../terminal/types';
import { mergeStoredQuotes } from '../lib/quotes';
import { mergeWatchlist } from '../lib/watchlistBackup';
import { normalizeWatchlistState, createWatchlistStorage, type WatchlistStorageIssue } from '../lib/watchlistPersistence';

export type MarketType = 'US' | 'CN' | 'CRYPTO';

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
  receivedAt?: number;
  streamConfirmedAt?: number | null;
  snapshot?: Quote;
}

interface StockStore {
  watchlist: WatchlistStock[];
  selectedTicker: string | null;
  addToWatchlist: (stock: WatchlistStock & StockQuote) => void;
  removeFromWatchlist: (ticker: string) => void;
  restoreToWatchlist: (stock: WatchlistStock, index: number) => void;
  importWatchlist: (stocks: WatchlistStock[]) => void;
  selectStock: (ticker: string | null) => void;
}

interface StockQuoteStore {
  quotes: Record<string, StockQuote>;
  connectionStatus: 'connecting' | 'connected' | 'disconnected';
  setConnectionStatus: (status: 'connecting' | 'connected' | 'disconnected') => void;
  seedQuote: (ticker: string, payload: StockQuote) => void;
  removeQuote: (ticker: string) => void;
  updateStockQuote: (ticker: string, payload: StockQuote) => void;
  updateStockQuotes: (updates: Record<string, StockQuote>) => void;
  markQuoteStale: (ticker: string, requestStartedAt: number) => void;
}

const defaultWatchlist: WatchlistStock[] = [
  { ticker: 'BTCUSDT', name: 'Bitcoin / USDT', market: 'CRYPTO' },
  { ticker: 'ETHUSDT', name: 'Ethereum / USDT', market: 'CRYPTO' },
  { ticker: 'SOLUSDT', name: 'Solana / USDT', market: 'CRYPTO' },
  { ticker: 'BNBUSDT', name: 'BNB / USDT', market: 'CRYPTO' },
  { ticker: 'XRPUSDT', name: 'XRP / USDT', market: 'CRYPTO' },
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
            [ticker]: { ...payload, stale: true },
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
  markQuoteStale: (ticker, requestStartedAt) =>
    set((state) => {
      const quote = state.quotes[ticker];
      if (!quote || quote.stale || (quote.receivedAt ?? 0) >= requestStartedAt) return state;
      return { quotes: { ...state.quotes, [ticker]: { ...quote, stale: true } } };
    }),
  updateStockQuote: (ticker, payload) =>
    set((state) => {
      const quotes = mergeStoredQuotes(state.quotes, { [ticker]: payload });
      return quotes === state.quotes ? state : { quotes };
    }),
  updateStockQuotes: updates =>
    set(state => {
      const quotes = mergeStoredQuotes(state.quotes, updates);
      return quotes === state.quotes ? state : { quotes };
    }),
}));

export const useWatchlistStorage = create<{ issue: WatchlistStorageIssue }>(() => ({ issue: null }));
const setStorageIssue = (issue: WatchlistStorageIssue) => useWatchlistStorage.setState({ issue });

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
      restoreToWatchlist: (stock, index) => set(state => {
        if (state.watchlist.some(item => item.ticker === stock.ticker)) return state;
        const watchlist = [...state.watchlist];
        watchlist.splice(Math.max(0, Math.min(index, watchlist.length)), 0, stock);
        return { watchlist, selectedTicker: state.selectedTicker ?? stock.ticker };
      }),
      importWatchlist: stocks => set(state => {
        const watchlist = mergeWatchlist(state.watchlist, stocks);
        return { watchlist, selectedTicker: state.selectedTicker ?? watchlist[0]?.ticker ?? null };
      }),
      selectStock: (ticker) => set({ selectedTicker: ticker }),
    }),
    {
      name: 'crypto-dashboard-watchlist:v1',
      storage: createJSONStorage(() => createWatchlistStorage(() => localStorage, setStorageIssue)),
      partialize: state => ({ watchlist: state.watchlist, selectedTicker: state.selectedTicker }),
      merge: (saved, current) => ({ ...current, ...normalizeWatchlistState(saved, current) }),
      onRehydrateStorage: () => (_state, error) => { if (error) setStorageIssue('read'); },
    },
  ),
);

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

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
  seedQuote: (ticker: string, payload: StockQuote) => void;
  removeQuote: (ticker: string) => void;
  updateStockQuote: (ticker: string, payload: StockQuote) => void;
}

const defaultWatchlist: Array<WatchlistStock & StockQuote> = [
  { ticker: 'AAPL', name: 'Apple Inc.', market: 'US', price: 180, changePercent: 0.5, volume: 10000000 },
  { ticker: 'NVDA', name: 'NVIDIA Corporation', market: 'US', price: 910, changePercent: 1.6, volume: 42000000 },
  { ticker: 'TSLA', name: 'Tesla Inc.', market: 'US', price: 250, changePercent: -0.8, volume: 31000000 },
  { ticker: '600519', name: 'Kweichow Moutai', market: 'CN', price: 1700, changePercent: 0.9, volume: 3200000 },
  { ticker: '300059', name: 'East Money', market: 'CN', price: 15, changePercent: 1.1, volume: 18500000 },
];

const defaultQuotes = Object.fromEntries(
  defaultWatchlist.map(({ ticker, price, changePercent, volume }) => [
    ticker,
    { price, changePercent, volume },
  ]),
);

export const useStockQuoteStore = create<StockQuoteStore>()((set) => ({
  quotes: defaultQuotes,
  seedQuote: (ticker, payload) =>
    set((state) => ({
      quotes: state.quotes[ticker]
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
      if (
        current &&
        current.price === payload.price &&
        current.changePercent === payload.changePercent &&
        current.volume === payload.volume
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

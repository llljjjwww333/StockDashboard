import { create } from 'zustand';

interface Stock {
  ticker: string;
  price: number;
  changePercent: number;
  volume: number;
}

interface StockStore {
  watchlist: Stock[];
  selectedStock: Stock | null;
  stockData: Record<string, any[]>;
  addToWatchlist: (stock: Stock) => void;
  removeFromWatchlist: (ticker: string) => void;
  selectStock: (stock: Stock) => void;
  updateStockPrice: (ticker: string, price: number, changePercent: number, volume: number) => void;
  setStockData: (ticker: string, data: any[]) => void;
}

export const useStockStore = create<StockStore>((set) => ({
  watchlist: [
    { ticker: 'AAPL', price: 180.0, changePercent: 0.5, volume: 10000000 },
    { ticker: 'MSFT', price: 400.0, changePercent: -0.2, volume: 8000000 },
    { ticker: 'GOOGL', price: 130.0, changePercent: 1.2, volume: 6000000 },
    { ticker: 'AMZN', price: 170.0, changePercent: -0.8, volume: 7000000 },
    { ticker: 'META', price: 300.0, changePercent: 0.3, volume: 5000000 },
  ],
  selectedStock: null,
  stockData: {},
  
  addToWatchlist: (stock) => set((state) => {
    if (!state.watchlist.some(s => s.ticker === stock.ticker)) {
      return { watchlist: [...state.watchlist, stock] };
    }
    return state;
  }),
  
  removeFromWatchlist: (ticker) => set((state) => ({
    watchlist: state.watchlist.filter(stock => stock.ticker !== ticker)
  })),
  
  selectStock: (stock) => set({ selectedStock: stock }),
  
  updateStockPrice: (ticker, price, changePercent, volume) => set((state) => ({
    watchlist: state.watchlist.map(stock => 
      stock.ticker === ticker 
        ? { ...stock, price, changePercent, volume }
        : stock
    ),
    selectedStock: state.selectedStock?.ticker === ticker
      ? { ...state.selectedStock, price, changePercent, volume }
      : state.selectedStock
  })),
  
  setStockData: (ticker, data) => set((state) => ({
    stockData: { ...state.stockData, [ticker]: data }
  })),
}));

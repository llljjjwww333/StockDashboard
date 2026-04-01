import React, { useState } from 'react';
import { useStockStore } from '../store/stockStore';

const Sidebar: React.FC = () => {
  const { watchlist, selectedStock, selectStock, addToWatchlist, removeFromWatchlist } = useStockStore();
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{ ticker: string; name: string }>>([]);

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    const term = e.target.value;
    setSearchTerm(term);
    
    if (term) {
      const results = [
        { ticker: 'AAPL', name: 'Apple Inc.' },
        { ticker: 'MSFT', name: 'Microsoft Corporation' },
        { ticker: 'GOOGL', name: 'Alphabet Inc.' },
        { ticker: 'AMZN', name: 'Amazon.com Inc.' },
        { ticker: 'META', name: 'Meta Platforms Inc.' },
        { ticker: 'TSLA', name: 'Tesla Inc.' },
        { ticker: 'JPM', name: 'JPMorgan Chase & Co.' },
        { ticker: 'V', name: 'Visa Inc.' },
        { ticker: 'JNJ', name: 'Johnson & Johnson' },
        { ticker: 'PFE', name: 'Pfizer Inc.' },
      ].filter(item => 
        item.ticker.toLowerCase().includes(term.toLowerCase()) ||
        item.name.toLowerCase().includes(term.toLowerCase())
      );
      setSearchResults(results);
    } else {
      setSearchResults([]);
    }
  };

  const handleAddStock = (ticker: string, name: string) => {
    const existingStock = watchlist.find(s => s.ticker === ticker);
    if (existingStock) {
      selectStock(existingStock);
      setSearchTerm('');
      setSearchResults([]);
      return;
    }
    
    const newStock = {
      ticker,
      price: Math.random() * 500 + 100,
      changePercent: (Math.random() - 0.5) * 4,
      volume: Math.floor(Math.random() * 10000000) + 1000000,
    };
    addToWatchlist(newStock);
    selectStock(newStock);
    setSearchTerm('');
    setSearchResults([]);
  };

  return (
    <div className="w-80 bg-secondary border-r border-border flex flex-col h-screen">
      <div className="p-6 border-b border-border">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-gradient-to-br from-accent to-indigo-600 rounded-xl flex items-center justify-center shadow-glow">
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">FinSense</h1>
            <p className="text-xs text-gray-400">Real-time Trading Dashboard</p>
          </div>
        </div>
      </div>
      
      <div className="p-4">
        <div className="relative">
          <svg className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search stocks..."
            className="w-full bg-tertiary border border-border rounded-xl px-4 py-3 pl-10 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-all"
            value={searchTerm}
            onChange={handleSearch}
          />
        </div>
        {searchResults.length > 0 && (
          <div className="mt-2 bg-tertiary border border-border rounded-xl max-h-64 overflow-y-auto shadow-card z-10 animate-slide-up">
            {searchResults.map((item) => {
              const isInWatchlist = watchlist.some(s => s.ticker === item.ticker);
              return (
                <div
                  key={item.ticker}
                  className="p-3 hover:bg-cardHover cursor-pointer flex justify-between items-center transition-colors"
                  onClick={() => handleAddStock(item.ticker, item.name)}
                >
                  <div className="flex items-center space-x-3">
                    <div className="w-8 h-8 bg-accent/20 rounded-lg flex items-center justify-center">
                      <span className="text-accent font-mono font-bold text-xs">{item.ticker.slice(0, 2)}</span>
                    </div>
                    <div>
                      <div className="font-mono font-bold text-white">{item.ticker}</div>
                      <div className="text-xs text-gray-400">{item.name}</div>
                    </div>
                  </div>
                  <button className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-all ${isInWatchlist ? 'bg-success/20 text-success' : 'bg-accent hover:bg-accentHover text-white'}`}>
                    {isInWatchlist ? 'Added' : 'Add'}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4">
        <div className="flex items-center justify-between mb-3 px-2">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Watchlist</h2>
          <span className="text-xs text-gray-500 bg-tertiary px-2 py-1 rounded-full">{watchlist.length}</span>
        </div>
        <div className="space-y-2">
          {watchlist.map((stock) => (
            <div
              key={stock.ticker}
              className={`p-4 rounded-xl cursor-pointer transition-all duration-200 ${selectedStock?.ticker === stock.ticker ? 'bg-gradient-to-r from-accent/20 to-indigo-600/20 border border-accent/50 shadow-glow' : 'bg-card border border-transparent hover:bg-cardHover hover:border-border shadow-card hover:shadow-card-hover'}`}
              onClick={() => selectStock(stock)}
            >
              <div className="flex justify-between items-start mb-2">
                <div className="flex items-center space-x-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center font-mono font-bold ${selectedStock?.ticker === stock.ticker ? 'bg-accent text-white' : 'bg-tertiary text-gray-300'}`}>
                    {stock.ticker.slice(0, 2)}
                  </div>
                  <div>
                    <div className="font-mono font-bold text-white">{stock.ticker}</div>
                  </div>
                </div>
                <div className={`text-sm font-semibold px-2 py-1 rounded-lg ${stock.changePercent >= 0 ? 'bg-success/20 text-success' : 'bg-danger/20 text-danger'}`}>
                  {stock.changePercent >= 0 ? '+' : ''}{stock.changePercent.toFixed(2)}%
                </div>
              </div>
              <div className="flex justify-between items-end">
                <div>
                  <div className="text-2xl font-bold text-white">${stock.price.toFixed(2)}</div>
                  <div className="text-xs text-gray-400 mt-1">Vol: {stock.volume.toLocaleString()}</div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeFromWatchlist(stock.ticker);
                  }}
                  className="text-gray-400 hover:text-danger transition-colors p-1"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
          {watchlist.length === 0 && (
            <div className="text-center py-12 text-gray-400">
              <svg className="w-12 h-12 mx-auto mb-3 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm">No stocks in watchlist</p>
              <p className="text-xs mt-1">Search and add stocks above</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Sidebar;

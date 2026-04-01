import React, { useEffect, useState } from 'react';
import { useStockStore } from '../store/stockStore';

interface RecommendationsProps {
  ticker: string;
}

interface StockRecommendation {
  ticker: string;
  name: string;
  price: number;
  changePercent: number;
}

const Recommendations: React.FC<RecommendationsProps> = ({ ticker }) => {
  const { selectStock, addToWatchlist, watchlist } = useStockStore();
  const [recommendations, setRecommendations] = useState<StockRecommendation[]>([]);

  const stockNames: Record<string, string> = {
    'MSFT': 'Microsoft Corporation',
    'GOOGL': 'Alphabet Inc.',
    'AMZN': 'Amazon.com Inc.',
    'META': 'Meta Platforms Inc.',
    'TSLA': 'Tesla Inc.',
    'JPM': 'JPMorgan Chase & Co.',
    'V': 'Visa Inc.',
    'JNJ': 'Johnson & Johnson',
    'PFE': 'Pfizer Inc.',
    'NVDA': 'NVIDIA Corporation',
  };

  useEffect(() => {
    const fetchRecommendations = async () => {
      try {
        const response = await fetch(`http://localhost:8000/api/v1/stocks/${ticker}/recommendations`);
        const data = await response.json();
        
        const recs = data.recommendations.map((t: string) => ({
          ticker: t,
          name: stockNames[t] || t,
          price: Math.random() * 500 + 100,
          changePercent: (Math.random() - 0.5) * 4,
        }));
        
        setRecommendations(recs);
      } catch (error) {
        console.error('Error fetching recommendations:', error);
        const mockRecs = ['MSFT', 'GOOGL', 'AMZN', 'META', 'TSLA', 'NVDA'].map((t) => ({
          ticker: t,
          name: stockNames[t] || t,
          price: Math.random() * 500 + 100,
          changePercent: (Math.random() - 0.5) * 4,
        }));
        setRecommendations(mockRecs);
      }
    };

    fetchRecommendations();
  }, [ticker]);

  const handleSelectStock = (stock: StockRecommendation) => {
    const existingStock = watchlist.find(s => s.ticker === stock.ticker);
    if (existingStock) {
      selectStock(existingStock);
    } else {
      const newStock = {
        ticker: stock.ticker,
        price: stock.price,
        changePercent: stock.changePercent,
        volume: Math.floor(Math.random() * 10000000) + 1000000,
      };
      addToWatchlist(newStock);
      selectStock(newStock);
    }
  };

  return (
    <div className="bg-card border border-border rounded-2xl p-6 shadow-card">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-white">Related Stocks</h2>
          <p className="text-sm text-gray-400 mt-1">You might also be interested in</p>
        </div>
        <svg className="w-6 h-6 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
        </svg>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {recommendations.map((stock, index) => (
          <div
            key={stock.ticker}
            className="bg-tertiary rounded-xl p-4 cursor-pointer hover:bg-cardHover border border-transparent hover:border-accent/30 transition-all duration-200 hover:shadow-card-hover animate-slide-up"
            style={{ animationDelay: `${index * 0.05}s` }}
            onClick={() => handleSelectStock(stock)}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="w-10 h-10 bg-gradient-to-br from-accent/30 to-indigo-600/30 rounded-lg flex items-center justify-center">
                <span className="text-accent font-mono font-bold text-sm">{stock.ticker.slice(0, 2)}</span>
              </div>
              <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
            <div className="font-mono font-bold text-white">{stock.ticker}</div>
            <div className="text-xs text-gray-400 mt-0.5 truncate">{stock.name}</div>
            <div className="flex items-center justify-between mt-3">
              <span className="text-lg font-bold text-white">${stock.price.toFixed(2)}</span>
              <span className={`text-sm font-semibold px-2 py-1 rounded-lg ${stock.changePercent >= 0 ? 'bg-success/20 text-success' : 'bg-danger/20 text-danger'}`}>
                {stock.changePercent >= 0 ? '+' : ''}{stock.changePercent.toFixed(2)}%
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Recommendations;

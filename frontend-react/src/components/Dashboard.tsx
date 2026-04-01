import React from 'react';
import Sidebar from './Sidebar';
import KLineChart from './KLineChart';
import Recommendations from './Recommendations';
import { useStockStore } from '../store/stockStore';

const Dashboard: React.FC = () => {
  const { selectedStock } = useStockStore();

  return (
    <div className="flex h-screen bg-primary">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        {selectedStock ? (
          <div className="p-6 animate-fade-in">
            <div className="mb-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-4">
                  <div className="w-16 h-16 bg-gradient-to-br from-accent to-indigo-600 rounded-2xl flex items-center justify-center shadow-glow">
                    <span className="text-2xl font-mono font-bold text-white">{selectedStock.ticker.slice(0, 2)}</span>
                  </div>
                  <div>
                    <h1 className="text-3xl font-bold text-white">{selectedStock.ticker}</h1>
                    <div className="flex items-center space-x-3 mt-1">
                      <span className="text-4xl font-bold text-white">${selectedStock.price.toFixed(2)}</span>
                      <span className={`text-lg font-semibold px-3 py-1 rounded-lg ${selectedStock.changePercent >= 0 ? 'bg-success/20 text-success' : 'bg-danger/20 text-danger'}`}>
                        {selectedStock.changePercent >= 0 ? '+' : ''}{selectedStock.changePercent.toFixed(2)}%
                      </span>
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm text-gray-400">Volume</div>
                  <div className="text-xl font-semibold text-white">{selectedStock.volume.toLocaleString()}</div>
                </div>
              </div>
            </div>

            <div className="space-y-6">
              <KLineChart ticker={selectedStock.ticker} />
              <Recommendations ticker={selectedStock.ticker} />
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center animate-fade-in">
              <div className="w-32 h-32 mx-auto mb-6 bg-gradient-to-br from-accent/20 to-indigo-600/20 rounded-full flex items-center justify-center">
                <svg className="w-16 h-16 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-white mb-2">Welcome to FinSense</h2>
              <p className="text-gray-400 mb-6">Select a stock from the watchlist to view its chart and details</p>
              <div className="inline-flex items-center space-x-2 text-accent">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                <span className="font-medium">Click on a stock in the sidebar to get started</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Dashboard;

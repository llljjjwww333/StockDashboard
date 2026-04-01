import React, { useEffect } from 'react';
import Dashboard from './components/Dashboard';
import { stockWebSocketService } from './services/stockWebSocketService';
import { useStockStore } from './store/stockStore';
import './App.css';

function App() {
  // 在应用启动时初始化 WebSocket 连接
  useEffect(() => {
    // 连接 WebSocket
    stockWebSocketService.connect();

    // 当 watchlist 变化时更新订阅
    const unsubscribeWatchlist = useStockStore.subscribe((state) => {
      // 更新订阅，而不是重新连接
      stockWebSocketService.updateSubscriptions();
    });

    // 组件卸载时清理
    return () => {
      stockWebSocketService.disconnect();
      unsubscribeWatchlist();
    };
  }, []);

  return (
    <div className="App">
      <Dashboard />
    </div>
  );
}

export default App;

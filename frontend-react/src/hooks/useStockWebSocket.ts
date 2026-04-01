import { useEffect, useRef, useState } from 'react';
import { useStockStore } from '../store/stockStore';

const useStockWebSocket = () => {
  // 使用 useState 来跟踪连接状态
  const [isConnected, setIsConnected] = useState(false);
  
  // 创建所有的 ref
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const subscribedTickersRef = useRef<Set<string>>(new Set());

  // 在组件挂载时连接
  useEffect(() => {
    // 连接到 WebSocket 服务器
    const connect = () => {
      if (socketRef.current) {
        socketRef.current.close();
      }

      try {
        socketRef.current = new WebSocket('ws://localhost:8000/ws/stock-updates');

        socketRef.current.onopen = () => {
          console.log('WebSocket connected');
          setIsConnected(true);
          subscribedTickersRef.current.clear();
          
          // 订阅所有在 watchlist 中的股票
          const currentWatchlist = useStockStore.getState().watchlist;
          currentWatchlist.forEach(stock => {
            if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
              socketRef.current.send(JSON.stringify({
                type: 'subscribe',
                data: { ticker: stock.ticker }
              }));
              subscribedTickersRef.current.add(stock.ticker);
            }
          });
        };

        socketRef.current.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            if (message.type === 'update') {
              const { ticker, price, change_percent, volume } = message.data;
              useStockStore.getState().updateStockPrice(ticker, price, change_percent, volume);
            }
          } catch (error) {
            console.error('Error parsing WebSocket message:', error);
          }
        };

        socketRef.current.onerror = (error) => {
          console.error('WebSocket error:', error);
          setIsConnected(false);
        };

        socketRef.current.onclose = () => {
          console.log('WebSocket disconnected');
          setIsConnected(false);
          subscribedTickersRef.current.clear();
          
          // 3秒后重新连接
          if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
          }
          reconnectTimeoutRef.current = setTimeout(connect, 3000);
        };
      } catch (error) {
        console.error('Error connecting to WebSocket:', error);
        setIsConnected(false);
        
        // 3秒后重新连接
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
        }
        reconnectTimeoutRef.current = setTimeout(connect, 3000);
      }
    };

    // 订阅股票
    const subscribeToStock = (ticker: string) => {
      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN && !subscribedTickersRef.current.has(ticker)) {
        socketRef.current.send(JSON.stringify({
          type: 'subscribe',
          data: { ticker }
        }));
        subscribedTickersRef.current.add(ticker);
      }
    };

    // 取消订阅股票
    const unsubscribeFromStock = (ticker: string) => {
      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN && subscribedTickersRef.current.has(ticker)) {
        socketRef.current.send(JSON.stringify({
          type: 'unsubscribe',
          data: { ticker }
        }));
        subscribedTickersRef.current.delete(ticker);
      }
    };

    // 连接 WebSocket
    connect();

    // 当 watchlist 变化时重新订阅
    const unsubscribeWatchlist = useStockStore.subscribe((state) => {
      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        // 获取当前 watchlist 中的股票
        const currentTickers = new Set(state.watchlist.map(stock => stock.ticker));
        
        // 取消订阅不在 watchlist 中的股票
        subscribedTickersRef.current.forEach(ticker => {
          if (!currentTickers.has(ticker)) {
            unsubscribeFromStock(ticker);
          }
        });
        
        // 订阅新添加到 watchlist 中的股票
        currentTickers.forEach(ticker => {
          if (!subscribedTickersRef.current.has(ticker)) {
            subscribeToStock(ticker);
          }
        });
      }
    });

    // 组件卸载时清理
    return () => {
      if (socketRef.current) {
        socketRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      unsubscribeWatchlist();
    };
  }, []); // 空依赖数组，只在挂载和卸载时执行

  return {
    isConnected
  };
};

export default useStockWebSocket;

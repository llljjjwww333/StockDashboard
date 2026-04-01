import { useStockStore } from '../store/stockStore';

class StockWebSocketService {
  private socket: WebSocket | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private isConnected = false;
  private subscribedTickers = new Set<string>();

  connect() {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      console.log('WebSocket is already connected');
      return;
    }

    if (this.socket) {
      this.socket.close();
    }

    try {
      console.log('Attempting to connect to WebSocket server...');
      this.socket = new WebSocket('ws://localhost:8000/ws/stock-updates');

      this.socket.onopen = () => {
        console.log('WebSocket connected');
        this.isConnected = true;
        this.subscribedTickers.clear();
        
        // 订阅所有在 watchlist 中的股票
        const currentWatchlist = useStockStore.getState().watchlist;
        currentWatchlist.forEach(stock => {
          if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify({
              type: 'subscribe',
              data: { ticker: stock.ticker }
            }));
            this.subscribedTickers.add(stock.ticker);
          }
        });
      };

      this.socket.onmessage = (event) => {
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

      this.socket.onerror = (error) => {
        console.error('WebSocket error:', error);
        this.isConnected = false;
      };

      this.socket.onclose = () => {
        console.log('WebSocket disconnected');
        this.isConnected = false;
        this.subscribedTickers.clear();
        
        // 5秒后重新连接，避免频繁的重新连接
        if (this.reconnectTimeout) {
          clearTimeout(this.reconnectTimeout);
        }
        this.reconnectTimeout = setTimeout(() => this.connect(), 5000);
      };
    } catch (error) {
      console.error('Error connecting to WebSocket:', error);
      this.isConnected = false;
      
      // 5秒后重新连接，避免频繁的重新连接
      if (this.reconnectTimeout) {
        clearTimeout(this.reconnectTimeout);
      }
      this.reconnectTimeout = setTimeout(() => this.connect(), 5000);
    }
  }

  updateSubscriptions() {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    // 获取当前 watchlist 中的股票
    const currentWatchlist = useStockStore.getState().watchlist;
    const currentTickers = new Set(currentWatchlist.map(stock => stock.ticker));
    
    // 取消订阅不在 watchlist 中的股票
    this.subscribedTickers.forEach(ticker => {
      if (!currentTickers.has(ticker)) {
        this.unsubscribeFromStock(ticker);
      }
    });
    
    // 订阅新添加到 watchlist 中的股票
    currentTickers.forEach(ticker => {
      if (!this.subscribedTickers.has(ticker)) {
        this.subscribeToStock(ticker);
      }
    });
  }

  subscribeToStock(ticker: string) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN && !this.subscribedTickers.has(ticker)) {
      console.log(`Subscribing to ${ticker}`);
      this.socket.send(JSON.stringify({
        type: 'subscribe',
        data: { ticker }
      }));
      this.subscribedTickers.add(ticker);
    }
  }

  unsubscribeFromStock(ticker: string) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN && this.subscribedTickers.has(ticker)) {
      console.log(`Unsubscribing from ${ticker}`);
      this.socket.send(JSON.stringify({
        type: 'unsubscribe',
        data: { ticker }
      }));
      this.subscribedTickers.delete(ticker);
    }
  }

  disconnect() {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this.isConnected = false;
    this.subscribedTickers.clear();
  }

  getIsConnected() {
    return this.isConnected;
  }
}

// 创建单例实例
export const stockWebSocketService = new StockWebSocketService();

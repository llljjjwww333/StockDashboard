import { useStockQuoteStore, useStockStore } from '../store/stockStore';
import { getWebSocketUrl } from '../lib/api';
import { toStoredQuote } from '../lib/quotes';

const CONNECT_TIMEOUT_MS = 12000;
const HEARTBEAT_MS = 15000;
const SILENCE_TIMEOUT_MS = 45000;

class StockWebSocketService {
  private socket: WebSocket | null = null;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private connectionTimer: ReturnType<typeof setTimeout> | null = null;
  private lastMessageAt = 0;
  private isConnected = false;
  private manualDisconnect = false;
  private reconnectAttempts = 0;
  private subscribedTickers = new Set<string>();
  private listening = false;
  private onOffline = () => {
    this.dropConnection();
    const store = useStockQuoteStore.getState();
    for (const [ticker, quote] of Object.entries(store.quotes)) store.updateStockQuote(ticker, { ...quote, stale: true });
  };
  private onOnline = () => {
    if (this.manualDisconnect) return;
    this.dropConnection();
    this.reconnectAttempts = 0;
    this.connect();
  };
  private onVisible = () => {
    if (document.hidden || this.manualDisconnect || !navigator.onLine) return;
    if (!this.socket || Date.now() - this.lastMessageAt >= SILENCE_TIMEOUT_MS) this.onOnline();
  };

  private clearConnectionTimer() {
    if (this.connectionTimer !== null) clearTimeout(this.connectionTimer);
    this.connectionTimer = null;
  }

  private dropConnection() {
    this.clearConnectionTimer();
    if (this.reconnectTimeout) { clearTimeout(this.reconnectTimeout); this.reconnectTimeout = null; }
    const socket = this.socket;
    this.socket = null;
    if (socket) { socket.onclose = null; socket.close(); }
    this.subscribedTickers.clear();
    this.isConnected = false;
    useStockQuoteStore.getState().setConnectionStatus('disconnected');
  }

  connect() {
    this.manualDisconnect = false;
    if (!this.listening) {
      window.addEventListener('online', this.onOnline);
      window.addEventListener('offline', this.onOffline);
      document.addEventListener('visibilitychange', this.onVisible);
      this.listening = true;
    }
    if (!navigator.onLine) {
      useStockQuoteStore.getState().setConnectionStatus('disconnected');
      return;
    }
    if (
      this.socket &&
      (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    useStockQuoteStore.getState().setConnectionStatus('connecting');
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    try {
      const socket = new WebSocket(getWebSocketUrl());
      this.socket = socket;
      this.lastMessageAt = Date.now();
      const restart = () => {
        if (this.socket !== socket) return;
        this.dropConnection();
        this.scheduleReconnect();
      };
      this.connectionTimer = setTimeout(restart, CONNECT_TIMEOUT_MS);
      const heartbeat = () => {
        if (this.socket !== socket) return;
        if (Date.now() - this.lastMessageAt >= SILENCE_TIMEOUT_MS) { restart(); return; }
        socket.send('{"type":"ping"}');
        this.connectionTimer = setTimeout(heartbeat, HEARTBEAT_MS);
      };

      socket.onopen = () => {
        if (this.socket !== socket) return;
        this.clearConnectionTimer();
        this.lastMessageAt = Date.now();
        this.connectionTimer = setTimeout(heartbeat, HEARTBEAT_MS);
        this.isConnected = true;
        useStockQuoteStore.getState().setConnectionStatus('connected');
        this.reconnectAttempts = 0;
        this.subscribedTickers.clear();

        const currentWatchlist = useStockStore.getState().watchlist;
        currentWatchlist.forEach((stock) => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(
              JSON.stringify({
                type: 'subscribe',
                data: { ticker: stock.ticker },
              }),
            );
            this.subscribedTickers.add(stock.ticker);
          }
        });
      };

      socket.onmessage = (event) => {
        if (this.socket !== socket) return;
        try {
          const message = JSON.parse(event.data);
          this.lastMessageAt = Date.now();
          if (message.type === 'update') {
            useStockQuoteStore.getState().updateStockQuote(message.data.ticker, toStoredQuote(message.data));
          } else if (message.type === 'error' && message.data?.ticker) {
            const current = useStockQuoteStore.getState().quotes[message.data.ticker];
            if (current) useStockQuoteStore.getState().updateStockQuote(message.data.ticker, { ...current, stale: true });
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      socket.onerror = () => {
        restart();
      };

      socket.onclose = () => {
        if (this.socket !== socket) return;
        this.clearConnectionTimer();
        this.socket = null;
        this.isConnected = false;
        useStockQuoteStore.getState().setConnectionStatus('disconnected');
        this.subscribedTickers.clear();
        if (!this.manualDisconnect) {
          this.scheduleReconnect();
        }
      };
    } catch (error) {
      console.error('Error connecting to WebSocket:', error);
      this.isConnected = false;
      useStockQuoteStore.getState().setConnectionStatus('disconnected');
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.manualDisconnect || this.reconnectTimeout || !navigator.onLine) return;
    const delay = Math.min(1000 * (2 ** this.reconnectAttempts), 30000);
    this.reconnectAttempts += 1;
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      this.connect();
    }, delay);
  }

  updateSubscriptions() {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    const currentWatchlist = useStockStore.getState().watchlist;
    const currentTickers = new Set(currentWatchlist.map((stock) => stock.ticker));

    this.subscribedTickers.forEach((ticker) => {
      if (!currentTickers.has(ticker)) {
        this.unsubscribeFromStock(ticker);
      }
    });

    currentTickers.forEach((ticker) => {
      if (!this.subscribedTickers.has(ticker)) {
        this.subscribeToStock(ticker);
      }
    });
  }

  subscribeToStock(ticker: string) {
    if (
      this.socket &&
      this.socket.readyState === WebSocket.OPEN &&
      !this.subscribedTickers.has(ticker)
    ) {
      console.log(`Subscribing to ${ticker}`);
      this.socket.send(
        JSON.stringify({
          type: 'subscribe',
          data: { ticker },
        }),
      );
      this.subscribedTickers.add(ticker);
    }
  }

  unsubscribeFromStock(ticker: string) {
    if (
      this.socket &&
      this.socket.readyState === WebSocket.OPEN &&
      this.subscribedTickers.has(ticker)
    ) {
      console.log(`Unsubscribing from ${ticker}`);
      this.socket.send(
        JSON.stringify({
          type: 'unsubscribe',
          data: { ticker },
        }),
      );
      this.subscribedTickers.delete(ticker);
    }
  }

  disconnect() {
    this.manualDisconnect = true;
    window.removeEventListener('online', this.onOnline);
    window.removeEventListener('offline', this.onOffline);
    document.removeEventListener('visibilitychange', this.onVisible);
    this.listening = false;
    this.dropConnection();
    this.reconnectAttempts = 0;
  }

  getIsConnected() {
    return this.isConnected;
  }
}

export const stockWebSocketService = new StockWebSocketService();

import { useStockQuoteStore, useStockStore } from '../store/stockStore';
import { getWebSocketUrl } from '../lib/api';
import { isMarketQuote } from '../lib/marketPayload';
import { toStoredQuote } from '../lib/quotes';
import { streamQuoteTickers } from '../lib/quoteSubscriptions';
import { isQuoteStreamHealthy } from '../lib/quoteStreamHealth';
import { isActivePhase, marketPhase } from '../terminal/marketSession';

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
  private subscriptionStartedAt = new Map<string, number>();
  private failedTickers = new Set<string>();
  private healthListeners = new Set<() => void>();
  private notifyHealth = () => { for (const listener of this.healthListeners) listener(); };
  subscribeHealth = (listener: () => void) => {
    this.healthListeners.add(listener);
    return () => { this.healthListeners.delete(listener); };
  };
  private activeTicker: string | null = null;
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
  private onPageShow = (event: PageTransitionEvent) => { if (event.persisted) this.onVisible(); };

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
    this.subscriptionStartedAt.clear(); this.failedTickers.clear();
    this.isConnected = false;
    useStockQuoteStore.getState().setConnectionStatus('disconnected');
    this.notifyHealth();
  }

  connect() {
    this.manualDisconnect = false;
    if (!this.listening) {
      window.addEventListener('online', this.onOnline);
      window.addEventListener('offline', this.onOffline);
      document.addEventListener('visibilitychange', this.onVisible);
      window.addEventListener('pageshow', this.onPageShow);
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

        this.updateSubscriptions();
      };

      socket.onmessage = (event) => {
        if (this.socket !== socket) return;
        try {
          const message = JSON.parse(event.data);
          this.lastMessageAt = Date.now();
          if (message.type === 'update' && isMarketQuote(message.data) && this.subscribedTickers.has(message.data.ticker)) {
            const quote = toStoredQuote(message.data, this.lastMessageAt);
            const failed = this.failedTickers.has(message.data.ticker);
            if (quote.stale) this.failedTickers.add(message.data.ticker); else this.failedTickers.delete(message.data.ticker);
            useStockQuoteStore.getState().updateStockQuote(message.data.ticker, {
              ...quote, streamConfirmedAt: quote.stale ? null : this.lastMessageAt,
            });
            if (failed !== Boolean(quote.stale)) this.notifyHealth();
          } else if (message.type === 'error' && this.subscribedTickers.has(message.data?.ticker)) {
            this.failedTickers.add(message.data.ticker);
            const current = useStockQuoteStore.getState().quotes[message.data.ticker];
            if (current) useStockQuoteStore.getState().updateStockQuote(message.data.ticker, {
              ...current, streamConfirmedAt: null,
              stale: current.stale || (current.streamConfirmedAt != null && current.receivedAt === current.streamConfirmedAt),
            });
            this.notifyHealth();
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
        this.subscriptionStartedAt.clear(); this.failedTickers.clear(); this.notifyHealth();
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

  setActiveTicker(ticker: string | null) {
    if (this.activeTicker === ticker) return;
    this.activeTicker = ticker;
    this.updateSubscriptions();
  }

  updateSubscriptions() {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    const currentTickers = streamQuoteTickers(useStockStore.getState().watchlist, this.activeTicker);

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
    this.notifyHealth();
  }

  private subscribeToStock(ticker: string) {
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
      this.subscriptionStartedAt.set(ticker, Date.now()); this.failedTickers.delete(ticker);
    }
  }

  private unsubscribeFromStock(ticker: string) {
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
      this.subscriptionStartedAt.delete(ticker); this.failedTickers.delete(ticker);
    }
  }

  disconnect() {
    this.manualDisconnect = true;
    window.removeEventListener('online', this.onOnline);
    window.removeEventListener('offline', this.onOffline);
    document.removeEventListener('visibilitychange', this.onVisible);
    window.removeEventListener('pageshow', this.onPageShow);
    this.listening = false;
    this.dropConnection();
    this.reconnectAttempts = 0;
  }

  getIsConnected() {
    return this.isConnected;
  }

  hasSubscription(ticker: string) {
    return this.isConnected && this.subscribedTickers.has(ticker);
  }

  hasHealthySubscription(ticker: string, now = Date.now(), active?: boolean) {
    if (!this.hasSubscription(ticker) || this.failedTickers.has(ticker)) return false;
    return isQuoteStreamHealthy(this.subscriptionStartedAt.get(ticker), useStockQuoteStore.getState().quotes[ticker]?.streamConfirmedAt,
      false, active ?? isActivePhase(marketPhase(ticker, new Date(now))), now);
  }
}

export const stockWebSocketService = new StockWebSocketService();

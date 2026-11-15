import { getLocale, t, useLanguage } from './lib/i18n';
import { formatVolume } from './lib/volumePresentation';
import { type CSSProperties, type PointerEvent, type ReactNode, memo, useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import './App.css';
import { stockWebSocketService } from './services/stockWebSocketService';
import { type MarketType, type StockQuote, type WatchlistStock, useStockQuoteStore, useStockStore, useWatchlistStorage } from './store/stockStore';
import { MarketChart } from './terminal/MarketChart';
import { liveDailyHistory } from './terminal/liveDailyHistory';
import { OrderBook } from './terminal/OrderBook';
import { ChinaMarkets } from './terminal/ChinaMarkets';
import { StockTags } from './terminal/StockTags';
import { WatchlistQuoteFallback } from './terminal/WatchlistQuoteFallback';
import { isChinaIndex } from './lib/instrumentIdentity';
import { MarketClock, QuoteFreshnessBadge } from './terminal/MarketClock';
import { useAgedWatchlistQuotes } from './terminal/useMarketPhase';
import { pricePrecision } from './lib/pricePrecision';
import { IndicatorPicker } from './terminal/IndicatorPicker';
import { analysisIndicatorValues } from './terminal/indicators';
import { candleIntervals, candlePeriodAllowed, chartSelection, initialChartSelection, loadChartSelection, saveChartSelection, type CandleInterval, type ChartMode } from './terminal/chartSelection';
import { applyLinkedChart, readCryptoDeskRoute as readDeskRoute } from './terminal/deskRoute';
import { DeskNavigation, type DeskEntry, type MarketOrigin } from './terminal/deskNavigation';
import { loadWatchSort, sortWatchlist, watchSortKey, type WatchSort } from './terminal/watchlistSort';
import { filterWatchlist, type WatchlistFilter } from './terminal/watchlistFilter';
import { isOlderQuote, toStoredQuote } from './lib/quotes';
import { SettingsDialog } from './ai/SettingsDialog';
import { useKeyboard } from './store/keyboardStore';
import { BackToTop } from './terminal/BackToTop';
import { ChartDataExport } from './terminal/ChartDataExport';
import { usePortfolioRunner } from './terminal/usePortfolioRunner';
import { SimulationView } from './terminal/SimulationView';
import { StrategyLab } from './terminal/StrategyLab';
import { ResourceError } from './terminal/ResourceError';
import { newsSourceLink } from './lib/newsSource';
import { NewsDesk } from './terminal/NewsDesk';
import { markNewsRead, toggleNewsSaved, useNewsLibrary } from './terminal/newsLibrary';
import { newsCoins, newsId, newsLanguage } from './terminal/newsFilters';
import { useOnlineStatus } from './lib/useOnlineStatus';
import { changeTone, changeDirection, priceChangeTone, type ChangeTone } from './lib/changePresentation';
import { normalizeNewsView } from './terminal/newsView';
import { AiControls, AnalysisSummary } from './ai/AiControls';
import { useAiProfiles } from './ai/profileStore';
import { useAnalysis } from './ai/useAnalysis';
import { plotAnalysis } from './ai/plotAnalysis';
import type { AnalysisResult } from './ai/types';
import './ai/ai.css';
import './terminal/chartPresentation.css';
import { periodOptions, type ChinaBoardMember, type ChinaBoardView, type DeskView, type HotspotRow, type NewsItem, type PeriodKey, type Quote } from './terminal/types';
import {
  formatClock,
  formatCompact,
  formatPrice,
  formatSigned,
  useHistoryPrefetch,
  useInstrumentData,
  useMarketOverview,
  useNewsFeed,
  useStockSearch,
} from './terminal/useTerminalData';

type IconName = 'overview' | 'markets' | 'news' | 'search' | 'plus' | 'remove' | 'arrow' | 'pulse' | 'expand' | 'wallet';

const navItems: Array<{ id: DeskView; label: string; icon: IconName }> = [
  { id: 'overview', label: '研究台', icon: 'overview' },
  { id: 'markets', label: '市场', icon: 'markets' },
  { id: 'news', label: '情报', icon: 'news' },
  { id: 'strategy', label: '策略', icon: 'pulse' },
  { id: 'simulation', label: '模拟', icon: 'wallet' },
];

const marketBenchmarks: Record<MarketType, WatchlistStock> = {
  CRYPTO: { ticker: 'BTCUSDT', name: 'Bitcoin / USDT', market: 'CRYPTO' },
  CN: { ticker: 'SH000001', name: '上证指数', market: 'CN' },
  US: { ticker: 'SPY', name: 'SPDR S&P 500 ETF Trust', market: 'US' },
};

const iconPaths: Record<IconName, ReactNode> = {
  overview: <><rect x="3" y="3" width="8" height="18" /><rect x="15" y="3" width="6" height="7" /><rect x="15" y="14" width="6" height="7" /></>,
  markets: <><path d="M3 17 8 12l4 3 8-10" /><path d="M16 5h4v4" /><path d="M3 21h18" /></>,
  news: <><path d="M5 4h14v16H5z" /><path d="M8 8h8M8 12h8M8 16h5" /></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  remove: <><path d="M5 7h14M9 7V4h6v3M8 7l1 13h6l1-13" /></>,
  arrow: <><path d="M5 12h14M14 7l5 5-5 5" /></>,
  wallet: <><path d="M4 6h15V4H5a2 2 0 0 0-2 2v13h18V8H5a2 2 0 0 1-2-2" /><path d="M16 11h5v5h-5z" /></>,
  pulse: <path d="M3 13h4l2-7 4 13 2-7h6" />,
  expand: <path d="M3 9V3h6m6 0h6v6m0 6v6h-6m-6 0H3v-6" />,
};

function Icon({ name }: { name: IconName }) {
  return <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">{iconPaths[name]}</svg>;
}

function Delta({ value, suffix = '%' }: { value: number; suffix?: string }) {
  return <span className={`delta ${changeTone(value)}`}>{formatSigned(value)}{Number.isFinite(value) ? suffix : ''}</span>;
}

function App() {
  usePortfolioRunner();
  useLanguage();
  const online = useOnlineStatus();
  const { watchlist, selectedTicker, addToWatchlist, removeFromWatchlist, selectStock } = useStockStore();
  const quotes = useStockQuoteStore((state) => state.quotes);
  const connectionStatus = useStockQuoteStore((state) => state.connectionStatus);
  const updateQuote = useStockQuoteStore((state) => state.updateStockQuote);
  const [navigation] = useState(() => new DeskNavigation(window.history, () => new URL(window.location.href), true));
  const [entryAtLoad] = useState(() => navigation.restore(window.history.state));
  const [route] = useState(() => readDeskRoute(new URLSearchParams(window.location.search)));
  const [view, setView] = useState<DeskView>(entryAtLoad?.location.view ?? route.view);
  const [market, setMarket] = useState<MarketType>(() =>
    entryAtLoad?.location.market ?? route.market ?? watchlist.find(stock => stock.ticker === selectedTicker)?.market ?? 'CRYPTO');
  const [chart, dispatchChart] = useReducer(chartSelection, initialChartSelection, () => entryAtLoad?.location.chart ?? applyLinkedChart(loadChartSelection(), route.chart));
  const initialChart = useRef(chart);
  const { period, mode: chartMode } = chart;
  const [searchQuery, setSearchQuery] = useState('');
  const [newsView, setNewsView] = useState(() => normalizeNewsView(entryAtLoad?.location.newsView));
  const [searchComposing, setSearchComposing] = useState(false);
  const [activeStory, setActiveStory] = useState<NewsItem | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<'ai' | 'help' | 'data'>('ai');
  const keyboardEnabled = useKeyboard(state => state.enabled);
  const openSettings = useCallback(() => { setSettingsSection('ai'); setSettingsOpen(true); }, []);
  const openBackup = useCallback(() => { setSettingsSection('data'); setSettingsOpen(true); }, []);
  const closeStory = useCallback(() => setActiveStory(null), []);
  const [immersive, setImmersive] = useState(entryAtLoad?.location.view === 'overview' && entryAtLoad.location.immersive);
  const [previewStock, setPreviewStock] = useState<WatchlistStock | null>(() => {
    if (entryAtLoad) return entryAtLoad.location.stock;
    if (!route.market) return null;
    const saved = route.ticker ? watchlist.find(stock => stock.ticker === route.ticker)
      : watchlist.find(stock => stock.ticker === selectedTicker && stock.market === route.market)
        ?? watchlist.find(stock => stock.market === route.market);
    if (saved) return saved.ticker === selectedTicker ? null : saved;
    return route.ticker ? { ticker: route.ticker, name: route.ticker, market: route.market } : marketBenchmarks[route.market];
  });
  const [boardView, setBoardView] = useState<ChinaBoardView>(entryAtLoad?.location.boardView ?? { category: 'industry', sort: 'strong', memberSort: 'strong', page: 1, query: '', selection: null });
  const [marketOrigin, setMarketOrigin] = useState<MarketOrigin | null>(entryAtLoad?.location.view === 'overview' ? entryAtLoad.location.marketOrigin : null);
  const returnToMarket = useRef<MarketOrigin | null>(entryAtLoad?.location.view === 'markets' ? entryAtLoad.location.marketOrigin : null);
  const [restoredEntry, setRestoredEntry] = useState<DeskEntry | null>(entryAtLoad);
  const pendingScroll = useRef<DeskEntry | null>(entryAtLoad);
  const restoringScroll = useRef(Boolean(entryAtLoad));
  const scrollLocation = useRef<string | null>(null);
  const [watchSort, setWatchSort] = useState(loadWatchSort);
  const [watchFilter, setWatchFilter] = useState<WatchlistFilter>({ query: '', market: 'ALL' });
  const [removedStocks, setRemovedStocks] = useState<Array<{ stock: WatchlistStock; index: number }>>([]);
  const undoableRemovals = removedStocks.filter(item => !watchlist.some(stock => stock.ticker === item.stock.ticker));
  const lastRemoved = undoableRemovals.at(-1);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const toggleImmersive = useCallback(() => {
    setImmersive(value => !value);
    window.scrollTo(0, 0);
  }, []);

  const selectedStock = previewStock ?? watchlist.find((stock) => stock.ticker === selectedTicker) ?? watchlist[0] ?? null;
  const selectedTickerSafe = selectedStock?.ticker ?? null;
  const activeQuoteTicker = view === 'overview' ? selectedTickerSafe : null;
  const routeMarket = (view === 'overview' ? selectedStock?.market : undefined) ?? market;
  const activePeriod = periodOptions.find((item) => item.key === period) ?? periodOptions[2];
  const interval = chartMode === 'candles' ? chart.candleInterval : activePeriod.interval;
  const historyPrefetch = useHistoryPrefetch();
  const cancelHistoryPrefetch = historyPrefetch.cancel;
  const storedQuote = selectedTickerSafe ? quotes[selectedTickerSafe] : undefined;
  const instrument = useInstrumentData(selectedTickerSafe, period, interval, chartMode === 'candles', view === 'overview',
    connectionStatus === 'connected', storedQuote?.streamConfirmedAt);
  const marketState = useMarketOverview(market, view === 'markets' || view === 'overview');
  const newsState = useNewsFeed(view === 'overview' || view === 'news', view === 'news' ? newsView.scope ?? 'ALL' : 'ALL');
  const search = useStockSearch(searchComposing ? '' : searchQuery, market);
  const response = instrument.quoteState.data;
  const quoteReceivedAt = instrument.quoteState.savedAt;
  const quoteFailedAt = instrument.quoteState.failedRequestAt;
  const httpQuote = useMemo(() => response ? toStoredQuote(response, quoteReceivedAt) : null, [response, quoteReceivedAt]);
  const liveQuote = httpQuote && httpQuote.snapshot !== storedQuote?.snapshot && !isOlderQuote(httpQuote, storedQuote)
    ? httpQuote : storedQuote;
  const displayedHistory = useMemo(() => liveDailyHistory(selectedTickerSafe, instrument.historyMeta, liveQuote),
    [selectedTickerSafe, instrument.historyMeta, liveQuote]);
  const quote = liveQuote?.snapshot ?? null;
  const price = liveQuote?.price ?? 0;
  const changePercent = liveQuote?.changePercent ?? 0;
  const previousClose = quote?.previous_close && quote.previous_close > 0 ? quote.previous_close
    : (changePercent !== -100 ? price / (1 + changePercent / 100) : price);
  const changeValue = price - previousClose;
  const dayOpen = quote?.open_price ?? 0;
  const dayHigh = quote?.high_price ?? 0;
  const dayLow = quote?.low_price ?? 0;

  const agedQuotes = useAgedWatchlistQuotes(watchlist, quotes, watchSort !== 'manual');
  const sortedWatchlist = useMemo(() => sortWatchlist(watchlist, quotes, watchSort, new Set(agedQuotes.split(','))),
    [watchlist, quotes, watchSort, agedQuotes]);
  const visibleWatchlist = useMemo(() => filterWatchlist(sortedWatchlist, quotes, watchFilter), [sortedWatchlist, quotes, watchFilter]);

  useEffect(() => {
    try { localStorage.setItem(watchSortKey, watchSort); } catch { /* In-memory sorting stays available. */ }
  }, [watchSort]);

  useEffect(() => {
    stockWebSocketService.connect();
    const unsubscribe = useStockStore.subscribe(() => stockWebSocketService.updateSubscriptions());
    return () => {
      unsubscribe();
      stockWebSocketService.disconnect();
    };
  }, []);

  useEffect(() => {
    stockWebSocketService.setActiveTicker(activeQuoteTicker);
  }, [activeQuoteTicker]);

  const previewTicker = previewStock?.ticker;
  useEffect(() => {
    if (!previewTicker) return;
    return () => {
      if (!useStockStore.getState().watchlist.some(stock => stock.ticker === previewTicker)) {
        useStockQuoteStore.getState().removeQuote(previewTicker);
      }
    };
  }, [previewTicker]);

  useLayoutEffect(() => {
    navigation.commit({ view, market: routeMarket, stock: selectedStock, chart, boardView, marketOrigin, immersive, newsView });
  }, [navigation, view, routeMarket, selectedStock, chart, boardView, marketOrigin, immersive, newsView]);

  useEffect(() => {
    const previousScrollRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    const scroll = () => { if (!restoringScroll.current) navigation.recordScroll(window.scrollY); };
    const flush = () => navigation.flush();
    const restore = (event: PopStateEvent) => {
      const entry = navigation.restore(event.state);
      const linked = readDeskRoute(new URLSearchParams(window.location.search));
      cancelHistoryPrefetch();
      setSearchQuery('');
      setSearchComposing(false);
      searchRef.current?.blur();
      setActiveStory(null);
      setSettingsOpen(false);
      if (entry) {
        const location = entry.location;
        setView(location.view);
        setMarket(location.market);
        setPreviewStock(location.stock);
        setBoardView(location.boardView);
        setNewsView(normalizeNewsView(location.newsView));
        setMarketOrigin(location.view === 'overview' ? location.marketOrigin : null);
        returnToMarket.current = location.view === 'markets' ? location.marketOrigin : null;
        setImmersive(location.immersive && location.view === 'overview');
        dispatchChart({ type: 'restore', selection: location.chart });
        restoringScroll.current = true;
        pendingScroll.current = entry;
        setRestoredEntry(entry);
      } else {
        // Old bookmarks / entries created before navigation support still follow their URL.
        const nextMarket = linked.market ?? 'CRYPTO';
        setView(linked.view);
        setNewsView(normalizeNewsView(null));
        setMarket(nextMarket);
        setPreviewStock(linked.ticker ? { ticker: linked.ticker, name: linked.ticker, market: nextMarket } : marketBenchmarks[nextMarket]);
        setMarketOrigin(null);
        returnToMarket.current = null;
        setImmersive(false);
        dispatchChart({ type: 'restore', selection: applyLinkedChart(loadChartSelection(), linked.chart) });
        restoringScroll.current = false;
        pendingScroll.current = null;
        setRestoredEntry(null);
      }
    };
    window.addEventListener('popstate', restore);
    window.addEventListener('scroll', scroll, { passive: true });
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('popstate', restore);
      window.removeEventListener('scroll', scroll);
      window.removeEventListener('pagehide', flush);
      window.history.scrollRestoration = previousScrollRestoration;
    };
  }, [navigation, cancelHistoryPrefetch]);

  useLayoutEffect(() => {
    const origin = view === 'markets' ? returnToMarket.current : null;
    const entry = pendingScroll.current;
    const savedScroll = entry?.location.view === view && entry.location.market === routeMarket &&
      (view !== 'overview' || entry.location.stock?.ticker === activeQuoteTicker) ? entry.scroll : null;
    const location = `${view}:${routeMarket}:${activeQuoteTicker ?? ''}`;
    if (!origin && savedScroll === null) {
      pendingScroll.current = null;
      restoringScroll.current = false;
      if (scrollLocation.current !== location) window.scrollTo(0, 0);
      scrollLocation.current = location;
      return;
    }
    scrollLocation.current = location;
    restoringScroll.current = true;
    const markets = document.querySelector('.content-canvas');
    const restore = () => {
      pendingScroll.current = null;
      returnToMarket.current = null;
      const anchor = origin ? document.getElementById(origin.anchorId) : null;
      if (anchor && origin) {
        anchor.focus({ preventScroll: true });
        window.scrollBy(0, anchor.getBoundingClientRect().top - origin.top);
      } else if (origin?.fromBoard) document.getElementById('cn-board-focus')?.scrollIntoView({ block: 'start' });
      else window.scrollTo(0, origin?.scroll ?? savedScroll ?? 0);
      navigation.recordScroll(window.scrollY);
      restoringScroll.current = false;
    };
    const isLoading = () => markets?.matches('[aria-busy="true"]') || markets?.querySelector('[aria-busy="true"]');
    if (!markets || !isLoading()) { restore(); return; }
    const cancel = () => {
      restoringScroll.current = false;
      observer.disconnect();
      clearTimeout(timeout);
      window.removeEventListener('pointerdown', cancelByUser);
      window.removeEventListener('wheel', cancelByUser);
      window.removeEventListener('keydown', cancelByUser);
    };
    const cancelByUser = () => {
      pendingScroll.current = null;
      returnToMarket.current = null;
      cancel();
    };
    const observer = new MutationObserver(() => {
      if (isLoading()) return;
      cancel();
      restore();
    });
    const timeout = setTimeout(() => { cancel(); restore(); }, 20000);
    observer.observe(markets, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-busy'] });
    window.addEventListener('pointerdown', cancelByUser);
    window.addEventListener('wheel', cancelByUser, { passive: true });
    window.addEventListener('keydown', cancelByUser);
    return cancel;
  }, [view, routeMarket, activeQuoteTicker, restoredEntry, navigation]);

  useEffect(() => {
    if (!route.chart || chart !== initialChart.current) saveChartSelection(chart);
  }, [chart, route.chart]);

  useEffect(() => {
    if (view !== 'overview') return;
    const store = useStockQuoteStore.getState();
    if (response && httpQuote && store.quotes[response.ticker]?.snapshot !== response) updateQuote(response.ticker, httpQuote);
    if (quoteFailedAt !== undefined && selectedTickerSafe && !instrument.streamHealthy) {
      store.markQuoteStale(selectedTickerSafe, quoteFailedAt);
    }
  }, [response, httpQuote, updateQuote, view, quoteFailedAt, selectedTickerSafe, instrument.streamHealthy]);

  const changeMarket = (next: MarketType) => {
    historyPrefetch.cancel();
    setMarket(next);
    setSearchQuery('');
    if (selectedStock?.market !== next) {
      const stock = watchlist.find(item => item.market === next);
      setMarketOrigin(null);
      if (stock) {
        setPreviewStock(null);
        selectStock(stock.ticker);
      } else setPreviewStock(marketBenchmarks[next]);
    }
  };

  useEffect(() => {
    const handleKeyboard = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.isComposing || document.querySelector('dialog[open]')) return;
      if (event.defaultPrevented) return;
      const typing = Boolean(target?.closest('input, textarea, select, [role="combobox"]') || target?.isContentEditable);
      if (event.key === 'Escape' && target === searchRef.current) {
        setSearchQuery('');
        searchRef.current?.blur();
        return;
      }
      if (event.key === 'Escape' && typing) return;
      const chartOverlay = document.querySelector('.professional-chart.is-expanded, .indicator-menu, .professional-overflow-menu, .professional-level-editor, .professional-level-list');
      if (event.key === 'Escape' && immersive && !chartOverlay) {
        toggleImmersive();
        return;
      }
      if (chartOverlay) return;
      if (event.key === 'Escape') {
        setSearchQuery('');
        searchRef.current?.blur();
        return;
      }
      if (typing || !keyboardEnabled || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === '?') {
        event.preventDefault();
        setSettingsSection('help');
        setSettingsOpen(true);
        return;
      }
      if (event.key.toLowerCase() === 'f' && !event.repeat && view === 'overview' && selectedTickerSafe) {
        event.preventDefault();
        toggleImmersive();
      }
      if (event.key === '/' && !immersive) {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === '1') setView('overview');
      if (event.key === '2') { setImmersive(false); setView('markets'); }
      if (event.key === '3') { setImmersive(false); setView('news'); }
      if (event.key === '4') { setImmersive(false); setView('strategy'); }
      if (event.key === '5') { setImmersive(false); setView('simulation'); }
      if ((event.key.toLowerCase() === 'j' || event.key.toLowerCase() === 'k') && visibleWatchlist.length) {
        event.preventDefault();
        const current = visibleWatchlist.findIndex((item) => item.ticker === selectedTickerSafe);
        const offset = event.key.toLowerCase() === 'j' ? 1 : -1;
        const index = current < 0 ? (offset > 0 ? 0 : visibleWatchlist.length - 1)
          : (current + offset + visibleWatchlist.length) % visibleWatchlist.length;
        const stock = visibleWatchlist[index];
        setPreviewStock(null);
        selectStock(stock.ticker);
        setMarketOrigin(null);
        setMarket(stock.market);
        setSearchQuery('');
        setView('overview');
      }
    };
    window.addEventListener('keydown', handleKeyboard);
    return () => window.removeEventListener('keydown', handleKeyboard);
  }, [immersive, keyboardEnabled, selectStock, selectedTickerSafe, visibleWatchlist, toggleImmersive, view]);

  const openInstrument = (stock: WatchlistStock, seed?: StockQuote) => {
    historyPrefetch.cancel();
    if (seed) useStockQuoteStore.getState().seedQuote(stock.ticker, seed);
    if (watchlist.some(item => item.ticker === stock.ticker)) {
      selectStock(stock.ticker);
      setPreviewStock(null);
    } else {
      setPreviewStock(stock);
    }
    setMarketOrigin(null);
    setMarket(stock.market);
    setSearchQuery('');
    searchRef.current?.blur();
    setView('overview');
  };

  const addPreviewToWatchlist = () => {
    if (!previewStock) return;
    addToWatchlist({ ...previewStock, name: quote?.name || previewStock.name, price, changePercent, volume: liveQuote?.volume ?? 0 });
    selectStock(previewStock.ticker);
    setPreviewStock(null);
  };

  const selectMarketRow = (row: ChinaBoardMember, anchor: HTMLButtonElement, fromBoard = false) => {
    const origin = view === 'markets' ? {
      ticker: row.ticker, market, anchorId: anchor.id, top: anchor.getBoundingClientRect().top, scroll: window.scrollY, fromBoard,
    } : null;
    openInstrument({ ticker: row.ticker, name: row.name, market }, row.price !== null && row.change_percent !== null && row.volume !== null ? {
      price: row.price, changePercent: row.change_percent, volume: row.volume,
    } : undefined);
    if (origin) setMarketOrigin(origin);
  };

  const backToMarket = () => {
    if (!marketOrigin) return;
    if (navigation.canReturnToMarket(marketOrigin)) { window.history.back(); return; }
    returnToMarket.current = marketOrigin;
    setMarketOrigin(null);
    setImmersive(false);
    setMarket(marketOrigin.market);
    setView('markets');
  };

  const openStory = useCallback((item: NewsItem) => {
    markNewsRead(item);
    setActiveStory(item);
  }, []);

  return (
    <div className={`app-shell${immersive ? ' is-immersive' : ''}`}>
      <a className="skip-link" href="#main-content" onClick={event => {
        event.preventDefault();
        const main = document.getElementById('main-content');
        main?.focus({ preventScroll: true });
        main?.scrollIntoView({ block: 'start', behavior: 'instant' });
      }}>{t('跳到主内容')}</a>
      <WatchlistQuoteFallback watchlist={watchlist} activeTicker={activeQuoteTicker} connected={connectionStatus === 'connected'} />
      <Sidebar
        view={view}
        setView={setView}
        watchlist={visibleWatchlist}
        totalStocks={watchlist.length}
        filter={watchFilter}
        setFilter={setWatchFilter}
        selectedTicker={selectedTickerSafe}
        quotes={quotes}
        connectionStatus={connectionStatus}
        online={online}
        watchSort={watchSort}
        setWatchSort={setWatchSort}
        previewHistory={ticker => {
          if (ticker !== selectedTickerSafe || view !== 'overview') historyPrefetch.schedule(ticker, period, interval, chartMode === 'candles');
        }}
        cancelHistoryPreview={historyPrefetch.cancel}
        onSearch={() => searchRef.current?.focus()}
        onBackup={openBackup}
        removedTicker={lastRemoved?.stock.ticker ?? null}
        undoRemoval={() => {
          if (!lastRemoved) return;
          useStockStore.getState().restoreToWatchlist(lastRemoved.stock, lastRemoved.index);
          setRemovedStocks(undoableRemovals.slice(0, -1));
        }}
        dismissRemoval={() => setRemovedStocks([])}
        selectStock={(stock) => {
          setPreviewStock(null);
          selectStock(stock.ticker);
          setMarketOrigin(null);
          setMarket(stock.market);
          setSearchQuery('');
          setView('overview');
        }}
        removeFromWatchlist={ticker => {
          const index = watchlist.findIndex(stock => stock.ticker === ticker);
          if (index < 0) return;
          setRemovedStocks([...undoableRemovals, { stock: watchlist[index], index }]);
          const keepOpen = selectedStock?.ticker === ticker;
          const currentQuote = useStockQuoteStore.getState().quotes[ticker];
          if (keepOpen) setPreviewStock(selectedStock);
          removeFromWatchlist(ticker);
          // A list removal keeps the active chart subscribed, including its newest streamed quote.
          if (keepOpen && currentQuote) updateQuote(ticker, currentQuote);
        }}
      />

      <div className="app-main">
        <Topbar
          market={market}
          setMarket={changeMarket}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          searchComposing={searchComposing}
          setSearchComposing={setSearchComposing}
          searchRef={searchRef}
          search={search}
          onSelect={(ticker, name) => openInstrument({ ticker, name, market })}
          onSettings={openSettings}
        />

        <main id="main-content" className="content-canvas" tabIndex={-1} aria-busy={view === 'overview' ? instrument.historyState.loading && !displayedHistory?.data.length
          : view === 'news' ? newsState.loading && !newsState.data : view === 'markets' && marketState.loading && !marketState.data}>
          {(!online || connectionStatus === 'disconnected') && <div className="connection-banner" data-online={online} role="status">{t(online ? '行情重连中' : '当前离线')}</div>}
          {view === 'overview' && (
            <Overview
              shortcutsEnabled={keyboardEnabled}
              immersive={immersive}
              onToggleImmersive={toggleImmersive}
              selectedStock={selectedStock}
              price={price}
              changeValue={changeValue}
              changePercent={changePercent}
              dayOpen={dayOpen}
              dayHigh={dayHigh}
              dayLow={dayLow}
              volume={quote?.volume ?? liveQuote?.volume ?? 0}
              amount={quote?.amount ?? null}
              turnoverRate={quote?.turnover_rate ?? null}
              quoteDetails={quote}
              period={period}
              setPeriod={period => dispatchChart({ type: 'period', period })}
              previewPeriod={item => {
                if (selectedTickerSafe && item.key !== period) {
                  historyPrefetch.schedule(selectedTickerSafe, item.key, chartMode === 'candles' ? interval : item.interval, chartMode === 'candles');
                }
              }}
              cancelHistoryPreview={historyPrefetch.cancel}
              chartMode={chartMode}
              setChartMode={mode => dispatchChart({ type: 'mode', mode })}
              candleInterval={chart.candleInterval}
              setCandleInterval={interval => dispatchChart({ type: 'interval', interval })}
              interval={interval}
              onSettings={openSettings}
              history={displayedHistory?.data ?? []}
              indicatorHistory={instrument.indicatorHistory}
              historyLoading={instrument.historyState.loading}
              quoteError={instrument.quoteState.error}
              quoteRetry={instrument.quoteState.retry}
              quoteLoading={instrument.quoteState.loading}
              historyError={instrument.historyState.error}
              historyRetry={instrument.historyState.retry}
              historyStale={displayedHistory?.stale ?? instrument.historyStale}
              historyMeta={displayedHistory}
              source={liveQuote?.source ?? quote?.source ?? null}
              asOf={liveQuote?.asOf ?? quote?.as_of ?? null}
              liveQuote={liveQuote}
              marketData={marketState.data}
              marketLoading={marketState.loading}
              news={newsState.data?.items ?? []}
              newsLoading={newsState.loading}
              newsError={newsState.error}
              newsRetry={newsState.retry}
              newsStale={newsState.data?.stale ?? false}
              onOpenStory={openStory}
              onSelectMarket={selectMarketRow}
              openMarkets={() => setView('markets')}
              openNews={() => setView('news')}
              marketBack={marketOrigin && marketOrigin.ticker === selectedTickerSafe ? { fromBoard: marketOrigin.fromBoard, onBack: backToMarket } : undefined}
              onAddToWatchlist={previewStock && !watchlist.some(stock => stock.ticker === previewTicker) ? addPreviewToWatchlist : undefined}
            />
          )}
          {view === 'markets' && (
            <Markets
              market={market}
              setMarket={changeMarket}
              data={marketState.data}
              loading={marketState.loading}
              error={marketState.error}
              onRetry={marketState.retry}
              onSelect={selectMarketRow}
              prefetch={ticker => historyPrefetch.schedule(ticker, period, interval, chartMode === 'candles')}
              cancelPrefetch={historyPrefetch.cancel}
              boardView={boardView}
              onBoardViewChange={setBoardView}
            />
          )}
          {view === 'simulation' && <SimulationView stock={selectedStock} watchlist={watchlist} onStrategy={() => setView('strategy')} onSettings={openSettings} />}
          {view === 'strategy' && <StrategyLab stock={selectedStock} watchlist={watchlist} onSettings={openSettings} onSimulation={() => setView('simulation')} />}
          {view === 'news' && (
            <NewsDesk feed={newsState.data} loading={newsState.loading} error={newsState.error} onRetry={newsState.retry} onOpenStory={openStory} onOpenTicker={ticker=>openInstrument(watchlist.find(s=>s.ticker===ticker)??{ticker,name:ticker.replace(/USDT$/,'')+' / USDT',market:'CRYPTO'})} onSettings={openSettings} filters={newsView} onFiltersChange={setNewsView} />
          )}
        </main>
      </div>
      {!immersive && <BackToTop />}
      {activeStory && <NewsDialog item={activeStory} onClose={closeStory} onOpenTicker={ticker=>{setActiveStory(null);openInstrument(watchlist.find(s=>s.ticker===ticker)??{ticker,name:ticker.replace(/USDT$/,'')+' / USDT',market:'CRYPTO'});}} />}
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} initialSection={settingsSection} />}
    </div>
  );
}

type SidebarProps = {
  online: boolean;
  totalStocks: number;
  filter: WatchlistFilter;
  setFilter: (filter: WatchlistFilter) => void;
  view: DeskView;
  setView: (view: DeskView) => void;
  watchlist: Array<{ ticker: string; name: string; market: MarketType }>;
  selectedTicker: string | null;
  quotes: Record<string, StockQuote>;
  connectionStatus: 'connecting' | 'connected' | 'disconnected';
  watchSort: WatchSort;
  setWatchSort: (sort: WatchSort) => void;
  previewHistory: (ticker: string) => void;
  cancelHistoryPreview: () => void;
  selectStock: (stock: SidebarProps['watchlist'][number]) => void;
  removeFromWatchlist: (ticker: string) => void;
  onSearch: () => void;
  onBackup: () => void;
  removedTicker: string | null;
  undoRemoval: () => void;
  dismissRemoval: () => void;
};

function Sidebar(props: SidebarProps) {
  const storageIssue = useWatchlistStorage(state => state.issue);
  const watchItems = useRef<HTMLDivElement>(null);
  const byChange = props.watchSort !== 'manual';
  const risingFirst = props.watchSort === 'change-desc';
  const hasSelectedWatchItem = props.watchlist.some(stock => stock.ticker === props.selectedTicker);
  useEffect(() => {
    if (!hasSelectedWatchItem) return;
    const list = watchItems.current;
    const selected = list?.querySelector('.watch-item.active');
    if (!list || !selected) return;
    const bounds = list.getBoundingClientRect();
    const card = selected.getBoundingClientRect();
    if (card.left < bounds.left) list.scrollLeft += card.left - bounds.left;
    else if (card.right > bounds.right) list.scrollLeft += card.right - bounds.right;
    if (card.top < bounds.top) list.scrollTop += card.top - bounds.top;
    else if (card.bottom > bounds.bottom) list.scrollTop += card.bottom - bounds.bottom;
  }, [props.selectedTicker, props.watchSort, hasSelectedWatchItem, props.filter.query, props.filter.market]);

  return (
    <aside className="sidebar">
      <button type="button" className="brand" onClick={() => props.setView('overview')}>
        <span className="brand-mark"><img src="/zpboard.png" alt="" /></span>
        <span><strong>ZPBOARD</strong></span>
      </button>

      <nav className="primary-nav" aria-label={t("主导航")}>
        {navItems.map((item) => (
          <button key={item.id} type="button" className={props.view === item.id ? 'active' : ''} aria-current={props.view === item.id ? 'page' : undefined} onClick={() => props.setView(item.id)}>
            <Icon name={item.icon} />
            <span><strong>{t(item.label)}</strong></span>
          </button>
        ))}
      </nav>

      <section className="watchlist">
        <header>
          <div><strong>{t("自选")}</strong></div>
          <div className="watch-sort">
            <button type="button" className={!byChange ? 'active' : ''} aria-pressed={!byChange} onClick={() => props.setWatchSort('manual')}>{t("默认")}</button>
            <button type="button" className={byChange ? 'active' : ''} aria-pressed={byChange}
              aria-label={t(byChange ? (risingFirst ? '涨跌幅从高到低' : '涨跌幅从低到高') : '按涨跌幅排序')}
              onClick={() => props.setWatchSort(risingFirst ? 'change-asc' : 'change-desc')}>
              {t("涨幅")}{byChange && <span aria-hidden="true"> {risingFirst ? '↓' : '↑'}</span>}
            </button>
          </div>
        </header>
        <div className="watch-filters">
          <div className="watch-filter-query">
            <input type="search" aria-label={t('筛选自选股')} placeholder={t('代码或名称')} maxLength={100} value={props.filter.query}
              onChange={event => props.setFilter({ ...props.filter, query: event.target.value })} autoComplete="off" spellCheck={false} />
          </div>
          <select aria-label={t('自选市场')} value={props.filter.market} onChange={event => props.setFilter({ ...props.filter, market: event.target.value as WatchlistFilter['market'] })}>
            <option value="ALL">USDT现货</option>
          </select>
        </div>
        <div className="watch-filter-meta">
          <small role="status">{t('{visible} / {total} 只', { visible: props.watchlist.length, total: props.totalStocks })}</small>
          {(props.filter.query || props.filter.market !== 'ALL') && <button type="button" onClick={() => props.setFilter({ query: '', market: 'ALL' })}>{t('清除自选筛选')}</button>}
        </div>
        {storageIssue && <div className="watch-storage-notice">
          <p role="status">{t(storageIssue === 'write' ? '自选更改暂未保存，刷新前可导出备份。' : '无法读取保存的自选，可在此导入备份。')}</p>
          <button type="button" onClick={props.onBackup}>{t('自选备份')}</button>
        </div>}
        <div className="watch-items" ref={watchItems}>
          {!props.watchlist.length && props.totalStocks > 0 && <div className="watch-empty"><p>{t('没有匹配的自选股')}</p></div>}
          {!props.totalStocks && <div className="watch-empty">
            <p>{t("暂无自选股")}</p>
            <button type="button" onClick={props.onSearch}>{t("搜索并添加股票")} <Icon name="plus" /></button>
          </div>}
          {props.watchlist.map((stock) => {
            const quote = props.quotes[stock.ticker];
            const name = quote?.snapshot?.name || stock.name;
            const amount = quote?.snapshot?.amount;
            const turnover = quote?.snapshot?.turnover_rate;
            return (
              <div key={stock.ticker} className={`watch-item${props.selectedTicker === stock.ticker ? ' active' : ''}`}>
                <button type="button" className="watch-select" aria-pressed={props.selectedTicker === stock.ticker}
                  onPointerEnter={event => { if (event.pointerType === 'mouse') props.previewHistory(stock.ticker); }}
                  onPointerLeave={props.cancelHistoryPreview} onClick={() => { props.cancelHistoryPreview(); props.selectStock(stock); }}>
                  <span className="watch-name"><strong>{stock.ticker}</strong><small title={name}>{isChinaIndex(stock.ticker) ? t(name) : name}</small></span>
                  <span className="watch-value"><strong>{quote ? formatPrice(quote.price, stock.market, stock.ticker) : '--'}</strong>
                    {quote ? <Delta value={quote.changePercent} /> : <small>{t("等待报价")}</small>}
                    {quote && <QuoteFreshnessBadge ticker={stock.ticker} quote={quote} />}
                  </span>
                  {stock.market === 'CN' && <span className="watch-context">
                    <StockTags ticker={stock.ticker} name={name} variant="watch" />
                    {amount != null && amount > 0 ? <small title={t("成交额")}>¥{formatCompact(amount)}</small>
                      : turnover != null ? <small title={t("换手率")}>{turnover.toFixed(2)}%</small> : null}
                  </span>}
                </button>
                <button className="watch-remove" type="button" onClick={() => props.removeFromWatchlist(stock.ticker)} aria-label={t("移除 {ticker}", { ticker: stock.ticker })}><Icon name="remove" /></button>
              </div>
            );
          })}
        </div>
        {props.removedTicker && <div className="watch-undo">
          <span role="status" key={props.removedTicker}>{t("已移除 {ticker}", { ticker: props.removedTicker })}</span>
          <button type="button" onClick={props.undoRemoval}>{t("撤销移除")}</button>
          <button type="button" className="watch-undo-dismiss" aria-label={t("关闭移除提示")} onClick={props.dismissRemoval}>×</button>
        </div>}
      </section>

      <footer className="sidebar-footer">
        <span data-status={props.connectionStatus} data-online={props.online}><i /> {!props.online ? t('离线') : props.connectionStatus === 'connected' ? t("已连接") : props.connectionStatus === 'connecting' ? t("连接中") : t("重新连接中")}</span>
      </footer>
    </aside>
  );
}

type TopbarProps = {
  onSettings: () => void;
  market: MarketType;
  setMarket: (market: MarketType) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  searchComposing: boolean;
  setSearchComposing: (composing: boolean) => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
  search: { results: Array<{ ticker: string; name: string }>; loading: boolean; error: string | null; retry: () => void };
  onSelect: (ticker: string, name: string) => void;
};

function Topbar({ searchRef, ...props }: TopbarProps) {
  const online = useOnlineStatus();
  const [selection, setSelection] = useState({ key: '', index: 0 });
  const resultsRef = useRef<HTMLDivElement>(null);
  const searchKey = `${props.market}:${props.searchQuery}`;
  const searchOpen = !props.searchComposing && Boolean(props.searchQuery.trim());
  const activeIndex = selection.key === searchKey ? Math.min(selection.index, Math.max(props.search.results.length - 1, 0)) : 0;
  const moveSelection = (index: number) => {
    setSelection({ key: searchKey, index });
    const popup = resultsRef.current;
    const option = document.getElementById(`stock-option-${index}`);
    if (!popup || !option) return;
    const bounds = option.getBoundingClientRect();
    const top = popup.getBoundingClientRect().top + popup.clientTop;
    const bottom = top + popup.clientHeight;
    if (bounds.top < top) popup.scrollTop += bounds.top - top;
    else if (bounds.bottom > bottom) popup.scrollTop += bounds.bottom - bottom;
  };
  return (
    <header className="topbar">
      <div className="market-context">
        <div role="group" aria-label={t("市场")}>
          <button type="button" className="active" aria-pressed="true" onClick={() => props.setMarket('CRYPTO')}>虚拟币</button>
        </div>
      </div>

      <div className="command-search" onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          props.setSearchComposing(false);
          props.setSearchQuery('');
        }
      }}>
        <Icon name="search" />
        <input
          ref={searchRef}
          value={props.searchQuery}
          onChange={(event) => props.setSearchQuery(event.target.value)}
          onCompositionStart={() => props.setSearchComposing(true)}
          onCompositionEnd={event => {
            props.setSearchQuery(event.currentTarget.value);
            props.setSearchComposing(false);
          }}
          placeholder={t("搜索币种 / USDT交易对")}
          aria-label={t("搜索币种 / USDT交易对")}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={searchOpen}
          aria-controls={searchOpen ? 'stock-search-results' : undefined}
          aria-activedescendant={searchOpen && props.search.results[activeIndex] ? `stock-option-${activeIndex}` : undefined}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="search"
          maxLength={100}
          onKeyDown={(event) => {
            if (props.searchComposing || event.nativeEvent.isComposing || event.keyCode === 229) {
              event.stopPropagation();
              return;
            }
            if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && props.search.results.length) {
              event.preventDefault();
              const offset = event.key === 'ArrowDown' ? 1 : -1;
              moveSelection((activeIndex + offset + props.search.results.length) % props.search.results.length);
            }
            if (event.key === 'Enter' && props.search.results[activeIndex]) {
              event.preventDefault();
              const result = props.search.results[activeIndex];
              props.onSelect(result.ticker, result.name);
            }
          }}
        />
        {props.searchQuery && !props.searchComposing && <button type="button" className="search-clear" aria-label={t("清空搜索")}
          onClick={() => {
            props.setSearchQuery('');
            searchRef.current?.focus();
          }}>×</button>}
        {searchOpen && (
          <div ref={resultsRef} className="search-results">
            <header><span>{t("搜索结果")}</span><small>{props.search.loading ? t("正在检索") : t("{count} 个结果", { count: props.search.results.length })}</small></header>
            <div id="stock-search-results" className="search-options" role="listbox" aria-label={t("股票搜索结果")}>
            {props.search.results.map((result, index) => (
              <button id={`stock-option-${index}`} key={result.ticker} role="option" aria-selected={activeIndex === index} type="button" tabIndex={-1}
                onMouseDown={event => event.preventDefault()} onMouseMove={() => { if (activeIndex !== index) setSelection({ key: searchKey, index }); }}
                onClick={() => props.onSelect(result.ticker, result.name)}>
                <span><strong>{result.ticker}</strong><small>{isChinaIndex(result.ticker) ? t(result.name) : result.name} <StockTags ticker={result.ticker} name={result.name} /></small></span>
                <Icon name="arrow" />
              </button>
            ))}
            </div>
            {props.search.loading && <p role="status">{t("正在检索")}</p>}
            {props.search.error && <div className="search-feedback"><p role="status">{t(props.search.error)}</p>
              <button type="button" disabled={!online} onClick={() => { props.search.retry(); searchRef.current?.focus(); }}>{t(online ? "重新搜索" : '等待网络')}</button></div>}
            {!props.search.loading && !props.search.error && !props.search.results.length && <p role="status">{t("没有找到匹配标的")}</p>}
          </div>
        )}
      </div>
      <button type="button" className="settings-trigger" onClick={props.onSettings}>{t("设置")}</button>
    </header>
  );
}

type OverviewProps = {
  shortcutsEnabled: boolean;
  onSettings: () => void;
  immersive: boolean;
  onToggleImmersive: () => void;
  interval: string;
  selectedStock: { ticker: string; name: string; market: MarketType } | null;
  price: number;
  changeValue: number;
  changePercent: number;
  dayOpen: number;
  dayHigh: number;
  dayLow: number;
  volume: number;
  amount: number | null;
  turnoverRate: number | null;
  quoteDetails: Quote | null;
  period: PeriodKey;
  setPeriod: (period: PeriodKey) => void;
  previewPeriod: (item: (typeof periodOptions)[number]) => void;
  cancelHistoryPreview: () => void;
  chartMode: ChartMode;
  setChartMode: (mode: ChartMode) => void;
  candleInterval: CandleInterval;
  setCandleInterval: (interval: CandleInterval) => void;
  history: Parameters<typeof MarketChart>[0]['data'];
  indicatorHistory: Parameters<typeof MarketChart>[0]['data'];
  historyLoading: boolean;
  quoteError: string | null;
  quoteRetry: () => void;
  quoteLoading: boolean;
  historyError: string | null;
  historyRetry: () => void;
  historyStale: boolean;
  historyMeta: ReturnType<typeof useInstrumentData>['historyMeta'];
  source: string | null;
  asOf: string | null;
  liveQuote?: StockQuote;
  marketData: ReturnType<typeof useMarketOverview>['data'];
  marketLoading: boolean;
  news: NewsItem[];
  newsLoading: boolean;
  newsError: string | null;
  newsRetry: () => void;
  newsStale: boolean;
  onOpenStory: (item: NewsItem) => void;
  onSelectMarket: (row: HotspotRow, anchor: HTMLButtonElement) => void;
  openMarkets: () => void;
  openNews: () => void;
  marketBack?: { fromBoard: boolean; onBack: () => void };
  onAddToWatchlist?: () => void;
};

function Overview(props: OverviewProps) {
  const { chartMode, setChartMode } = props;
  const intraday = props.period === '1d' || props.period === '5d';
  const visiblePeriods = periodOptions.filter(item => chartMode === 'line' || candlePeriodAllowed(props.candleInterval, item.key));
  const { profiles, activeId } = useAiProfiles();
  const profile = profiles.find(p => p.id === activeId);
  const analysis = useAnalysis(`chart:${props.selectedStock?.ticker}:${props.period}:${props.interval}:${chartMode}`, profile);
  const [selection, setSelection] = useState<{ result: AnalysisResult; id: string } | null>(null);
  const selectedAnnotation = selection?.result === analysis.result ? selection?.id : undefined;
  const selectAnnotation = useCallback((id: string) => {
    if (analysis.result) setSelection({ result: analysis.result, id });
  }, [analysis.result]);
  const chartData = props.history.length > 0 ? props.history : analysis.result?.data ?? props.history;
  const { chartAnnotations, trendlines } = useMemo(() => plotAnalysis(analysis.result, chartData, props.historyMeta), [analysis.result, chartData, props.historyMeta]);
  const plottedPoints = useMemo(() => new Set(chartAnnotations.map(point => point.id)), [chartAnnotations]);
  if (!props.selectedStock) {
    return <section className="empty-state"><h1>{t("暂无自选股")}</h1><p>{t("搜索并添加股票")}</p></section>;
  }

  const stock = props.selectedStock;
  const stockName = props.quoteDetails?.name || stock.name;
  const tone = changeTone(props.changePercent);
  const digits = pricePrecision(stock.ticker, props.price);
  const runChartAnalysis = () => analysis.run({
    scope: 'chart', ticker: stock.ticker, market: stock.market, period: props.period, interval: props.interval, chart_type: chartMode,
    chart_history: props.history.length >= 2 ? {
      data: props.history, source: props.historyMeta?.source, price_type: props.historyMeta?.price_type,
      adjustment: props.historyMeta?.adjustment, stale: props.historyStale,
      indicators: analysisIndicatorValues(props.history, props.indicatorHistory,
        (!intraday || chartMode === 'candles') && props.historyMeta?.price_type !== 'snapshot'),
    } : undefined,
  });

  return (
    <div className="overview">
      <header className="instrument-hero">
        <div className="instrument-title">
          {props.marketBack && <button type="button" className="board-back" onClick={props.marketBack.onBack}><Icon name="arrow" />{t(props.marketBack.fromBoard ? '返回板块' : '返回市场')}</button>}
          <h1>{isChinaIndex(stock.ticker) ? t(stockName) : stockName}</h1>
          <div>
            <strong>{stock.ticker}</strong>{stock.market === 'CRYPTO' && <small className="quote-tag">USDT · 现货 · 24h</small>}<StockTags key={stock.ticker} ticker={stock.ticker} name={stockName} variant="detail" />
            <MarketClock ticker={stock.ticker} asOf={props.asOf} source={props.source} />
            {stock.market === 'US' && <small className="quote-tag">{t("延时")}</small>}
            <QuoteFreshnessBadge ticker={stock.ticker} quote={props.liveQuote} />
            {props.onAddToWatchlist && <button type="button" className="watch-add" onClick={props.onAddToWatchlist}><Icon name="plus" />{t('加入自选')}</button>}
          </div>
        </div>
        <div className="hero-quote">
          <strong>{props.price > 0 ? formatPrice(props.price, stock.market, stock.ticker) : '--'}</strong>
          {props.price > 0 && <div className={tone}><span>{formatSigned(props.changeValue, digits)}</span><span>{formatSigned(props.changePercent)}%</span></div>}
        </div>
      </header>

      {props.price <= 0 && <ResourceError error={props.quoteError} loading={props.quoteLoading} onRetry={props.quoteRetry} label="重试行情" />}

      <div className="overview-layout">
        <section className="chart-card surface">
          <header className="section-header chart-header">
            <div className="chart-heading">
              <h2>{t("走势")}</h2>
              {props.historyStale && <small className="quote-tag">{t("缓存")}</small>}
              {trendlines.length > 0 && (
                <div className="chart-trend-keys" role="group" aria-label={t("AI 趋势线")}>
                  {trendlines.map(line => (
                    <button key={line.id} className={line.kind} type="button" aria-pressed={line.id === selectedAnnotation}
                      title={`${line.start.price.toFixed(digits)} → ${line.end.price.toFixed(digits)}`} onClick={() => selectAnnotation(line.id)}>
                      <span aria-hidden="true">{line.start.price < line.end.price ? '↗' : '↘'}</span>{line.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="chart-controls">
              <div className="chart-type-controls">
                <div className="chart-mode" role="group" aria-label={t("图表类型")}>
                  <button type="button" aria-pressed={chartMode === 'line'} onClick={() => setChartMode('line')}>{t("折线")}</button>
                  <button type="button" aria-pressed={chartMode === 'candles'} onClick={() => setChartMode('candles')}>{t("K线")}</button>
                </div>
                {chartMode === 'candles' && (
                  <select className="candle-interval" aria-label={t('K线周期')} value={props.candleInterval} onChange={event => props.setCandleInterval(event.target.value as CandleInterval)}>
                    {candleIntervals.map(item => <option key={item.value} value={item.value}>{t(item.label)}</option>)}
                  </select>
                )}
              </div>
              <div className="chart-actions">
                <IndicatorPicker intraday={intraday && chartMode === 'line'} />
                <AiControls profile={profile} loading={analysis.loading} onSettings={props.onSettings}
                  onRun={runChartAnalysis}
                  onCancel={analysis.cancel} onClear={analysis.clear} hasResult={Boolean(analysis.result)} />
                <button type="button" className="immersive-trigger" title={`${t(props.immersive ? "退出沉浸" : "沉浸看盘")}${props.shortcutsEnabled ? ' (F)' : ''}`} aria-keyshortcuts={props.shortcutsEnabled ? 'F' : undefined} aria-pressed={props.immersive}
                  onClick={props.onToggleImmersive}><Icon name="expand" />{t(props.immersive ? "退出沉浸" : "沉浸看盘")}</button>
              </div>
              <div className={`period-tabs${visiblePeriods.length === 1 ? ' is-single' : ''}`} role="group" aria-label={t('时间范围')}>
                {visiblePeriods.length === 1 ? <span className="chart-fixed-range">{t('1日')}</span> : visiblePeriods.map(item => (
                  <button key={item.key} type="button" className={props.period === item.key ? 'active' : ''} aria-pressed={props.period === item.key}
                    onPointerEnter={event => { if (event.pointerType === 'mouse') props.previewPeriod(item); }}
                    onPointerLeave={props.cancelHistoryPreview} onClick={() => { props.cancelHistoryPreview(); props.setPeriod(item.key); }}>
                    {t(chartMode === 'candles' && item.key === '1d' ? '1日' : item.label)}
                  </button>
                ))}
              </div>
            </div>
          </header>
          {analysis.error && <div className="error-banner" role="status">{t(analysis.error)}</div>}
          <ResourceError error={props.historyError} loading={props.historyLoading} onRetry={props.historyRetry} label="重试图表" hasData={Boolean(chartData.length)} />
          <div className="chart-wrap">
            {props.historyLoading && !chartData.length
              ? <LoadingBlock label={t("加载中")} />
              : <MarketChart key={`${stock.ticker}:${props.period}:${props.interval}:${chartMode}`} data={chartData} warmup={props.indicatorHistory} ticker={stock.ticker} period={props.period} mode={chartMode} interval={props.interval}
                  referencePrice={props.historyMeta?.reference_price} adjustment={props.historyMeta?.adjustment} source={props.historyMeta?.source}
                  immersive={props.immersive} annotations={chartAnnotations} trendlines={trendlines} selectedAnnotation={selectedAnnotation} onSelectAnnotation={selectAnnotation} />}
          </div>
          <ChartDataExport ticker={stock.ticker} period={props.period} interval={props.interval} history={props.historyMeta ?? null} />
          {stock.market === 'CRYPTO' ? <>
          <div className="key-stats">
            <Metric label="24h开盘（USDT）" value={props.dayOpen > 0 ? props.dayOpen.toFixed(digits) : '--'} />
            <Metric label="24h最高（USDT）" value={props.dayHigh > 0 ? props.dayHigh.toFixed(digits) : '--'} />
            <Metric label="24h最低（USDT）" value={props.dayLow > 0 ? props.dayLow.toFixed(digits) : '--'} />
            <Metric label={'24h成交量（'+stock.ticker.slice(0,-4)+'）'} value={props.price > 0 ? formatVolume(props.volume, stock.market, getLocale(), false) : '--'} />
            <Metric label="24h成交额（USDT）" value={props.amount !== null && props.amount >= 0 ? formatCompact(props.amount) : '--'} />
            <Metric label="市场 / 日线时区" value="现货 · 24/7 · UTC" />
          </div>
          </> : <>
          <div className="key-stats">
            <Metric label={t("今开")} value={props.dayOpen > 0 ? props.dayOpen.toFixed(digits) : '--'} />
            <Metric label={t("昨收")} value={props.quoteDetails?.previous_close && props.quoteDetails.previous_close > 0 ? props.quoteDetails.previous_close.toFixed(digits) : '--'} />
            <Metric label={t("最高")} value={props.dayHigh > 0 ? props.dayHigh.toFixed(digits) : '--'} tone={priceChangeTone(props.dayHigh, props.quoteDetails?.previous_close, digits)} />
            <Metric label={t("最低")} value={props.dayLow > 0 ? props.dayLow.toFixed(digits) : '--'} tone={priceChangeTone(props.dayLow, props.quoteDetails?.previous_close, digits)} />
            <Metric label={t("振幅")} value={formatMetric(props.quoteDetails?.amplitude_percent, '%')} />
            <Metric label={t("量比")} value={formatMetric(props.quoteDetails?.volume_ratio)} />
            <Metric label={t("成交量")} value={props.price > 0 ? formatVolume(props.volume, stock.market, getLocale()) : '--'} />
            <Metric label={t("成交额")} value={props.amount !== null && props.amount >= 0 ? formatCompact(props.amount) : '--'} />
            <Metric label={t("换手率")} value={props.turnoverRate === null ? '--' : `${props.turnoverRate.toFixed(2)}%`} />
            <Metric label={t("市盈率")} value={formatMetric(props.quoteDetails?.pe_ratio)} />
            <Metric label={t("市净率")} value={formatMetric(props.quoteDetails?.pb_ratio)} />
            <Metric label={t("总市值")} value={props.quoteDetails?.market_cap ? `${stock.market === 'CN' ? '¥' : '$'}${formatCompact(props.quoteDetails.market_cap)}` : '--'} />
          </div>
          </>}
          {analysis.result && <AnalysisSummary result={analysis.result} onAnnotation={selectAnnotation} plottedPoints={plottedPoints} />}
        </section>

        <aside className="insight-column">
          <OrderBook ticker={stock.ticker} quote={props.liveQuote} />
          <MarketSnapshot data={props.marketData} loading={props.marketLoading} onOpen={props.openMarkets} />

          <section className="movers-card surface">
            <header><div><h2>{t("领涨")}</h2></div><button onClick={props.openMarkets}>{t("全部")} <Icon name="arrow" /></button></header>
            <MoverRows rows={props.marketData?.leaders.slice(0, 4) ?? []} onSelect={props.onSelectMarket} />
          </section>
        </aside>
      </div>

      <section className="intelligence-strip">
        <header>
          <div><h2>{t("资讯")}</h2>{props.newsStale && <small className="quote-tag">{t("缓存")}</small>}</div>
          <button onClick={props.openNews}>{t("更多")} <Icon name="arrow" /></button>
        </header>
        <ResourceError error={props.newsError} loading={props.newsLoading} onRetry={props.newsRetry} label="重试资讯" hasData={Boolean(props.news.length)} />
        <div className="story-grid">
          {(props.news.some(item=>newsCoins(item).includes(stock.ticker))?props.news.filter(item=>newsCoins(item).includes(stock.ticker)):props.news.filter(item=>newsLanguage(item)==='zh').length?props.news.filter(item=>newsLanguage(item)==='zh'):props.news).slice(0, 3).map(item => (
            <button key={newsKey(item)} onClick={() => props.onOpenStory(item)}>
              <span><time dateTime={item.published_at}>{formatClock(item.published_at)}</time><small>{item.source}</small></span>
              <h3>{item.title}</h3>
            </button>
          ))}
          {!props.news.length && !props.newsError && (props.newsLoading ? <LoadingBlock label={t("加载中")} /> : <p className="empty-message" role="status">{t("暂无新闻")}</p>)}
        </div>
      </section>

    </div>
  );
}

function formatMetric(value: number | null | undefined, suffix = '') {
  return value !== null && value !== undefined && Number.isFinite(value) ? `${value.toFixed(2)}${suffix}` : '--';
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: ChangeTone }) {
  return <div className="metric"><span>{label}</span><strong className={tone}>{value}</strong></div>;
}

function LoadingBlock({ label }: { label: string }) {
  return <div className="loading-block"><i /><span>{label}</span></div>;
}

function MarketSnapshot({ data, loading, onOpen }: { data: ReturnType<typeof useMarketOverview>['data']; loading: boolean; onOpen: () => void }) {
  const breadth = data?.breadth;
  const total = Math.max(breadth?.total ?? 0, 1);
  return (
    <section className="snapshot-card surface">
      <header><div><h2>{t("涨跌分布")}</h2>{data && data.summary.mode !== 'full_market' && <small className="quote-tag">{t("样本")}</small>}</div><button onClick={onOpen} aria-label={t("查看市场")}><Icon name="arrow" /></button></header>
      <strong>{data ? `${data.summary.breadth_ratio.toFixed(1)}%` : '--'}<small>{t("上涨占比")}</small></strong>
      <div className="breadth-bar">
        <span className="up" style={{ width: `${((breadth?.advancers ?? 0) / total) * 100}%` }} />
        <span className="flat" style={{ width: `${((breadth?.flat ?? 0) / total) * 100}%` }} />
        <span className="down" style={{ width: `${((breadth?.decliners ?? 0) / total) * 100}%` }} />
      </div>
      <dl>
        <div><dt>{t("上涨")}</dt><dd className="positive">{breadth?.advancers ?? '--'}</dd></div>
        <div><dt>{t("平盘")}</dt><dd>{breadth?.flat ?? '--'}</dd></div>
        <div><dt>{t("下跌")}</dt><dd className="negative">{breadth?.decliners ?? '--'}</dd></div>
      </dl>
      {loading && <span className="loading-note">{t("同步中")}</span>}
    </section>
  );
}

function MoverRows({ rows, onSelect, group }: {
  rows: HotspotRow[]; onSelect: (row: HotspotRow, anchor: HTMLButtonElement) => void; group?: string;
}) {
  return <div className="mover-rows">{rows.map((row) => (
    <button key={row.ticker} id={group ? `market-${group}-${row.ticker}` : undefined} data-market-ticker={row.ticker}
      onClick={event => onSelect(row, event.currentTarget)}>
      <span><strong>{row.ticker}</strong><small>{row.name}</small><StockTags ticker={row.ticker} name={row.name} /></span>
      <span><strong>{row.price.toFixed(pricePrecision(row.ticker, row.price))}</strong><Delta value={row.change_percent} /></span>
    </button>
  ))}</div>;
}

function Markets({ market, setMarket, data, loading, error, onRetry, onSelect, boardView, onBoardViewChange, prefetch, cancelPrefetch }: {
  market: MarketType;
  setMarket: (market: MarketType) => void;
  data: ReturnType<typeof useMarketOverview>['data'];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onSelect: (row: ChinaBoardMember, anchor: HTMLButtonElement, fromBoard?: boolean) => void;
  boardView: ChinaBoardView;
  onBoardViewChange: (view: ChinaBoardView) => void;
  prefetch: (ticker: string) => void;
  cancelPrefetch: () => void;
}) {
  const movedBetweenRows = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse' || !(event.target instanceof Element)) return;
    const row = event.target.closest<HTMLElement>('[data-market-ticker]');
    if (!row || (event.relatedTarget instanceof Node && row.contains(event.relatedTarget))) return;
    return row.dataset.marketTicker;
  };
  const hover = {
    onPointerOver: (event: PointerEvent<HTMLDivElement>) => {
      const ticker = movedBetweenRows(event);
      if (ticker) prefetch(ticker);
    },
    onPointerOut: (event: PointerEvent<HTMLDivElement>) => { if (movedBetweenRows(event)) cancelPrefetch(); },
  };
  const marketTabs = <div className="page-tabs"><button type="button" className="active" onClick={() => setMarket('CRYPTO')}>USDT现货 · 24小时</button></div>;
  if (market === 'CN') return <div className="markets-page" aria-busy={loading && !data} {...hover}>
    <PageHeader title={t("A 股市场")} />
    <ResourceError error={error} loading={loading} onRetry={onRetry} label="重试市场" hasData={Boolean(data)} />
    <ChinaMarkets data={data} error={error} onSelect={onSelect} boardView={boardView} onBoardViewChange={onBoardViewChange} />
  </div>;

  const heatRows = data?.sectors?.length ? data.sectors : [...(data?.leaders ?? []), ...(data?.laggards ?? [])];
  const maxChange = Math.max(...heatRows.map((row) => Math.abs(row.change_percent)), 1);
  return (
    <div className="markets-page" aria-busy={loading && !data} {...hover}>
      <PageHeader title={t("市场")}>
        {marketTabs}
      </PageHeader>
      <ResourceError error={error} loading={loading} onRetry={onRetry} label="重试市场" hasData={Boolean(data)} />
      {data && <div className="market-meta"><span>{data.market === 'CRYPTO' ? 'Binance USDT现货' : data.summary.mode === 'full_market' ? t("全市场") : t("样本")}</span><time>{formatClock(data.updated_at)}</time>{data.stale && <span>{t("缓存")}</span>}</div>}
      <section className="index-row">
        {(data?.indices ?? []).slice(0, 5).map((row) => <button key={row.ticker} id={`market-index-${row.ticker}`} data-market-ticker={row.ticker}
          onClick={event => onSelect(row, event.currentTarget)}><span>{row.name}</span><strong>{row.price.toFixed(2)}</strong><Delta value={row.change_percent} /><small>{row.ticker}</small></button>)}
      </section>
      <div className="market-grid">
        <section className="heatmap surface">
          <header className="section-header"><div><h2>热门交易对 · 24h</h2></div><small>{data ? t("更新 {time}", { time: formatClock(data.updated_at) }) : '--'}</small></header>
          <div className="heatmap-grid">
            {heatRows.slice(0, 16).map((row, index) => (
              <button key={`${row.ticker}-${index}`} id={`market-heat-${row.ticker}`} data-market-ticker={row.ticker} data-direction={changeDirection(row.change_percent)} style={{ ['--heat' as string]: Math.max(Math.abs(row.change_percent) / maxChange, .12) } as CSSProperties} onClick={event => onSelect(row, event.currentTarget)}>
                <span>{row.sector ?? row.name}</span><small>{row.ticker}</small><Delta value={row.change_percent} /><em>{formatVolume(row.volume, data?.market ?? 'US', getLocale())}</em>
              </button>
            ))}
            {loading && !heatRows.length && <LoadingBlock label={t("加载中")} />}
          </div>
        </section>
        <section className="ranking surface">
          <header className="section-header"><div><h2>{t("排行")}</h2></div></header>
          <div className="ranking-columns"><div><h3>{t("领涨")}</h3><MoverRows group="leaders" rows={data?.leaders.slice(0, 8) ?? []} onSelect={onSelect} /></div><div><h3>{t("领跌")}</h3><MoverRows group="laggards" rows={data?.laggards.slice(0, 8) ?? []} onSelect={onSelect} /></div></div>
        </section>
      </div>
    </div>
  );
}

const newsKey = newsId;

const NewsDialog = memo(function NewsDialog({ item, onClose, onOpenTicker }: { item: NewsItem; onClose: () => void; onOpenTicker:(ticker:string)=>void }) {
  useLanguage();
  const sourceLink = newsSourceLink(item.url);
  const library=useNewsLibrary(),saved=library.saved.some(n=>newsId(n)===newsId(item));
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog?.showModal();
    return () => {
      dialog?.close();
      document.body.style.overflow = previousOverflow;
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);
  return <dialog ref={ref} className="news-dialog" aria-labelledby="news-dialog-title" onCancel={onClose} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <header><span>{item.source} · {formatClock(item.published_at)}</span><button type="button" aria-label={t("关闭新闻")} onClick={onClose}>{t("关闭 ×")}</button></header>
    <article tabIndex={0} aria-labelledby="news-dialog-title">
      <small className="news-summary-label">{t('新闻摘要')}</small>
      <h2 id="news-dialog-title">{item.title}</h2>
      <p>{item.summary.trim() || t('该资讯未提供摘要')}</p>
    </article>
    <div className="crypto-news-tags">{newsCoins(item).map(coin=><button type="button" key={coin} onClick={()=>onOpenTicker(coin)}>{coin.replace(/USDT$/,'')} 行情 ↗</button>)}<button type="button" className="crypto-news-save" aria-pressed={saved} onClick={()=>toggleNewsSaved(item)}>{saved?'★ 已收藏':'☆ 收藏'}</button></div>
    {sourceLink && <footer className="news-source-action"><small>{sourceLink.hostname}</small>
      <a href={sourceLink.href} target="_blank" rel="noopener noreferrer" aria-label={t('阅读原文（新窗口）')}>{t('阅读原文')} <span aria-hidden="true">↗</span></a>
    </footer>}
  </dialog>;
});

function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return <header className="page-header"><h1>{title}</h1>{children}</header>;
}

export default App;

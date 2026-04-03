
import { useEffect, useRef, useState } from 'react';
import './App.css';
import { buildApiUrl, getCurrencySymbol } from './lib/api';
import { stockWebSocketService } from './services/stockWebSocketService';
import { type MarketType, useStockStore } from './store/stockStore';

type PeriodKey = '1d' | '1wk' | '1mo' | '3mo' | '1y';
type IntradayInterval = '5m' | '15m';
type Language = 'zh' | 'en';
type SearchResult = { ticker: string; name: string };
type HistoryPoint = { timestamp: string; open: number; high: number; low: number; close: number; volume: number };
type QuoteResponse = {
  ticker: string;
  price: number;
  volume: number;
  change_percent: number;
  change?: number | null;
  open_price?: number | null;
  high_price?: number | null;
  low_price?: number | null;
  previous_close?: number | null;
  amount?: number | null;
  turnover_rate?: number | null;
  amplitude_percent?: number | null;
};
type DetailState = { history: HistoryPoint[]; related: string[]; loading: boolean; error: string | null; lastUpdated: string | null };
type SnapshotState = { quote: QuoteResponse | null; history: HistoryPoint[]; loading: boolean; error: string | null; lastUpdated: string | null };

const periodOptions: Array<{ key: PeriodKey; label: string }> = [
  { key: '1d', label: '1D' },
  { key: '1wk', label: '1W' },
  { key: '1mo', label: '1M' },
  { key: '3mo', label: '3M' },
  { key: '1y', label: '1Y' },
];
const intervalByPeriod: Record<PeriodKey, string> = { '1d': '5m', '1wk': '30m', '1mo': '1d', '3mo': '1d', '1y': '1wk' };
const intradayIntervalOptions: Array<{ key: IntradayInterval; label: string }> = [{ key: '15m', label: '15m' }, { key: '5m', label: '5m' }];
const marketLabel: Record<MarketType, string> = { US: 'US', CN: 'CN' };
const formatSigned = (value: number, digits = 2) => `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`;
const tz = (market: MarketType) => (market === 'US' ? 'America/New_York' : 'Asia/Shanghai');
const ma = (data: HistoryPoint[], period: number) => data.map((point, index) => index < period - 1 ? null : ({ timestamp: point.timestamp, value: data.slice(index - period + 1, index + 1).reduce((sum, item) => sum + item.close, 0) / period }));

const localeByLanguage: Record<Language, string> = { zh: 'zh-CN', en: 'en-US' };
const periodDisplayLabel: Record<Language, Record<PeriodKey, string>> = {
  zh: { '1d': '分时', '1wk': '1周', '1mo': '1个月', '3mo': '3个月', '1y': '1年' },
  en: { '1d': 'Intraday', '1wk': '1 Week', '1mo': '1 Month', '3mo': '3 Months', '1y': '1 Year' },
};

const translations = {
  zh: {
    watchlist: '自选',
    names: '只股票',
    addStock: '添加股票',
    searching: '搜索中...',
    searchHint: '按代码或名称搜索，并加入自选列表。',
    add: '添加',
    remove: '删除',
    volumeShort: '量',
    dailySnapshot: '当日快照',
    snapshot: '快照',
    waitingUpdate: '等待更新',
    last: '最新',
    change: '涨跌',
    amplitude: '振幅',
    candlestick: 'K线图',
    chartHint: '下方图表范围会切换，但上方快照始终显示今日交易时段数据。',
    loadingChart: '图表加载中...',
    noCandlestickData: '暂无K线数据。',
    sessionNotes: '交易摘要',
    sessionHint: '以下要点基于今日交易时段快照，而不是当前图表区间。',
    related: '相关标的',
    relatedHint: '来自后端推荐映射的快捷跳转列表。',
    noRelated: '暂无相关标的。',
    emptyWatchlist: '自选列表为空，请先在左侧添加股票。',
    pleaseAddStock: '请先添加一只股票。',
    failedToLoadMarketData: '加载行情数据失败',
    failedToLoadDailySnapshot: '加载日内快照失败',
    searchFailed: '搜索失败',
    unknownError: '未知错误',
    todayOpen: '今日开盘',
    previousClose: '昨收',
    todayHigh: '今日最高',
    todayLow: '今日最低',
    highMinusLow: '最高减最低',
    vsPrevClose: '相对昨收',
    todayVolume: '今日累计成交量',
    avgBarVolume: '5分钟均量',
    todayAmount: '今日成交额',
    shownWhenAvailable: '有数据时显示',
    open: '开盘',
    prevClose: '昨收',
    dayHigh: '日高',
    dayLow: '日低',
    dayRange: '日内波动',
    turnover: '成交额',
    turnoverRate: '换手率',
    avgBarVol: '均量',
    close: '收盘',
    range: '区间',
    summary: (name: string, open: string, high: string, low: string, last: string, volume: string) => `${name} 今日快照：开盘 ${open}，最高 ${high}，最低 ${low}，最新 ${last}，成交量 ${volume}。`,
    notes: {
      line1: (open: string, high: string, low: string, last: string) => `开盘 ${open}，最高 ${high}，最低 ${low}，最新 ${last}。`,
      line2: (range: string, amplitude: string) => `日内波动 ${range}，振幅 ${amplitude}%。`,
      line3: (volume: string, avg: string) => `成交量 ${volume}，5分钟均量 ${avg}。`,
    },
    sessionLabel: (market: MarketType, period: PeriodKey) => period !== '1d' && period !== '1wk' ? `${market} 市场交易时段视图` : market === 'US' ? '美股常规时段 09:30-16:00 ET' : 'A股常规时段 09:30-11:30 / 13:00-15:00',
    xAxisTimezone: (market: MarketType) => market === 'US' ? '横轴使用美东时间' : '横轴使用北京时间',
    chartAria: (ticker: string) => `${ticker} K线图`,
  },
  en: {
    watchlist: 'Watchlist',
    names: 'names',
    addStock: 'Add stock',
    searching: 'Searching...',
    searchHint: 'Search by ticker or name and add to your watchlist.',
    add: 'Add',
    remove: 'Remove',
    volumeShort: 'Vol',
    dailySnapshot: 'Daily Snapshot',
    snapshot: 'Snapshot',
    waitingUpdate: 'Waiting for update',
    last: 'Last',
    change: 'Change',
    amplitude: 'Amplitude',
    candlestick: 'Candlestick',
    chartHint: "The chart range changes below, but the snapshot above always stays on today's session data.",
    loadingChart: 'Loading chart...',
    noCandlestickData: 'No candlestick data.',
    sessionNotes: 'Session Notes',
    sessionHint: "These bullets use today's session snapshot instead of the selected chart range.",
    related: 'Related',
    relatedHint: 'Quick jump list from the backend recommendation mapping.',
    noRelated: 'No related names.',
    emptyWatchlist: 'Your watchlist is empty. Add a stock on the left first.',
    pleaseAddStock: 'Please add a stock first.',
    failedToLoadMarketData: 'Failed to load market data',
    failedToLoadDailySnapshot: 'Failed to load daily snapshot',
    searchFailed: 'Search failed',
    unknownError: 'Unknown error',
    todayOpen: 'Today open',
    previousClose: 'Previous close',
    todayHigh: 'Today high',
    todayLow: 'Today low',
    highMinusLow: 'High minus low',
    vsPrevClose: 'Vs prev close',
    todayVolume: 'Today cumulative volume',
    avgBarVolume: 'Average 5m bar volume',
    todayAmount: 'Today traded amount',
    shownWhenAvailable: 'Shown when available',
    open: 'Open',
    prevClose: 'Prev Close',
    dayHigh: 'Day High',
    dayLow: 'Day Low',
    dayRange: 'Day Range',
    turnover: 'Turnover',
    turnoverRate: 'Turnover Rate',
    avgBarVol: 'Avg Bar Vol',
    close: 'Close',
    range: 'Range',
    summary: (name: string, open: string, high: string, low: string, last: string, volume: string) => `${name} daily snapshot: open ${open}, high ${high}, low ${low}, last ${last}, volume ${volume}.`,
    notes: {
      line1: (open: string, high: string, low: string, last: string) => `Open ${open}, high ${high}, low ${low}, last ${last}.`,
      line2: (range: string, amplitude: string) => `Daily range is ${range} and amplitude is ${amplitude}%.`,
      line3: (volume: string, avg: string) => `Volume is ${volume} with average 5m bar volume ${avg}.`,
    },
    sessionLabel: (market: MarketType, period: PeriodKey) => period !== '1d' && period !== '1wk' ? `${market} market session view` : market === 'US' ? 'US cash session 09:30-16:00 ET' : 'CN cash session 09:30-11:30 / 13:00-15:00',
    xAxisTimezone: (market: MarketType) => market === 'US' ? 'XAxis uses ET' : 'XAxis uses Beijing time',
    chartAria: (ticker: string) => `${ticker} candlestick chart`,
  },
} as const;

const detectInitialLanguage = (): Language => {
  const storedLanguage = window.localStorage.getItem('stock-dashboard-language');
  if (storedLanguage === 'zh' || storedLanguage === 'en') return storedLanguage;
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
};

function App() {
  const { watchlist, selectedTicker, addToWatchlist, removeFromWatchlist, selectStock, updateStockQuote } = useStockStore();
  const [language, setLanguage] = useState<Language>(() => detectInitialLanguage());
  const [activePeriod, setActivePeriod] = useState<PeriodKey>('1mo');
  const [intradayInterval, setIntradayInterval] = useState<IntradayInterval>('15m');
  const [searchText, setSearchText] = useState('');
  const [searchMarket, setSearchMarket] = useState<MarketType>('US');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [detailState, setDetailState] = useState<DetailState>({ history: [], related: [], loading: true, error: null, lastUpdated: null });
  const [snapshotState, setSnapshotState] = useState<SnapshotState>({ quote: null, history: [], loading: true, error: null, lastUpdated: null });
  const historyCacheRef = useRef<Record<string, { history: HistoryPoint[]; lastUpdated: string }>>({});
  const relatedCacheRef = useRef<Record<string, string[]>>({});
  const snapshotCacheRef = useRef<Record<string, { quote: QuoteResponse; history: HistoryPoint[]; lastUpdated: string }>>({});
  const selectedStock = watchlist.find((item) => item.ticker === selectedTicker) ?? watchlist[0] ?? null;
  const selectedTickerSafe = selectedStock?.ticker ?? null;
  const effectiveInterval = activePeriod === '1d' ? intradayInterval : intervalByPeriod[activePeriod];
  const locale = localeByLanguage[language];
  const t = translations[language];
  const formatCompactNumber = (value: number) => new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 2 }).format(value);
  const formatDateTime = (value: string) => new Date(value).toLocaleString(locale, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const formatXAxisLabel = (value: string, market: MarketType, period: PeriodKey) => new Intl.DateTimeFormat(locale, { timeZone: tz(market), year: period === '1y' ? 'numeric' : undefined, month: period === '1mo' || period === '3mo' || period === '1y' ? '2-digit' : undefined, day: period === '1mo' || period === '3mo' ? '2-digit' : period === '1y' ? undefined : '2-digit', hour: period === '1d' || period === '1wk' ? '2-digit' : undefined, minute: period === '1d' || period === '1wk' ? '2-digit' : undefined, hour12: false }).format(new Date(value));
  const formatHoverTime = (value: string, market: MarketType, period: PeriodKey) => new Intl.DateTimeFormat(locale, { timeZone: tz(market), year: period === '1y' ? 'numeric' : undefined, month: '2-digit', day: '2-digit', hour: period === '1d' || period === '1wk' ? '2-digit' : undefined, minute: period === '1d' || period === '1wk' ? '2-digit' : undefined, hour12: false }).format(new Date(value));

  useEffect(() => {
    window.localStorage.setItem('stock-dashboard-language', language);
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
  }, [language]);

  useEffect(() => {
    stockWebSocketService.connect();
    const unsubscribe = useStockStore.subscribe(() => stockWebSocketService.updateSubscriptions());
    return () => { stockWebSocketService.disconnect(); unsubscribe(); };
  }, []);

  useEffect(() => { if (!selectedStock && watchlist.length > 0) selectStock(watchlist[0].ticker); }, [selectedStock, selectStock, watchlist]);

  useEffect(() => {
    if (!selectedTickerSafe) { setDetailState({ history: [], related: [], loading: false, error: t.pleaseAddStock, lastUpdated: null }); return; }
    let cancelled = false;
    const cacheKey = `${selectedTickerSafe}:${activePeriod}:${effectiveInterval}`;
    const cachedHistory = historyCacheRef.current[cacheKey];
    const cachedRelated = relatedCacheRef.current[selectedTickerSafe];
    if (cachedHistory) { setDetailState({ history: cachedHistory.history, related: cachedRelated ?? [], loading: false, error: null, lastUpdated: cachedHistory.lastUpdated }); return () => { cancelled = true; }; }
    const load = async () => {
      setDetailState((current) => ({ ...current, loading: true, error: null }));
      try {
        const [historyResponse, quoteResponse, relatedResponse] = await Promise.all([fetch(buildApiUrl(`/stocks/${selectedTickerSafe}/history?period=${activePeriod}&interval=${effectiveInterval}`)), fetch(buildApiUrl(`/stocks/${selectedTickerSafe}/quote`)), cachedRelated ? Promise.resolve(null) : fetch(buildApiUrl(`/stocks/${selectedTickerSafe}/recommendations`))]);
        if (!historyResponse.ok || !quoteResponse.ok || (relatedResponse && !relatedResponse.ok)) throw new Error(t.failedToLoadMarketData);
        const historyData: { ticker: string; data: HistoryPoint[] } = await historyResponse.json();
        const quoteData: QuoteResponse = await quoteResponse.json();
        const relatedData: { recommendations: string[] } | null = relatedResponse ? await relatedResponse.json() : null;
        if (cancelled) return;
        const lastUpdated = new Date().toISOString();
        const nextRelated = relatedData?.recommendations ?? cachedRelated ?? [];
        historyCacheRef.current[cacheKey] = { history: historyData.data, lastUpdated };
        relatedCacheRef.current[selectedTickerSafe] = nextRelated;
        updateStockQuote(selectedTickerSafe, { price: quoteData.price, changePercent: quoteData.change_percent, volume: quoteData.volume });
        setDetailState({ history: historyData.data, related: nextRelated, loading: false, error: null, lastUpdated });
      } catch (error) {
        if (!cancelled) setDetailState({ history: [], related: [], loading: false, error: error instanceof Error ? error.message : t.unknownError, lastUpdated: null });
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [activePeriod, effectiveInterval, selectedTickerSafe, t.failedToLoadMarketData, t.pleaseAddStock, t.unknownError, updateStockQuote]);

  useEffect(() => {
    if (!selectedTickerSafe) { setSnapshotState({ quote: null, history: [], loading: false, error: null, lastUpdated: null }); return; }
    let cancelled = false;
    const cached = snapshotCacheRef.current[selectedTickerSafe];
    if (cached) setSnapshotState({ quote: cached.quote, history: cached.history, loading: false, error: null, lastUpdated: cached.lastUpdated });
    else setSnapshotState({ quote: null, history: [], loading: true, error: null, lastUpdated: null });
    const load = async () => {
      try {
        const [quoteResponse, historyResponse] = await Promise.all([fetch(buildApiUrl(`/stocks/${selectedTickerSafe}/quote`)), fetch(buildApiUrl(`/stocks/${selectedTickerSafe}/history?period=1d&interval=5m`))]);
        if (!quoteResponse.ok || !historyResponse.ok) throw new Error(t.failedToLoadDailySnapshot);
        const quote: QuoteResponse = await quoteResponse.json();
        const historyData: { ticker: string; data: HistoryPoint[] } = await historyResponse.json();
        if (cancelled) return;
        const lastUpdated = new Date().toISOString();
        snapshotCacheRef.current[selectedTickerSafe] = { quote, history: historyData.data, lastUpdated };
        setSnapshotState({ quote, history: historyData.data, loading: false, error: null, lastUpdated });
      } catch (error) {
        if (!cancelled) setSnapshotState((current) => ({ ...current, loading: false, error: error instanceof Error ? error.message : t.unknownError }));
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [selectedTickerSafe, t.failedToLoadDailySnapshot, t.unknownError]);
  useEffect(() => {
    if (!selectedStock || selectedStock.market !== 'US' || activePeriod !== '1d' || intradayInterval !== '15m') return;
    setDetailState((current) => {
      if (current.history.length === 0) return current;
      const nextHistory = [...current.history];
      const lastBar = nextHistory[nextHistory.length - 1];
      const barStart = new Date(lastBar.timestamp).getTime();
      const bucketMs = 15 * 60 * 1000;
      const nextBucketTime = barStart + bucketMs;
      const latestPrice = selectedStock.price;
      const latestVolume = selectedStock.volume;
      if (!Number.isFinite(latestPrice) || latestPrice <= 0) return current;
      if (Date.now() < nextBucketTime) nextHistory[nextHistory.length - 1] = { ...lastBar, high: Math.max(lastBar.high, latestPrice), low: Math.min(lastBar.low, latestPrice), close: latestPrice, volume: Math.max(lastBar.volume, latestVolume) };
      else nextHistory.push({ timestamp: new Date(nextBucketTime).toISOString(), open: lastBar.close, high: Math.max(lastBar.close, latestPrice), low: Math.min(lastBar.close, latestPrice), close: latestPrice, volume: latestVolume });
      return { ...current, history: nextHistory };
    });
  }, [activePeriod, intradayInterval, selectedStock?.market, selectedStock?.price, selectedStock?.volume]);

  useEffect(() => {
    if (!searchText.trim()) { setSearchResults([]); setSearchLoading(false); setSearchError(null); return; }
    let cancelled = false;
    setSearchLoading(true); setSearchError(null);
    const timeoutId = window.setTimeout(async () => {
      try {
        const response = await fetch(buildApiUrl(`/stocks/search?query=${encodeURIComponent(searchText.trim())}&market=${searchMarket}`));
        if (!response.ok) throw new Error(t.searchFailed);
        const data: { results: SearchResult[] } = await response.json();
        if (!cancelled) { setSearchResults(data.results); setSearchLoading(false); }
      } catch (error) {
        if (!cancelled) { setSearchResults([]); setSearchLoading(false); setSearchError(error instanceof Error ? error.message : t.searchFailed); }
      }
    }, 260);
    return () => { cancelled = true; window.clearTimeout(timeoutId); };
  }, [searchMarket, searchText, t.searchFailed]);

  const history = detailState.history;
  const latestBar = history[history.length - 1] ?? null;
  const latestClose = latestBar?.close ?? selectedStock?.price ?? 0;
  const quote = snapshotState.quote;
  const dayHistory = snapshotState.history;
  const latestSnapshotBar = dayHistory[dayHistory.length - 1] ?? null;
  const todayPrice = selectedStock?.price ?? quote?.price ?? latestClose;
  const previousClose = quote?.previous_close ?? (selectedStock && selectedStock.changePercent !== -100 ? selectedStock.price / (1 + selectedStock.changePercent / 100) : todayPrice);
  const todayDelta = quote?.change ?? todayPrice - previousClose;
  const todayDeltaPercent = selectedStock?.changePercent ?? quote?.change_percent ?? (previousClose === 0 ? 0 : (todayDelta / previousClose) * 100);
  const dayOpen = quote?.open_price ?? dayHistory[0]?.open ?? previousClose ?? todayPrice;
  const dayHigh = Math.max(quote?.high_price ?? todayPrice, latestSnapshotBar?.high ?? todayPrice, todayPrice);
  const dayLow = Math.min(quote?.low_price ?? todayPrice, latestSnapshotBar?.low ?? todayPrice, todayPrice);
  const dayRange = dayHigh - dayLow;
  const dayAmplitude = quote?.amplitude_percent ?? (previousClose === 0 ? 0 : (dayRange / previousClose) * 100);
  const avgBarVolume = dayHistory.length ? dayHistory.reduce((sum, item) => sum + item.volume, 0) / dayHistory.length : selectedStock?.volume ?? quote?.volume ?? 0;
  const heroPeriodLabel = activePeriod === '1d' ? `${periodDisplayLabel[language][activePeriod]} ${intradayInterval}` : periodDisplayLabel[language][activePeriod];
  const snapshotUpdated = snapshotState.lastUpdated ?? detailState.lastUpdated;
  const summary = selectedStock ? t.summary(selectedStock.name, dayOpen.toFixed(2), dayHigh.toFixed(2), dayLow.toFixed(2), todayPrice.toFixed(2), formatCompactNumber(quote?.volume ?? selectedStock.volume)) : '';
  const infoCards = selectedStock ? [
    { title: t.open, value: `${getCurrencySymbol(selectedStock.ticker)}${dayOpen.toFixed(2)}`, hint: t.todayOpen },
    { title: t.prevClose, value: `${getCurrencySymbol(selectedStock.ticker)}${previousClose.toFixed(2)}`, hint: t.previousClose },
    { title: t.dayHigh, value: `${getCurrencySymbol(selectedStock.ticker)}${dayHigh.toFixed(2)}`, hint: t.todayHigh },
    { title: t.dayLow, value: `${getCurrencySymbol(selectedStock.ticker)}${dayLow.toFixed(2)}`, hint: t.todayLow },
    { title: t.dayRange, value: `${getCurrencySymbol(selectedStock.ticker)}${dayRange.toFixed(2)}`, hint: t.highMinusLow },
    { title: t.amplitude, value: `${dayAmplitude.toFixed(2)}%`, hint: t.vsPrevClose },
    { title: language === 'zh' ? '成交量' : 'Volume', value: formatCompactNumber(selectedStock.volume || quote?.volume || 0), hint: t.todayVolume },
    { title: t.avgBarVol, value: formatCompactNumber(avgBarVolume), hint: t.avgBarVolume },
    { title: t.turnover, value: quote?.amount ? formatCompactNumber(quote.amount) : '--', hint: t.todayAmount },
    { title: t.turnoverRate, value: quote?.turnover_rate !== null && quote?.turnover_rate !== undefined ? `${quote.turnover_rate.toFixed(2)}%` : '--', hint: t.shownWhenAvailable },
  ] : [];

  return (
    <div className="terminal-page">
      <aside className="watchlist-panel">
        <div className="watchlist-header"><div><p className="eyebrow">{t.watchlist}</p><h1>ZPboard</h1></div><div className="watchlist-header-actions"><div className="language-toggle"><button type="button" className={language === 'zh' ? 'active' : ''} onClick={() => setLanguage('zh')}>中</button><button type="button" className={language === 'en' ? 'active' : ''} onClick={() => setLanguage('en')}>EN</button></div><span className="status-pill">{watchlist.length} {t.names}</span></div></div>
        <div className="search-panel">
          <div className="market-toggle">{(['US', 'CN'] as MarketType[]).map((market) => <button key={market} type="button" className={searchMarket === market ? 'active' : ''} onClick={() => setSearchMarket(market)}>{marketLabel[market]}</button>)}</div>
          <label className="search-box"><span>{t.addStock}</span><input value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder={searchMarket === 'US' ? 'AAPL / Tesla' : '600519 / Moutai'} /></label>
          <div className="search-results">
            {searchLoading && <p className="search-hint">{t.searching}</p>}
            {!searchLoading && searchError && <p className="search-hint search-error">{searchError}</p>}
            {!searchLoading && !searchError && !searchText.trim() && <p className="search-hint">{t.searchHint}</p>}
            {!searchLoading && !searchError && searchText.trim() && searchResults.map((result) => <button key={result.ticker} type="button" className="search-result-item" onClick={() => { addToWatchlist({ ticker: result.ticker, name: result.name, market: searchMarket, price: 0, changePercent: 0, volume: 0 }); selectStock(result.ticker); setSearchText(''); setSearchResults([]); }}><div><strong>{result.ticker}</strong><span>{result.name}</span></div><em>{t.add}</em></button>)}
          </div>
        </div>
        <div className="watchlist-items">
          {watchlist.map((stock) => {
            const isActive = stock.ticker === selectedStock?.ticker;
            const isPositive = stock.changePercent >= 0;
            return <button key={stock.ticker} type="button" className={`watchlist-item${isActive ? ' active' : ''}`} onClick={() => selectStock(stock.ticker)}><div className="watchlist-main"><div><strong>{stock.ticker}</strong><span>{stock.name}</span></div><span className={`badge ${stock.market === 'US' ? 'badge-us' : 'badge-cn'}`}>{marketLabel[stock.market]}</span></div><div className="watchlist-meta"><p>{getCurrencySymbol(stock.ticker)}{stock.price.toFixed(2)}</p><span className={isPositive ? 'positive' : 'negative'}>{formatSigned(stock.changePercent)}%</span></div><div className="watchlist-footer"><small>{t.volumeShort} {formatCompactNumber(stock.volume)}</small><button type="button" className="ghost-action" onClick={(event) => { event.stopPropagation(); removeFromWatchlist(stock.ticker); }}>{t.remove}</button></div></button>;
          })}
        </div>
      </aside>

      <main className="detail-panel">
        {selectedStock ? <>
          <section className="hero-card"><div className="hero-topline"><div><p className="eyebrow">{t.dailySnapshot}</p><h2>{selectedStock.name}<span>{selectedStock.ticker}</span></h2></div><div className="hero-tags"><span>{marketLabel[selectedStock.market]}</span><span>{heroPeriodLabel}</span><span>{snapshotUpdated ? `${t.snapshot} ${formatDateTime(snapshotUpdated)}` : t.waitingUpdate}</span></div></div><div className="hero-metrics"><div><p className="metric-label">{t.last}</p><strong>{getCurrencySymbol(selectedStock.ticker)}{todayPrice.toFixed(2)}</strong></div><div><p className="metric-label">{t.change}</p><strong className={todayDeltaPercent >= 0 ? 'positive' : 'negative'}>{formatSigned(todayDelta)} / {formatSigned(todayDeltaPercent)}%</strong></div><div><p className="metric-label">{t.amplitude}</p><strong>{dayAmplitude.toFixed(2)}%</strong></div></div><p className="hero-summary">{snapshotState.error ? snapshotState.error : summary}</p></section>
          <section className="chart-card"><div className="section-header"><div><h3>{t.candlestick}</h3><p>{t.chartHint}</p></div><div className="chart-controls"><div className="period-switcher">{periodOptions.map((option) => <button key={option.key} type="button" className={activePeriod === option.key ? 'active' : ''} onClick={() => setActivePeriod(option.key)}>{option.key === '1d' ? periodDisplayLabel[language][option.key] : option.label}</button>)}</div>{activePeriod === '1d' && <div className="period-switcher">{intradayIntervalOptions.map((option) => <button key={option.key} type="button" className={intradayInterval === option.key ? 'active' : ''} onClick={() => setIntradayInterval(option.key)}>{option.label}</button>)}</div>}</div></div>{detailState.loading ? <div className="chart-state">{t.loadingChart}</div> : detailState.error ? <div className="chart-state chart-error">{detailState.error}</div> : <CandleChart data={history} ticker={selectedStock.ticker} market={selectedStock.market} period={activePeriod} interval={effectiveInterval} language={language} formatCompactNumber={formatCompactNumber} formatHoverTime={formatHoverTime} formatXAxisLabel={formatXAxisLabel} />}</section>
          <section className="info-grid">{infoCards.map((item) => <InfoCard key={item.title} title={item.title} value={item.value} hint={item.hint} />)}</section>
          <section className="insight-layout"><div className="insight-card"><div className="section-header"><div><h3>{t.sessionNotes}</h3><p>{t.sessionHint}</p></div></div><ul className="insight-list"><li>{t.notes.line1(dayOpen.toFixed(2), dayHigh.toFixed(2), dayLow.toFixed(2), todayPrice.toFixed(2))}</li><li>{t.notes.line2(dayRange.toFixed(2), dayAmplitude.toFixed(2))}</li><li>{t.notes.line3(formatCompactNumber(selectedStock.volume || quote?.volume || 0), formatCompactNumber(avgBarVolume))}</li></ul></div><div className="insight-card"><div className="section-header"><div><h3>{t.related}</h3><p>{t.relatedHint}</p></div></div><div className="related-list">{detailState.related.length > 0 ? detailState.related.map((ticker) => <button key={ticker} type="button" className="related-chip" onClick={() => { const existing = watchlist.find((item) => item.ticker === ticker); if (existing) { selectStock(existing.ticker); return; } addToWatchlist({ ticker, name: ticker, market: ticker.length === 6 && !Number.isNaN(Number(ticker)) ? 'CN' : 'US', price: 0, changePercent: 0, volume: 0 }); selectStock(ticker); }}>{ticker}</button>) : <p className="empty-copy">{t.noRelated}</p>}</div></div></section>
        </> : <section className="empty-state">{t.emptyWatchlist}</section>}
      </main>
    </div>
  );
}

function InfoCard({ title, value, hint }: { title: string; value: string; hint: string }) {
  return <article className="info-card"><p>{title}</p><strong>{value}</strong><span>{hint}</span></article>;
}
function CandleChart({ data, ticker, market, period, interval, language, formatCompactNumber, formatHoverTime, formatXAxisLabel }: { data: HistoryPoint[]; ticker: string; market: MarketType; period: PeriodKey; interval: string; language: Language; formatCompactNumber: (value: number) => string; formatHoverTime: (value: string, market: MarketType, period: PeriodKey) => string; formatXAxisLabel: (value: string, market: MarketType, period: PeriodKey) => string }) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; index: number } | null>(null);
  const t = translations[language];
  if (data.length === 0) return <div className="chart-state">{t.noCandlestickData}</div>;
  const width = 1000; const height = 420; const paddingX = 32; const paddingY = 24;
  const floor = Math.min(...data.map((item) => item.low));
  const ceiling = Math.max(...data.map((item) => item.high));
  const range = Math.max(ceiling - floor, 1);
  const innerWidth = width - paddingX * 2; const innerHeight = height - paddingY * 2;
  const step = innerWidth / data.length;
  const candleWidthFactor = period === '1y' ? 0.92 : period === '3mo' || period === '1mo' ? 0.82 : period === '1wk' ? 0.68 : 0.56;
  const candleWidth = Math.max(6, step * candleWidthFactor);
  const hoveredBar = hoveredIndex === null ? data[data.length - 1] : data[hoveredIndex];
  const axisIndexes = Array.from(new Set([0, Math.floor(data.length * 0.25), Math.floor(data.length * 0.5), Math.floor(data.length * 0.75), data.length - 1])).filter((index) => index >= 0 && index < data.length);
  const ma5 = ma(data, 5); const ma10 = ma(data, 10); const ma20 = ma(data, 20);
  const getY = (value: number) => paddingY + ((ceiling - value) / range) * innerHeight;
  const buildMaPath = (points: Array<{ timestamp: string; value: number } | null>) => points.reduce((path, point, index) => {
    if (!point) return path;
    const x = paddingX + step * index + step / 2; const y = getY(point.value);
    return `${path}${path ? ' L' : 'M'} ${x} ${y}`;
  }, '');

  return (
    <div className="candle-chart" onMouseLeave={() => { setHoveredIndex(null); setTooltip(null); }}>
      <div className="chart-overlay"><div><p>{ticker}</p><strong>{hoveredBar.close.toFixed(2)}</strong></div><div className={hoveredBar.close >= hoveredBar.open ? 'positive' : 'negative'}>{formatSigned(hoveredBar.close - hoveredBar.open)} ({formatSigned(((hoveredBar.close - hoveredBar.open) / hoveredBar.open) * 100)}%)</div><span>{formatHoverTime(hoveredBar.timestamp, market, period)}</span></div>
      <div className="chart-stats"><span>{t.open} {hoveredBar.open.toFixed(2)}</span><span>{t.dayHigh} {hoveredBar.high.toFixed(2)}</span><span>{t.dayLow} {hoveredBar.low.toFixed(2)}</span><span>{t.close} {hoveredBar.close.toFixed(2)}</span><span>{t.volumeShort} {formatCompactNumber(hoveredBar.volume)}</span>{period === '1d' && <span>{t.range} {interval}</span>}</div>
      <div className="ma-legend"><span className="ma-chip ma-chip-5">MA5</span><span className="ma-chip ma-chip-10">MA10</span><span className="ma-chip ma-chip-20">MA20</span></div>
      {tooltip && data[tooltip.index] && <div className="chart-tooltip" style={{ left: tooltip.x, top: tooltip.y }}><strong>{ticker}</strong><span>{formatHoverTime(data[tooltip.index].timestamp, market, period)}</span><span>{t.open} {data[tooltip.index].open.toFixed(2)}</span><span>{t.dayHigh} {data[tooltip.index].high.toFixed(2)}</span><span>{t.dayLow} {data[tooltip.index].low.toFixed(2)}</span><span>{t.close} {data[tooltip.index].close.toFixed(2)}</span><span>{t.volumeShort} {formatCompactNumber(data[tooltip.index].volume)}</span></div>}
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={t.chartAria(ticker)}>
        {[0, 0.25, 0.5, 0.75, 1].map((tick) => { const value = floor + (1 - tick) * range; const y = paddingY + tick * innerHeight; return <g key={tick}><line x1={paddingX} y1={y} x2={width - paddingX} y2={y} className="grid-line" /><text x={width - paddingX + 8} y={y + 4} className="axis-label">{value.toFixed(2)}</text></g>; })}
        {data.map((point, index) => {
          const x = paddingX + step * index + step / 2; const openY = getY(point.open); const closeY = getY(point.close); const highY = getY(point.high); const lowY = getY(point.low); const rising = point.close >= point.open; const candleTop = Math.min(openY, closeY); const candleHeight = Math.max(Math.abs(closeY - openY), 2);
          return <g key={`${point.timestamp}-${index}`} onPointerEnter={() => setHoveredIndex(index)} onPointerMove={(event) => { const bounds = event.currentTarget.ownerSVGElement?.getBoundingClientRect(); if (!bounds) return; setHoveredIndex(index); setTooltip({ index, x: event.clientX - bounds.left + 14, y: event.clientY - bounds.top - 18 }); }}><rect x={x - step / 2} y={paddingY} width={step} height={innerHeight} className="hover-zone" /><line x1={x} y1={highY} x2={x} y2={lowY} className={rising ? 'wick-up' : 'wick-down'} /><rect x={x - candleWidth / 2} y={candleTop} width={candleWidth} height={candleHeight} rx="3" className={rising ? 'candle-up' : 'candle-down'} /></g>;
        })}
        <path d={buildMaPath(ma5)} className="ma-line ma-line-5" />
        <path d={buildMaPath(ma10)} className="ma-line ma-line-10" />
        <path d={buildMaPath(ma20)} className="ma-line ma-line-20" />
        {axisIndexes.map((index) => { const x = paddingX + step * index + step / 2; const point = data[index]; return <text key={`x-axis-${point.timestamp}`} x={x} y={height - 6} textAnchor="middle" className="axis-label">{formatXAxisLabel(point.timestamp, market, period)}</text>; })}
      </svg>
      <div className="chart-footer"><span>{t.sessionLabel(market, period)}</span><span>{t.xAxisTimezone(market)}</span></div>
    </div>
  );
}

export default App;

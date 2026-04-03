
import { useEffect, useRef, useState } from 'react';
import './App.css';
import { buildApiUrl, getCurrencySymbol } from './lib/api';
import { stockWebSocketService } from './services/stockWebSocketService';
import { type MarketType, useStockStore } from './store/stockStore';

type PeriodKey = '1d' | '1wk' | '1mo' | '3mo' | '1y';
type IntradayInterval = '5m' | '15m';
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
  { key: '1d', label: 'Intraday' },
  { key: '1wk', label: '1W' },
  { key: '1mo', label: '1M' },
  { key: '3mo', label: '3M' },
  { key: '1y', label: '1Y' },
];
const periodDisplayLabel: Record<PeriodKey, string> = { '1d': 'Intraday', '1wk': '1 Week', '1mo': '1 Month', '3mo': '3 Months', '1y': '1 Year' };
const intervalByPeriod: Record<PeriodKey, string> = { '1d': '5m', '1wk': '30m', '1mo': '1d', '3mo': '1d', '1y': '1wk' };
const intradayIntervalOptions: Array<{ key: IntradayInterval; label: string }> = [{ key: '15m', label: '15m' }, { key: '5m', label: '5m' }];
const marketLabel: Record<MarketType, string> = { US: 'US', CN: 'CN' };
const formatCompactNumber = (value: number) => new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 2 }).format(value);
const formatSigned = (value: number, digits = 2) => `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`;
const formatDateTime = (value: string) => new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
const tz = (market: MarketType) => (market === 'US' ? 'America/New_York' : 'Asia/Shanghai');
const formatXAxisLabel = (value: string, market: MarketType, period: PeriodKey) => new Intl.DateTimeFormat('zh-CN', { timeZone: tz(market), year: period === '1y' ? 'numeric' : undefined, month: period === '1mo' || period === '3mo' || period === '1y' ? '2-digit' : undefined, day: period === '1mo' || period === '3mo' ? '2-digit' : period === '1y' ? undefined : '2-digit', hour: period === '1d' || period === '1wk' ? '2-digit' : undefined, minute: period === '1d' || period === '1wk' ? '2-digit' : undefined, hour12: false }).format(new Date(value));
const formatHoverTime = (value: string, market: MarketType, period: PeriodKey) => new Intl.DateTimeFormat('zh-CN', { timeZone: tz(market), year: period === '1y' ? 'numeric' : undefined, month: '2-digit', day: '2-digit', hour: period === '1d' || period === '1wk' ? '2-digit' : undefined, minute: period === '1d' || period === '1wk' ? '2-digit' : undefined, hour12: false }).format(new Date(value));
const sessionLabel = (market: MarketType, period: PeriodKey) => period !== '1d' && period !== '1wk' ? `${market} market session view` : market === 'US' ? 'US cash session 09:30-16:00 ET' : 'CN cash session 09:30-11:30 / 13:00-15:00';
const ma = (data: HistoryPoint[], period: number) => data.map((point, index) => index < period - 1 ? null : ({ timestamp: point.timestamp, value: data.slice(index - period + 1, index + 1).reduce((sum, item) => sum + item.close, 0) / period }));

function App() {
  const { watchlist, selectedTicker, addToWatchlist, removeFromWatchlist, selectStock, updateStockQuote } = useStockStore();
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

  useEffect(() => {
    stockWebSocketService.connect();
    const unsubscribe = useStockStore.subscribe(() => stockWebSocketService.updateSubscriptions());
    return () => { stockWebSocketService.disconnect(); unsubscribe(); };
  }, []);

  useEffect(() => { if (!selectedStock && watchlist.length > 0) selectStock(watchlist[0].ticker); }, [selectedStock, selectStock, watchlist]);

  useEffect(() => {
    if (!selectedTickerSafe) { setDetailState({ history: [], related: [], loading: false, error: 'Please add a stock first.', lastUpdated: null }); return; }
    let cancelled = false;
    const cacheKey = `${selectedTickerSafe}:${activePeriod}:${effectiveInterval}`;
    const cachedHistory = historyCacheRef.current[cacheKey];
    const cachedRelated = relatedCacheRef.current[selectedTickerSafe];
    if (cachedHistory) { setDetailState({ history: cachedHistory.history, related: cachedRelated ?? [], loading: false, error: null, lastUpdated: cachedHistory.lastUpdated }); return () => { cancelled = true; }; }
    const load = async () => {
      setDetailState((current) => ({ ...current, loading: true, error: null }));
      try {
        const [historyResponse, quoteResponse, relatedResponse] = await Promise.all([fetch(buildApiUrl(`/stocks/${selectedTickerSafe}/history?period=${activePeriod}&interval=${effectiveInterval}`)), fetch(buildApiUrl(`/stocks/${selectedTickerSafe}/quote`)), cachedRelated ? Promise.resolve(null) : fetch(buildApiUrl(`/stocks/${selectedTickerSafe}/recommendations`))]);
        if (!historyResponse.ok || !quoteResponse.ok || (relatedResponse && !relatedResponse.ok)) throw new Error('Failed to load market data');
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
        if (!cancelled) setDetailState({ history: [], related: [], loading: false, error: error instanceof Error ? error.message : 'Unknown error', lastUpdated: null });
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [activePeriod, effectiveInterval, selectedTickerSafe, updateStockQuote]);

  useEffect(() => {
    if (!selectedTickerSafe) { setSnapshotState({ quote: null, history: [], loading: false, error: null, lastUpdated: null }); return; }
    let cancelled = false;
    const cached = snapshotCacheRef.current[selectedTickerSafe];
    if (cached) setSnapshotState({ quote: cached.quote, history: cached.history, loading: false, error: null, lastUpdated: cached.lastUpdated });
    else setSnapshotState({ quote: null, history: [], loading: true, error: null, lastUpdated: null });
    const load = async () => {
      try {
        const [quoteResponse, historyResponse] = await Promise.all([fetch(buildApiUrl(`/stocks/${selectedTickerSafe}/quote`)), fetch(buildApiUrl(`/stocks/${selectedTickerSafe}/history?period=1d&interval=5m`))]);
        if (!quoteResponse.ok || !historyResponse.ok) throw new Error('Failed to load daily snapshot');
        const quote: QuoteResponse = await quoteResponse.json();
        const historyData: { ticker: string; data: HistoryPoint[] } = await historyResponse.json();
        if (cancelled) return;
        const lastUpdated = new Date().toISOString();
        snapshotCacheRef.current[selectedTickerSafe] = { quote, history: historyData.data, lastUpdated };
        setSnapshotState({ quote, history: historyData.data, loading: false, error: null, lastUpdated });
      } catch (error) {
        if (!cancelled) setSnapshotState((current) => ({ ...current, loading: false, error: error instanceof Error ? error.message : 'Unknown error' }));
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [selectedTickerSafe]);
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
        if (!response.ok) throw new Error('Search failed');
        const data: { results: SearchResult[] } = await response.json();
        if (!cancelled) { setSearchResults(data.results); setSearchLoading(false); }
      } catch (error) {
        if (!cancelled) { setSearchResults([]); setSearchLoading(false); setSearchError(error instanceof Error ? error.message : 'Search failed'); }
      }
    }, 260);
    return () => { cancelled = true; window.clearTimeout(timeoutId); };
  }, [searchMarket, searchText]);

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
  const heroPeriodLabel = activePeriod === '1d' ? `${periodDisplayLabel[activePeriod]} ${intradayInterval}` : periodDisplayLabel[activePeriod];
  const snapshotUpdated = snapshotState.lastUpdated ?? detailState.lastUpdated;
  const summary = selectedStock ? `${selectedStock.name} daily snapshot: open ${dayOpen.toFixed(2)}, high ${dayHigh.toFixed(2)}, low ${dayLow.toFixed(2)}, last ${todayPrice.toFixed(2)}, volume ${formatCompactNumber(quote?.volume ?? selectedStock.volume)}.` : '';
  const infoCards = selectedStock ? [
    { title: 'Open', value: `${getCurrencySymbol(selectedStock.ticker)}${dayOpen.toFixed(2)}`, hint: 'Today open' },
    { title: 'Prev Close', value: `${getCurrencySymbol(selectedStock.ticker)}${previousClose.toFixed(2)}`, hint: 'Previous close' },
    { title: 'Day High', value: `${getCurrencySymbol(selectedStock.ticker)}${dayHigh.toFixed(2)}`, hint: 'Today high' },
    { title: 'Day Low', value: `${getCurrencySymbol(selectedStock.ticker)}${dayLow.toFixed(2)}`, hint: 'Today low' },
    { title: 'Day Range', value: `${getCurrencySymbol(selectedStock.ticker)}${dayRange.toFixed(2)}`, hint: 'High minus low' },
    { title: 'Amplitude', value: `${dayAmplitude.toFixed(2)}%`, hint: 'Vs prev close' },
    { title: 'Volume', value: formatCompactNumber(selectedStock.volume || quote?.volume || 0), hint: 'Today cumulative volume' },
    { title: 'Avg Bar Vol', value: formatCompactNumber(avgBarVolume), hint: 'Average 5m bar volume' },
    { title: 'Turnover', value: quote?.amount ? formatCompactNumber(quote.amount) : '--', hint: 'Today traded amount' },
    { title: 'Turnover Rate', value: quote?.turnover_rate !== null && quote?.turnover_rate !== undefined ? `${quote.turnover_rate.toFixed(2)}%` : '--', hint: 'Shown when available' },
  ] : [];

  return (
    <div className="terminal-page">
      <aside className="watchlist-panel">
        <div className="watchlist-header"><div><p className="eyebrow">Watchlist</p><h1>ZPboard</h1></div><span className="status-pill">{watchlist.length} names</span></div>
        <div className="search-panel">
          <div className="market-toggle">{(['US', 'CN'] as MarketType[]).map((market) => <button key={market} type="button" className={searchMarket === market ? 'active' : ''} onClick={() => setSearchMarket(market)}>{marketLabel[market]}</button>)}</div>
          <label className="search-box"><span>Add stock</span><input value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder={searchMarket === 'US' ? 'AAPL / Tesla' : '600519 / Moutai'} /></label>
          <div className="search-results">
            {searchLoading && <p className="search-hint">Searching...</p>}
            {!searchLoading && searchError && <p className="search-hint search-error">{searchError}</p>}
            {!searchLoading && !searchError && !searchText.trim() && <p className="search-hint">Search by ticker or name and add to your watchlist.</p>}
            {!searchLoading && !searchError && searchText.trim() && searchResults.map((result) => <button key={result.ticker} type="button" className="search-result-item" onClick={() => { addToWatchlist({ ticker: result.ticker, name: result.name, market: searchMarket, price: 0, changePercent: 0, volume: 0 }); selectStock(result.ticker); setSearchText(''); setSearchResults([]); }}><div><strong>{result.ticker}</strong><span>{result.name}</span></div><em>Add</em></button>)}
          </div>
        </div>
        <div className="watchlist-items">
          {watchlist.map((stock) => {
            const isActive = stock.ticker === selectedStock?.ticker;
            const isPositive = stock.changePercent >= 0;
            return <button key={stock.ticker} type="button" className={`watchlist-item${isActive ? ' active' : ''}`} onClick={() => selectStock(stock.ticker)}><div className="watchlist-main"><div><strong>{stock.ticker}</strong><span>{stock.name}</span></div><span className={`badge ${stock.market === 'US' ? 'badge-us' : 'badge-cn'}`}>{marketLabel[stock.market]}</span></div><div className="watchlist-meta"><p>{getCurrencySymbol(stock.ticker)}{stock.price.toFixed(2)}</p><span className={isPositive ? 'positive' : 'negative'}>{formatSigned(stock.changePercent)}%</span></div><div className="watchlist-footer"><small>Vol {formatCompactNumber(stock.volume)}</small><button type="button" className="ghost-action" onClick={(event) => { event.stopPropagation(); removeFromWatchlist(stock.ticker); }}>Remove</button></div></button>;
          })}
        </div>
      </aside>

      <main className="detail-panel">
        {selectedStock ? <>
          <section className="hero-card"><div className="hero-topline"><div><p className="eyebrow">Daily Snapshot</p><h2>{selectedStock.name}<span>{selectedStock.ticker}</span></h2></div><div className="hero-tags"><span>{marketLabel[selectedStock.market]}</span><span>{heroPeriodLabel}</span><span>{snapshotUpdated ? `Snapshot ${formatDateTime(snapshotUpdated)}` : 'Waiting for update'}</span></div></div><div className="hero-metrics"><div><p className="metric-label">Last</p><strong>{getCurrencySymbol(selectedStock.ticker)}{todayPrice.toFixed(2)}</strong></div><div><p className="metric-label">Change</p><strong className={todayDeltaPercent >= 0 ? 'positive' : 'negative'}>{formatSigned(todayDelta)} / {formatSigned(todayDeltaPercent)}%</strong></div><div><p className="metric-label">Amplitude</p><strong>{dayAmplitude.toFixed(2)}%</strong></div></div><p className="hero-summary">{snapshotState.error ? snapshotState.error : summary}</p></section>
          <section className="chart-card"><div className="section-header"><div><h3>Candlestick</h3><p>The chart range changes below, but the snapshot above always stays on today's session data.</p></div><div className="chart-controls"><div className="period-switcher">{periodOptions.map((option) => <button key={option.key} type="button" className={activePeriod === option.key ? 'active' : ''} onClick={() => setActivePeriod(option.key)}>{option.label}</button>)}</div>{activePeriod === '1d' && <div className="period-switcher">{intradayIntervalOptions.map((option) => <button key={option.key} type="button" className={intradayInterval === option.key ? 'active' : ''} onClick={() => setIntradayInterval(option.key)}>{option.label}</button>)}</div>}</div></div>{detailState.loading ? <div className="chart-state">Loading chart...</div> : detailState.error ? <div className="chart-state chart-error">{detailState.error}</div> : <CandleChart data={history} ticker={selectedStock.ticker} market={selectedStock.market} period={activePeriod} interval={effectiveInterval} />}</section>
          <section className="info-grid">{infoCards.map((item) => <InfoCard key={item.title} title={item.title} value={item.value} hint={item.hint} />)}</section>
          <section className="insight-layout"><div className="insight-card"><div className="section-header"><div><h3>Session Notes</h3><p>These bullets use today's session snapshot instead of the selected chart range.</p></div></div><ul className="insight-list"><li>Open {dayOpen.toFixed(2)}, high {dayHigh.toFixed(2)}, low {dayLow.toFixed(2)}, last {todayPrice.toFixed(2)}.</li><li>Daily range is {dayRange.toFixed(2)} and amplitude is {dayAmplitude.toFixed(2)}%.</li><li>Volume is {formatCompactNumber(selectedStock.volume || quote?.volume || 0)} with average 5m bar volume {formatCompactNumber(avgBarVolume)}.</li></ul></div><div className="insight-card"><div className="section-header"><div><h3>Related</h3><p>Quick jump list from the backend recommendation mapping.</p></div></div><div className="related-list">{detailState.related.length > 0 ? detailState.related.map((ticker) => <button key={ticker} type="button" className="related-chip" onClick={() => { const existing = watchlist.find((item) => item.ticker === ticker); if (existing) { selectStock(existing.ticker); return; } addToWatchlist({ ticker, name: ticker, market: ticker.length === 6 && !Number.isNaN(Number(ticker)) ? 'CN' : 'US', price: 0, changePercent: 0, volume: 0 }); selectStock(ticker); }}>{ticker}</button>) : <p className="empty-copy">No related names.</p>}</div></div></section>
        </> : <section className="empty-state">Your watchlist is empty. Add a stock on the left first.</section>}
      </main>
    </div>
  );
}

function InfoCard({ title, value, hint }: { title: string; value: string; hint: string }) {
  return <article className="info-card"><p>{title}</p><strong>{value}</strong><span>{hint}</span></article>;
}
function CandleChart({ data, ticker, market, period, interval }: { data: HistoryPoint[]; ticker: string; market: MarketType; period: PeriodKey; interval: string }) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; index: number } | null>(null);
  if (data.length === 0) return <div className="chart-state">No candlestick data.</div>;
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
      <div className="chart-stats"><span>Open {hoveredBar.open.toFixed(2)}</span><span>High {hoveredBar.high.toFixed(2)}</span><span>Low {hoveredBar.low.toFixed(2)}</span><span>Close {hoveredBar.close.toFixed(2)}</span><span>Vol {formatCompactNumber(hoveredBar.volume)}</span>{period === '1d' && <span>Interval {interval}</span>}</div>
      <div className="ma-legend"><span className="ma-chip ma-chip-5">MA5</span><span className="ma-chip ma-chip-10">MA10</span><span className="ma-chip ma-chip-20">MA20</span></div>
      {tooltip && data[tooltip.index] && <div className="chart-tooltip" style={{ left: tooltip.x, top: tooltip.y }}><strong>{ticker}</strong><span>{formatHoverTime(data[tooltip.index].timestamp, market, period)}</span><span>Open {data[tooltip.index].open.toFixed(2)}</span><span>High {data[tooltip.index].high.toFixed(2)}</span><span>Low {data[tooltip.index].low.toFixed(2)}</span><span>Close {data[tooltip.index].close.toFixed(2)}</span><span>Vol {formatCompactNumber(data[tooltip.index].volume)}</span></div>}
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${ticker} candlestick chart`}>
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
      <div className="chart-footer"><span>{sessionLabel(market, period)}</span><span>{market === 'US' ? 'XAxis uses ET' : 'XAxis uses Beijing time'}</span></div>
    </div>
  );
}

export default App;

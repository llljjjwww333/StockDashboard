import { t, useLanguage } from './lib/i18n';
import { type CSSProperties, type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import './App.css';
import { stockWebSocketService } from './services/stockWebSocketService';
import { type MarketType, type StockQuote, useStockQuoteStore, useStockStore } from './store/stockStore';
import { MarketChart } from './terminal/MarketChart';
import { OrderBook } from './terminal/OrderBook';
import { ChinaMarkets } from './terminal/ChinaMarkets';
import { StockTags } from './terminal/StockTags';
import { isChinaIndex } from './lib/instrumentIdentity';
import { MarketClock } from './terminal/MarketClock';
import { pricePrecision } from './lib/pricePrecision';
import { IndicatorPicker } from './terminal/IndicatorPicker';
import { candleIntervals, candlePeriodAllowed, chartSelection, initialChartSelection, loadChartSelection, saveChartSelection, type CandleInterval, type ChartMode } from './terminal/chartSelection';
import { toStoredQuote } from './lib/quotes';
import { SettingsDialog } from './ai/SettingsDialog';
import { AiControls, AnalysisSummary } from './ai/AiControls';
import { useAiProfiles } from './ai/profileStore';
import { useAnalysis } from './ai/useAnalysis';
import type { AnalysisResult } from './ai/types';
import './ai/ai.css';
import './terminal/chartPresentation.css';
import { periodOptions, type ChinaBoardView, type DeskView, type HotspotRow, type NewsItem, type PeriodKey, type Quote } from './terminal/types';
import {
  formatClock,
  formatCompact,
  formatPrice,
  formatSigned,
  useInstrumentData,
  useMarketOverview,
  useNewsFeed,
  useStockSearch,
} from './terminal/useTerminalData';

type IconName = 'overview' | 'markets' | 'news' | 'search' | 'plus' | 'remove' | 'arrow' | 'pulse' | 'expand';

const navItems: Array<{ id: DeskView; label: string; icon: IconName }> = [
  { id: 'overview', label: '研究台', icon: 'overview' },
  { id: 'markets', label: '市场', icon: 'markets' },
  { id: 'news', label: '情报', icon: 'news' },
];

const iconPaths: Record<IconName, ReactNode> = {
  overview: <><rect x="3" y="3" width="8" height="18" /><rect x="15" y="3" width="6" height="7" /><rect x="15" y="14" width="6" height="7" /></>,
  markets: <><path d="M3 17 8 12l4 3 8-10" /><path d="M16 5h4v4" /><path d="M3 21h18" /></>,
  news: <><path d="M5 4h14v16H5z" /><path d="M8 8h8M8 12h8M8 16h5" /></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  remove: <><path d="M5 7h14M9 7V4h6v3M8 7l1 13h6l1-13" /></>,
  arrow: <><path d="M5 12h14M14 7l5 5-5 5" /></>,
  pulse: <path d="M3 13h4l2-7 4 13 2-7h6" />,
  expand: <path d="M3 9V3h6m6 0h6v6m0 6v6h-6m-6 0H3v-6" />,
};

function Icon({ name }: { name: IconName }) {
  return <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">{iconPaths[name]}</svg>;
}

function Delta({ value, suffix = '%' }: { value: number; suffix?: string }) {
  return <span className={`delta ${value >= 0 ? 'positive' : 'negative'}`}>{formatSigned(value)}{suffix}</span>;
}

const getInitialView = (): DeskView => {
  const value = new URLSearchParams(window.location.search).get('view');
  return value === 'markets' || value === 'news' ? value : 'overview';
};

const getInitialMarket = (): MarketType => new URLSearchParams(window.location.search).get('market') === 'CN' ? 'CN' : 'US';

function App() {
  useLanguage();
  const { watchlist, selectedTicker, addToWatchlist, removeFromWatchlist, selectStock } = useStockStore();
  const quotes = useStockQuoteStore((state) => state.quotes);
  const connectionStatus = useStockQuoteStore((state) => state.connectionStatus);
  const updateQuote = useStockQuoteStore((state) => state.updateStockQuote);
  const [view, setView] = useState<DeskView>(getInitialView);
  const [market, setMarket] = useState<MarketType>(getInitialMarket);
  const [chart, dispatchChart] = useReducer(chartSelection, initialChartSelection, () => loadChartSelection());
  const { period, mode: chartMode } = chart;
  const [searchQuery, setSearchQuery] = useState('');
  const [activeStory, setActiveStory] = useState<NewsItem | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [immersive, setImmersive] = useState(false);
  const [boardView, setBoardView] = useState<ChinaBoardView>({ category: 'industry', sort: 'strong', page: 1, query: '', selection: null });
  const [boardOriginTicker, setBoardOriginTicker] = useState<string | null>(null);
  const returnToBoard = useRef(false);
  const [watchSort, setWatchSort] = useState<'manual' | 'change' | 'volume'>('manual');
  const searchRef = useRef<HTMLInputElement | null>(null);
  const toggleImmersive = useCallback(() => {
    setImmersive(value => !value);
    window.scrollTo(0, 0);
  }, []);

  const selectedStock = watchlist.find((stock) => stock.ticker === selectedTicker) ?? watchlist[0] ?? null;
  const selectedTickerSafe = selectedStock?.ticker ?? null;
  const activePeriod = periodOptions.find((item) => item.key === period) ?? periodOptions[2];
  const interval = chartMode === 'candles' ? chart.candleInterval : activePeriod.interval;
  const instrument = useInstrumentData(selectedTickerSafe, period, interval, chartMode === 'candles', view === 'overview', connectionStatus === 'connected');
  const marketState = useMarketOverview(market, view !== 'news');
  const newsState = useNewsFeed(view !== 'markets');
  const search = useStockSearch(searchQuery, market);
  const liveQuote = selectedTickerSafe ? quotes[selectedTickerSafe] : null;
  const quote = liveQuote?.snapshot ?? instrument.quoteState.data;
  const price = liveQuote?.price ?? quote?.price ?? 0;
  const changePercent = liveQuote?.changePercent ?? quote?.change_percent ?? 0;
  const previousClose = quote?.previous_close ?? (changePercent !== -100 ? price / (1 + changePercent / 100) : price);
  const changeValue = price - previousClose;
  const dayOpen = quote?.open_price ?? 0;
  const dayHigh = quote?.high_price ?? 0;
  const dayLow = quote?.low_price ?? 0;

  const sortedWatchlist = watchSort === 'manual'
    ? watchlist
    : [...watchlist].sort((left, right) => watchSort === 'change'
      ? (quotes[right.ticker]?.changePercent ?? 0) - (quotes[left.ticker]?.changePercent ?? 0)
      : (quotes[right.ticker]?.volume ?? 0) - (quotes[left.ticker]?.volume ?? 0));

  useEffect(() => {
    stockWebSocketService.connect();
    const unsubscribe = useStockStore.subscribe(() => stockWebSocketService.updateSubscriptions());
    return () => {
      unsubscribe();
      stockWebSocketService.disconnect();
    };
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('view', view);
    url.searchParams.set('market', market);
    window.history.replaceState(null, '', url);
  }, [market, view]);
  useLayoutEffect(() => {
    if (view === 'markets' && returnToBoard.current) {
      returnToBoard.current = false;
      document.getElementById('cn-board-focus')?.scrollIntoView({ block: 'start' });
    } else window.scrollTo(0, 0);
  }, [view]);

  useEffect(() => { saveChartSelection(chart); }, [chart]);

  useEffect(() => {
    const incoming = instrument.quoteState.data;
    if (view === 'overview' && incoming) updateQuote(incoming.ticker, toStoredQuote(incoming));
  }, [instrument.quoteState.data, updateQuote, view]);

  const changeMarket = (next: MarketType) => {
    setMarket(next);
    setSearchQuery('');
    if (view === 'overview' && selectedStock?.market !== next) {
      const stock = watchlist.find(item => item.market === next);
      if (stock) selectStock(stock.ticker);
      else searchRef.current?.focus();
    }
  };

  useEffect(() => {
    const handleKeyboard = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.isComposing || document.querySelector('dialog[open]')) return;
      const chartOverlay = document.querySelector('.professional-chart.is-expanded, .indicator-menu');
      if (event.key === 'Escape' && immersive && !chartOverlay) {
        toggleImmersive();
        return;
      }
      if (event.defaultPrevented || chartOverlay) return;
      const typing = Boolean(target?.closest('input, textarea, select, [role="combobox"]') || target?.isContentEditable);
      if (event.key === 'Escape') {
        setSearchQuery('');
        searchRef.current?.blur();
        return;
      }
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
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
      if ((event.key.toLowerCase() === 'j' || event.key.toLowerCase() === 'k') && sortedWatchlist.length) {
        event.preventDefault();
        const current = Math.max(0, sortedWatchlist.findIndex((item) => item.ticker === selectedTicker));
        const offset = event.key.toLowerCase() === 'j' ? 1 : -1;
        const stock = sortedWatchlist[(current + offset + sortedWatchlist.length) % sortedWatchlist.length];
        selectStock(stock.ticker);
        setBoardOriginTicker(null);
        setMarket(stock.market);
        setSearchQuery('');
        setView('overview');
      }
    };
    window.addEventListener('keydown', handleKeyboard);
    return () => window.removeEventListener('keydown', handleKeyboard);
  }, [immersive, selectStock, selectedTicker, selectedTickerSafe, sortedWatchlist, toggleImmersive, view]);

  const openInstrument = (ticker: string, name: string, nextMarket: MarketType, seed = { price: 0, changePercent: 0, volume: 0 }) => {
    addToWatchlist({ ticker, name, market: nextMarket, ...seed });
    selectStock(ticker);
    setBoardOriginTicker(null);
    setMarket(nextMarket);
    setSearchQuery('');
    searchRef.current?.blur();
    if (view === 'overview') window.scrollTo(0, 0);
    setView('overview');
  };

  const selectMarketRow = (row: HotspotRow, fromBoard = false) => {
    openInstrument(row.ticker, row.name, market, {
      price: row.price,
      changePercent: row.change_percent,
      volume: row.volume,
    });
    if (fromBoard) setBoardOriginTicker(row.ticker);
  };

  const backToBoard = () => {
    returnToBoard.current = true;
    setImmersive(false);
    setMarket('CN');
    setView('markets');
  };

  const openStory = (item: NewsItem) => {
    if (item.url && /^https?:\/\//i.test(item.url)) window.open(item.url, '_blank', 'noopener,noreferrer');
    else setActiveStory(item);
  };

  return (
    <div className={`app-shell${immersive ? ' is-immersive' : ''}`}>
      <Sidebar
        view={view}
        setView={setView}
        watchlist={sortedWatchlist}
        selectedTicker={selectedTickerSafe}
        quotes={quotes}
        connectionStatus={connectionStatus}
        watchSort={watchSort}
        setWatchSort={setWatchSort}
        selectStock={(stock) => {
          selectStock(stock.ticker);
          setBoardOriginTicker(null);
          setMarket(stock.market);
          setSearchQuery('');
          setView('overview');
        }}
        removeFromWatchlist={removeFromWatchlist}
      />

      <div className="app-main">
        <Topbar
          market={market}
          setMarket={changeMarket}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          searchRef={searchRef}
          search={search}
          onSelect={(ticker, name) => openInstrument(ticker, name, market)}
          onSettings={() => setSettingsOpen(true)}
        />

        <main className="content-canvas">
          {connectionStatus === 'disconnected' && <div className="connection-banner" role="status">{t("重新连接中")}</div>}
          {view === 'overview' && (
            <Overview
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
              amount={quote?.amount ?? 0}
              turnoverRate={quote?.turnover_rate ?? null}
              quoteDetails={quote}
              period={period}
              setPeriod={period => dispatchChart({ type: 'period', period })}
              chartMode={chartMode}
              setChartMode={mode => dispatchChart({ type: 'mode', mode })}
              candleInterval={chart.candleInterval}
              setCandleInterval={interval => dispatchChart({ type: 'interval', interval })}
              interval={interval}
              onSettings={() => setSettingsOpen(true)}
              history={instrument.historyState.data ?? []}
              indicatorHistory={instrument.indicatorHistory}
              historyLoading={instrument.historyState.loading}
              quoteError={instrument.quoteState.error}
              historyError={instrument.historyState.error}
              historyStale={instrument.historyStale}
              historyMeta={instrument.historyMeta}
              source={liveQuote?.source ?? quote?.source ?? null}
              asOf={liveQuote?.asOf ?? quote?.as_of ?? null}
              stale={liveQuote?.stale ?? quote?.stale ?? false}
              marketData={marketState.data}
              marketLoading={marketState.loading}
              news={newsState.data?.items ?? []}
              newsLoading={newsState.loading}
              newsError={newsState.error}
              onOpenStory={openStory}
              onSelectMarket={selectMarketRow}
              openMarkets={() => setView('markets')}
              openNews={() => setView('news')}
              onBackToBoard={boardOriginTicker && boardOriginTicker === selectedTickerSafe ? backToBoard : undefined}
            />
          )}
          {view === 'markets' && (
            <Markets
              market={market}
              setMarket={changeMarket}
              data={marketState.data}
              loading={marketState.loading}
              error={marketState.error}
              onSelect={selectMarketRow}
              boardView={boardView}
              onBoardViewChange={setBoardView}
            />
          )}
          {view === 'news' && (
            <Intelligence data={newsState.data?.items ?? []} loading={newsState.loading} error={newsState.error} onOpenStory={openStory} market={market} onSettings={() => setSettingsOpen(true)} />
          )}
        </main>
      </div>
      {activeStory && <NewsDialog item={activeStory} onClose={() => setActiveStory(null)} />}
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

type SidebarProps = {
  view: DeskView;
  setView: (view: DeskView) => void;
  watchlist: Array<{ ticker: string; name: string; market: MarketType }>;
  selectedTicker: string | null;
  quotes: Record<string, StockQuote>;
  connectionStatus: 'connecting' | 'connected' | 'disconnected';
  watchSort: 'manual' | 'change' | 'volume';
  setWatchSort: (sort: 'manual' | 'change' | 'volume') => void;
  selectStock: (stock: SidebarProps['watchlist'][number]) => void;
  removeFromWatchlist: (ticker: string) => void;
};

function Sidebar(props: SidebarProps) {
  const watchItems = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const list = watchItems.current;
    const selected = list?.querySelector('.watch-item.active');
    if (!list || !selected || list.scrollWidth <= list.clientWidth) return;
    const bounds = list.getBoundingClientRect();
    const card = selected.getBoundingClientRect();
    if (card.left < bounds.left) list.scrollLeft += card.left - bounds.left;
    else if (card.right > bounds.right) list.scrollLeft += card.right - bounds.right;
  }, [props.selectedTicker, props.watchSort]);

  return (
    <aside className="sidebar">
      <button type="button" className="brand" onClick={() => props.setView('overview')}>
        <span className="brand-mark"><img src="/zpboard.png" alt="" /></span>
        <span><strong>ZPBOARD</strong></span>
      </button>

      <nav className="primary-nav" aria-label={t("主导航")}>
        {navItems.map((item) => (
          <button key={item.id} type="button" className={props.view === item.id ? 'active' : ''} onClick={() => props.setView(item.id)}>
            <Icon name={item.icon} />
            <span><strong>{t(item.label)}</strong></span>
          </button>
        ))}
      </nav>

      <section className="watchlist">
        <header>
          <div><strong>{t("自选")}</strong></div>
          <div className="watch-sort">
            <button className={props.watchSort === 'manual' ? 'active' : ''} onClick={() => props.setWatchSort('manual')}>{t("默认")}</button>
            <button className={props.watchSort === 'change' ? 'active' : ''} onClick={() => props.setWatchSort('change')}>{t("涨幅")}</button>
          </div>
        </header>
        <div className="watch-items" ref={watchItems}>
          {props.watchlist.map((stock) => {
            const quote = props.quotes[stock.ticker];
            const name = quote?.snapshot?.name || stock.name;
            const amount = quote?.snapshot?.amount;
            const turnover = quote?.snapshot?.turnover_rate;
            return (
              <div key={stock.ticker} className={`watch-item${props.selectedTicker === stock.ticker ? ' active' : ''}`}>
                <button type="button" className="watch-select" aria-pressed={props.selectedTicker === stock.ticker} onClick={() => props.selectStock(stock)}>
                  <span className="watch-name"><strong>{stock.ticker}</strong><small title={name}>{isChinaIndex(stock.ticker) ? t(name) : name}</small></span>
                  <span className="watch-value"><strong>{quote ? formatPrice(quote.price, stock.market, stock.ticker) : '--'}</strong>{quote ? <Delta value={quote.changePercent} /> : <small>{t("等待报价")}</small>}</span>
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
      </section>

      <footer className="sidebar-footer">
        <span data-status={props.connectionStatus}><i /> {props.connectionStatus === 'connected' ? t("已连接") : props.connectionStatus === 'connecting' ? t("连接中") : t("重新连接中")}</span>
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
  searchRef: React.RefObject<HTMLInputElement | null>;
  search: { results: Array<{ ticker: string; name: string }>; loading: boolean; error: string | null };
  onSelect: (ticker: string, name: string) => void;
};

function Topbar({ searchRef, ...props }: TopbarProps) {
  const [selection, setSelection] = useState({ key: '', index: 0 });
  const searchKey = `${props.market}:${props.searchQuery}`;
  const searchOpen = Boolean(props.searchQuery.trim());
  const activeIndex = selection.key === searchKey ? Math.min(selection.index, Math.max(props.search.results.length - 1, 0)) : 0;
  return (
    <header className="topbar">
      <div className="market-context">
        <div role="group" aria-label={t("市场")}>
          <button type="button" className={props.market === 'US' ? 'active' : ''} aria-pressed={props.market === 'US'} onClick={() => props.setMarket('US')}>{t("美股")}</button>
          <button type="button" className={props.market === 'CN' ? 'active' : ''} aria-pressed={props.market === 'CN'} onClick={() => props.setMarket('CN')}>{t("A 股")}</button>
        </div>
      </div>

      <div className="command-search" onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget)) props.setSearchQuery('');
      }}>
        <Icon name="search" />
        <input
          ref={searchRef}
          value={props.searchQuery}
          onChange={(event) => props.setSearchQuery(event.target.value)}
          placeholder={t("搜索股票")}
          aria-label={t("搜索股票")}
          role="combobox"
          aria-expanded={searchOpen}
          aria-controls={searchOpen ? 'stock-search-results' : undefined}
          aria-activedescendant={searchOpen && props.search.results[activeIndex] ? `stock-option-${activeIndex}` : undefined}
          autoComplete="off"
          onKeyDown={(event) => {
            if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && props.search.results.length) {
              event.preventDefault();
              const offset = event.key === 'ArrowDown' ? 1 : -1;
              setSelection({ key: searchKey, index: (activeIndex + offset + props.search.results.length) % props.search.results.length });
            }
            if (event.key === 'Enter' && props.search.results[activeIndex]) {
              event.preventDefault();
              const result = props.search.results[activeIndex];
              props.onSelect(result.ticker, result.name);
            }
          }}
        />
        {searchOpen && (
          <div id="stock-search-results" className="search-results" role="listbox" aria-label={t("股票搜索结果")}>
            <header><span>{t("搜索结果")}</span><small>{props.search.loading ? t("正在检索") : t("{count} 个结果", { count: props.search.results.length })}</small></header>
            {props.search.results.map((result, index) => (
              <button id={`stock-option-${index}`} key={result.ticker} role="option" aria-selected={activeIndex === index} type="button" onMouseDown={event => event.preventDefault()} onMouseEnter={() => setSelection({ key: searchKey, index })} onClick={() => props.onSelect(result.ticker, result.name)}>
                <span className="result-monogram">{result.ticker.slice(0, 2)}</span>
                <span><strong>{result.ticker}</strong><small>{isChinaIndex(result.ticker) ? t(result.name) : result.name} <StockTags ticker={result.ticker} name={result.name} /></small></span>
                <Icon name="plus" />
              </button>
            ))}
            {props.search.error && <p role="status">{t(props.search.error)}</p>}
            {!props.search.loading && !props.search.error && !props.search.results.length && <p>{t("没有找到匹配标的")}</p>}
          </div>
        )}
      </div>
      <button type="button" className="settings-trigger" onClick={props.onSettings}>{t("设置")}</button>
    </header>
  );
}

type OverviewProps = {
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
  amount: number;
  turnoverRate: number | null;
  quoteDetails: Quote | null;
  period: PeriodKey;
  setPeriod: (period: PeriodKey) => void;
  chartMode: ChartMode;
  setChartMode: (mode: ChartMode) => void;
  candleInterval: CandleInterval;
  setCandleInterval: (interval: CandleInterval) => void;
  history: Parameters<typeof MarketChart>[0]['data'];
  indicatorHistory: Parameters<typeof MarketChart>[0]['data'];
  historyLoading: boolean;
  quoteError: string | null;
  historyError: string | null;
  historyStale: boolean;
  historyMeta: ReturnType<typeof useInstrumentData>['historyMeta'];
  source: string | null;
  asOf: string | null;
  stale: boolean;
  marketData: ReturnType<typeof useMarketOverview>['data'];
  marketLoading: boolean;
  news: NewsItem[];
  newsLoading: boolean;
  newsError: string | null;
  onOpenStory: (item: NewsItem) => void;
  onSelectMarket: (row: HotspotRow) => void;
  openMarkets: () => void;
  openNews: () => void;
  onBackToBoard?: () => void;
};

function Overview(props: OverviewProps) {
  const { chartMode, setChartMode } = props;
  const intraday = props.period === '1d' || props.period === '5d';
  const { profiles, activeId } = useAiProfiles();
  const profile = profiles.find(p => p.id === activeId);
  const analysis = useAnalysis(`chart:${props.selectedStock?.ticker}:${props.period}:${props.interval}:${chartMode}`, profile);
  const [selection, setSelection] = useState<{ result: AnalysisResult; id: string } | null>(null);
  const selectedAnnotation = selection?.result === analysis.result ? selection?.id : undefined;
  const selectAnnotation = useCallback((id: string) => {
    if (analysis.result) setSelection({ result: analysis.result, id });
  }, [analysis.result]);
  const chartData = props.history.length > 0 ? props.history : analysis.result?.data ?? props.history;
  const { chartAnnotations, trendlines } = useMemo(() => {
    const indexByTime = new Map(chartData.map((bar, index) => [Date.parse(bar.timestamp), index]));
    return {
      chartAnnotations: (analysis.result?.annotations ?? []).flatMap(point => {
        const index = indexByTime.get(Date.parse(point.timestamp));
        return index === undefined ? [] : [{ ...point, index, timestamp: chartData[index].timestamp }];
      }),
      trendlines: (analysis.result?.trendlines ?? []).flatMap(line => {
        const startIndex = indexByTime.get(Date.parse(line.start.timestamp));
        const endIndex = indexByTime.get(Date.parse(line.end.timestamp));
        return startIndex === undefined || endIndex === undefined || startIndex >= endIndex ? [] : [{ ...line, startIndex, endIndex }];
      }),
    };
  }, [analysis.result, chartData]);
  if (!props.selectedStock) {
    return <section className="empty-state"><h1>{t("暂无自选股")}</h1><p>{t("搜索并添加股票")}</p></section>;
  }

  const stock = props.selectedStock;
  const stockName = props.quoteDetails?.name || stock.name;
  const positive = props.changePercent >= 0;
  const digits = pricePrecision(stock.ticker, props.price);

  return (
    <div className="overview">
      <header className="instrument-hero">
        <div className="instrument-title">
          {props.onBackToBoard && <button type="button" className="board-back" onClick={props.onBackToBoard}><Icon name="arrow" />{t('返回板块')}</button>}
          <h1>{isChinaIndex(stock.ticker) ? t(stockName) : stockName}</h1>
          <div><strong>{stock.ticker}</strong><StockTags key={stock.ticker} ticker={stock.ticker} name={stockName} variant="detail" /><MarketClock ticker={stock.ticker} asOf={props.asOf} source={props.source} />{stock.market === 'US' && <small className="quote-tag">{t("延时")}</small>}{props.stale && <small className="quote-tag">{t("缓存")}</small>}</div>
        </div>
        <div className="hero-quote">
          <strong>{props.price > 0 ? formatPrice(props.price, stock.market, stock.ticker) : '--'}</strong>
          {props.price > 0 && <div className={positive ? 'positive' : 'negative'}><span>{formatSigned(props.changeValue, digits)}</span><span>{formatSigned(props.changePercent)}%</span></div>}
        </div>
      </header>

      {props.quoteError && props.price <= 0 && <div role="status" className="error-banner">{t("行情暂不可用")}</div>}

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
                  onRun={() => analysis.run({ scope: 'chart', ticker: stock.ticker, market: stock.market, period: props.period, interval: props.interval, chart_type: chartMode })}
                  onClear={analysis.clear} hasResult={Boolean(analysis.result)} />
                <button type="button" className="immersive-trigger" title={`${t(props.immersive ? "退出沉浸" : "沉浸看盘")} (F)`} aria-keyshortcuts="F" aria-pressed={props.immersive}
                  onClick={props.onToggleImmersive}><Icon name="expand" />{t(props.immersive ? "退出沉浸" : "沉浸看盘")}</button>
              </div>
              <div className="period-tabs" role="group" aria-label={t('时间范围')}>
                {periodOptions.filter(item => chartMode === 'line' || candlePeriodAllowed(props.candleInterval, item.key)).map(item => (
                  <button key={item.key} type="button" className={props.period === item.key ? 'active' : ''} aria-pressed={props.period === item.key} onClick={() => props.setPeriod(item.key)}>
                    {t(chartMode === 'candles' && item.key === '1d' ? '1日' : item.label)}
                  </button>
                ))}
              </div>
            </div>
          </header>
          {analysis.error && <div className="error-banner" role="status">{t(analysis.error)}</div>}
          {props.historyError && !chartData.length && <div role="status" className="error-banner">{t(props.historyError)}</div>}
          <div className="chart-wrap">
            {props.historyLoading && !chartData.length
              ? <LoadingBlock label={t("加载中")} />
              : <MarketChart key={`${stock.ticker}:${props.period}:${props.interval}:${chartMode}`} data={chartData} warmup={props.indicatorHistory} ticker={stock.ticker} period={props.period} mode={chartMode} interval={props.interval}
                  referencePrice={props.historyMeta?.reference_price} adjustment={props.historyMeta?.adjustment} source={props.historyMeta?.source}
                  immersive={props.immersive} annotations={chartAnnotations} trendlines={trendlines} selectedAnnotation={selectedAnnotation} onSelectAnnotation={selectAnnotation} />}
          </div>
          <div className="key-stats">
            <Metric label={t("今开")} value={props.dayOpen > 0 ? props.dayOpen.toFixed(digits) : '--'} />
            <Metric label={t("昨收")} value={props.quoteDetails?.previous_close?.toFixed(digits) ?? '--'} />
            <Metric label={t("最高")} value={props.dayHigh > 0 ? props.dayHigh.toFixed(digits) : '--'} tone="positive" />
            <Metric label={t("最低")} value={props.dayLow > 0 ? props.dayLow.toFixed(digits) : '--'} tone="negative" />
            <Metric label={t("振幅")} value={formatMetric(props.quoteDetails?.amplitude_percent, '%')} />
            <Metric label={t("量比")} value={formatMetric(props.quoteDetails?.volume_ratio)} />
            <Metric label={t("成交量")} value={props.price > 0 ? formatCompact(props.volume) : '--'} />
            <Metric label={t("成交额")} value={props.amount ? formatCompact(props.amount) : '--'} />
            <Metric label={t("换手率")} value={props.turnoverRate === null ? '--' : `${props.turnoverRate.toFixed(2)}%`} />
            <Metric label={t("市盈率")} value={formatMetric(props.quoteDetails?.pe_ratio)} />
            <Metric label={t("市净率")} value={formatMetric(props.quoteDetails?.pb_ratio)} />
            <Metric label={t("总市值")} value={props.quoteDetails?.market_cap ? `${stock.market === 'CN' ? '¥' : '$'}${formatCompact(props.quoteDetails.market_cap)}` : '--'} />
          </div>
          {analysis.result && <AnalysisSummary result={analysis.result} onAnnotation={selectAnnotation} />}
        </section>

        <aside className="insight-column">
          <OrderBook ticker={stock.ticker} quote={props.quoteDetails} />
          <MarketSnapshot data={props.marketData} loading={props.marketLoading} onOpen={props.openMarkets} />

          <section className="movers-card surface">
            <header><div><h2>{t("领涨")}</h2></div><button onClick={props.openMarkets}>{t("全部")} <Icon name="arrow" /></button></header>
            <MoverRows rows={props.marketData?.leaders.slice(0, 4) ?? []} onSelect={props.onSelectMarket} />
          </section>
        </aside>
      </div>

      <section className="intelligence-strip">
        <header>
          <div><h2>{t("资讯")}</h2></div>
          <button onClick={props.openNews}>{t("更多")} <Icon name="arrow" /></button>
        </header>
        <div className="story-grid">
          {props.news.slice(0, 3).map((item, index) => (
            <button key={`${item.published_at}-${index}`} onClick={() => props.onOpenStory(item)}>
              <span><time>{formatClock(item.published_at)}</time><small>{item.source}</small></span>
              <h3>{item.title}</h3>
            </button>
          ))}
          {!props.news.length && (props.newsLoading ? <LoadingBlock label={t("加载中")} /> : <p className="empty-message" role="status">{t(props.newsError ?? "暂无新闻")}</p>)}
        </div>
      </section>

    </div>
  );
}

function formatMetric(value: number | null | undefined, suffix = '') {
  return value !== null && value !== undefined && Number.isFinite(value) ? `${value.toFixed(2)}${suffix}` : '--';
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'positive' | 'negative' }) {
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

function MoverRows({ rows, onSelect }: { rows: HotspotRow[]; onSelect: (row: HotspotRow) => void }) {
  return <div className="mover-rows">{rows.map((row) => (
    <button key={row.ticker} onClick={() => onSelect(row)}>
      <span><strong>{row.ticker}</strong><small>{row.name}</small><StockTags ticker={row.ticker} name={row.name} /></span>
      <span><strong>{row.price.toFixed(pricePrecision(row.ticker, row.price))}</strong><Delta value={row.change_percent} /></span>
    </button>
  ))}</div>;
}

function Markets({ market, setMarket, data, loading, error, onSelect, boardView, onBoardViewChange }: {
  market: MarketType;
  setMarket: (market: MarketType) => void;
  data: ReturnType<typeof useMarketOverview>['data'];
  loading: boolean;
  error: string | null;
  onSelect: (row: HotspotRow, fromBoard?: boolean) => void;
  boardView: ChinaBoardView;
  onBoardViewChange: (view: ChinaBoardView) => void;
}) {
  const marketTabs = <div className="page-tabs"><button type="button" className={market === 'US' ? 'active' : ''} aria-pressed={market === 'US'} onClick={() => setMarket('US')}>{t("美国市场")}</button><button type="button" className={market === 'CN' ? 'active' : ''} aria-pressed={market === 'CN'} onClick={() => setMarket('CN')}>{t("中国市场")}</button></div>;
  if (market === 'CN') return <div className="markets-page">
    <PageHeader title={t("A 股市场")} />
    <ChinaMarkets data={data} onSelect={onSelect} boardView={boardView} onBoardViewChange={onBoardViewChange} />
  </div>;

  const heatRows = data?.sectors?.length ? data.sectors : [...(data?.leaders ?? []), ...(data?.laggards ?? [])];
  const maxChange = Math.max(...heatRows.map((row) => Math.abs(row.change_percent)), 1);
  return (
    <div className="markets-page">
      <PageHeader title={t("市场")}>
        {marketTabs}
      </PageHeader>
      {error && <div className="error-banner">{t(error)}</div>}
      {data && <div className="market-meta"><span>{data.summary.mode === 'full_market' ? t("全市场") : t("样本")}</span><time>{formatClock(data.updated_at)}</time>{data.stale && <span>{t("缓存")}</span>}</div>}
      <section className="index-row">
        {(data?.indices ?? []).slice(0, 5).map((row) => <button key={row.ticker} onClick={() => onSelect(row)}><span>{row.name}</span><strong>{row.price.toFixed(2)}</strong><Delta value={row.change_percent} /><small>{row.ticker}</small></button>)}
      </section>
      <div className="market-grid">
        <section className="heatmap surface">
          <header className="section-header"><div><h2>{t("板块")}</h2></div><small>{data ? t("更新 {time}", { time: formatClock(data.updated_at) }) : '--'}</small></header>
          <div className="heatmap-grid">
            {heatRows.slice(0, 16).map((row, index) => (
              <button key={`${row.ticker}-${index}`} data-direction={row.change_percent >= 0 ? 'up' : 'down'} style={{ ['--heat' as string]: Math.max(Math.abs(row.change_percent) / maxChange, .12) } as CSSProperties} onClick={() => onSelect(row)}>
                <span>{row.sector ?? row.name}</span><small>{row.ticker}</small><Delta value={row.change_percent} /><em>{formatCompact(row.volume)}</em>
              </button>
            ))}
            {loading && !heatRows.length && <LoadingBlock label={t("加载中")} />}
          </div>
        </section>
        <section className="ranking surface">
          <header className="section-header"><div><h2>{t("排行")}</h2></div></header>
          <div className="ranking-columns"><div><h3>{t("领涨")}</h3><MoverRows rows={data?.leaders.slice(0, 8) ?? []} onSelect={onSelect} /></div><div><h3>{t("领跌")}</h3><MoverRows rows={data?.laggards.slice(0, 8) ?? []} onSelect={onSelect} /></div></div>
        </section>
      </div>
    </div>
  );
}

function Intelligence({ data, loading, error, onOpenStory, market, onSettings }: { data: NewsItem[]; loading: boolean; error: string | null; onOpenStory: (item: NewsItem) => void; market: MarketType; onSettings: () => void }) {
  const [query, setQuery] = useState('');
  const [source, setSource] = useState('ALL');
  const { profiles, activeId } = useAiProfiles();
  const profile = profiles.find(p => p.id === activeId);
  const analysis = useAnalysis(`news:${market}:${source}:${query}`, profile);
  const filtered = data.filter((item) => (source === 'ALL' || item.source === source) &&
    `${item.title} ${item.summary}`.toLowerCase().includes(query.trim().toLowerCase()));
  const sources = [...new Set(data.map((item) => item.source))];
  return (
    <div className="news-page">
      <PageHeader title={t("资讯")}><AiControls profile={profile} loading={analysis.loading} onSettings={onSettings}
        onRun={() => analysis.run({ scope: 'news', market, query, news_source: source })}
        onClear={analysis.clear} hasResult={Boolean(analysis.result)} /></PageHeader>
      <div className="news-filters">
        <input aria-label={t("筛选财经新闻")} placeholder={t("搜索资讯")} value={query} onChange={(event) => setQuery(event.target.value)} />
        <select aria-label={t("新闻来源")} value={source} onChange={(event) => setSource(event.target.value)}><option value="ALL">{t("全部来源")}</option>{sources.map((name) => <option key={name} value={name}>{name}</option>)}</select>
        {(query || source !== 'ALL') && <button type="button" onClick={() => { setQuery(''); setSource('ALL'); }}>{t("清除筛选")}</button>}
        <small>{filtered.length} / {data.length} {t("条")}</small>
      </div>
      {error && <div role="status" className="error-banner">{t(error)}</div>}
      {analysis.error && <div className="error-banner" role="status">{t(analysis.error)}</div>}
      {analysis.result && <AnalysisSummary result={analysis.result} />}
      {!filtered.length && (loading ? <LoadingBlock label={t("加载中")} /> : <p className="empty-message">{query || source !== 'ALL' ? t("没有匹配结果") : t("暂无新闻")}</p>)}
      <section className="news-feed surface">
        <div>
          {filtered.map((item, index) => (
            <button key={`${item.published_at}-${index}`} onClick={() => onOpenStory(item)}>
              <time>{formatClock(item.published_at)}</time>
              <div><h3>{item.title}</h3><p>{item.summary}</p></div>
              <small>{item.source}</small>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function NewsDialog({ item, onClose }: { item: NewsItem; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return <dialog ref={ref} className="news-dialog" aria-labelledby="news-dialog-title" onCancel={onClose} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <article>
      <header><span>{item.source} · {formatClock(item.published_at)}</span><button type="button" aria-label={t("关闭新闻")} onClick={onClose}>{t("关闭 ×")}</button></header>
      <h2 id="news-dialog-title">{item.title}</h2>
      <p>{item.summary}</p>
    </article>
  </dialog>;
}

function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return <header className="page-header"><h1>{title}</h1>{children}</header>;
}

export default App;

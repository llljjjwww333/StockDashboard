import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildApiUrl } from '../lib/api';
import { getLocale } from '../lib/i18n';
import { useOnlineStatus } from '../lib/useOnlineStatus';
import { useCryptoStreamStore } from '../store/cryptoStreamStore';
import type { NewsScope } from './newsView';
import { resourceCache, stockMembershipCache, type ResourceCache } from '../lib/resourceCache';
import { remainingFreshTime } from '../lib/resourceFreshness';
import { pageResumeClock } from '../lib/pageResume';
import { pricePrecision } from '../lib/pricePrecision';
import { isChinaEquity, isChinaIndex, isChinaTicker, isInstrumentTicker, type StockMemberships } from '../lib/instrumentIdentity';
import { isActivePhase, marketPhase, type MarketPhase } from './marketSession';
import { useMarketPhase, useQuoteStreamHealth } from './useMarketPhase';
import { compatibleIndicatorHistory } from './indicatorWarmup';
import type { MarketType } from '../store/stockStore';
import type {
  HistoryResponse,
  ChinaIndex,
  ChinaBoardPage,
  ChinaBoardMember,
  HotspotResponse,
  Loadable,
  NewsResponse,
  PeriodKey,
  Quote,
  SearchResult,
} from './types';

const idle = <T,>(loading = false): Loadable<T> => ({ data: null, loading, error: null });
type ResourceState<T> = Loadable<T> & { savedAt?: number; requestedAt?: number; failedRequestAt?: number };

function historyPath(ticker: string, period: PeriodKey, interval: string, candles: boolean) {
  return `/stocks/${ticker}/history?period=${period}&interval=${interval}${candles && (period === '1d' || period === '5d') ? '&candles=true' : ''}`;
}

function historyRefresh(period: PeriodKey, active: boolean) {
  if (period !== '1d' && period !== '5d') return 60000;
  return active ? 5000 : 30000;
}

function freshHistoryFor(path: string, refreshMs: number) {
  const cached = resourceCache.read<HistoryResponse>(path);
  return cached?.data.data.length && !cached.data.stale
    ? Math.max(0, refreshMs - (Date.now() - cached.savedAt)) : 0;
}

export function useHistoryPrefetch() {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inFlight = useRef(false);
  const nextAllowed = useRef(0);
  const cancel = useCallback(() => clearTimeout(timer.current), []);
  useEffect(() => cancel, [cancel]);
  const schedule = (ticker: string, period: PeriodKey, interval: string, candles: boolean) => {
    cancel();
    timer.current = setTimeout(() => {
      if (document.hidden || !navigator.onLine || inFlight.current || Date.now() < nextAllowed.current) return;
      const path = historyPath(ticker, period, interval, candles);
      if (freshHistoryFor(path, historyRefresh(period, isActivePhase(marketPhase(ticker, new Date()))))) return;
      inFlight.current = true;
      nextAllowed.current = Date.now() + 1000;
      void resourceCache.request<HistoryResponse>(path, buildApiUrl(path))
        .catch(() => { /* The selected chart can retry on demand. */ })
        .finally(() => { inFlight.current = false; });
    }, 220);
  };
  return { schedule, cancel };
}

function useResource<T>(path: string | null, refreshMs: number, message: string, enabled = true,
  { reuseFreshHistory = false, reuseFreshData = false, cache = resourceCache, phase }:
    { reuseFreshHistory?: boolean; reuseFreshData?: boolean; cache?: ResourceCache; phase?: MarketPhase } = {},
): ResourceState<T> & { retry: () => void } {
  const [attempt, setAttempt] = useState(0);
  const lastAttempt = useRef(0);
  const retry = useCallback(() => setAttempt(value => value + 1), []);
  const cached = path ? cache.read<T>(path) : undefined;
  const cachedState = useMemo<ResourceState<T>>(() => {
    if (!cached) return idle(Boolean(path));
    const shouldMarkStale = Date.now() - cached.savedAt > refreshMs;
    const data = shouldMarkStale && cached.data && typeof cached.data === 'object' && !(cached.data as { stale?: boolean }).stale
      ? { ...cached.data, stale: true } as T : cached.data;
    return { data, savedAt: cached.savedAt, requestedAt: cached.requestedAt, loading: false, error: null };
  }, [cached, path, refreshMs]);
  const [state, setState] = useState<ResourceState<T> & { path: string | null }>(() => ({ ...cachedState, path }));
  if (state.path !== path) setState({ ...cachedState, path });
  const previousSession = useRef({ path, phase });
  useEffect(() => {
    if (!path || !enabled) return;
    const manual = lastAttempt.current !== attempt;
    lastAttempt.current = attempt;
    if (manual) setState(current => current.path === path ? { ...current, loading: true } : current);
    let forceNextLoad = manual;
    const phaseChanged = previousSession.current.path === path && previousSession.current.phase !== phase;
    previousSession.current = { path, phase };
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let inFlight = false;
    let requestStartedAt: number | undefined;
    let handledResume = pageResumeClock.current?.revision;
    let staleRetries = 0;
    let failureCount = 0;
    // A new session must not treat an earlier shared request as its first fresh snapshot.
    const pendingAtSessionChange = cache.pendingSince(path);
    const resumeBoundary = pageResumeClock.boundary(Date.now());
    let resumeAfterRequest = !reuseFreshData && (phaseChanged || resumeBoundary !== undefined) && pendingAtSessionChange !== undefined &&
      pendingAtSessionChange < (resumeBoundary ?? Date.now());
    const markStale = (failedRequestAt?: number) => {
      if (!disposed) setState(current => {
        const previous = current.path === path ? current : cache.read<T>(path);
        const data = previous?.data ?? null;
        return { path, data: data && typeof data === 'object' ? { ...data, stale: true } as T : data,
          savedAt: previous?.savedAt, requestedAt: previous?.requestedAt, failedRequestAt, loading: false, error: message };
      });
    };
    const load = async () => {
      if (inFlight || disposed || document.hidden || !navigator.onLine) return;
      if (reuseFreshData && !forceNextLoad) {
        const fresh = cache.read<T>(path);
        const remaining = remainingFreshTime(fresh, refreshMs, Date.now());
        if (fresh && remaining > 0) {
          setState({ path, data: fresh.data, savedAt: fresh.savedAt, requestedAt: fresh.requestedAt, loading: false, error: null });
          timer = setTimeout(load, remaining);
          return;
        }
      }
      forceNextLoad = false;
      inFlight = true;
      requestStartedAt = cache.pendingSince(path) ?? Date.now();
      let nextRefresh = refreshMs;
      try {
        const { data, savedAt, requestedAt } = await cache.request<T>(path, buildApiUrl(path));
        failureCount = 0;
        if ((data as { stale?: boolean })?.stale && staleRetries < 2) { nextRefresh = 1000; staleRetries++; }
        else staleRetries = 0;
        if (reuseFreshData && !(data as { stale?: boolean })?.stale) {
          const remaining = remainingFreshTime({ data, savedAt }, refreshMs, Date.now());
          nextRefresh = remaining > 0 ? remaining : Math.min(refreshMs, 60000);
        }
        if (!disposed) setState({ path, data, savedAt, requestedAt, loading: false, error: null });
      } catch {
        nextRefresh = Math.min(refreshMs, 2000 * 2 ** Math.min(failureCount++, 5));
        markStale(requestStartedAt);
      } finally {
        inFlight = false;
        if (!disposed && !document.hidden && navigator.onLine) timer = setTimeout(load, resumeAfterRequest ? 0 : nextRefresh);
        resumeAfterRequest = false;
      }
    };
    if (navigator.onLine) {
      const remaining = reuseFreshHistory && !phaseChanged && !manual ? freshHistoryFor(path, refreshMs) : 0;
      const fresh = remaining ? cache.read<T>(path) : undefined;
      if (fresh) {
        setState({ path, data: fresh.data, savedAt: fresh.savedAt, requestedAt: fresh.requestedAt, loading: false, error: null });
        timer = setTimeout(load, remaining);
      } else void load();
    }
    else markStale();
    const resume = () => {
      if (document.hidden || !navigator.onLine) { clearTimeout(timer); return; }
      const cycle = pageResumeClock.current;
      if (cycle && handledResume === cycle.revision) return;
      handledResume = cycle?.revision;
      clearTimeout(timer);
      const pending = inFlight ? requestStartedAt : cache.pendingSince(path);
      if (!reuseFreshData && pending !== undefined && pending < (cycle?.startedAt ?? Date.now())) resumeAfterRequest = true;
      if (!inFlight) void load();
    };
    const onPageShow = (event: PageTransitionEvent) => { if (event.persisted) resume(); };
    const onOffline = () => { clearTimeout(timer); cache.cancel(path); markStale(); };
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', resume);
    window.addEventListener('offline', onOffline);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      disposed = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('online', resume);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, [path, refreshMs, message, enabled, reuseFreshHistory, reuseFreshData, cache, phase, attempt]);
  return { ...(state.path === path ? state : cachedState), retry };
}

export function useInstrumentData(ticker: string | null, period: PeriodKey, interval: string, candles = false, enabled = true,
  connected = true, streamConfirmedAt?: number | null,
) {
  const phase = useMarketPhase(ticker ?? '');
  const active = isActivePhase(phase);
  const streamHealthy = useQuoteStreamHealth(connected, streamConfirmedAt, active);
  const historyRefreshMs = historyRefresh(period, active);
  const quoteState = useResource<Quote>(ticker ? `/stocks/${ticker}/quote` : null, streamHealthy ? 30000 : active ? 5000 : 15000, '行情暂不可用', enabled, { phase });
  const history = useResource<HistoryResponse>(
    ticker ? historyPath(ticker, period, interval, candles) : null, historyRefreshMs, '历史行情暂不可用', enabled, { reuseFreshHistory: true, phase },
  );
  const warmup = useResource<HistoryResponse>(
    ticker && history.data && (period === '1mo' || period === '3mo') ? `/stocks/${ticker}/history?period=1y&interval=1d` : null,
    120000, '指标历史暂不可用', enabled,
  );
  const indicatorHistory = useMemo(() => compatibleIndicatorHistory(ticker ?? '', history.data, warmup.data),
    [ticker, history.data, warmup.data]);
  return {
    indicatorHistory,
    streamHealthy,
    quoteState,
    historyState: { data: history.data?.data ?? null, loading: history.loading, error: history.error, retry: history.retry },
    historyStale: history.data?.stale ?? false,
    historyMeta: history.data,
  };
}

export function useStrategyHistory(ticker: string | null, period: '3mo' | '1y', enabled = true) {
  return useResource<HistoryResponse>(ticker ? historyPath(ticker, period, '1d', true) : null,
    60000, '历史行情暂不可用', enabled, { reuseFreshHistory: true });
}

export function useCryptoDepth(ticker: string, enabled: boolean) {
  const stream = useCryptoStreamStore(state => state.depth[ticker]);
  const [clock, setClock] = useState(Date.now);
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [enabled]);
  const healthy = Boolean(stream && clock - stream.receivedAt < 5000);
  const fallback = useResource<NonNullable<Quote['order_book']>>(enabled ? `/stocks/${ticker}/depth` : null,
    2000, '盘口暂不可用', enabled && !healthy);
  const useStream = stream && (healthy || !fallback.data || stream.receivedAt > (fallback.savedAt ?? 0));
  return { ...fallback, data: useStream ? stream.book : fallback.data,
    sequence: useStream ? stream.sequence : null,
    asOf: useStream ? stream.received_at : fallback.savedAt ? new Date(fallback.savedAt).toISOString() : null };
}

export function useMarketOverview(market: MarketType, enabled = true) {
  return useResource<HotspotResponse>(`/market/hotspots?market=${market}`, 15000, '市场暂不可用', enabled);
}

export function useWatchlistQuotes(batch: string) {
  const cnActive = isActivePhase(useMarketPhase('SH000001'));
  const usActive = isActivePhase(useMarketPhase('AAPL'));
  const active = batch.split(',').some(ticker => isChinaTicker(ticker) ? cnActive : usActive);
  return useResource<{ quotes: unknown[]; unavailable: string[]; stale?: boolean }>(
    `/market/quotes?tickers=${encodeURIComponent(batch)}`, active ? 5000 : 15000, '行情暂不可用',
  );
}

export function useChinaIndices() {
  const phase = useMarketPhase('SH000001');
  return useResource<{ rows: ChinaIndex[]; stale?: boolean }>('/market/cn/indices', isActivePhase(phase) ? 5000 : 30000, '指数行情暂不可用', true, { phase });
}

export function useChinaIndexTrend() {
  const phase = useMarketPhase('SH000001');
  return useResource<HistoryResponse>(historyPath('SH000001', '1d', '1m', false), historyRefresh('1d', isActivePhase(phase)),
    '历史行情暂不可用', true, { reuseFreshHistory: true, phase });
}

export function useChinaBoardPage(category: 'industry' | 'concept', sort: 'strong' | 'weak' | 'amount', page: number, query: string, enabled: boolean) {
  const path = `/market/cn/boards?category=${category}&sort=${sort}&page=${page}${query ? `&query=${encodeURIComponent(query)}` : ''}`;
  return useResource<ChinaBoardPage>(enabled ? path : null, 30000, '板块行情暂不可用');
}

export function useChinaBoardMembers(ticker: string | null, page: number, sort: 'strong' | 'weak' | 'amount' = 'strong') {
  return useResource<ChinaBoardPage<ChinaBoardMember>>(ticker ? `/market/cn/boards/${ticker}/members?page=${page}&sort=${sort}` : null, 30000, '成分股暂不可用');
}

export function useStockMemberships(ticker: string | null, enabled = true) {
  return useResource<StockMemberships>(ticker && isChinaEquity(ticker) ? `/stocks/${ticker}/tags` : null,
    6 * 60 * 60 * 1000, '股票板块暂不可用', enabled, { cache: stockMembershipCache, reuseFreshData: true });
}

export function useNewsFeed(enabled = true, market: NewsScope = 'CRYPTO') {
  return useResource<NewsResponse>(`/news?market=${market === 'CRYPTO' ? market : 'CRYPTO'}&limit=200`, 60000, '资讯暂不可用', enabled);
}

export function useStockSearch(query: string, market: MarketType) {
  const online = useOnlineStatus();
  const normalized = query.normalize('NFKC').trim();
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt(value => value + 1), []);
  const key = `${market}:${normalized}:${attempt}`;
  const [state, setState] = useState<{ key: string; results: SearchResult[]; loading: boolean; error: string | null }>({ key: '', results: [], loading: false, error: null });

  useEffect(() => {
    if (!normalized || !online) {
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setState({ key, results: [], loading: true, error: null });
      fetch(buildApiUrl(`/stocks/search?query=${encodeURIComponent(normalized)}&market=${market}`), { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]) })
        .then((response) => response.ok ? response.json() : Promise.reject(new Error()))
        .then((payload: { results?: unknown }) => {
          if (!Array.isArray(payload?.results) || !payload.results.every(row => row && isInstrumentTicker(row.ticker) && typeof row.name === 'string')) {
            throw new Error('Invalid search results');
          }
          const tickers = new Set<string>();
          const results = (payload.results as SearchResult[]).filter(row => {
            if (isChinaTicker(row.ticker) !== (market === 'CN') || tickers.has(row.ticker)) return false;
            tickers.add(row.ticker);
            return true;
          });
          if (!controller.signal.aborted) setState({ key, results, loading: false, error: null });
        })
        .catch(() => {
          if (!controller.signal.aborted) setState({ key, results: [], loading: false, error: '搜索暂不可用' });
        });
    }, 220);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [key, market, normalized, online]);

  if (!normalized) return { results: [], loading: false, error: null, retry };
  if (!online) return { results: [], loading: false, error: '当前离线，请恢复网络后搜索', retry };
  return { ...(state.key === key ? state : { results: [], loading: true, error: null }), retry };
}

export const formatCompact = (value: number) => new Intl.NumberFormat(getLocale(), {
  notation: 'compact',
  maximumFractionDigits: 2,
}).format(value || 0);

export const formatPrice = (value: number, market: MarketType, ticker = '') => `${market === 'CRYPTO' ? '' : isChinaIndex(ticker) ? '' : market === 'CN' ? '¥' : '$'}${(value || 0).toFixed(pricePrecision(ticker, value))}`;
export { formatSigned } from '../lib/changePresentation';
export const formatClock = (value: string | Date) => new Intl.DateTimeFormat(getLocale(), {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
}).format(new Date(value));

import { useEffect, useMemo, useState } from 'react';
import { buildApiUrl } from '../lib/api';
import { getLocale } from '../lib/i18n';
import { resourceCache } from '../lib/resourceCache';
import { pricePrecision } from '../lib/pricePrecision';
import { isChinaEquity, isChinaIndex, type StockMemberships } from '../lib/instrumentIdentity';
import { marketPhase } from './marketSession';
import type { MarketType } from '../store/stockStore';
import type {
  HistoryPoint,
  HistoryResponse,
  ChinaIndex,
  ChinaBoardPage,
  HotspotResponse,
  Loadable,
  NewsResponse,
  PeriodKey,
  Quote,
  SearchResult,
} from './types';

const idle = <T,>(loading = false): Loadable<T> => ({ data: null, loading, error: null });
const emptyHistory: HistoryPoint[] = [];

function useResource<T>(path: string | null, refreshMs: number, message: string, enabled = true): Loadable<T> {
  const cached = path ? resourceCache.read<T>(path) : undefined;
  const cachedState = useMemo<Loadable<T>>(() => {
    if (!cached) return idle(Boolean(path));
    const shouldMarkStale = Date.now() - cached.savedAt > refreshMs;
    const data = shouldMarkStale && cached.data && typeof cached.data === 'object' && !(cached.data as { stale?: boolean }).stale
      ? { ...cached.data, stale: true } as T : cached.data;
    return { data, loading: false, error: null };
  }, [cached, path, refreshMs]);
  const [state, setState] = useState<Loadable<T> & { path: string | null }>(() => ({ ...cachedState, path }));
  useEffect(() => {
    if (!path || !enabled) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let inFlight = false;
    let staleRetries = 0;
    let failureCount = 0;
    let resumeAfterRequest = false;
    const markStale = () => {
      if (!disposed) setState((current) => ({
        path, data: (() => {
          const data = current.path === path ? current.data : resourceCache.read<T>(path)?.data ?? null;
          return data && typeof data === 'object' ? { ...data, stale: true } as T : data;
        })(), loading: false, error: message,
      }));
    };
    const load = async () => {
      if (inFlight || disposed || document.hidden || !navigator.onLine) return;
      inFlight = true;
      let nextRefresh = refreshMs;
      try {
        const { data } = await resourceCache.request<T>(path, buildApiUrl(path));
        failureCount = 0;
        if ((data as { stale?: boolean })?.stale && staleRetries < 2) { nextRefresh = 1000; staleRetries++; }
        else staleRetries = 0;
        if (!disposed) setState({ path, data, loading: false, error: null });
      } catch {
        nextRefresh = Math.min(refreshMs, 2000 * 2 ** Math.min(failureCount++, 5));
        markStale();
      } finally {
        inFlight = false;
        if (!disposed && !document.hidden && navigator.onLine) timer = setTimeout(load, resumeAfterRequest ? 0 : nextRefresh);
        resumeAfterRequest = false;
      }
    };
    if (navigator.onLine) void load();
    else markStale();
    const onVisible = () => {
      clearTimeout(timer);
      if (!document.hidden) void load();
    };
    const onOnline = () => {
      clearTimeout(timer);
      if (inFlight) resumeAfterRequest = true;
      else void load();
    };
    const onOffline = () => { clearTimeout(timer); resourceCache.cancel(path); markStale(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      disposed = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [path, refreshMs, message, enabled]);
  return state.path === path ? state : cachedState;
}

export function useInstrumentData(ticker: string | null, period: PeriodKey, interval: string, candles = false, enabled = true, streaming = true) {
  const phase = marketPhase(ticker ?? '', new Date());
  const active = ['交易时段', '集合竞价'].includes(phase);
  const historyRefreshMs = period === '1d' || period === '5d' ? active ? 5000 : 30000 : 60000;
  const quoteState = useResource<Quote>(ticker ? `/stocks/${ticker}/quote` : null, streaming ? 30000 : active ? 5000 : 15000, '行情暂不可用', enabled);
  const history = useResource<HistoryResponse>(
    ticker ? `/stocks/${ticker}/history?period=${period}&interval=${interval}${candles && ['1d', '5d'].includes(period) ? '&candles=true' : ''}` : null, historyRefreshMs, '历史行情暂不可用', enabled,
  );
  const warmup = useResource<{ data: HistoryPoint[] }>(
    ticker && history.data && (period === '1mo' || period === '3mo') ? `/stocks/${ticker}/history?period=1y&interval=1d` : null,
    120000, '指标历史暂不可用', enabled,
  );
  return {
    indicatorHistory: warmup.data?.data ?? emptyHistory,
    quoteState,
    historyState: { data: history.data?.data ?? null, loading: history.loading, error: history.error },
    historyStale: history.data?.stale ?? false,
    historyMeta: history.data,
  };
}

export function useMarketOverview(market: MarketType, enabled = true) {
  return useResource<HotspotResponse>(`/market/hotspots?market=${market}`, 15000, '市场暂不可用', enabled);
}

export function useChinaIndices(enabled = true) {
  const active = ['交易时段', '集合竞价'].includes(marketPhase('SH000001', new Date()));
  return useResource<{ rows: ChinaIndex[]; stale?: boolean }>('/market/cn/indices', active ? 5000 : 30000, '指数行情暂不可用', enabled);
}

export function useChinaIndexTrend() {
  return useResource<HistoryResponse>('/stocks/SH000001/history?period=1d&interval=1m', 15000, '历史行情暂不可用');
}

export function useChinaBoardPage(category: 'industry' | 'concept', sort: 'strong' | 'weak' | 'amount', page: number, query: string, enabled: boolean) {
  const path = `/market/cn/boards?category=${category}&sort=${sort}&page=${page}${query ? `&query=${encodeURIComponent(query)}` : ''}`;
  return useResource<ChinaBoardPage>(enabled ? path : null, 30000, '板块行情暂不可用');
}

export function useChinaBoardMembers(ticker: string | null, page: number) {
  return useResource<ChinaBoardPage>(ticker ? `/market/cn/boards/${ticker}/members?page=${page}` : null, 30000, '成分股暂不可用');
}

export function useStockMemberships(ticker: string | null) {
  return useResource<StockMemberships>(ticker && isChinaEquity(ticker) ? `/stocks/${ticker}/tags` : null, 6 * 60 * 60 * 1000, '股票板块暂不可用');
}

export function useNewsFeed(enabled = true) {
  return useResource<NewsResponse>('/news?market=ALL&limit=80', 60000, '资讯暂不可用', enabled);
}

export function useStockSearch(query: string, market: MarketType) {
  const key = `${market}:${query.trim()}`;
  const [state, setState] = useState<{ key: string; results: SearchResult[]; loading: boolean; error: string | null }>({ key: '', results: [], loading: false, error: null });

  useEffect(() => {
    const normalized = query.trim();
    if (!normalized) {
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setState({ key, results: [], loading: true, error: null });
      fetch(buildApiUrl(`/stocks/search?query=${encodeURIComponent(normalized)}&market=${market}`), { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]) })
        .then((response) => response.ok ? response.json() as Promise<{ results: SearchResult[] }> : Promise.reject(new Error()))
        .then((payload) => {
          if (!controller.signal.aborted) setState({ key, results: payload.results ?? [], loading: false, error: null });
        })
        .catch(() => {
          if (!controller.signal.aborted) setState({ key, results: [], loading: false, error: '搜索暂不可用' });
        });
    }, 220);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [key, market, query]);

  if (!query.trim()) return { results: [], loading: false, error: null };
  return state.key === key ? state : { results: [], loading: true, error: null };
}

export const formatCompact = (value: number) => new Intl.NumberFormat(getLocale(), {
  notation: 'compact',
  maximumFractionDigits: 2,
}).format(value || 0);

export const formatPrice = (value: number, market: MarketType, ticker = '') => `${isChinaIndex(ticker) ? '' : market === 'CN' ? '¥' : '$'}${(value || 0).toFixed(pricePrecision(ticker, value))}`;
export const formatSigned = (value: number, digits = 2) => `${value >= 0 ? '+' : ''}${(value || 0).toFixed(digits)}`;
export const formatClock = (value: string | Date) => new Intl.DateTimeFormat(getLocale(), {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
}).format(new Date(value));

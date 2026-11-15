import { instrumentMarket, isCryptoTicker, isInstrumentTicker } from '../lib/instrumentIdentity.ts';
import type { MarketType } from '../store/stockStore';
import { candleIntervals, candlePeriodAllowed, chartSelection, type CandleInterval, type ChartSelection } from './chartSelection.ts';
import { periodOptions, type DeskView, type PeriodKey } from './types.ts';

type LinkedChart =
  | { mode: 'line'; period: PeriodKey }
  | { mode: 'candles'; period: PeriodKey; interval: CandleInterval };

export function readDeskRoute(params: URLSearchParams) {
  const page = params.get('view');
  const view: DeskView = page === 'markets' || page === 'news' || page === 'strategy' || page === 'simulation' ? page : 'overview';
  const code = params.get('ticker')?.toUpperCase();
  const ticker = view === 'overview' && isInstrumentTicker(code) ? code : null;
  const requestedMarket = params.get('market');
  const market: MarketType | null = ticker ? instrumentMarket(ticker)
    : requestedMarket === 'CN' || requestedMarket === 'US' || requestedMarket === 'CRYPTO' ? requestedMarket : null;
  const period = ticker ? periodOptions.find(option => option.key === params.get('period'))?.key : undefined;
  const mode = params.get('chart');
  const interval = candleIntervals.find(option => option.value === (params.get('interval') ?? '1d'))?.value;
  let chart: LinkedChart | null = null;
  if (period && (mode === 'line' || mode === null)) chart = { mode: 'line', period };
  if (period && mode === 'candles' && interval && candlePeriodAllowed(interval, period)) {
    chart = { mode, period, interval };
  }
  return { view, market, ticker, chart };
}

export function readCryptoDeskRoute(params: URLSearchParams) {
  const route = readDeskRoute(params), crypto = route.ticker && isCryptoTicker(route.ticker);
  return { ...route, market: 'CRYPTO' as const, ticker: crypto ? route.ticker : null, chart: crypto ? route.chart : null };
}

export function applyLinkedChart(saved: ChartSelection, chart: LinkedChart | null) {
  if (!chart) return saved;
  const selectedMode = chart.mode === 'candles'
    ? chartSelection(saved, { type: 'interval', interval: chart.interval })
    : chartSelection(saved, { type: 'mode', mode: 'line' });
  return chartSelection(selectedMode, { type: 'period', period: chart.period });
}

export function writeDeskRoute(url: URL, view: DeskView, market: MarketType, ticker: string | null, chart: ChartSelection) {
  const params = url.searchParams;
  params.set('view', view);
  params.set('market', market);
  if (view === 'overview' && ticker) {
    params.set('ticker', ticker);
    params.set('period', chart.period);
    params.set('chart', chart.mode);
    if (chart.mode === 'candles') params.set('interval', chart.candleInterval);
    else params.delete('interval');
  } else {
    for (const key of ['ticker', 'period', 'chart', 'interval']) params.delete(key);
  }
}

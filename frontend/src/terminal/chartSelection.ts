import type { PeriodKey } from './types';

export type ChartMode = 'line' | 'candles';
export type CandleInterval = '1m' | '5m' | '15m' | '30m' | '1h' | '1d';
export const candleIntervals: Array<{ value: CandleInterval; label: string }> = [
  { value: '1m', label: '1分钟' }, { value: '5m', label: '5分钟' }, { value: '15m', label: '15分钟' },
  { value: '30m', label: '30分钟' }, { value: '1h', label: '60分钟' }, { value: '1d', label: '日K' },
];
export type ChartSelection = { period: PeriodKey; mode: ChartMode; lastCandlePeriod: PeriodKey; candleInterval: CandleInterval; lastMinutePeriod: PeriodKey };
export type ChartAction = { type: 'mode'; mode: ChartMode } | { type: 'period'; period: PeriodKey } | { type: 'interval'; interval: CandleInterval };
export const initialChartSelection: ChartSelection = { period: '1d', mode: 'line', lastCandlePeriod: '1mo', candleInterval: '1d', lastMinutePeriod: '1d' };
const preferenceKey = 'marketdesk:chart-selection:v1';
const isIntraday = (period: PeriodKey) => period === '1d' || period === '5d';

export function loadChartSelection(storage?: Pick<Storage, 'getItem'>): ChartSelection {
  try {
    const saved = JSON.parse((storage ?? localStorage).getItem(preferenceKey) ?? 'null');
    const periods = ['1d', '5d', '1mo', '3mo', '1y'];
    if (!saved || !['line', 'candles'].includes(saved.mode) || !periods.includes(saved.period) ||
      !candleIntervals.some(item => item.value === saved.candleInterval)) return initialChartSelection;
    const selection: ChartSelection = { mode: saved.mode, period: saved.period, candleInterval: saved.candleInterval,
      lastCandlePeriod: ['1mo', '3mo', '1y'].includes(saved.lastCandlePeriod) ? saved.lastCandlePeriod : '1mo',
      lastMinutePeriod: ['1d', '5d'].includes(saved.lastMinutePeriod) ? saved.lastMinutePeriod : '1d' };
    if (selection.mode === 'candles' && !candlePeriodAllowed(selection.candleInterval, selection.period)) {
      selection.period = selection.candleInterval === '1d' ? selection.lastCandlePeriod : '1d';
    }
    return selection;
  } catch { return initialChartSelection; }
}

export function saveChartSelection(selection: ChartSelection) {
  try { localStorage.setItem(preferenceKey, JSON.stringify(selection)); } catch { /* Preferences remain usable in memory. */ }
}

export function candlePeriodAllowed(interval: CandleInterval, period: PeriodKey) {
  return interval === '1d' ? !isIntraday(period) : isIntraday(period) && (interval !== '1m' || period === '1d');
}

export function chartSelection(state: ChartSelection, action: ChartAction): ChartSelection {
  if (action.type === 'period') {
    if (state.mode === 'candles' && !candlePeriodAllowed(state.candleInterval, action.period)) return state;
    const intraday = isIntraday(action.period);
    return { ...state, period: action.period,
      lastCandlePeriod: intraday ? state.lastCandlePeriod : action.period,
      lastMinutePeriod: intraday && state.mode === 'candles' ? action.period : state.lastMinutePeriod };
  }
  if (action.type === 'interval') {
    const period = candlePeriodAllowed(action.interval, state.period) ? state.period
      : action.interval === '1d' ? state.lastCandlePeriod : action.interval === '1m' ? '1d' : state.lastMinutePeriod;
    return { ...state, mode: 'candles', candleInterval: action.interval, period };
  }
  if (action.mode === 'candles') {
    const period = candlePeriodAllowed(state.candleInterval, state.period) ? state.period
      : state.candleInterval === '1d' ? state.lastCandlePeriod : state.candleInterval === '1m' ? '1d' : state.lastMinutePeriod;
    return { ...state, mode: 'candles', period };
  }
  return { ...state, mode: 'line' };
}

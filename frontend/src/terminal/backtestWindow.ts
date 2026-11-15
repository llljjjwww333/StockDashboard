import { validateStrategyConfig, type StrategyConfig } from './backtest.ts';
import { getStrategy } from './strategyCatalog.ts';
import type { HistoryPoint } from './types';

export function backtestWindow(input: HistoryPoint[], config: StrategyConfig) {
  const c = validateStrategyConfig(config);
  const warmup = getStrategy(c.kind)!.warmup(c);
  const dates = [...input].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)).map(p => p.timestamp.slice(0, 10));
  const historyStart = dates[0] ?? '', historyEnd = dates.at(-1) ?? '';
  const earliestStart = dates[warmup] ?? '';
  const first = c.startDate ? dates.findIndex(date => date >= c.startDate) : warmup;
  const end = dates.findLastIndex(date => !c.endDate || date <= c.endDate);
  const status = !dates.length ? 'empty' : dates.length <= warmup ? 'short-history'
    : first < 0 || end < first ? 'outside' : first < warmup ? 'short-warmup' : 'ready';
  return {
    status, warmup, totalBars: dates.length, historyStart, historyEnd, earliestStart,
    availableBars: Math.max(0, dates.length - warmup),
    precedingBars: first < 0 ? dates.length : first,
    start: status === 'ready' ? dates[first] : '', end: status === 'ready' ? dates[end] : '',
    testedBars: status === 'ready' ? end - first + 1 : 0,
  };
}

export function sameBacktestConfig(left: StrategyConfig, right: StrategyConfig) {
  try {
    const a = validateStrategyConfig(left), b = validateStrategyConfig(right);
    return (Object.keys(a) as (keyof StrategyConfig)[]).every(key => JSON.stringify(a[key]) === JSON.stringify(b[key]));
  } catch { return false; }
}

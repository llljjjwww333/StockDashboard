import { configForStrategy, runBacktest, validateStrategyConfig, type BacktestResult, type StrategyConfig } from './backtest.ts';
import { experimentParameters, getStrategy, strategyCatalog, type StrategyParameterKey } from './strategyCatalog.ts';
import type { HistoryPoint } from './types';

export type ExperimentSpec = { mode: 'parameters' | 'strategies'; x: StrategyParameterKey; y: StrategyParameterKey | ''; xValues: number[]; yValues: number[]; trainingFraction: number; objective: 'sharpe' | 'return' | 'drawdown' };
export type ExperimentCandidate = { index: number; config: StrategyConfig; x: number | null; y: number | null; error?: string };
export type ExperimentPlan = { spec: ExperimentSpec; base: StrategyConfig; bars: HistoryPoint[]; candidates: ExperimentCandidate[]; start: string; trainEnd: string; validationStart: string; end: string; trainCount: number; validationCount: number };
export type ExperimentRow = ExperimentCandidate & { train?: BacktestResult; validation?: BacktestResult };
export type ExperimentRun = { signature: string; ticker: string; source: string; adjustment: string; stale: boolean; createdAt: string; plan: ExperimentPlan; rows: ExperimentRow[]; complete: boolean };

export function parameterRange(start: number, end: number, step: number): number[] {
  if (![start, end, step].every(Number.isFinite) || step <= 0 || end < start || (end - start) / step > 80) throw new Error('参数范围无效，每条轴最多81个值。');
  return Array.from({ length: Math.floor((end - start) / step + 1e-9) + 1 }, (_, i) => Number((start + i * step).toFixed(8)));
}
export function planExperiment(input: HistoryPoint[], config: StrategyConfig, spec: ExperimentSpec): ExperimentPlan {
  const base = validateStrategyConfig(config), parameters = experimentParameters(base.kind);
  if (![.6, .7, .8].includes(spec.trainingFraction) || !['sharpe', 'return', 'drawdown'].includes(spec.objective) || !['parameters', 'strategies'].includes(spec.mode)) throw new Error('实验设置无效。');
  const candidates: ExperimentCandidate[] = [];
  if (spec.mode === 'strategies') {
    for (const s of strategyCatalog) candidates.push({ index: candidates.length, config: configForStrategy(base, s.id), x: null, y: null });
  } else {
    if (!parameters.some(p => p.key === spec.x) || spec.y && (!parameters.some(p => p.key === spec.y) || spec.y === spec.x) || !spec.xValues.length || spec.y && !spec.yValues.length || spec.xValues.length * (spec.y ? spec.yValues.length : 1) > 81) throw new Error('请选择有效参数，最多81组组合。');
    for (const x of spec.xValues) for (const y of spec.y ? spec.yValues : [null]) {
      const c = { ...base, [spec.x]: x, ...(spec.y ? { [spec.y]: y } : {}) };
      candidates.push({ index: candidates.length, config: c, x, y });
    }
  }
  const bars = [...input].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const last = bars.findLastIndex(p => !base.endDate || p.timestamp.slice(0, 10) <= base.endDate);
  const requested = base.startDate ? bars.findIndex(p => p.timestamp.slice(0, 10) >= base.startDate) : null;
  const fits = (first: number) => { const count = last - first + 1, train = Math.floor(count * spec.trainingFraction); return train >= 20 && count - train >= 20; };
  let warmup = 0;
  for (const candidate of candidates) {
    try {
      const c = validateStrategyConfig(candidate.config), needed = getStrategy(c.kind)!.warmup(c);
      candidate.config = c;
      if (requested !== null && requested < needed) throw new Error('开始日期前预热不足。');
      if (!fits(requested ?? needed)) throw new Error('历史不足。');
      warmup = Math.max(warmup, needed);
    } catch (e) { candidate.error = e instanceof Error ? e.message : '参数无效'; }
  }
  if (!candidates.some(c => !c.error)) throw new Error('样本内和样本外各需至少20个交易日，请调整划分或缩短周期。');
  const first = requested ?? warmup;
  const count = last - first + 1, trainCount = Math.floor(count * spec.trainingFraction), validationCount = count - trainCount;
  return { spec: structuredClone(spec), base, bars: bars.slice(0, last + 1), candidates,
    start: bars[first].timestamp.slice(0, 10), trainEnd: bars[first + trainCount - 1].timestamp.slice(0, 10),
    validationStart: bars[first + trainCount].timestamp.slice(0, 10), end: bars[last].timestamp.slice(0, 10), trainCount, validationCount };
}
export function evaluateCandidate(plan: ExperimentPlan, candidate: ExperimentCandidate): ExperimentRow {
  if (candidate.error) return { ...candidate };
  try {
    const trainInput = plan.bars.filter(p => p.timestamp.slice(0, 10) <= plan.trainEnd);
    const train = runBacktest(trainInput, { ...candidate.config, startDate: plan.start, endDate: plan.trainEnd, liquidateEnd: true });
    const validation = runBacktest(plan.bars, { ...candidate.config, startDate: plan.validationStart, endDate: plan.end });
    return { ...candidate, train, validation };
  } catch (e) { return { ...candidate, error: e instanceof Error ? e.message : '回测失败' }; }
}
export function rankExperiment(rows: ExperimentRow[], objective: ExperimentSpec['objective']) {
  const score = (r: ExperimentRow) => !r.train ? -Infinity : objective === 'return' ? r.train.totalReturn : objective === 'drawdown' ? -r.train.maxDrawdown : r.train.sharpe ?? -Infinity;
  return [...rows].sort((a, b) => {
    if (Boolean(a.train) !== Boolean(b.train)) return a.train ? -1 : 1;
    const first = score(a), second = score(b);
    return first === second ? a.index - b.index : first > second ? -1 : 1;
  });
}

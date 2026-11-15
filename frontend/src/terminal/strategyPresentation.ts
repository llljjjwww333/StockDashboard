import type { StrategyConfig } from './backtest';
import { getStrategy } from './strategyCatalog';

export const strategyDate = (value: string) => value.slice(0, 10);
export const strategyName = (kind: string) => getStrategy(kind)?.name ?? kind;
export const strategyPercent = (value: number | null) => value === null ? '—' : (value * 100).toFixed(2) + '%';
export const strategyParameters = (config: StrategyConfig) => config.plan ? `分批 · 首仓${config.plan.initialPct}% · 目标${config.plan.addTargetPct}%` : config.kind === 'custom' ? `${config.rules?.entry.conditions.length ?? 0} BUY / ${config.rules?.exit.conditions.length ?? 0} SELL` : getStrategy(config.kind)?.parameters.map(p => config[p.key] ?? getStrategy(config.kind)?.defaults[p.key] ?? '—').join(' / ') ?? '';

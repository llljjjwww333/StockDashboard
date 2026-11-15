import { isCryptoTicker } from '../lib/instrumentIdentity.ts';
import { strategyDefaults, validateStrategyConfig, type StrategyConfig } from './backtest.ts';
import { parseStrategyRules, validateStrategyRuleSemantics } from './strategyRules.ts';
import { validMandate, type Mandate } from './portfolio.ts';
import type { WatchlistStock } from '../store/stockStore';
import { describeStrategyGoal } from './strategyDescription.ts';
import { strategyCapabilityIssues, volatilityAllocationGoal } from './strategyCapabilities.ts';
import { parseStagedPlan } from './stagedPlan.ts';
import { parseAllocation } from './volatilityAllocation.ts';

export function executableStrategy(strategy: Mandate) {
  if (!strategy.execution || !strategy.instrument || strategy.executionTicker !== strategy.instrument.ticker || strategy.executionGoal !== strategy.goal) return false;
  if (!strategy.execution.plan && strategyCapabilityIssues(strategy.goal).length) return false;
  if (volatilityAllocationGoal(strategy.goal) && !strategy.execution.allocation) return false;
  if (strategy.instrument.market === 'CRYPTO' && strategy.execution.allocation && strategy.execution.allocation.annualization !== 365) return false;
  try { const config = validateStrategyConfig({ ...strategy.execution, positionPct: strategy.maxSingle }); if (config.rules) validateStrategyRuleSemantics(config.rules); return true; } catch { return false; }
}

export function strategyExecutionMode(strategy: Mandate): 'rules' | 'ai' | null {
  if (!strategy.execution) return 'ai';
  return executableStrategy(strategy) ? 'rules' : null;
}

export function suggestedStrategyAllocation(strategy: Mandate | undefined, available: number) {
  return Math.max(0, Math.min(strategy?.maxSingle ?? 30, available));
}
export function applyGeneratedStrategy(strategy: Mandate, instrument: WatchlistStock, value: unknown, language: 'zh' | 'en' = 'zh'): Mandate {
  if (!value || typeof value !== 'object') throw new Error('模型未返回完整策略和参数');
  const p = value as Record<string, unknown>;
  const execution = generatedExecution(p.execution, p.max_single_pct as number);
  const next = validMandate({
    ...strategy, instrument, name: p.name as string, goal: p.goal as string, summary: p.summary as string,
    maxSingle: p.max_single_pct as number, maxGross: p.max_single_pct as number, maxPositions: 1,
    reviewMinutes: p.review_minutes as number, news: p.news as boolean, execution: undefined,
  });
  if(!execution.plan&&strategyCapabilityIssues(strategy.goal).length)throw new Error('分批目标必须返回完整分批计划，不能替换为简单均线策略');
  if (volatilityAllocationGoal(strategy.goal) && !execution.allocation) throw new Error('AI未返回目标中的波动率动态仓位公式');
  if (execution.allocation && instrument.market === 'CRYPTO' && execution.allocation.annualization !== 365) throw new Error('虚拟币波动率应按365日年化');
  return withExecution({ ...next, sourceGoal:strategy.goal, goalMode: 'generated', goal:execution.plan?strategy.goal:describeStrategyGoal(instrument.ticker, execution, language) }, execution);
}
export function editStrategyExecution(strategy: Mandate, instrument: WatchlistStock, config: StrategyConfig, bind = false, language: 'zh' | 'en' = 'zh'): Mandate {
  const canDescribe = bind || strategy.goalMode === 'generated' && strategy.executionGoal === strategy.goal && strategy.executionTicker === instrument.ticker;
  let next: Mandate = { ...strategy, instrument, execution: config, summary: undefined,
    executionGoal: strategy.execution && !bind ? strategy.executionGoal : strategy.goal,
    executionTicker: strategy.execution && !bind ? strategy.executionTicker : instrument.ticker,
    revision: (strategy.revision ?? 0) + 1 };
  if (canDescribe) {
    try {
      validateStrategyConfig(config);
      if (config.rules) validateStrategyRuleSemantics(config.rules);
      const goal = describeStrategyGoal(instrument.ticker, config, language);
      next = { ...next, ...(bind ? { goalMode: 'generated' as const, sourceGoal: strategy.sourceGoal ?? strategy.goal } : {}), goal, executionGoal: goal, executionTicker: instrument.ticker };
    } catch { /* Keep the last description while the form is incomplete. */ }
  }
  return next;
}
export function withExecution(strategy: Mandate, config: StrategyConfig): Mandate {
  if (!strategy.instrument) throw new Error('请选择标的');
  const execution = validateStrategyConfig({ ...config, positionPct: strategy.maxSingle });
  return { ...strategy, execution, executionGoal: strategy.goal, executionTicker: strategy.instrument.ticker, revision: (strategy.revision ?? 0) + 1 };
}
export function generatedExecution(value: unknown, positionPct: number): StrategyConfig {
  if (!value || typeof value !== 'object') throw new Error('模型未返回可执行规则');
  const p = value as Record<string, unknown>;
  if(p.plan){const plan=parseStagedPlan(p.plan);return validateStrategyConfig({...strategyDefaults,kind:'custom',plan,rules:null,positionPct,stopLossPct:plan.stopLossPct,takeProfitPct:0});}
  const rules = parseStrategyRules(p.rules);
  validateStrategyRuleSemantics(rules);
  const environment: Partial<StrategyConfig> = {};
  if (p.environment && typeof p.environment === 'object') {
    for (const key of ['feeBps','slippageBps','startDate','endDate','dataStartDate','dataEndDate'] as const) {
      if (Object.hasOwn(p.environment,key)) Object.assign(environment, { [key]: (p.environment as Record<string, unknown>)[key] });
    }
  }
  return validateStrategyConfig({ ...strategyDefaults, ...environment, kind: 'custom', rules,
    allocation: p.allocation ? parseAllocation(p.allocation) : null,
    positionPct, stopLossPct: p.stop_loss_pct as number, takeProfitPct: p.take_profit_pct as number });
}
export type BacktestEnvironment = { capital: number; feeBps: number; slippageBps: number; startDate: string; endDate: string; lotSize: number; liquidateEnd: boolean };
export function strategyBacktestConfig(strategy: Mandate, environment: BacktestEnvironment) {
  if (!strategy.execution || !strategy.instrument) throw new Error('请先生成或设置规则');
  if (strategy.executionGoal !== strategy.goal || strategy.executionTicker !== strategy.instrument.ticker) throw new Error('策略目标已修改，请更新规则');
  if (!strategy.execution.plan && strategyCapabilityIssues(strategy.goal).length) throw new Error('分批目标尚未对应到分批计划');
  if (strategy.execution.rules) validateStrategyRuleSemantics(strategy.execution.rules);
  return validateStrategyConfig({ ...strategy.execution!, ...environment, ...(isCryptoTicker(strategy.instrument.ticker)?{sessionsPerYear:365,lotSize:0}:{}), positionPct: strategy.maxSingle });
}

import type { HistoryPoint } from './types';
import type { CustomStrategyRules } from './strategyRules';
import { ruleOperands } from './strategyRules.ts';

export type VolatilityAllocation = { method: 'volatility_target'; period: number; targetVolPct: number;
  minPositionPct: number; annualization: 252 | 365; ddof: 0 | 1; rebalanceThresholdPct: number };

export function parseAllocation(value: unknown): VolatilityAllocation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('动态仓位参数无效');
  const p = value as VolatilityAllocation;
  if (Object.keys(p).some(key => !['method','period','targetVolPct','minPositionPct','annualization','ddof','rebalanceThresholdPct'].includes(key)) ||
    p.method !== 'volatility_target' || !Number.isInteger(p.period) || p.period < 2 || p.period > 200 ||
    ![252,365].includes(p.annualization) || ![0,1].includes(p.ddof) ||
    !Number.isFinite(p.targetVolPct) || p.targetVolPct <= 0 || p.targetVolPct > 100 ||
    !Number.isFinite(p.minPositionPct) || p.minPositionPct < 0 || p.minPositionPct > 100 ||
    !Number.isFinite(p.rebalanceThresholdPct) || p.rebalanceThresholdPct < 0 || p.rebalanceThresholdPct > 100) throw new Error('动态仓位参数无效');
  return { ...p };
}

export function allocationWarmup(rules: CustomStrategyRules, allocation: VolatilityAllocation) {
  const periods = ruleOperands(rules).map(operand => {
    if ('value' in operand) return 1;
    if (['macd','macd_signal'].includes(operand.indicator)) return 35;
    if (!('period' in operand)) return 1;
    if (operand.indicator === 'adx') return operand.period * 2 + 1;
    return operand.period + (['rsi','roc','momentum','volume_ratio'].includes(operand.indicator) ? 1 : 0);
  });
  const cross = [...rules.entry.conditions, ...rules.exit.conditions].some(c => c.operator.startsWith('cross_')) ? 1 : 0;
  return Math.max(allocation.period + 1, ...periods) + cross;
}

export function annualizedLogVolatility(data: HistoryPoint[], allocation: VolatilityAllocation): (number | null)[] {
  const returns = data.map((p, i) => i ? Math.log(p.close / data[i - 1].close) : 0);
  return data.map((_, i) => {
    if (i < allocation.period) return null;
    const window = returns.slice(i - allocation.period + 1, i + 1);
    const mean = window.reduce((sum, r) => sum + r, 0) / window.length;
    return Math.sqrt(window.reduce((sum, r) => sum + (r - mean) ** 2, 0) /
      (window.length - allocation.ddof) * allocation.annualization);
  });
}

export function allocationWeight(active: boolean, volatility: number | null, policy: VolatilityAllocation, cap: number) {
  if (!active || volatility === null || !Number.isFinite(volatility) || volatility < 0) return 0;
  return Math.min(cap, Math.max(policy.minPositionPct, volatility <= 1e-14 ? cap : policy.targetVolPct / volatility));
}

export const allocationExecutionDue = (now: Date) => now.getUTCHours() === 0 && now.getUTCMinutes() === 0;

// Solve for the target weight against NAV after fees and slippage, at the execution mark.
export function rebalanceQuantity(cash: number, shares: number, mark: number, weightPct: number,
  feeBps: number, slippageBps: number, lot = 0, equity = cash + shares * mark) {
  const weight = weightPct / 100, gap = weight * equity - shares * mark;
  const fee = feeBps / 10000, slip = slippageBps / 10000;
  const cost = gap >= 0 ? (1 + slip) * (1 + fee) - 1 : 1 - (1 - slip) * (1 - fee);
  let quantity = gap / (mark * (gap >= 0 ? 1 + weight * cost : 1 - weight * cost));
  quantity = quantity >= 0 ? Math.min(quantity, cash / (mark * (1 + slip) * (1 + fee))) : Math.max(quantity, -shares);
  if (lot) quantity = Math.sign(quantity) * Math.floor(Math.abs(quantity) / lot + 1e-9) * lot;
  return Math.abs(quantity) < 1e-12 ? 0 : quantity;
}

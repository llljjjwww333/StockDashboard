import type { HistoryPoint } from './types';
import { adxSeries, atrSeries, bollingerSeries, cciSeries, ema, obvSeries, rangePosition, rocSeries, rsiSeries, sma, type Series } from './technicalSeries.ts';

export const directIndicators = ['close', 'open', 'high', 'low', 'volume', 'obv', 'macd', 'macd_signal'] as const;
export const periodIndicators = ['sma', 'ema', 'rsi', 'roc', 'momentum', 'atr_pct', 'volume_ratio', 'cci', 'williams', 'adx'] as const;
export const bandIndicators = ['boll_upper', 'boll_lower'] as const;
export type RuleIndicator = typeof directIndicators[number] | typeof periodIndicators[number] | typeof bandIndicators[number];
export type RuleOperand = { value: number } | (({ indicator: typeof directIndicators[number] } | { indicator: typeof periodIndicators[number]; period: number } | { indicator: typeof bandIndicators[number]; period: number; multiplier: number }) & { factor?: number });
export const ruleOperators = ['gt', 'gte', 'lt', 'lte', 'cross_above', 'cross_below'] as const;
export type RuleCondition = { left: RuleOperand; operator: typeof ruleOperators[number]; right: RuleOperand };
export type RuleGroup = { mode: 'all' | 'any'; conditions: RuleCondition[] };
export type CustomStrategyRules = { entry: RuleGroup; exit: RuleGroup };
const priceIndicators: readonly string[] = ['close', 'open', 'high', 'low', 'sma', 'ema', 'boll_upper', 'boll_lower'];
export function comparableRuleOperands(left: RuleOperand, right: RuleOperand) {
  const dimension = (operand: RuleOperand) => {
    if ('value' in operand) return null;
    if (priceIndicators.includes(operand.indicator)) return 'price';
    if (['macd', 'macd_signal'].includes(operand.indicator)) return 'macd';
    if (['roc', 'atr_pct'].includes(operand.indicator)) return 'percent';
    return operand.indicator;
  };
  const a = dimension(left), b = dimension(right);
  return a === null || b === null || a === b;
}
export function validateStrategyRuleSemantics(rules: CustomStrategyRules) {
  for (const [key, label] of [['entry', '买入'], ['exit', '卖出']] as const) {
    rules[key].conditions.forEach((c, index) => {
      if (!comparableRuleOperands(c.left, c.right)) {
        const ratio = 'indicator' in c.left && c.left.indicator === 'volume_ratio' || 'indicator' in c.right && c.right.indicator === 'volume_ratio';
        throw new Error(`${label}条件 ${index + 1}：${ratio ? '量比应与数值阈值或另一量比比较，不能与价格均线比较' : '两侧指标类型不兼容，请使用数值阈值或同类指标'}`);
      }
    });
  }
}
export const defaultCustomRules = (): CustomStrategyRules => ({ entry: { mode: 'all', conditions: [{ left: { indicator: 'close' }, operator: 'gt', right: { indicator: 'sma', period: 20 } }] }, exit: { mode: 'any', conditions: [{ left: { indicator: 'close' }, operator: 'lt', right: { indicator: 'sma', period: 20 } }] } });
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const only = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).every(k => keys.includes(k));

export function parseRuleOperand(value: unknown): RuleOperand {
  if (!record(value)) throw new Error('策略规则格式无效。');
  if (only(value, ['value']) && typeof value.value === 'number' && Number.isFinite(value.value) && Math.abs(value.value) <= 1e12) return { value: value.value };
  const name = value.indicator;
  if (typeof name !== 'string') throw new Error('策略规则格式无效。');
  const factor = value.factor;
  if (factor !== undefined && factor !== null && (typeof factor !== 'number' || !Number.isFinite(factor) || factor <= 0 || factor > 1000)) throw new Error('指标系数无效');
  const scaled = typeof factor === 'number' && factor !== 1 ? { factor } : {};
  if ((directIndicators as readonly string[]).includes(name) && only(value, ['indicator', 'factor'])) return { indicator: name, ...scaled } as RuleOperand;
  const period = value.period;
  if (typeof period !== 'number' || !Number.isInteger(period) || period < 2 || period > 200) throw new Error('规则指标周期应为2至200。');
  if ((periodIndicators as readonly string[]).includes(name) && only(value, ['indicator', 'period', 'factor'])) return { indicator: name, period, ...scaled } as RuleOperand;
  if ((bandIndicators as readonly string[]).includes(name) && only(value, ['indicator', 'period', 'multiplier', 'factor']) && typeof value.multiplier === 'number' && Number.isFinite(value.multiplier) && value.multiplier >= .1 && value.multiplier <= 5) return { indicator: name, period, multiplier: value.multiplier, ...scaled } as RuleOperand;
  throw new Error('策略规则含不支持的指标或字段。');
}
export function parseStrategyRules(value: unknown): CustomStrategyRules {
  if (!record(value) || !only(value, ['entry', 'exit'])) throw new Error('策略规则格式无效。');
  const group = (input: unknown): RuleGroup => {
    if (!record(input) || !only(input, ['mode', 'conditions']) || !['all', 'any'].includes(String(input.mode)) || !Array.isArray(input.conditions) || input.conditions.length < 1 || input.conditions.length > 6) throw new Error('每组策略规则需要1至6个条件。');
    return { mode: input.mode as RuleGroup['mode'], conditions: input.conditions.map(c => {
      if (!record(c) || !only(c, ['left', 'operator', 'right']) || !(ruleOperators as readonly unknown[]).includes(c.operator)) throw new Error('策略规则格式无效。');
      return { left: parseRuleOperand(c.left), operator: c.operator as RuleCondition['operator'], right: parseRuleOperand(c.right) };
    }) };
  };
  return { entry: group(value.entry), exit: group(value.exit) };
}
export const ruleOperands = (rules: CustomStrategyRules) => [...rules.entry.conditions, ...rules.exit.conditions].flatMap(c => [c.left, c.right]);
export function ruleWarmup(rules: CustomStrategyRules) {
  return Math.max(2, ...ruleOperands(rules).map(o => 'value' in o ? 0 : o.indicator === 'macd' || o.indicator === 'macd_signal' ? 35 : 'period' in o ? o.indicator === 'adx' ? o.period * 2 + 1 : o.period + 1 : 2)) + 1;
}
export const rulesNeedVolume = (rules: CustomStrategyRules) => ruleOperands(rules).some(o => 'indicator' in o && ['volume', 'volume_ratio', 'obv'].includes(o.indicator));

export function customStrategySignals(data: HistoryPoint[], rules: CustomStrategyRules) {
  validateStrategyRuleSemantics(rules);
  const closes = data.map(p => p.close), cache = new Map<string, Series>();
  const series = (operand: RuleOperand): Series => {
    const key = JSON.stringify(operand), saved = cache.get(key);
    if (saved) return saved;
    let values: Series;
    if ('value' in operand) values = data.map(() => operand.value);
    else {
      const p = 'period' in operand ? operand.period : 20;
      switch (operand.indicator) {
        case 'close': case 'open': case 'high': case 'low': case 'volume': values = data.map(d => d[operand.indicator as 'close']); break;
        case 'sma': values = sma(closes, p); break;
        case 'ema': values = ema(closes, p); break;
        case 'rsi': values = rsiSeries(closes, p); break;
        case 'roc': values = rocSeries(closes, p); break;
        case 'momentum': values = closes.map((close, i) => i >= p ? close - closes[i - p] : null); break;
        case 'atr_pct': values = atrSeries(data, p).map((v, i) => v === null ? null : v / closes[i] * 100); break;
        case 'cci': values = cciSeries(data, p); break;
        case 'williams': values = rangePosition(data, p).map(v => v === null ? null : v - 100); break;
        case 'adx': values = adxSeries(data, p).adx; break;
        case 'obv': values = obvSeries(data); break;
        case 'volume_ratio': {
          const mean = sma(data.map(d => d.volume), p);
          values = data.map((d, i) => i && mean[i - 1] !== null && mean[i - 1]! > 0 ? d.volume / mean[i - 1]! : null); break;
        }
        case 'boll_lower': case 'boll_upper': { const bands = bollingerSeries(closes, p, operand.multiplier); values = operand.indicator === 'boll_upper' ? bands.upper : bands.lower; break; }
        case 'macd': case 'macd_signal': {
          const fast = ema(closes, 12), slow = ema(closes, 26);
          const dif = data.map((_, i) => fast[i] !== null && slow[i] !== null ? fast[i]! - slow[i]! : null);
          values = operand.indicator === 'macd' ? dif : ema(dif, 9); break;
        }
      }
    }
    if ('indicator' in operand && operand.factor !== undefined) values = values.map(value => value === null ? null : value * operand.factor!);
    cache.set(key, values); return values;
  };
  const evaluate = (condition: RuleCondition, i: number) => {
    const left = series(condition.left), right = series(condition.right), a = left[i], b = right[i];
    if (a === null || b === null || !Number.isFinite(a) || !Number.isFinite(b)) return false;
    switch (condition.operator) {
      case 'gt': return a > b;
      case 'gte': return a >= b;
      case 'lt': return a < b;
      case 'lte': return a <= b;
      case 'cross_above': return i > 0 && left[i - 1] !== null && right[i - 1] !== null && a > b && left[i - 1]! <= right[i - 1]!;
      case 'cross_below': return i > 0 && left[i - 1] !== null && right[i - 1] !== null && a < b && left[i - 1]! >= right[i - 1]!;
    }
  };
  const evaluateGroup = (g: RuleGroup) => data.map((_, i) => g.mode === 'all' ? g.conditions.every(c => evaluate(c, i)) : g.conditions.some(c => evaluate(c, i)));
  return { enter: evaluateGroup(rules.entry), exit: evaluateGroup(rules.exit) };
}

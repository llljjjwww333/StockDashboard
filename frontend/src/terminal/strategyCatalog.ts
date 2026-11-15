import type { StrategyConfig } from './backtest';
import { stagedWarmup } from './stagedPlan.ts';
import { ruleWarmup } from './strategyRules.ts';

export type StrategyKind = 'adaptive' | 'sma' | 'ema' | 'macd' | 'breakout' | 'keltner' | 'supertrend' | 'adx' | 'momentum' | 'bands' | 'rsi' | 'stochastic' | 'cci' | 'williams' | 'volume' | 'obv' | 'custom';
export type StrategyParameterKey = 'fast' | 'slow' | 'bandWidth' | 'signalPeriod' | 'entryThreshold' | 'exitThreshold' | 'atrMultiplier' | 'adxThreshold' | 'volumeMultiplier' | 'momentumThreshold' | 'positionPct' | 'stopLossPct' | 'takeProfitPct';
export type StrategyParameter = { key: StrategyParameterKey; label: string; min: number; max: number; step: number };
export type StrategyDefinition = { id: StrategyKind; name: string; group: string; parameters: StrategyParameter[]; experimentParameters?: StrategyParameter[]; defaults: Partial<StrategyConfig>; entry: string; exit: string; warmup: (c: Required<StrategyConfig>) => number; volume?: boolean; orderedWindows?: boolean };
const parameter = (key: StrategyParameterKey, label: string, min = 2, max = 199, step = 1): StrategyParameter => ({ key, label, min, max, step });
const fast = parameter('fast', '短周期（交易日）');
const slow = parameter('slow', '长周期（交易日）', 3, 200);
const period = parameter('fast', '指标周期');
const multiplier = parameter('atrMultiplier', 'ATR 倍数', .1, 10, .1);
const thresholds = (min: number, max: number) => [parameter('entryThreshold', '入场阈值', min, max, 1), parameter('exitThreshold', '离场阈值', min, max, 1)];
const longWarmup = (c: Required<StrategyConfig>) => c.slow + 1;
const shortWarmup = (c: Required<StrategyConfig>) => c.fast + 1;
export const strategyGroups = ['自适应', '趋势', '动量', '均值回归', '量价'] as const;
export type Regime = 'trend' | 'range' | 'volatile' | 'defensive';
export type RegimeMethod = Exclude<StrategyKind, 'adaptive'> | 'cash';
export const regimeNames: Record<Regime, string> = { trend: '趋势', range: '震荡', volatile: '高波动', defensive: '下行' };
export const defaultRegimeMethods: Record<Regime, RegimeMethod> = { trend: 'ema', range: 'bands', volatile: 'breakout', defensive: 'cash' };
export const strategyCatalog: StrategyDefinition[] = [
  { id: 'adaptive', name: '多状态自适应', group: '自适应', parameters: [parameter('fast', '状态指标周期', 2, 50), parameter('slow', '大周期均线', 20, 200), parameter('adxThreshold', '趋势 ADX 阈值', 5, 80), parameter('bandWidth', '高波动 ATR（%）', .1, 5, .1), parameter('signalPeriod', '切换确认天数', 1, 10)], defaults: { fast: 14, slow: 60, adxThreshold: 25, bandWidth: 3, signalPeriod: 3 }, entry: '按已确认市场状态调用对应策略', exit: '状态切换后执行新策略或持有现金', warmup: c => Math.max(c.slow + 1, c.fast * 2 + 1, ...Object.values(c.regimeMethods).filter(k => k !== 'cash').map(k => { const d = getStrategy(k)!; return d.warmup({ ...c, ...d.defaults, kind: k }); })) + c.signalPeriod },
  { id: 'sma', name: '双均线', group: '趋势', parameters: [fast, slow], defaults: { fast: 5, slow: 20 }, orderedWindows: true, entry: '短均线高于长均线', exit: '短均线不再高于长均线', warmup: longWarmup },
  { id: 'ema', name: 'EMA 双线', group: '趋势', parameters: [fast, slow], defaults: { fast: 12, slow: 26 }, orderedWindows: true, entry: '快 EMA 高于慢 EMA', exit: '快 EMA 不再高于慢 EMA', warmup: longWarmup },
  { id: 'macd', name: 'MACD 趋势', group: '趋势', parameters: [fast, slow, parameter('signalPeriod', '信号周期', 2, 50)], defaults: { fast: 12, slow: 26, signalPeriod: 9 }, orderedWindows: true, entry: 'DIF 高于 DEA', exit: 'DIF 不再高于 DEA', warmup: c => c.slow + c.signalPeriod },
  { id: 'breakout', name: '通道突破', group: '趋势', parameters: [fast, slow], defaults: { fast: 5, slow: 20 }, orderedWindows: true, entry: '收盘突破此前长周期最高价', exit: '收盘跌破此前短周期最低价', warmup: longWarmup },
  { id: 'keltner', name: 'Keltner 突破', group: '趋势', parameters: [parameter('fast', 'ATR 周期'), parameter('slow', 'EMA 周期', 3, 200), multiplier], defaults: { fast: 10, slow: 20, atrMultiplier: 2 }, entry: '收盘高于 EMA + ATR × 倍数', exit: '收盘跌至 EMA 中轨', warmup: c => Math.max(c.fast, c.slow) + 1 },
  { id: 'supertrend', name: 'Supertrend', group: '趋势', parameters: [parameter('fast', 'ATR 周期'), multiplier], defaults: { fast: 10, atrMultiplier: 3 }, entry: 'ATR 趋势线转为多头', exit: 'ATR 趋势线转为空头', warmup: shortWarmup },
  { id: 'adx', name: 'ADX 方向趋势', group: '趋势', parameters: [period, parameter('adxThreshold', 'ADX 阈值', 5, 80)], defaults: { fast: 14, adxThreshold: 25 }, entry: 'ADX 达到阈值且 +DI 高于 −DI', exit: 'ADX 回落或方向反转', warmup: c => c.fast * 2 + 1 },
  { id: 'momentum', name: 'ROC 动量', group: '动量', parameters: [parameter('fast', '动量回看周期'), parameter('slow', '趋势均线周期', 3, 200), parameter('momentumThreshold', '动量阈值（%）', -30, 50, .5)], defaults: { fast: 20, slow: 60, momentumThreshold: 0 }, entry: 'ROC 高于阈值且收盘在趋势均线上方', exit: '动量或趋势条件失效', warmup: c => Math.max(c.fast, c.slow) + 1 },
  { id: 'bands', name: '布林回归', group: '均值回归', parameters: [slow, parameter('bandWidth', '布林标准差倍数', .1, 5, .1)], defaults: { slow: 20, bandWidth: 2 }, entry: '收盘低于布林下轨', exit: '收盘回到布林中轨', warmup: longWarmup },
  { id: 'rsi', name: 'RSI 反转', group: '均值回归', parameters: [period, ...thresholds(0, 100)], defaults: { fast: 14, entryThreshold: 30, exitThreshold: 70 }, entry: 'Wilder RSI 低于入场阈值', exit: 'RSI 回升至离场阈值', warmup: shortWarmup },
  { id: 'stochastic', name: 'Stochastic 反转', group: '均值回归', parameters: [parameter('fast', '%K 周期'), parameter('slow', '%D 平滑周期', 2, 50), ...thresholds(0, 100)], defaults: { fast: 14, slow: 3, entryThreshold: 20, exitThreshold: 80 }, entry: '低位 %K 上穿 %D', exit: '%K 下穿 %D 或进入高位', warmup: c => c.fast + c.slow + 1 },
  { id: 'cci', name: 'CCI 回归', group: '均值回归', parameters: [period, ...thresholds(-300, 300)], defaults: { fast: 20, entryThreshold: -100, exitThreshold: 100 }, entry: 'CCI 低于入场阈值', exit: 'CCI 回升至离场阈值', warmup: shortWarmup },
  { id: 'williams', name: 'Williams %R', group: '均值回归', parameters: [period, ...thresholds(-100, 0)], defaults: { fast: 14, entryThreshold: -80, exitThreshold: -20 }, entry: '%R 低于入场阈值', exit: '%R 回升至离场阈值', warmup: shortWarmup },
  { id: 'volume', name: '放量突破', group: '量价', parameters: [parameter('fast', '均量与退出周期'), parameter('slow', '突破回看周期', 3, 200), parameter('volumeMultiplier', '放量倍数', .5, 10, .1)], defaults: { fast: 10, slow: 40, volumeMultiplier: 1.5 }, volume: true, entry: '突破前期高点且成交量放大', exit: '收盘跌破短均线', warmup: c => Math.max(c.fast, c.slow) + 1 },
  { id: 'obv', name: 'OBV 量价趋势', group: '量价', parameters: [fast, slow], defaults: { fast: 10, slow: 30 }, orderedWindows: true, volume: true, entry: 'OBV 快线在慢线上方且价格在均线上方', exit: '量能趋势或价格趋势反转', warmup: longWarmup },
];
const customStrategy: StrategyDefinition = { id: 'custom', name: 'AI 自定义策略', group: '自定义', parameters: [], experimentParameters: [parameter('positionPct', '开仓资金比例（%）', 1, 100, 5), parameter('stopLossPct', '收盘止损（%）', 0, 100, .5), parameter('takeProfitPct', '收盘止盈（%）', 0, 1000, 1)], defaults: {}, entry: '自定义买入规则', exit: '自定义卖出规则', warmup: c => c.plan?stagedWarmup(c.plan):ruleWarmup(c.rules!) };
export const getStrategy = (kind: string) => kind === 'custom' ? customStrategy : strategyCatalog.find(s => s.id === kind);
export const experimentParameters = (kind: string) => { const definition = getStrategy(kind)!; return definition.experimentParameters ?? definition.parameters; };

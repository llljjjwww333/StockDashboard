import type { StrategyConfig } from './backtest';
import { getStrategy } from './strategyCatalog.ts';
import type { RuleGroup, RuleOperand } from './strategyRules.ts';
import { stagedDescriptions } from './stagedPlan.ts';

const names = { close:'收盘价',open:'开盘价',high:'最高价',low:'最低价',volume:'成交量',obv:'OBV',macd:'MACD DIF(12/26/9)',macd_signal:'MACD DEA(12/26/9)',sma:'SMA',ema:'EMA',rsi:'RSI',roc:'ROC(%)',momentum:'MOM',atr_pct:'ATR(%)',volume_ratio:'量比',cci:'CCI',williams:'Williams %R',adx:'ADX',boll_upper:'布林上轨',boll_lower:'布林下轨' };
const zhOperators = { gt:'大于',gte:'大于等于',lt:'小于',lte:'小于等于',cross_above:'上穿',cross_below:'下穿' };
const enOperators = { gt:'>',gte:'>=',lt:'<',lte:'<=',cross_above:'crosses above',cross_below:'crosses below' };

// Descriptions always follow executable fields; prose is never parsed into orders.
export function describeStrategyGoal(ticker: string, config: StrategyConfig, language: 'zh' | 'en' = 'zh') {
  if(config.plan)return '仅交易'+ticker+'，初始全现金。\n'+stagedDescriptions(config.plan).map(([title,text])=>title+'：'+text).join('\n');
  const zh = language !== 'en';
  const operand = (value: RuleOperand): string => 'value' in value ? String(value.value) :
    (zh ? names[value.indicator] : value.indicator) + ('period' in value ? '(' + value.period + ('multiplier' in value ? ', ' + value.multiplier + 'σ' : '') + ')' : '') + (value.factor !== undefined && value.factor !== 1 ? ' × ' + value.factor : '');
  const group = (value: RuleGroup) => (zh ? value.mode === 'all' ? '全部满足：' : '任一满足：' : value.mode === 'all' ? 'all: ' : 'any: ') + value.conditions.map(c => operand(c.left) + ' ' + (zh ? zhOperators : enOperators)[c.operator] + ' ' + operand(c.right)).join(zh ? '；' : '; ');
  const definition = getStrategy(config.kind), custom = config.kind === 'custom' && config.rules;
  const parameters = definition?.parameters.map(p => p.label + '=' + config[p.key]).join('，') ?? '';
  const entry = custom ? group(custom.entry) : definition?.entry + (parameters ? '；' + parameters : '');
  const exit = custom ? group(custom.exit) : definition?.exit;
  const position = config.positionPct ?? 100, stop = config.stopLossPct ?? 0, profit = config.takeProfitPct ?? 0;
  if (config.allocation) { const a = config.allocation; return `仅交易${ticker}，现货只做多，初始现金。\n买入（${entry}）。\n清仓（${exit}）。\n目标波动率${a.targetVolPct}%，对数收益率${a.period}日${a.ddof?'样本':'总体'}标准差×√${a.annualization}；信号成立w=min(${position}%,max(${a.minPositionPct}%,${a.targetVolPct}%/σ${a.period}))，失效w=0。\n每日严格再平衡，阈值${a.rebalanceThresholdPct}个百分点；1D UTC完整日K收盘计算，次日开盘执行；止损${stop}%，止盈${profit}%。\n手续费${config.feeBps}基点，滑点${config.slippageBps}基点；数据${config.dataStartDate||'可用起点'}至${config.dataEndDate||'最近完成日'}，交易${config.startDate||'预热后'}至${config.endDate||'最近完成日'}。`; }
  if (zh) return `仅交易${ticker}，初始持有现金。\n买入（${entry}）。\n卖出（${exit}）。\n开仓资金比例${position}%；收盘止损${stop ? stop + '%' : '关闭'}；收盘止盈${profit ? profit + '%' : '关闭'}。\n日线收盘判断，下一交易日开盘成交。`;
  return `Trade only ${ticker}, starting in cash.\nBuy (${entry}).\nSell (${exit}).\nPosition ${position}%; close-based stop loss ${stop ? stop + '%' : 'off'}; take profit ${profit ? profit + '%' : 'off'}.\nEvaluate at the daily close; fill at the next session open.`;
}

import type { StrategyConfig } from './backtest';
import { defaultRegimeMethods, getStrategy, regimeNames } from './strategyCatalog';
import type { RuleGroup, RuleOperand } from './strategyRules';
import { stagedDescriptions } from './stagedPlan';

const indicatorNames = { close: '收盘价', open: '开盘价', high: '最高价', low: '最低价', volume: '成交量', obv: 'OBV', macd: 'MACD DIF（12 / 26 / 9）', macd_signal: 'MACD DEA（12 / 26 / 9）', sma: 'SMA', ema: 'EMA', rsi: 'RSI', roc: 'ROC（%）', momentum: 'MOM', atr_pct: 'ATR（%）', volume_ratio: '量比', cci: 'CCI', williams: 'Williams %R', adx: 'ADX', boll_upper: '布林上轨', boll_lower: '布林下轨' };
const operators = { gt: '大于', gte: '大于或等于', lt: '小于', lte: '小于或等于', cross_above: '上穿', cross_below: '下穿' };
function operandText(value: RuleOperand) {
  if ('value' in value) return String(value.value);
  return indicatorNames[value.indicator] + ('period' in value ? `（${value.period} 个交易日${'multiplier' in value ? `，${value.multiplier} 倍标准差` : ''}）` : '') + (value.factor !== undefined && value.factor !== 1 ? ' × ' + value.factor : '');
}
function RuleDetails({ label, group }: { label: string; group: RuleGroup }) {
  return <section><h4>{label}<small>{group.mode === 'all' ? '全部条件满足' : '任一条件满足'}</small></h4><ol>{group.conditions.map((c, i) => <li key={i}>{operandText(c.left)} {operators[c.operator]} {operandText(c.right)}</li>)}</ol></section>;
}

export function StrategyDetails({ config }: { config: StrategyConfig }) {
  if(config.plan)return <div className="strategy-definition-details" aria-label="策略详细参数">{stagedDescriptions(config.plan).map(([title,text])=><section key={title}><h4>{title}</h4><p>{text}</p></section>)}<details><summary>判定口径</summary><ul>{config.plan.assumptions.map((t,i)=><li key={i}>{t}</li>)}</ul></details></div>;
  const definition = getStrategy(config.kind);
  return <div className="strategy-definition-details" aria-label="策略详细参数">
    {config.kind === 'custom' && config.rules ? <div className="strategy-condition-details"><RuleDetails label="买入条件" group={config.rules.entry}/><RuleDetails label="卖出条件" group={config.rules.exit}/></div> : <>
      <div className="strategy-condition-details"><section><h4>买入条件</h4><p>{definition?.entry}</p></section><section><h4>卖出条件</h4><p>{definition?.exit}</p></section></div>
      <dl>{definition?.parameters.map(p => <div key={p.key}><dt>{p.label}</dt><dd>{config[p.key] ?? definition.defaults[p.key] ?? '—'}</dd></div>)}</dl>
    </>}
    {config.kind === 'adaptive' && <dl>{Object.entries(config.regimeMethods ?? defaultRegimeMethods).map(([regime, method]) => <div key={regime}><dt>{regimeNames[regime as keyof typeof regimeNames]}</dt><dd>{method === 'cash' ? '现金' : getStrategy(method)?.name}</dd></div>)}</dl>}
    {config.allocation&&<section><h4>目标波动率动态仓位</h4><p>w = min({config.positionPct}%, {config.allocation.targetVolPct}% / σ{config.allocation.period})；信号失效为0%。对数收益率标准差×√{config.allocation.annualization}，{config.allocation.ddof?'样本':'总体'}口径，每日再平衡，阈值{config.allocation.rebalanceThresholdPct}个百分点。</p></section>}
    <dl><div><dt>{config.allocation?'最大仓位':'开仓资金比例'}</dt><dd>{config.positionPct ?? 100}%</dd></div><div><dt>收盘止损</dt><dd>{config.stopLossPct ? `${config.stopLossPct}%` : '关闭'}</dd></div><div><dt>收盘止盈</dt><dd>{config.takeProfitPct ? `${config.takeProfitPct}%` : '关闭'}</dd></div><div><dt>成交时点</dt><dd>日线收盘判断，下一交易日开盘成交</dd></div></dl>
  </div>;
}

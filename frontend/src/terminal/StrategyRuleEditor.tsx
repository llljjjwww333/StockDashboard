import { useState } from 'react';
import { t } from '../lib/i18n';
import { bandIndicators, comparableRuleOperands, directIndicators, periodIndicators, ruleOperators, type CustomStrategyRules, type RuleCondition, type RuleGroup, type RuleIndicator, type RuleOperand } from './strategyRules';

const labels: Record<RuleIndicator | 'constant', string> = { constant: '数值', close: '收盘价', open: '开盘价', high: '最高价', low: '最低价', volume: '成交量', obv: 'OBV', macd: 'MACD DIF', macd_signal: 'MACD DEA', sma: 'SMA', ema: 'EMA', rsi: 'RSI', roc: 'ROC（%）', atr_pct: 'ATR（%）', volume_ratio: '量比', cci: 'CCI', williams: 'Williams %R', adx: 'ADX', boll_upper: '布林上轨', boll_lower: '布林下轨' };
const operators = { gt: '>', gte: '≥', lt: '<', lte: '≤', cross_above: '上穿', cross_below: '下穿' };
const indicators = [...directIndicators, ...periodIndicators, ...bandIndicators];
function indicatorOperand(name: RuleIndicator): RuleOperand {
  if ((bandIndicators as readonly string[]).includes(name)) return { indicator: name as 'boll_upper', period: 20, multiplier: 2 };
  if ((periodIndicators as readonly string[]).includes(name)) return { indicator: name as 'sma', period: ['rsi', 'atr_pct', 'adx', 'williams'].includes(name) ? 14 : 20 };
  return { indicator: name as 'close' };
}
function newCondition(name: RuleIndicator, side: 'entry' | 'exit'): RuleCondition {
  const thresholds: Partial<Record<RuleIndicator, number>> = { rsi: side === 'entry' ? 30 : 70, roc: 0, atr_pct: 3, volume_ratio: 1, cci: side === 'entry' ? -100 : 100, williams: side === 'entry' ? -80 : -20, adx: 25 };
  const right: RuleOperand = name === 'macd' ? { indicator: 'macd_signal' } : ['macd_signal', 'volume', 'obv'].includes(name) ? { value: 0 } : thresholds[name] !== undefined ? { value: thresholds[name]! } : { indicator: 'sma', period: 20 };
  const oversold = ['rsi', 'cci', 'williams'].includes(name);
  return { left: indicatorOperand(name), operator: (side === 'entry') !== oversold ? 'gt' : 'lt', right };
}

function OperandEditor({ value, onChange, label, compareWith }: { value: RuleOperand; onChange: (value: RuleOperand) => void; label: string; compareWith?: RuleOperand }) {
  const name = 'value' in value ? 'constant' : value.indicator;
  const choices = indicators.filter(id => !compareWith || comparableRuleOperands(compareWith, indicatorOperand(id)));
  const incompatible = name !== 'constant' && !choices.includes(name);
  return <div className="strategy-rule-operand">
    <select aria-label={label} value={name} onChange={e => onChange(e.target.value === 'constant' ? { value: 0 } : indicatorOperand(e.target.value as RuleIndicator))}>{incompatible&&<option disabled value={name}>不兼容：{labels[name]}</option>}{['constant', ...choices].map(id => <option key={id} value={id}>{t(labels[id as keyof typeof labels])}</option>)}</select>
    {'value' in value && <label className="rule-value-field"><span>阈值</span><input type="number" aria-label={label + ' ' + t('数值')} step="any" value={Number.isFinite(value.value) ? value.value : ''} onChange={e => onChange({ value: e.target.valueAsNumber })}/></label>}
    {'period' in value && <label className="rule-value-field"><span>周期（日）</span><input type="number" aria-label={label + ' ' + t('周期')} min={2} max={200} value={Number.isFinite(value.period) ? value.period : ''} onChange={e => onChange({ ...value, period: e.target.valueAsNumber })}/></label>}
    {'multiplier' in value && <label className="rule-value-field"><span>标准差倍数</span><input type="number" aria-label={label + ' ' + t('倍数')} step={.1} min={.1} max={5} value={Number.isFinite(value.multiplier) ? value.multiplier : ''} onChange={e => onChange({ ...value, multiplier: e.target.valueAsNumber })}/></label>}
    {'indicator' in value && ['macd', 'macd_signal'].includes(value.indicator) && <small className="rule-fixed-parameter">12 / 26 / 9</small>}
  </div>;
}

export function StrategyRuleEditor({ value, onChange }: { value: CustomStrategyRules; onChange: (next: CustomStrategyRules) => void }) {
  const [adding, setAdding] = useState<{ entry: RuleIndicator | ''; exit: RuleIndicator | '' }>({ entry: '', exit: '' });
  const groupEditor = (key: 'entry' | 'exit', label: string) => {
    const group = value[key];
    const updateGroup = (next: RuleGroup) => onChange({ ...value, [key]: next });
    const update = (index: number, changes: Partial<RuleCondition>) => updateGroup({ ...group, conditions: group.conditions.map((condition, i) => i === index ? { ...condition, ...changes } : condition) });
    return <section className="strategy-rule-group" key={key} aria-label={t(label)}>
      <header><h3>{t(label)} <small>{group.conditions.length} 个条件</small></h3><select aria-label={t(label) + ' ' + t('条件关系')} value={group.mode} onChange={e => updateGroup({ ...group, mode: e.target.value as RuleGroup['mode'] })}><option value="all">{t('全部满足')}</option><option value="any">{t('任一满足')}</option></select></header>
      {!!group.conditions.length && <div className="strategy-rule-columns" aria-hidden="true"><span>指标 / 周期</span><span>关系</span><span>阈值或比较指标</span><span/></div>}
      {group.conditions.map((condition, index) => <div className="strategy-rule-row" key={index}>
        <OperandEditor label={t(label) + ' ' + (index + 1) + ' ' + t('左值')} value={condition.left} onChange={left => update(index, { left })}/>
        <select aria-label={t(label) + ' ' + (index + 1) + ' ' + t('比较')} value={condition.operator} onChange={e => update(index, { operator: e.target.value as RuleCondition['operator'] })}>{ruleOperators.map(op => <option key={op} value={op}>{t(operators[op])}</option>)}</select>
        <OperandEditor label={t(label) + ' ' + (index + 1) + ' ' + t('右值')} value={condition.right} compareWith={condition.left} onChange={right => update(index, { right })}/>
        <button type="button" aria-label={t('删除条件') + ' ' + t(label) + ' ' + (index + 1)} onClick={() => updateGroup({ ...group, conditions: group.conditions.filter((_, i) => i !== index) })}>删除</button>
      </div>)}
      {!group.conditions.length && <p className="strategy-definition-empty">暂无条件，请在下方选择指标并添加。</p>}
      <div className="strategy-rule-add"><select aria-label={t(label) + ' 新增指标'} value={adding[key]} disabled={group.conditions.length >= 6} onChange={e => setAdding({ ...adding, [key]: e.target.value as RuleIndicator })}><option value="">选择要添加的指标</option>{indicators.map(id => <option key={id} value={id}>{t(labels[id])}</option>)}</select><button type="button" disabled={!adding[key] || group.conditions.length >= 6} onClick={() => { const indicator = adding[key]; if (indicator) { updateGroup({ ...group, conditions: [...group.conditions, newCondition(indicator, key)] }); setAdding({ ...adding, [key]: '' }); } }}>添加{key === 'entry' ? '买入' : '卖出'}条件</button></div>
    </section>;
  };
  return <div className="strategy-rule-editor">{groupEditor('entry', '买入规则')}{groupEditor('exit', '卖出规则')}</div>;
}

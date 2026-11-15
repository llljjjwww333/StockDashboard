import { test } from 'node:test';
import assert from 'node:assert/strict';
import { customStrategySignals, defaultCustomRules, parseStrategyRules, validateStrategyRuleSemantics } from '../src/terminal/strategyRules.ts';
import { runBacktest, strategyDefaults, validateStrategyConfig } from '../src/terminal/backtest.ts';
import { parseGeneratedStrategy } from '../src/ai/strategyPayload.ts';
import { parseStrategyLibrary } from '../src/terminal/strategyWorkspace.ts';
import { evaluateCandidate, planExperiment } from '../src/terminal/strategyExperiment.ts';

const data = Array.from({ length: 120 }, (_, i) => { const close = 100 + i * .2 + Math.sin(i / 4) * 10; return { timestamp: new Date(Date.UTC(2024, 0, i + 1)).toISOString(), open: close - .1, high: close + .2, low: close - .2, close, volume: 1000 + i * 10 }; });
const rules = () => ({ entry: { mode: 'all', conditions: [{ left: { indicator: 'sma', period: 2 }, operator: 'gt', right: { indicator: 'sma', period: 3 } }] }, exit: { mode: 'any', conditions: [{ left: { indicator: 'sma', period: 2 }, operator: 'lte', right: { indicator: 'sma', period: 3 } }] } });
const response = () => ({ ticker: 'AAPL', provider: 'Fixture', model: 'test', generated_at: '2024-06-01T00:00:00Z', proposal: { name: 'AI strategy', summary: 'Generated from supplied evidence', rules: rules(), risk: { position_pct: 50, stop_loss_pct: 5, take_profit_pct: 10 }, evidence: [{ id: 'H1', reason: 'Price trend' }] }, evidence: [{ id: 'H1', kind: 'history', title: 'Daily prices', detail: '', source: 'Fixture', timestamp: '2024-05-01' }] });

test('composed rules reproduce the classic strategy with the same dates and execution costs', () => {
  const config = { ...strategyDefaults, fast: 2, slow: 3, startDate: data[10].timestamp.slice(0, 10) };
  const classic = runBacktest(data, config), custom = runBacktest(data, { ...config, kind: 'custom', rules: rules() });
  assert.deepEqual(custom.curve, classic.curve);
  assert.deepEqual(custom.trades, classic.trades);
});

test('AND/OR and crossings use only current and previous completed observations', () => {
  const crossing = { entry: { mode: 'all', conditions: [{ left: { indicator: 'close' }, operator: 'cross_above', right: { value: 105 } }, { left: { indicator: 'volume_ratio', period: 3 }, operator: 'gt', right: { value: .5 } }] }, exit: { mode: 'any', conditions: [{ left: { indicator: 'close' }, operator: 'cross_below', right: { value: 105 } }] } };
  const first = customStrategySignals(data.slice(0, 70), crossing), all = customStrategySignals(data, crossing);
  assert.deepEqual(all.enter.slice(0, 70), first.enter);
  assert.deepEqual(all.exit.slice(0, 70), first.exit);
  const index = all.enter.findIndex(Boolean);
  assert(index > 0 && data[index].close > 105 && data[index - 1].close <= 105);
});

test('rule validation rejects executable code, unknown fields and invalid numeric operands', () => {
  for (const bad of [{ ...rules(), code: 'alert(1)' }, { entry: { mode: 'all', conditions: [] }, exit: rules().exit }]) assert.throws(() => parseStrategyRules(bad));
  for (const operand of [{ indicator: 'eval' }, { indicator: 'rsi', period: 1 }, { value: Infinity }, { value: 2, code: 'x' }, { indicator: 'close', period: 20 }]) {
    const bad = rules(); bad.entry.conditions[0].left = operand;
    assert.throws(() => parseStrategyRules(bad));
  }
});

test('volume ratios cannot be compared to a price moving average even when both periods are 20', () => {
  const bad = rules();bad.entry.conditions[0] = {left:{indicator:'volume_ratio',period:20},operator:'gt',right:{indicator:'sma',period:20}};
  assert.throws(()=>validateStrategyRuleSemantics(bad),/量比/);
  assert.throws(()=>customStrategySignals(data,bad),/量比/);
  bad.entry.conditions[0].right={value:1};
  assert.doesNotThrow(()=>validateStrategyRuleSemantics(bad));
  bad.entry.conditions[0].right={indicator:'volume_ratio',period:5};
  assert.doesNotThrow(()=>validateStrategyRuleSemantics(bad));
});

test('AI payloads only retain known evidence, rules and fields and reject invented citations', () => {
  const value = response(); value.api_key = 'secret'; value.proposal.risk.key = 'secret';
  const clean = parseGeneratedStrategy(value);
  assert(!JSON.stringify(clean).includes('secret'));
  value.proposal.evidence[0].id = 'N999';
  assert.throws(() => parseGeneratedStrategy(value));
});

test('custom snapshots replay both rules and AI provenance without retaining credentials', () => {
  const config = validateStrategyConfig({ ...strategyDefaults, kind: 'custom', rules: rules() });
  const snapshot = { version: 2, id: 'custom-test', name: 'Generated', createdAt: '2024-06-01', instrument: { ticker: 'AAPL', name: 'Apple', market: 'US' }, config, period: '1y', source: 'Fixture', adjustment: 'qfq', stale: false, bars: data, ai: { prompt: 'Trend strategy', generation: { ...response(), api_key: 'secret' } } };
  const replay = parseStrategyLibrary(JSON.stringify([snapshot]));
  assert.equal(replay.damaged, false);
  assert.deepEqual(replay.reports[0].result, runBacktest(data, config));
  assert(!JSON.stringify(replay).includes('secret'));
  snapshot.ai.generation.ticker = 'NVDA';
  assert.equal(parseStrategyLibrary(JSON.stringify([snapshot])).reports.length, 0);
});

test('custom rules can scan risk settings without an empty parameter catalog', () => {
  const config = { ...strategyDefaults, kind: 'custom', rules: defaultCustomRules() };
  const plan = planExperiment(data, config, { mode: 'parameters', x: 'positionPct', y: 'stopLossPct', xValues: [25, 50], yValues: [3, 5], trainingFraction: .7, objective: 'return' });
  assert.equal(plan.candidates.length, 4);
  assert(plan.candidates.map(c => evaluateCandidate(plan, c)).every(r => r.train && r.validation));
});

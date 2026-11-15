import { test } from 'node:test';
import assert from 'node:assert/strict';
import { strategyDefaults } from '../src/terminal/backtest.ts';
import { evaluateCandidate, parameterRange, planExperiment, rankExperiment } from '../src/terminal/strategyExperiment.ts';

const data = Array.from({ length: 280 }, (_, i) => {
  const close = 100 + .1 * i + Math.sin(i / 7) * 20;
  return { timestamp: new Date(Date.UTC(2024, 0, i + 1)).toISOString(), open: close - .1, high: close + .3, low: close - .3, close, volume: 1000 + i * 10 };
});
const spec = { mode: 'parameters', x: 'fast', y: 'slow', xValues: [3, 5, 7], yValues: [20, 30, 40], trainingFraction: .7, objective: 'sharpe' };

test('parameter ranges are finite, decimal-safe and bounded', () => {
  assert.deepEqual(parameterRange(.1, .3, .1), [.1, .2, .3]);
  assert.throws(() => parameterRange(1, 100, 1));
  assert.throws(() => parameterRange(2, 1, 1));
  assert.throws(() => parameterRange(1, 2, 0));
});

test('all parameter candidates use exactly the same train and validation dates', () => {
  const plan = planExperiment(data, strategyDefaults, spec);
  assert.equal(plan.candidates.length, 9);
  assert.equal(plan.start, data[41].timestamp.slice(0, 10));
  for (const candidate of plan.candidates) {
    const row = evaluateCandidate(plan, candidate);
    assert.equal(row.error, undefined);
    assert.equal(row.train.start.slice(0, 10), plan.start);
    assert.equal(row.train.end.slice(0, 10), plan.trainEnd);
    assert.equal(row.validation.start.slice(0, 10), plan.validationStart);
    assert.equal(row.validation.end.slice(0, 10), plan.end);
    assert.equal(row.train.invested, false, 'Training closes its own account');
    assert(row.validation.trades.every(t => t.date.slice(0, 10) >= plan.validationStart));
  }
});

test('changing only holdout data cannot alter training performance or training ranking', () => {
  const plan = planExperiment(data, strategyDefaults, spec);
  const changed = data.map(p => p.timestamp.slice(0, 10) >= plan.validationStart ? { ...p, open: p.open * 3, high: p.high * 3, low: p.low * 3, close: p.close * 3 } : p);
  const other = planExperiment(changed, strategyDefaults, spec);
  const rows = plan.candidates.map(c => evaluateCandidate(plan, c)), others = other.candidates.map(c => evaluateCandidate(other, c));
  assert.deepEqual(rows.map(r => r.train), others.map(r => r.train));
  assert.deepEqual(rankExperiment(rows, 'sharpe').map(r => r.index), rankExperiment(others, 'sharpe').map(r => r.index));
});

test('ranking never uses validation scores as a hidden tiebreaker', () => {
  const rows = [{ index: 1, train: { sharpe: .5 }, validation: { sharpe: 1000 } }, { index: 0, train: { sharpe: .5 }, validation: { sharpe: -1000 } }];
  assert.deepEqual(rankExperiment(rows, 'sharpe').map(r => r.index), [0, 1]);
  assert.deepEqual(rankExperiment([{ index: 0, error: 'invalid' }, { index: 1, train: { sharpe: null } }], 'sharpe').map(r => r.index), [1, 0]);
});

test('all-strategy comparison covers 16 strategies with a shared time range', () => {
  const plan = planExperiment(data, strategyDefaults, { ...spec, mode: 'strategies' });
  assert.equal(plan.candidates.length, 16);
  const rows = plan.candidates.map(c => evaluateCandidate(plan, c));
  assert(rows.every(r => !r.error));
  assert.equal(new Set(rows.map(r => r.train.start)).size, 1);
  assert.equal(new Set(rows.map(r => r.validation.start)).size, 1);
});

test('invalid combinations remain visible and short or oversized experiments are rejected', () => {
  const plan = planExperiment(data, strategyDefaults, { ...spec, xValues: [5, 25], yValues: [20] });
  assert.equal(plan.candidates.filter(c => c.error).length, 1);
  assert(evaluateCandidate(plan, plan.candidates[1]).error);
  assert.throws(() => planExperiment(data.slice(0, 45), strategyDefaults, spec), /至少20/);
  assert.throws(() => planExperiment(data, strategyDefaults, { ...spec, y: 'fast' }));
  assert.throws(() => planExperiment(data, strategyDefaults, { ...spec, xValues: Array(82).fill(5) }));
});

test('short listing history skips long warmups while comparable valid strategies still run', () => {
  const plan = planExperiment(data.slice(0, 76), strategyDefaults, { ...spec, mode: 'strategies', trainingFraction: .6 });
  const rows = plan.candidates.map(c => evaluateCandidate(plan, c));
  assert(rows.some(r => r.config.kind === 'adaptive' && r.error));
  assert(rows.some(r => r.config.kind === 'ema' && r.train && r.validation));
  const valid = rows.filter(r => !r.error);
  assert(valid.length > 1);
  assert(plan.trainCount >= 20 && plan.validationCount >= 20);
  assert.equal(new Set(valid.map(r => r.train.start)).size, 1);
  assert.equal(new Set(valid.map(r => r.validation.start)).size, 1);
});

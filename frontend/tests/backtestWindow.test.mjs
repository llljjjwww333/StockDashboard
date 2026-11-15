import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { backtestWindow, sameBacktestConfig } from '../src/terminal/backtestWindow.ts';
import { runBacktest, strategyDefaults, validateStrategyConfig } from '../src/terminal/backtest.ts';
import { marketHours } from '../src/lib/marketCalendar.ts';

const plan = JSON.parse(fs.readFileSync(new URL('../../backend/tests/fixtures/staged_plan.json', import.meta.url), 'utf8'));
const config = { ...strategyDefaults, kind: 'custom', plan, positionPct: plan.maxPositionPct, stopLossPct: plan.stopLossPct, lotSize: 100 };
const history = [];
for (let d = new Date('2026-07-16T00:00:00Z'); d <= new Date('2026-11-10T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) {
  const day = d.toISOString().slice(0, 10);
  if (marketHours('CN', day)) history.push({ timestamp: day + 'T00:00:00+08:00', open: 24, high: 25, low: 23, close: 24, volume: 1000 });
}

test('the screenshot date fails preflight before running and exposes the actual available interval', () => {
  assert.equal(history.length, 78);
  const c = { ...config, startDate: '2026-10-01', endDate: '2026-11-10' };
  const w = backtestWindow(history, c);
  assert.equal(w.status, 'short-warmup'); assert.equal(w.warmup, 63);
  assert.equal(w.earliestStart, '2026-10-21'); assert.equal(w.availableBars, 15);
  assert(w.precedingBars < w.warmup); assert.equal(w.testedBars, 0);
  assert.throws(() => runBacktest(history, c), /预热/);
  const corrected = { ...c, startDate: w.earliestStart, endDate: w.historyEnd };
  const result = runBacktest(history, corrected), ready = backtestWindow(history, corrected);
  assert.equal(ready.status, 'ready'); assert.equal(ready.testedBars, result.testedBars);
  assert.equal(result.start.slice(0, 10), w.earliestStart); assert.equal(result.testedBars, 15);
  assert.deepEqual(corrected.plan, config.plan);
});

test('blank dates use full eligible history and a later start preserves its requested interval', () => {
  const full = backtestWindow(history, config), actual = runBacktest(history, config);
  assert.equal(full.start, actual.start.slice(0, 10)); assert.equal(full.end, actual.end.slice(0, 10));
  assert.equal(full.testedBars, actual.testedBars);
  const c = { ...config, startDate: '2026-11-02', endDate: '2026-11-10' }, later = backtestWindow(history, c);
  assert.equal(later.status, 'ready'); assert.equal(later.start, '2026-11-02'); assert.equal(later.testedBars, 7);
});

test('short history, dates outside history and end dates before warmup cannot appear ready', () => {
  const short = backtestWindow(history.slice(-60), config);
  assert.equal(short.status, 'short-history'); assert.equal(short.earliestStart, ''); assert.equal(short.availableBars, 0);
  assert.equal(backtestWindow([], config).status, 'empty');
  for (const dates of [{ startDate: '2026-12-01' }, { endDate: '2026-08-01' }, { startDate: '2026-10-01', endDate: '2026-10-05' }]) {
    assert.notEqual(backtestWindow(history, { ...config, ...dates }).status, 'ready');
    assert.throws(() => runBacktest(history, { ...config, ...dates }));
  }
});

test('availability follows edited strategy windows and does not rely on chronological input order', () => {
  const c = { ...config, plan: { ...plan, maLong: 70 } };
  const w = backtestWindow(history.toReversed(), c), result = runBacktest(history, c);
  assert.equal(w.warmup, 73); assert.equal(w.testedBars, 5); assert.equal(w.start, result.start.slice(0, 10));
});

test('result comparison detects changed dates, costs and plan values while normalizing defaults', () => {
  assert(sameBacktestConfig(config, validateStrategyConfig(config)));
  for (const changes of [{ startDate: '2026-11-02' }, { feeBps: 30 }, { capital: 200000 }, { plan: { ...plan, initialPct: 8 } }]) {
    assert.equal(sameBacktestConfig(config, { ...config, ...changes }), false);
  }
  assert.equal(sameBacktestConfig(config, { ...config, capital: NaN }), false);
});

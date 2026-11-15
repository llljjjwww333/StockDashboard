import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configForStrategy, runBacktest, strategyDefaults, validateStrategyConfig } from '../src/terminal/backtest.ts';
import { getStrategy, strategyCatalog } from '../src/terminal/strategyCatalog.ts';
import { strategySignals } from '../src/terminal/strategySignals.ts';
import { adxSeries, atrSeries, cciSeries, rsiSeries, supertrendSeries } from '../src/terminal/technicalSeries.ts';

const near = (a, b) => assert(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
const bars = Array.from({ length: 300 }, (_, i) => {
  const close = 100 + .05 * i + 20 * Math.sin(i / 6);
  return { timestamp: new Date(Date.UTC(2024, 0, i + 1)).toISOString(), open: close - .2, high: close + .4, low: close - .4, close, volume: i % 9 === 0 ? 9000 : 1000 + i * 2 };
});

test('all 16 strategies have independently configurable, valid defaults and preserve execution settings', () => {
  assert.equal(strategyCatalog.length, 16);
  assert.equal(new Set(strategyCatalog.map(s => s.id)).size, 16);
  for (const definition of strategyCatalog) {
    const c = validateStrategyConfig(configForStrategy({ ...strategyDefaults, positionPct: 60, feeBps: 12 }, definition.id));
    assert.equal(c.kind, definition.id);
    assert.equal(c.positionPct, 60);
    assert.equal(c.feeBps, 12);
    assert(definition.parameters.length >= 2);
    const r = runBacktest(bars, c);
    assert.equal(r.warmupBars, getStrategy(c.kind).warmup(c));
    assert(Number.isFinite(r.totalReturn));
    assert(r.trades.every(t => t.signalDate < t.date));
  }
});

test('all strategies are causal at both signal and portfolio levels', () => {
  for (const s of strategyCatalog) {
    const c = validateStrategyConfig(configForStrategy(strategyDefaults, s.id));
    const first = strategySignals(bars.slice(0, 180), c), full = strategySignals(bars, c);
    assert.deepEqual(full.enter.slice(0, 180), first.enter, `${s.id} enter`);
    assert.deepEqual(full.exit.slice(0, 180), first.exit, `${s.id} exit`);
    const prefix = runBacktest(bars.slice(0, 180), c), result = runBacktest(bars, c);
    assert.deepEqual(result.curve.slice(0, prefix.curve.length), prefix.curve, s.id);
  }
});

test('strategy families produce distinct signals rather than renamed copies', () => {
  const fingerprints = strategyCatalog.map(s => {
    const c = validateStrategyConfig(configForStrategy(strategyDefaults, s.id));
    return JSON.stringify(strategySignals(bars, c));
  });
  assert(new Set(fingerprints).size >= 13);
});

test('flat prices and volume never generate spurious trades or undefined returns', () => {
  const flat = bars.map(p => ({ ...p, open: 10, high: 10, low: 10, close: 10, volume: 0 }));
  for (const s of strategyCatalog) {
    const r = runBacktest(flat, configForStrategy(strategyDefaults, s.id));
    assert.equal(r.totalReturn, 0, s.id);
    assert.equal(r.trades.length, 0, s.id);
  }
});

test('Wilder RSI has the known seeded values and updates causally', () => {
  const result = rsiSeries([10, 11, 12, 11, 13, 12], 3);
  assert.deepEqual(result.slice(0, 3), [null, null, null]);
  near(result[3], 200 / 3);
  near(result[4], 250 / 3);
  near(result[5], 2000 / 33);
});

test('ATR includes gaps and Wilder smoothing; CCI uses mean absolute deviation', () => {
  const data = [{ high: 11, low: 9, close: 10 }, { high: 14, low: 11, close: 13 }, { high: 13, low: 10, close: 11 }, { high: 15, low: 12, close: 14 }, { high: 16, low: 13, close: 15 }];
  const atr = atrSeries(data, 3);
  assert.equal(atr[2], null); near(atr[3], 11 / 3); near(atr[4], 31 / 9);
  const cci = cciSeries([1, 2, 3, 4].map(v => ({ high: v, low: v, close: v })), 3);
  near(cci[2], 100); near(cci[3], 100);
});

test('ADX reaches 100 for a monotonic directional path and zero on flat prices', () => {
  const up = Array.from({ length: 20 }, (_, i) => ({ close: 10 + i, high: 11 + i, low: 9 + i }));
  const values = adxSeries(up, 3);
  assert.equal(values.adx[4], null);
  near(values.adx[5], 100);
  near(values.plus[5], 50);
  near(values.minus[5], 0);
  assert.equal(adxSeries(up.map(() => ({ close: 10, high: 10, low: 10 })), 3).adx[10], 0);
});

test('Supertrend preserves trailing bands until a closing break changes direction', () => {
  const points = [10, 11, 12, 13, 14, 15, 12, 9].map(v => ({ close: v, high: v + 1, low: v - 1 }));
  assert.deepEqual(supertrendSeries(points, 2, 1), [null, null, -1, -1, -1, 1, -1, -1]);
});

test('volume strategies reject unusable volumes and oscillator thresholds are validated', () => {
  const invalid = bars.map((p, i) => i ? p : { ...p, volume: NaN });
  for (const kind of ['volume', 'obv']) assert.throws(() => runBacktest(invalid, configForStrategy(strategyDefaults, kind)), /成交量/);
  assert.throws(() => runBacktest(bars, { ...configForStrategy(strategyDefaults, 'rsi'), entryThreshold: 80, exitThreshold: 20 }), /阈值/);
  assert.throws(() => validateStrategyConfig({ ...strategyDefaults, kind: 'fake' }));
});

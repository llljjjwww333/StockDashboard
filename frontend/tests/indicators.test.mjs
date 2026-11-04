import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateIndicators, sma, ema, seriesPath } from '../src/terminal/indicators.ts';

function bars(count, flat = false) {
  return Array.from({ length: count }, (_, i) => ({ timestamp: new Date(Date.UTC(2026, 0, i + 1)).toISOString(),
    open: 100 + (flat ? 0 : i), close: 100 + (flat ? 0 : i), high: 102 + (flat ? 0 : i), low: 99 + (flat ? 0 : i), volume: 100 + i }));
}

test('SMA and EMA use complete seed windows', () => {
  assert.deepEqual(sma([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
  assert.deepEqual(ema([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
  assert.deepEqual(ema([null, 1, 2, 3, 4], 3), [null, null, null, 2, 3]);
});

test('daily prehistory fills MA60 throughout the displayed one-month window', () => {
  const all = bars(180);
  const visible = all.slice(150);
  const result = calculateIndicators(visible, all);
  assert.equal(result.overlays.ma60[0].values[0], 220.5);
  assert.equal(result.overlays.ma60[0].values.length, 30);
});

test('warmup data after the visible last candle cannot affect indicators', () => {
  const all = bars(180);
  const visible = all.slice(150, 161);
  all[179].close = 999999;
  const result = calculateIndicators(visible, all);
  assert.equal(result.overlays.ma5[0].values.at(-1), 258);
});

test('flat prices produce finite neutral oscillators and zero-width Bollinger bands', () => {
  const result = calculateIndicators(bars(80, true));
  assert.equal(result.panels.rsi.lines[0].values.at(-1), 50);
  assert.equal(result.panels.cci.lines[0].values.at(-1), 0);
  assert.equal(result.panels.roc.lines[0].values.at(-1), 0);
  assert.equal(result.panels.obv.lines[0].values.at(-1), 0);
  assert.equal(result.overlays.boll[1].values.at(-1), 100);
  assert.equal(result.overlays.boll[2].values.at(-1), 100);
  for (const line of result.panels.kdj.lines) assert(Math.abs(line.values.at(-1) - 100 / 3) < 1e-8);
});

test('steady linear prices give the known MACD separation and zero histogram', () => {
  const result = calculateIndicators(bars(80));
  assert.equal(result.panels.macd.lines[0].values.at(-1), 7);
  assert.equal(result.panels.macd.lines[1].values.at(-1), 7);
  assert.equal(result.panels.macd.bars.at(-1), 0);
  assert.equal(result.panels.rsi.lines[0].values.at(-1), 100);
  assert(Math.abs(result.panels.atr.lines[0].values.at(-1) - 3) < 1e-10);
});

test('OBV ignores unchanged closes and subtracts down-volume', () => {
  const points = bars(4);
  [100, 101, 101, 99].forEach((value, i) => { points[i].close = value; points[i].volume = (i + 1) * 10; });
  assert.deepEqual(calculateIndicators(points).panels.obv.lines[0].values, [0, 20, 20, -20]);
});

test('short windows retain missing values rather than drawing invented indicators', () => {
  const result = calculateIndicators(bars(5));
  assert(result.overlays.ma60[0].values.every(v => v === null));
  assert(result.panels.macd.lines[0].values.every(v => v === null));
  assert(result.panels.rsi.lines[0].values.every(v => v === null));
  assert.equal(calculateIndicators([]).panels.volume.bars.length, 0);
});

test('line paths break at missing indicator values', () => {
  const path = seriesPath([1, 2, null, 4], i => i, v => v);
  assert.equal((path.match(/M/g) ?? []).length, 2);
  assert(!path.includes('NaN'));
});

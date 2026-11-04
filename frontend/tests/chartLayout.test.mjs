import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildChartLayout, nearestPoint, areaPaths } from '../src/terminal/chartLayout.ts';
import { seriesPath } from '../src/terminal/indicators.ts';

const point = timestamp => ({ timestamp, open: 100, high: 100, low: 100, close: 100, volume: 1 });

test('minute candle spacing follows its interval without breaking every bar', () => {
  const data = ['09:45', '10:00', '10:15', '10:30'].map(time => point(`2026-11-02T${time}:00+08:00`));
  const layout = buildChartLayout(data, '600519', true, 18, 982, 15);
  assert.equal(layout.breaks.size, 0);
  assert.equal(layout.step, 60);
  assert.equal(layout.positions[1] - layout.positions[0], 60);
});

test('coarser China candles do not create a false missing-bar break across lunch', () => {
  const data = ['11:25', '11:30', '13:05', '13:10'].map(time => point(`2026-11-02T${time}:00+08:00`));
  const layout = buildChartLayout(data, '600519', true, 18, 982, 5);
  assert.equal(layout.breaks.size, 0);
});

test('five trading sessions break price, overlays and filled areas without overnight bridges', () => {
  const data = [26, 27, 28, 29, 30].flatMap(day => Array.from({ length: 242 }, (_, i) => {
    const minute = i <= 120 ? 570 + i : 780 + i - 121;
    return point(`2026-10-${day}T${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}:00+08:00`);
  }));
  const { positions, breaks, sessions } = buildChartLayout(data, '600519', true, 54, 946);
  assert.equal(sessions.length, 5);
  assert.deepEqual([...breaks], [242, 484, 726, 968]);
  for (let i = 242; i < positions.length; i += 242) assert.equal(positions[i] - positions[i - 1], 12);
  assert.equal((seriesPath(data.map(p => p.close), i => positions[i], v => v, breaks).match(/M/g) ?? []).length, 5);
  assert.equal(areaPaths(data.map(p => p.close), i => positions[i], v => v, 300, breaks).length, 5);
});

test('partial current session uses the full trading clock instead of stretching to the close', () => {
  const layout = buildChartLayout(['09:30', '10:30'].map(t => point(`2026-10-30T${t}:00+08:00`)), '600519', true, 0, 241);
  assert.deepEqual(layout.positions, [0, 60]);
});

test('China lunch break is compressed and does not create an artificial price gap', () => {
  const layout = buildChartLayout(['11:30', '13:00', '15:00'].map(t => point(`2026-10-30T${t}:00+08:00`)), '600519', true, 0, 241);
  assert.deepEqual(layout.positions, [120, 121, 241]);
  assert.equal(layout.breaks.has(1), false);
  assert.equal(layout.breaks.has(2), true); // The intentionally missing afternoon samples remain a separate gap.
});

test('US session dates and clock positions respect daylight saving time', () => {
  const layout = buildChartLayout([
    point('2026-10-30T13:30:00Z'), point('2026-10-30T20:00:00Z'),
    point('2026-11-02T14:30:00Z'), point('2026-11-02T21:00:00Z'),
  ], 'AAPL', true, 0, 792);
  assert.deepEqual(layout.positions, [0, 390, 402, 792]);
  assert(layout.breaks.has(2));
});

test('missing intraday samples keep their clock spacing and break instead of fabricating continuity', () => {
  const layout = buildChartLayout(['09:30', '09:31', '10:00'].map(t => point(`2026-10-30T${t}:00+08:00`)), '600519', true, 0, 241);
  assert.deepEqual(layout.positions, [0, 1, 30]);
  assert.deepEqual([...layout.breaks], [2]);
  assert.equal(nearestPoint(layout.positions, 29), 2);
  assert.equal(nearestPoint(layout.positions, -10), 0);
  assert.equal(nearestPoint(layout.positions, 900), 2);
});

test('daily price history keeps continuous evenly spaced trading bars', () => {
  const data = ['2026-10-29', '2026-10-30', '2026-11-02'].map(d => point(`${d}T00:00:00+08:00`));
  const layout = buildChartLayout(data, '600519', false, 0, 100);
  assert.deepEqual(layout.positions, [0, 50, 100]);
  assert.equal(layout.breaks.size, 0);
});

test('a single genuine daily bar is centered and remains drawable', () => {
  const layout = buildChartLayout([point('2026-11-02T00:00:00+08:00')], '920117', false, 18, 924);
  assert.deepEqual(layout.positions, [471]);
  assert.equal(layout.breaks.size, 0);
});

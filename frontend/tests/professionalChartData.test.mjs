import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chartCandles, candleUpdatePlan, formatPercentagePrice, indicatorUpdatePlan, percentageReference, rangeAfterCandleReplacement, readPriceLevels } from '../src/terminal/professionalChartData.ts';
import { pricePrecision } from '../src/lib/pricePrecision.ts';
const bar = (timestamp, close = 100) => ({ timestamp, open: close - 1, high: close + 1, low: close - 2, close, volume: 100 });

test('chart axes keep exchange wall time through New York daylight-saving changes', () => {
  const data = [bar('2026-10-30T13:30:00Z'), bar('2026-11-02T14:30:00Z')];
  const rows = chartCandles(data, 'AAPL');
  assert.equal(new Date(rows[0].time * 1000).toISOString(), '2026-10-30T09:30:00.000Z');
  assert.equal(new Date(rows[1].time * 1000).toISOString(), '2026-11-02T09:30:00.000Z');
  assert.equal(data[0].timestamp, '2026-10-30T13:30:00Z');
});

test('China chart axes keep Shanghai time and preserve three-decimal prices', () => {
  const rows = chartCandles([bar('2026-11-03T01:35:00Z', 4.092)], '510300');
  assert.equal(new Date(rows[0].time * 1000).toISOString(), '2026-11-03T09:35:00.000Z');
  assert.equal(rows[0].close, 4.092);
  assert.equal(pricePrecision('510300', 4.092), 3);
  assert.equal(pricePrecision('159915', 2.123), 3);
  assert.equal(pricePrecision('600519', 1480), 2);
  assert.equal(pricePrecision('AAPL', 220), 2);
  assert.equal(pricePrecision('PENNY', .1234), 4);
});

test('live tail updates and appends avoid replacing the historical series', () => {
  const old = chartCandles([bar('2026-11-03T09:30:00-05:00'), bar('2026-11-03T09:31:00-05:00')], 'AAPL');
  assert.deepEqual(candleUpdatePlan(old, old), { replace: false, rows: [] });
  const next = [...old.slice(0, 1), { ...old[1], close: 101 }, { ...old[1], time: old[1].time + 60, close: 102 }];
  assert.deepEqual(candleUpdatePlan(old, next), { replace: false, rows: next.slice(1) });
  assert.equal(candleUpdatePlan(old, [{ ...old[0], close: 103 }, old[1]]).replace, true);
  assert.equal(candleUpdatePlan(old, old.slice(1)).replace, true);
  assert.equal(candleUpdatePlan(old, [old[0], { ...old[1], time: old[1].time + 60 }]).replace, true);
  assert.equal(candleUpdatePlan([], old).replace, true);
});

test('saved drawing levels stay isolated by ticker and reject invalid numbers', () => {
  const store = { getItem: key => key.endsWith('AAPL') ? '[100,0,-1,"secret",200,null,1e100]' : '[4.092]' };
  assert.deepEqual(readPriceLevels('AAPL', store), [100, 200]);
  assert.deepEqual(readPriceLevels('510300', store), [4.092]);
  assert.deepEqual(readPriceLevels('AAPL', { getItem: () => '{bad' }), []);
});

test('percentage labels share the candle reference including the partially visible left bar', () => {
  const rows = [{ close: 100 }, { close: 110 }, { close: 120 }];
  assert.equal(percentageReference(rows), 100);
  assert.equal(percentageReference(rows, -4), 100);
  assert.equal(percentageReference(rows, 1.8), 110);
  assert.equal(formatPercentagePrice(121, percentageReference(rows, 1.8)), '10.00%');
  assert.equal(formatPercentagePrice(99, 100), '-1.00%');
  assert.equal(formatPercentagePrice(100 - 1e-12, 100), '0.00%');
});

test('offscreen and unavailable percentage references cannot produce invalid axis labels', () => {
  assert.equal(percentageReference([], 0), null);
  assert.equal(percentageReference([{ close: 100 }], 2), null);
  assert.equal(percentageReference([{ close: 100 }], NaN), null);
  assert.equal(percentageReference([{ close: 0 }]), null);
  for (const reference of [0, -1, null, Infinity]) assert.equal(formatPercentagePrice(100, reference), '--');
});

test('indicator updates retain whitespace and rebuild when an earlier value or color changes', () => {
  const previous = [{ time: 1 }, { time: 2, value: 12, color: 'red' }, { time: 3, value: 14, color: 'green' }];
  assert.deepEqual(indicatorUpdatePlan(previous, previous), { replace: false, rows: [] });
  const next = [...previous.slice(0, 2), { time: 3, value: 15, color: 'green' }, { time: 4 }];
  assert.deepEqual(indicatorUpdatePlan(previous, next), { replace: false, rows: next.slice(2) });
  assert.equal(indicatorUpdatePlan(previous, [{ time: 1, value: 10 }, ...previous.slice(1)]).replace, true);
  assert.equal(indicatorUpdatePlan(previous, [previous[0], { ...previous[1], color: 'green' }, previous[2]]).replace, true);
  assert.equal(indicatorUpdatePlan(previous, previous.slice(1)).replace, true);
});

test('a rolling candle window preserves historical time and the latest edge independently', () => {
  const previous = Array.from({ length: 10 }, (_, index) => ({ time: 100 + index }));
  const next = [...previous.slice(2), { time: 110 }, { time: 111 }, { time: 112 }];
  assert.deepEqual(rangeAfterCandleReplacement(previous, next, { from: 3.25, to: 7.25 }), { from: 1.25, to: 5.25 });
  assert.deepEqual(rangeAfterCandleReplacement(previous, next, { from: 3, to: 11 }), { from: 4, to: 12 });
  assert.deepEqual(rangeAfterCandleReplacement(previous, previous, { from: 3, to: 7 }), { from: 3, to: 7 });
  assert.deepEqual(rangeAfterCandleReplacement(previous, [{ time: 99 }, ...previous], { from: 3, to: 7 }), { from: 4, to: 8 });
  const expired = previous.map(row => ({ time: row.time + 20 }));
  assert.deepEqual(rangeAfterCandleReplacement(previous, expired, { from: 1, to: 5 }), { from: -2, to: 2 });
});

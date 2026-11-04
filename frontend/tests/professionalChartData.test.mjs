import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chartCandles, candleUpdatePlan, readPriceLevels } from '../src/terminal/professionalChartData.ts';
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

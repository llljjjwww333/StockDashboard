import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liveDailyHistory } from '../src/terminal/liveDailyHistory.ts';

const point = { timestamp: '2026-11-04T00:00:00+08:00', open: 100, high: 102, low: 99, close: 100, volume: 1000 };
const history = { ticker: '600519', interval: '1d', price_type: 'ohlc', adjustment: 'qfq', source: 'History feed',
  fetched_at: '2026-11-04T02:30:00Z', data: [{ ...point, timestamp: '2026-11-03T00:00:00+08:00' }, point] };
const quote = { ticker: '600519', price: 101.25, open_price: 100, high_price: 103.5, low_price: 98.75, previous_close: 100,
  volume: 1500, change_percent: 1.25, as_of: '2026-11-04T10:30:03+08:00', fetched_at: '2026-11-04T02:30:04Z', source: 'Quote feed' };
const live = (snapshot = quote, changes = {}) => ({ price: snapshot.price, volume: snapshot.volume, changePercent: snapshot.change_percent, snapshot, ...changes });

test('full-day quotes update only the current daily bar and preserve source history', () => {
  const result = liveDailyHistory('600519', history, live());
  assert.deepEqual(result.data.at(-1), { timestamp: point.timestamp, open: 100, high: 103.5, low: 98.75, close: 101.25, volume: 1500 });
  assert.equal(result.data[0], history.data[0]);
  assert.deepEqual(history.data.at(-1), point);
  assert.equal(result.as_of, quote.as_of);
  assert.equal(result.source, 'History feed + Quote feed');
});

test('a failed quote confirmation does not erase its last observed daily values', () => {
  const result = liveDailyHistory('600519', history, live(quote, { stale: true }));
  assert.equal(result.data.at(-1).close, 101.25);
  assert.equal(result.data.at(-1).volume, 1500);
  assert.equal(result.stale, true);
});

test('daily data cannot be replaced by older, incomplete or differently adjusted observations', () => {
  for (const change of [
    { ticker: '000001' }, { volume: 999 }, { open_price: 110 }, { high_price: 101 }, { low_price: 100 },
    { open_price: null }, { high_price: null }, { low_price: null }, { as_of: '2026-11-03T14:00:00+08:00' },
    { as_of: '2026-11-04T09:20:00+08:00' }, { as_of: 'invalid' },
  ]) assert.equal(liveDailyHistory('600519', history, live({ ...quote, ...change })), history);
  for (const change of [{ interval: '1m' }, { price_type: 'snapshot' }, { adjustment: 'hfq' }, { ticker: '000001' }]) {
    const other = { ...history, ...change };
    assert.equal(liveDailyHistory('600519', other, live()), other);
  }
});

test('equal-volume observations require a capture time at least as recent as the history', () => {
  assert.equal(liveDailyHistory('600519', history, live({ ...quote, volume: 1000, as_of: '2026-11-04T10:29:59+08:00' })), history);
  assert.equal(liveDailyHistory('600519', history, live({ ...quote, volume: 1000 })).data.at(-1).close, 101.25);
  assert.equal(liveDailyHistory('600519', history, live({ ...quote, price: 100, open_price: 100, high_price: 102, low_price: 99, volume: 1000 })), history);
});

test('a new session uses real quote OHLCV, the previous close and the original daily timestamp convention', () => {
  const next = { ...quote, as_of: '2026-11-05T09:30:03+08:00', open_price: 101, high_price: 104, low_price: 100, price: 103, volume: 50 };
  const result = liveDailyHistory('600519', history, live(next));
  assert.equal(result.data.length, 3);
  assert.deepEqual(result.data.at(-1), { timestamp: '2026-11-05T00:00:00+08:00', open: 101, high: 104, low: 100, close: 103, volume: 50 });
  assert.equal(liveDailyHistory('600519', history, live({ ...next, previous_close: 90 })), history);
  assert.equal(liveDailyHistory('600519', history, live({ ...next, as_of: '2026-11-06T10:30:00+08:00' })), history);
});

test('weekend rollover preserves New York daily bar times through a DST change', () => {
  const usHistory = { ...history, ticker: 'AAPL', adjustment: 'none', data: [{ ...point, timestamp: '2026-10-30T09:30:00-04:00' }] };
  const next = { ...quote, ticker: 'AAPL', as_of: '2026-11-02T10:30:03-05:00', open_price: 101, high_price: 104, low_price: 100, price: 103, volume: 50 };
  assert.equal(liveDailyHistory('AAPL', usHistory, live(next)).data.at(-1).timestamp, '2026-11-02T09:30:00-05:00');
  for (const as_of of ['2026-11-02T09:15:00-05:00', '2026-11-02T17:00:00-05:00']) {
    assert.equal(liveDailyHistory('AAPL', usHistory, live({ ...next, as_of })), usHistory);
  }
});

test('late-published Chinese closing snapshots and US closing timestamps remain usable', () => {
  const result = liveDailyHistory('600519', history, live({ ...quote, as_of: '2026-11-04T16:14:41+08:00' }));
  assert.equal(result.data.at(-1).close, quote.price);
  const usHistory = { ...history, ticker: 'AAPL', adjustment: 'none', data: [{ ...point, timestamp: '2026-11-04T09:30:00-05:00' }] };
  assert.equal(liveDailyHistory('AAPL', usHistory, live({ ...quote, ticker: 'AAPL', as_of: '2026-11-04T16:00:01-05:00' })).data.at(-1).close, quote.price);
});

test('ETF quotes keep their actual three-decimal OHLC values', () => {
  const fundHistory = { ...history, ticker: '510300', data: [{ ...point, open: 4.09, high: 4.1, low: 4.08, close: 4.092 }] };
  const fundQuote = { ...quote, ticker: '510300', open_price: 4.09, high_price: 4.103, low_price: 4.079, price: 4.101 };
  assert.equal(liveDailyHistory('510300', fundHistory, live(fundQuote)).data.at(-1).close, 4.101);
});

test('official holidays do not create daily bars, while the reopening session can follow the holiday gap', () => {
  const beforeHoliday = { ...history, data: [{ ...point, timestamp: '2026-09-30T00:00:00+08:00' }] };
  assert.equal(liveDailyHistory('600519', beforeHoliday, live({ ...quote, as_of: '2026-10-01T10:30:00+08:00' })), beforeHoliday);
  const reopened = liveDailyHistory('600519', beforeHoliday, live({ ...quote, as_of: '2026-10-08T10:30:00+08:00' }));
  assert.equal(reopened.data.at(-1).timestamp, '2026-10-08T00:00:00+08:00');
  const usHistory = { ...history, ticker: 'AAPL', adjustment: 'none', data: [{ ...point, timestamp: '2026-11-27T09:30:00-05:00' }] };
  assert.equal(liveDailyHistory('AAPL', usHistory, live({ ...quote, ticker: 'AAPL', as_of: '2026-11-27T13:30:00-05:00' })), usHistory);
});

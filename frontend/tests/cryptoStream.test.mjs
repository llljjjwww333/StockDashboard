import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isCandleEvent, isDepthEvent, mergeCryptoCandles } from '../src/lib/cryptoStream.ts';

const point = { timestamp: '2026-11-14T00:00:00Z', open: 100, high: 102, low: 99, close: 101, volume: 12.5 };
const history = { ticker: 'BTCUSDT', interval: '1d', price_type: 'ohlc', data: [point], fetched_at: '2026-11-14T01:00:00Z' };
const event = { ticker: 'BTCUSDT', interval: '1d', event_time: Date.parse('2026-11-14T02:00:00Z'), closed: false,
  point: { ...point, close: 101.5, high: 103, volume: 12.75 } };

test('native candles update only the matching UTC bar with its actual fractional candle volume', () => {
  const result = mergeCryptoCandles(history, 'BTCUSDT', [event]);
  assert.equal(result.data.at(-1).close, 101.5);
  assert.equal(result.data.at(-1).volume, 12.75);
  assert.equal(history.data[0], point);
  assert.equal(point.volume, 12.5);
});

test('new UTC session appends once and missing candle gaps are left for REST recovery', () => {
  const next = { ...event, point: { ...event.point, timestamp: '2026-11-15T00:00:00Z', volume: .01 } };
  const result = mergeCryptoCandles(history, 'BTCUSDT', [next]);
  assert.equal(result.data.length, 2);
  assert.equal(mergeCryptoCandles(result, 'BTCUSDT', [next]).data.length, 2);
  assert.equal(mergeCryptoCandles(history, 'BTCUSDT', [{ ...next, point: { ...next.point, timestamp: '2026-11-16T00:00:00Z' } }]), history);
});

test('other symbols, intervals, older candles and smaller volume cannot overwrite history', () => {
  for (const changed of [{ ticker: 'ETHUSDT' }, { interval: '1m' }, { point: { ...point, volume: 1 } },
    { point: { ...point, timestamp: '2026-11-13T00:00:00Z' } }]) {
    assert.equal(mergeCryptoCandles(history, 'BTCUSDT', [{ ...event, ...changed }]), history);
  }
});

test('stream payload validation rejects invalid OHLC, oversized depth and non-finite values', () => {
  assert(isCandleEvent(event));
  assert(!isCandleEvent({ ...event, point: { ...point, high: 98 } }));
  const depth = { ticker: 'BTCUSDT', sequence: 1, received_at: '2026-11-15T00:00:00Z', book: {
    bids: [{ level: 1, price: 100, volume: .0001 }], asks: [{ level: 1, price: 101, volume: .0002 }] } };
  assert(isDepthEvent(depth));
  assert(!isDepthEvent({ ...depth, sequence: NaN }));
  assert(!isDepthEvent({ ...depth, book: { ...depth.book, bids: Array(11).fill(depth.book.bids[0]) } }));
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LatestFrame } from '../src/lib/latestFrame.ts';
import { mergeStoredQuotes } from '../src/lib/quotes.ts';
import { bookStatistics } from '../src/lib/orderBook.ts';

function harness() {
  const callbacks = new Map(), values = [];
  let serial = 0;
  const queue = new LatestFrame(value => values.push(value), callback => { callbacks.set(++serial, callback); return serial; },
    id => callbacks.delete(id), (next, current) => next.sequence > current.sequence);
  const paint = () => { const list = [...callbacks.values()]; callbacks.clear(); list.forEach(fn => fn(0)); };
  return { queue, values, callbacks, paint };
}

test('a burst after a stalled frame publishes the newest actual snapshot only once', () => {
  const h = harness();
  for (let sequence = 1; sequence <= 1000; sequence++) h.queue.offer({ sequence, quantity: sequence / 10000 });
  assert.equal(h.callbacks.size, 1);
  h.paint();
  assert.deepEqual(h.values, [{ sequence: 1000, quantity: .1 }]);
  assert.equal(h.callbacks.size, 0);
  h.paint(); assert.equal(h.values.length, 1);
});

test('older packets cannot replace the pending snapshot and clearing cancels a stale frame', () => {
  const h = harness(); h.queue.offer({ sequence: 20 }); h.queue.offer({ sequence: 19 });
  h.paint(); assert.deepEqual(h.values, [{ sequence: 20 }]);
  h.queue.offer({ sequence: 21 }); h.queue.clear(); h.paint();
  assert.equal(h.values.length, 1);
});

test('batch quotes preserve monotonic market time, untouched objects and stream confirmations', () => {
  const quote = { price: 100, changePercent: 1, volume: 12, asOf: '2026-11-15T10:00:02Z', receivedAt: 2, streamConfirmedAt: 2 };
  const current = { BTCUSDT: quote, ETHUSDT: { ...quote, price: 10 }, SOLUSDT: { ...quote, price: 1 } };
  const result = mergeStoredQuotes(current, {
    BTCUSDT: { ...quote, price: 99, asOf: '2026-11-15T10:00:01Z' },
    ETHUSDT: { ...quote, price: 11, receivedAt: 3, streamConfirmedAt: undefined },
  });
  assert.equal(result.BTCUSDT, quote); assert.equal(result.ETHUSDT.price, 11);
  assert.equal(result.ETHUSDT.streamConfirmedAt, 2); assert.equal(result.SOLUSDT, current.SOLUSDT);
  assert.equal(current.ETHUSDT.price, 10);
  assert.equal(mergeStoredQuotes(current, {}), current);
});

test('fractional coin quantities keep correct bar scale and bid share below one whole coin', () => {
  const bids = [{ level: 1, price: 100, volume: .0002 }], asks = [{ level: 1, price: 101, volume: .0006 }];
  const stats = bookStatistics(bids, asks);
  assert.equal(stats.peak, .0006); assert.equal(stats.spread, 1);
  assert(Math.abs(stats.bidShare - 25) < 1e-10);
  const scaled = bookStatistics(bids.map(r => ({ ...r, volume: r.volume * 10000 })), asks.map(r => ({ ...r, volume: r.volume * 10000 })));
  assert(Math.abs(scaled.bidShare - stats.bidShare) < 1e-10);
  assert.deepEqual(bookStatistics([], []), { peak: 0, bidShare: 0, spread: null });
});

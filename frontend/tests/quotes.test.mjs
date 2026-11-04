import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toStoredQuote, isOlderQuote } from '../src/lib/quotes.ts';

const snapshot = {
  ticker: 'AAPL', price: 102, volume: 500, change_percent: 2,
  high_price: 104, low_price: 98, previous_close: 100,
  volume_ratio: 1.36, pe_ratio: 21.18, pb_ratio: 6.42, market_cap: 1740176000000,
  as_of: '2026-11-02T10:00:02-05:00', fetched_at: '2026-11-02T15:00:03Z',
};

test('live price, volume and day range keep the complete source snapshot', () => {
  const quote = toStoredQuote(snapshot);
  assert.equal(quote.snapshot.high_price, 104);
  assert.equal(quote.volume, 500);
  assert.equal(quote.snapshot.previous_close, 100);
  assert.equal(quote.snapshot.volume_ratio, 1.36);
  assert.equal(quote.snapshot.pe_ratio, 21.18);
  assert.equal(quote.snapshot.market_cap, 1740176000000);
});

test('a slow HTTP response cannot replace a newer WebSocket quote', () => {
  const current = toStoredQuote(snapshot);
  assert.equal(isOlderQuote(toStoredQuote({ ...snapshot, as_of: '2026-11-02T10:00:01-05:00', fetched_at: '2026-11-02T15:00:05Z' }), current), true);
});

test('same-market-time snapshots retain the newest retrieval', () => {
  const current = toStoredQuote(snapshot);
  assert.equal(isOlderQuote(toStoredQuote({ ...snapshot, fetched_at: '2026-11-02T15:00:01Z' }), current), true);
  assert.equal(isOlderQuote(toStoredQuote({ ...snapshot, fetched_at: '2026-11-02T15:00:05Z' }), current), false);
});

test('failure state can mark the existing quote stale without changing its price', () => {
  const current = toStoredQuote(snapshot);
  assert.equal(isOlderQuote({ ...current, stale: true }, current), false);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toStoredQuote, isOlderQuote, quoteFreshness } from '../src/lib/quotes.ts';

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

test('quotes without exchange time cannot displace timestamped snapshots', () => {
  const current = toStoredQuote(snapshot);
  const undated = toStoredQuote({ ...snapshot, as_of: null, fetched_at: '2026-11-02T15:00:05Z' });
  assert.equal(isOlderQuote(undated, current), true);
  assert.equal(isOlderQuote(current, undated), false);
});

test('a separate stale copy cannot displace an equally recent live snapshot', () => {
  const current = toStoredQuote(snapshot);
  assert.equal(isOlderQuote(toStoredQuote({ ...snapshot, stale: true }), current), true);
  const undated = toStoredQuote({ ...snapshot, as_of: null, fetched_at: null, stale: true });
  assert.equal(isOlderQuote(undated, { price: 101, volume: 495, changePercent: 1 }), false);
});

test('a confirmed quote ages out without changes to connection status', () => {
  const now = Date.parse('2026-11-04T10:30:00+08:00');
  const ticker = '600519';
  const confirmedAt = new Date(now - 75000).toISOString();
  const received = toStoredQuote({ ...snapshot, ticker, as_of: confirmedAt, fetched_at: confirmedAt }, now);
  assert.equal(quoteFreshness(ticker, received, now), 'cached');
  const undated = toStoredQuote({ ...snapshot, as_of: null, fetched_at: null }, now - 75000);
  assert.equal(quoteFreshness('AAPL', undated, now), 'cached');
  assert.equal(quoteFreshness('AAPL', undated, now - 1), null);
});

test('a fresh poll with an old exchange time is marked only during continuous China trading', () => {
  const ticker = '600519';
  const now = Date.parse('2026-11-04T10:30:00+08:00');
  const as_of = new Date(now - 95000).toISOString();
  const quote = toStoredQuote({ ...snapshot, ticker, as_of, fetched_at: new Date(now).toISOString() });
  assert.equal(quoteFreshness(ticker, quote, now), 'old');
  assert.equal(quoteFreshness('AAPL', quote, now), null);
  for (const time of ['2026-11-04T12:10:00+08:00', '2026-11-04T15:10:00+08:00']) {
    const fetched = toStoredQuote({ ...snapshot, ticker, as_of, fetched_at: time });
    assert.equal(quoteFreshness(ticker, fetched, Date.parse(time)), null);
  }
  const fresh = toStoredQuote({ ...snapshot, ticker, as_of: new Date(now).toISOString(), fetched_at: new Date(now).toISOString() });
  assert.equal(quoteFreshness(ticker, fresh, now), null);
});

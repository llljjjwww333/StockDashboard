import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pollQuoteBatches, streamQuoteTickers } from '../src/lib/quoteSubscriptions.ts';

const watchlist = Array.from({ length: 102 }, (_, index) => ({ ticker: `TEST${index}` }));

test('the active instrument takes a stream slot and the displaced ticker is polled', () => {
  const active = 'TEST101';
  const streamed = streamQuoteTickers(watchlist, active);
  assert.equal(streamed.size, 100);
  assert.equal([...streamed][0], active);
  assert.deepEqual(pollQuoteBatches(watchlist, active, true), ['TEST99,TEST100']);
  assert.deepEqual(pollQuoteBatches(watchlist.slice(0, 99), 'PREVIEW', true), []);
  assert.deepEqual(pollQuoteBatches(watchlist.slice(0, 100), 'PREVIEW', true), ['TEST99']);
});

test('disconnected polling covers all saved tickers except the separately fetched active quote', () => {
  const active = 'TEST0';
  const batches = pollQuoteBatches([...watchlist, watchlist[1], { ticker: 'INVALID!' }], active, false).map(batch => batch.split(','));
  assert.deepEqual(batches.map(batch => batch.length), [100, 1]);
  assert.deepEqual(batches.flat(), watchlist.slice(1).map(stock => stock.ticker));
});

test('a connected feed polls only its interrupted symbols alongside tickers beyond the stream limit', () => {
  assert.deepEqual(pollQuoteBatches(watchlist, 'TEST101', true, new Set(['TEST1', 'TEST101', 'MISSING'])), ['TEST1,TEST99,TEST100']);
  assert.deepEqual(pollQuoteBatches(watchlist.slice(0, 4), 'TEST0', true, new Set(['TEST1'])), ['TEST1']);
  assert.deepEqual(pollQuoteBatches(watchlist.slice(0, 4), 'TEST0', true, new Set()), []);
});

test('market rows share the watchlist socket and cannot displace active or saved subscriptions', () => {
  assert.deepEqual([...streamQuoteTickers([{ ticker: 'BTCUSDT' }], 'ETHUSDT', ['BTCUSDT', 'SOLUSDT', 'INVALID!'])], ['ETHUSDT', 'BTCUSDT', 'SOLUSDT']);
  assert.equal(streamQuoteTickers(watchlist, 'ACTIVE', ['EXTRA']).has('EXTRA'), false);
});

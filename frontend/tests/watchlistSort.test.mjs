import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sortWatchlist } from '../src/terminal/watchlistSort.ts';

test('watchlist sorting separates missing quotes from zero and keeps ties in saved order', () => {
  const watchlist = ['MISSING', 'TIED1', 'DOWN', 'UP', 'TIED2', 'INVALID'].map(ticker => ({ ticker }));
  const quotes = Object.fromEntries(
    [['TIED1', 0], ['DOWN', -2], ['UP', 3], ['TIED2', 0], ['INVALID', NaN]]
      .map(([ticker, changePercent]) => [ticker, { price: 100, changePercent }]),
  );
  const tickers = sort => sortWatchlist(watchlist, quotes, sort).map(stock => stock.ticker);
  assert.deepEqual(tickers('change-desc'), ['UP', 'TIED1', 'TIED2', 'DOWN', 'MISSING', 'INVALID']);
  assert.deepEqual(tickers('change-asc'), ['DOWN', 'TIED1', 'TIED2', 'UP', 'MISSING', 'INVALID']);
  assert.deepEqual(tickers('manual'), ['MISSING', 'TIED1', 'DOWN', 'UP', 'TIED2', 'INVALID']);
  quotes.MISSING = { price: 100, changePercent: -4 };
  assert.deepEqual(tickers('change-desc'), ['UP', 'TIED1', 'TIED2', 'DOWN', 'MISSING', 'INVALID']);
  assert.deepEqual(tickers('change-asc'), ['MISSING', 'DOWN', 'TIED1', 'TIED2', 'UP', 'INVALID']);
});

test('aged quotes rank below fresh quotes in either direction but above missing prices', () => {
  const watchlist = ['OLD', 'LIVE', 'MISSING', 'CACHED', 'FLAT'].map(ticker => ({ ticker }));
  const quotes = {
    OLD: { price: 100, changePercent: 50 }, LIVE: { price: 100, changePercent: -1 },
    CACHED: { price: 100, changePercent: -50 }, FLAT: { price: 100, changePercent: 0 },
  };
  const aged = new Set(['OLD', 'CACHED']);
  const tickers = sort => sortWatchlist(watchlist, quotes, sort, aged).map(stock => stock.ticker);
  assert.deepEqual(tickers('change-desc'), ['FLAT', 'LIVE', 'OLD', 'CACHED', 'MISSING']);
  assert.deepEqual(tickers('change-asc'), ['LIVE', 'FLAT', 'CACHED', 'OLD', 'MISSING']);
  assert.deepEqual(tickers('manual'), ['OLD', 'LIVE', 'MISSING', 'CACHED', 'FLAT']);
});

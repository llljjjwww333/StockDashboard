import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWatchlistState, createWatchlistStorage } from '../src/lib/watchlistPersistence.ts';

const apple = { ticker: 'AAPL', name: 'Apple', market: 'US' };
const fallback = { watchlist: [apple], selectedTicker: 'AAPL' };

test('watchlist hydration salvages valid identities and ignores corrupt rows and stored quote fields', () => {
  const value = { watchlist: [null, 1, { ticker: '../invalid' }, { ticker: ' aapl ', name: 'Apple', market: 'CN', price: 123 },
    { ticker: 'AAPL', name: 'Duplicate' }, { ticker: '600519', name: null, market: 'US' },
    { ticker: 'sh000001', name: '上证指数', market: 'US' }], selectedTicker: 'sh000001', selectStock: 'invalid-action' };
  assert.deepEqual(normalizeWatchlistState(value, fallback), {
    watchlist: [apple, { ticker: '600519', name: '600519', market: 'CN' }, { ticker: 'SH000001', name: '上证指数', market: 'CN' }], selectedTicker: 'SH000001',
  });
  assert.equal(value.watchlist[3].ticker, ' aapl ');
});

test('legitimate empty lists stay empty while missing or invalid arrays use the current defaults', () => {
  assert.deepEqual(normalizeWatchlistState({ watchlist: [], selectedTicker: 'AAPL' }, fallback), { watchlist: [], selectedTicker: null });
  for (const value of [null, undefined, {}, { watchlist: null }, { watchlist: 'invalid' }]) {
    assert.deepEqual(normalizeWatchlistState(value, fallback), fallback);
  }
  assert.deepEqual(normalizeWatchlistState({ watchlist: [{ ticker: 'NVDA', name: 'NVIDIA' }], selectedTicker: 'missing' }, fallback), {
    watchlist: [{ ticker: 'NVDA', name: 'NVIDIA', market: 'US' }], selectedTicker: 'NVDA',
  });
});

test('blocked storage never interrupts an in-memory action and a later successful save clears the issue', () => {
  const issues = [];
  let blocked = true;
  const data = new Map();
  const storage = createWatchlistStorage(() => {
    if (blocked) throw new Error('Blocked');
    return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
  }, issue => issues.push(issue));
  assert.equal(storage.getItem('watchlist'), null);
  assert.doesNotThrow(() => storage.setItem('watchlist', 'saved'));
  assert.deepEqual(issues, ['read', 'write']);
  blocked = false;
  storage.setItem('watchlist', 'saved');
  assert.equal(storage.getItem('watchlist'), 'saved');
  assert.equal(issues.at(-1), null);
  storage.removeItem('watchlist');
  assert.equal(storage.getItem('watchlist'), null);
});

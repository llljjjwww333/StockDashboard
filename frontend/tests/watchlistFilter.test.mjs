import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterWatchlist } from '../src/terminal/watchlistFilter.ts';

const stocks = [
  { ticker: 'AAPL', name: 'Apple Inc.', market: 'US' },
  { ticker: '600519', name: 'Kweichow Moutai', market: 'CN' },
  { ticker: 'NVDA', name: 'NVIDIA', market: 'US' },
];
const quotes = { '600519': { snapshot: { name: '贵州茅台' } } };
const find = (query = '', market = 'ALL') => filterWatchlist(stocks, quotes, { query, market }).map(stock => stock.ticker);

test('watchlist filtering matches saved names, quote names and normalized symbols', () => {
  assert.deepEqual(find(' apple '), ['AAPL']);
  assert.deepEqual(find('ａａｐｌ'), ['AAPL']);
  assert.deepEqual(find('茅台'), ['600519']);
  assert.deepEqual(find('moutai'), ['600519']);
  assert.deepEqual(find('６００５１９'), ['600519']);
});

test('market and query combine without changing input order or mutating the saved list', () => {
  assert.deepEqual(find('', 'US'), ['AAPL', 'NVDA']);
  assert.deepEqual(find('', 'CN'), ['600519']);
  assert.deepEqual(find('Apple', 'CN'), []);
  assert.deepEqual(find('  '), ['AAPL', '600519', 'NVDA']);
  assert.deepEqual(find('missing'), []);
  assert.deepEqual(stocks.map(stock => stock.ticker), ['AAPL', '600519', 'NVDA']);
});

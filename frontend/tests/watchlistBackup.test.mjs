import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportWatchlist, parseWatchlistBackup, mergeWatchlist, watchlistBackupMaxBytes } from '../src/lib/watchlistBackup.ts';

const apple = { ticker: 'AAPL', name: 'Apple', market: 'US' };
const maotai = { ticker: '600519', name: '贵州茅台', market: 'CN' };
const backup = stocks => JSON.stringify({ format: 'zpboard-watchlist', version: 1, stocks });

test('backup roundtrip exports only instrument identity, omitting extra fields', () => {
  const serialized = exportWatchlist([{ ...apple, apiKey: 'private', price: 200 }, maotai]);
  assert.deepEqual(parseWatchlistBackup(serialized), { stocks: [apple, maotai], duplicates: 0 });
  assert(!serialized.includes('private') && !serialized.includes('price'));
});

test('import normalizes symbols and skips duplicate symbols without replacing the first name', () => {
  const parsed = parseWatchlistBackup(backup([{ ...apple, ticker: ' aapl ' }, { ...apple, name: 'Other' }, maotai]));
  assert.deepEqual(parsed, { stocks: [apple, maotai], duplicates: 1 });
  const current = [{ ...apple, name: 'My Apple' }];
  const merged = mergeWatchlist(current, [...parsed.stocks, maotai]);
  assert.deepEqual(merged, [current[0], maotai]);
  assert.deepEqual(current, [{ ...apple, name: 'My Apple' }]);
});

test('invalid files and any invalid row reject the whole import', () => {
  for (const invalid of ['{', 'null', '{}', '[]', JSON.stringify({ stocks: [apple] }),
    JSON.stringify({ format: 'zpboard-watchlist', version: 2, stocks: [apple] }),
    backup([]), backup([apple, null]), backup([apple, { ...maotai, market: 'US' }]),
    backup([{ ...apple, market: 'CN' }]), backup([{ ...apple, ticker: '../secret' }]),
    backup([{ ...apple, name: ' ' }]), backup([{ ...apple, name: 'x'.repeat(201) }]),
    backup(Array(2001).fill(apple)),
  ]) assert.throws(() => parseWatchlistBackup(invalid));
});

test('index identity and mixed markets survive export and a maximal backup fits the file size limit', () => {
  const index = { ticker: 'SH000001', name: '上证指数', market: 'CN' };
  assert.deepEqual(parseWatchlistBackup(exportWatchlist([index, apple])).stocks, [index, apple]);
  const stocks = Array.from({ length: 2000 }, (_, i) => ({ ticker: `STOCK${i}`, name: '😀'.repeat(100), market: 'US' }));
  const text = exportWatchlist(stocks);
  assert(Buffer.byteLength(text) < watchlistBackupMaxBytes);
  assert.equal(parseWatchlistBackup(text).stocks.length, 2000);
});

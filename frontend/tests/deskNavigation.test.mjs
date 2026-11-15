import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DeskNavigation } from '../src/terminal/deskNavigation.ts';
import { chartSelection, initialChartSelection } from '../src/terminal/chartSelection.ts';
import { normalizeNewsView } from '../src/terminal/newsView.ts';

const aapl = { ticker: 'AAPL', name: 'Apple', market: 'US' };
const boardView = { category: 'industry', sort: 'strong', memberSort: 'strong', page: 1, query: '', selection: null };
const start = { view: 'overview', market: 'US', stock: aapl, chart: initialChartSelection, boardView, marketOrigin: null, immersive: false };

test('news filters update in place and restore independently with each history entry', () => {
  const b = browser();
  const newsView = { query: '芯片', source: 'Wire', scope: 'CN' };
  b.navigation.commit({ ...start, view: 'news', newsView });
  b.navigation.commit({ ...start, view: 'news', newsView: { ...newsView, query: '银行' } });
  assert.equal(b.entries.length, 1);
  b.navigation.commit({ ...start, view: 'overview', newsView });
  newsView.source = 'Changed after commit';
  const restored = b.go(-1);
  assert.deepEqual(restored.location.newsView, { query: '银行', source: 'Wire', scope: 'CN' });
  b.navigation.commit(restored.location);
  const reloaded = new DeskNavigation(b.history, () => new URL(b.entries[0].url));
  assert.deepEqual(reloaded.restore(b.history.state).location.newsView, { query: '银行', source: 'Wire', scope: 'CN' });
});

test('legacy history entries and invalid news filters receive usable defaults', () => {
  assert.deepEqual(normalizeNewsView(undefined), { query: '', source: 'ALL', scope: 'ALL' });
  assert.deepEqual(normalizeNewsView({ query: null, source: [], scope: 'invalid' }), { query: '', source: 'ALL', scope: 'ALL' });
  assert.deepEqual(normalizeNewsView({ query: 'x'.repeat(200), source: ' ' }), { query: 'x'.repeat(100), source: 'ALL', scope: 'ALL' });
  const b = browser();
  b.navigation.commit(start);
  assert.deepEqual(b.history.state.zpboardNavigation.location.newsView, { query: '', source: 'ALL', scope: 'ALL' });
});

function browser() {
  const entries = [{ url: 'https://example.com/?entry=home#chart', state: { otherApp: 'keep' } }];
  let index = 0;
  const history = {
    get state() { return structuredClone(entries[index].state); },
    pushState(state, _, url) {
      entries.splice(++index, entries.length, { state: structuredClone(state), url: String(url) });
    },
    replaceState(state, _, url) { entries[index] = { state: structuredClone(state), url: String(url) }; },
  };
  const navigation = new DeskNavigation(history, () => new URL(entries[index].url));
  return { navigation, history, entries, go(offset) {
    assert.ok(entries[index + offset]);
    index += offset;
    return navigation.restore(history.state);
  } };
}

test('page and stock navigation support back/forward without adding entries on restore', () => {
  const b = browser();
  b.navigation.commit(start);
  b.navigation.commit(start); // StrictMode mount replay.
  b.navigation.commit({ ...start, view: 'markets' });
  b.navigation.commit({ ...start, view: 'news' });
  assert.equal(b.entries.length, 3);
  const markets = b.go(-1);
  assert.equal(markets.location.view, 'markets');
  b.navigation.commit(markets.location);
  assert.equal(b.entries.length, 3);
  assert.equal(b.go(1).location.view, 'news');
  const overview = b.go(-2);
  assert.equal(overview.location.stock.ticker, 'AAPL');
  b.navigation.commit(overview.location);
  b.navigation.commit({ ...start, stock: { ...aapl, ticker: 'NVDA' } });
  assert.equal(b.entries.length, 2); // Normal browser branching drops the abandoned forward path.
  assert.equal(b.go(-1).location.stock.ticker, 'AAPL');
});

test('chart ranges, immersive mode and market filters update the current entry', () => {
  const b = browser();
  let chart = chartSelection(initialChartSelection, { type: 'interval', interval: '15m' });
  chart = chartSelection(chart, { type: 'period', period: '5d' });
  b.navigation.commit(start);
  b.navigation.commit({ ...start, chart, immersive: true });
  b.navigation.commit({ ...start, view: 'markets', chart });
  const filters = { ...boardView, category: 'concept', memberSort: 'amount', page: 14, query: '芯片' };
  b.navigation.commit({ ...start, view: 'markets', boardView: filters, chart });
  b.navigation.commit({ ...start, view: 'news', boardView: filters, chart });
  assert.equal(b.entries.length, 3);
  assert.deepEqual(b.go(-1).location.boardView, filters);
  const restored = b.go(-1).location;
  assert.deepEqual(chartSelection(initialChartSelection, { type: 'restore', selection: restored.chart }), chart);
  assert.equal(restored.immersive, true);
});

test('scroll positions survive departure, back/forward and an immediate second traversal', () => {
  const b = browser();
  b.navigation.commit(start);
  b.navigation.recordScroll(720);
  b.navigation.commit({ ...start, view: 'news' });
  b.navigation.recordScroll(1650);
  assert.equal(b.go(-1).scroll, 720);
  b.navigation.commit(start);
  b.navigation.recordScroll(810);
  assert.equal(b.go(1).scroll, 1650); // This scroll was not flushed before popstate.
  assert.equal(b.go(-1).scroll, 810);
  b.navigation.recordScroll(-10);
  b.navigation.recordScroll(NaN);
  b.navigation.flush();
  assert.equal(b.history.state.zpboardNavigation.scroll, 0);
});

test('opening a default-board member pins the board, member page and return anchor on departure', () => {
  const b = browser();
  const board = { ticker: 'BK1036', name: '半导体', price: 2000, change_percent: 2, volume: 1234 };
  const pinned = { ...boardView, selection: { board, page: 4 } };
  const origin = { ticker: '688041', market: 'CN', anchorId: 'cn-member-688041', top: 150, scroll: 950, fromBoard: true };
  const markets = { ...start, view: 'markets', market: 'CN' };
  b.navigation.commit(markets);
  b.navigation.recordScroll(950);
  b.navigation.commit({ ...markets, view: 'overview', stock: { ticker: '688041', name: '海光信息', market: 'CN' }, boardView: pinned, marketOrigin: origin });
  assert.equal(b.navigation.canReturnToMarket(origin), true);
  const restored = b.go(-1);
  assert.deepEqual(restored.location.boardView, pinned);
  assert.deepEqual(restored.location.marketOrigin, origin);
  assert.equal(restored.scroll, 950);
  b.navigation.commit({ ...restored.location, marketOrigin: null });
  const chart = b.go(1);
  b.navigation.commit(chart.location);
  assert.equal(b.navigation.canReturnToMarket(origin), true, 'Forward then return uses the existing market entry');
  board.name = 'mutated after navigation';
  assert.equal(restored.location.boardView.selection.board.name, '半导体');
});

test('restoring a removed favorite returns its identity without reverting any watchlist data', () => {
  const b = browser();
  const cn = { ...start, market: 'CN', stock: { ticker: 'SH000001', name: '上证指数', market: 'CN', price: 3671, apiKey: 'never-store' } };
  b.navigation.commit(cn);
  b.navigation.commit(start);
  const restored = b.go(-1);
  assert.deepEqual(restored.location.stock, { ticker: 'SH000001', name: '上证指数', market: 'CN' });
  assert.equal(JSON.stringify(b.history.state).includes('never-store'), false);
  assert.equal('watchlist' in restored.location, false);
  assert.equal(b.history.state.otherApp, 'keep');
  assert.equal(new URL(b.entries[0].url).searchParams.get('entry'), 'home');
  assert.equal(new URL(b.entries[0].url).hash, '#chart');
});

test('foreign or mismatched entries are adopted in place so forward navigation remains available', () => {
  const b = browser();
  b.navigation.commit(start);
  b.navigation.commit({ ...start, view: 'news' });
  b.go(-1);
  b.history.replaceState({ oldBookmark: true }, '', 'https://example.com/?view=markets&market=CN');
  assert.equal(b.navigation.restore(b.history.state), null);
  b.navigation.commit({ ...start, view: 'markets', market: 'CN' });
  assert.equal(b.entries.length, 2);
  assert.equal(b.go(1).location.view, 'news');
  const invalid = structuredClone(b.history.state);
  invalid.zpboardNavigation.location.view = 'markets';
  assert.equal(b.navigation.restore(invalid), null);
});

test('a new app instance restores the selected board and can return through its existing history after reload', () => {
  const b = browser();
  const board = { ticker: 'BK1001', name: '半导体', price: 2000, change_percent: 2, volume: 1234 };
  const pinned = { ...boardView, page: 2, memberSort: 'amount', selection: { board, page: 3 } };
  const origin = { ticker: '600025', market: 'CN', anchorId: 'market-members-600025', top: 400, scroll: 950, fromBoard: true };
  const markets = { ...start, view: 'markets', market: 'CN', boardView: pinned };
  b.navigation.commit(markets);
  b.navigation.commit({ ...markets, view: 'overview', stock: { ticker: '600025', name: '华能水电', market: 'CN' }, marketOrigin: origin });
  b.navigation.recordScroll(200);
  b.navigation.flush();
  const reloaded = new DeskNavigation(b.history, () => new URL(b.entries.at(-1).url));
  const restored = reloaded.restore(b.history.state);
  assert.equal(restored.scroll, 200);
  assert.deepEqual(restored.location.boardView, pinned);
  assert.deepEqual(restored.location.marketOrigin, origin);
  reloaded.commit(restored.location);
  assert.equal(reloaded.canReturnToMarket(origin), true);
  assert.equal(reloaded.canReturnToMarket({ ...origin, market: 'US' }), false);
  assert.equal(b.entries.length, 2);
});

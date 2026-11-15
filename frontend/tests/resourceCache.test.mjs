import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ResourceCache } from '../src/lib/resourceCache.ts';

test('invalid market refreshes retain the last valid response for each endpoint', async () => {
  const quote = { ticker: 'SH000001', name: '上证指数', price: 3671.4, change_percent: 1.75, volume: 18000 };
  const updated_at = '2026-11-04T06:21:12Z';
  const page = { rows: [quote], total: 1, page: 1, page_size: 12, source: 'Eastmoney', updated_at };
  const hotspots = { indices: [quote], leaders: [], laggards: [], active: [], updated_at,
    breadth: { advancers: 2, flat: 1, decliners: 1, total: 4 }, summary: { mode: 'full_market', breadth_ratio: 50 } };
  const cases = [
    ['/market/cn/indices', { rows: [quote] }, [{ result: [] }, { rows: [] }, { rows: [{ ...quote, as_of: 'invalid' }] }]],
    ['/market/cn/boards?category=industry', page, [{ ...page, updated_at: 'invalid' }, { ...page, page_size: 0 }]],
    ['/market/cn/boards/BK0475/members?page=1', page, [{ ...page, rows: [{ ...quote, price: '3671.4' }] }]],
    ['/market/hotspots?market=CN', hotspots, [{ ...hotspots, leaders: null }, { ...hotspots, summary: { breadth_ratio: '50' } }]],
    ['/stocks/SH000001/quote', quote, [{ ...quote, order_book: { bids: [], asks: {} } }, { ...quote, high_price: '3671.4' }]],
  ];

  for (const [path, valid, invalidResponses] of cases) {
    let body = valid;
    const cache = new ResourceCache({ fetcher: async () => Response.json(body) });
    await cache.request(path, path);
    for (const invalid of invalidResponses) {
      body = invalid;
      await assert.rejects(cache.request(path, path), /Invalid market data/, path);
      assert.deepEqual(cache.read(path).data, valid, path);
    }
    body = valid;
    assert.deepEqual((await cache.request(path, path)).data, valid, path);
    cache.flushPersistence();
  }
});

test('an empty board search is a valid response', async () => {
  const path = '/market/cn/boards?query=missing';
  const body = { rows: [], total: 0, page: 1, page_size: 12, source: 'Eastmoney', updated_at: '2026-11-04T06:21:12Z' };
  const cache = new ResourceCache({ fetcher: async () => Response.json(body) });
  assert.deepEqual((await cache.request(path, path)).data, body);
});

test('invalid stock tags cannot replace the last usable membership response', async () => {
  const path = '/stocks/920117/tags';
  const valid = { industry: '通用设备', boards: ['固态电池'], source: 'Eastmoney' };
  let body = valid;
  const cache = new ResourceCache({ fetcher: async () => Response.json(body) });
  await cache.request(path, path);
  for (const invalid of [{ results: [] }, { ...valid, boards: [42] }, { ...valid, updated_at: 'invalid' }, { ...valid, stale: 'false' }]) {
    body = invalid;
    await assert.rejects(cache.request(path, path), /Invalid stock tags/);
    assert.deepEqual(cache.read(path).data, valid);
  }
});

const path = '/stocks/600519/history?period=1mo&interval=1d';
const history = { data: [{ timestamp: '2026-11-02T00:00:00+08:00', open: 100, high: 102, low: 99, close: 101, volume: 123 }] };
const storage = () => { const values = new Map(); return { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) }; };

test('a hundred memberships persist independently without displacing chart history', async () => {
  const session = storage();
  const market = new ResourceCache({ storage: session, fetcher: async () => Response.json(history) });
  await market.request(path, path);
  market.flushPersistence();
  const savedMarket = session.getItem('marketdesk:market-cache:v1');
  const memberships = new ResourceCache({ scope: 'memberships', storage: session, fetcher: async url => Response.json({
    industry: url.split('/')[2], boards: ['芯片', '融资融券'], source: 'Fixture', updated_at: new Date().toISOString() }) });
  for (let i = 0; i < 100; i++) await memberships.request(`/stocks/${600000 + i}/tags`, `/stocks/${600000 + i}/tags`);
  memberships.flushPersistence();
  assert.equal(session.getItem('marketdesk:market-cache:v1'), savedMarket);
  const reloaded = new ResourceCache({ scope: 'memberships', storage: session });
  for (let i = 0; i < 100; i++) assert.equal(reloaded.read(`/stocks/${600000 + i}/tags`).data.industry, String(600000 + i));
  assert.deepEqual(new ResourceCache({ storage: session }).read(path).data, history);
  assert.equal(market.read('/stocks/600000/tags'), undefined);
});

test('the membership cache is bounded and requests background data at low priority', async () => {
  const session = storage();
  let priority;
  const cache = new ResourceCache({ scope: 'memberships', storage: session, fetcher: async (_, options) => {
    priority = options.priority;
    return Response.json({ industry: 'Industry', boards: [], source: 'Fixture' });
  } });
  for (let i = 0; i < 130; i++) await cache.request(`/stocks/${600000 + i}/tags`, '/test');
  cache.flushPersistence();
  assert.equal(priority, 'low');
  assert.equal(cache.read('/stocks/600000/tags'), undefined);
  assert(cache.read('/stocks/600129/tags'));
  assert.equal(JSON.parse(session.getItem('marketdesk:membership-cache:v1')).length, 128);
  assert(session.getItem('marketdesk:membership-cache:v1').length <= 128000);
});

test('membership hydration rejects corrupt data, future entries and unrelated cached endpoints', () => {
  const session = storage(), now = Date.now();
  const valid = { industry: 'Industry', boards: [], source: 'Fixture' };
  session.setItem('marketdesk:membership-cache:v1', JSON.stringify([
    { path: '/stocks/600519/tags', savedAt: now, data: valid },
    { path: '/stocks/600520/tags', savedAt: now + 1, data: valid },
    { path: '/stocks/600521/tags', savedAt: now, data: { ...valid, boards: [123] } },
    { path: '/stocks/600522/tags', savedAt: now - 86400000, data: valid },
    { path, savedAt: now, data: history },
  ]));
  const cache = new ResourceCache({ scope: 'memberships', storage: session, now: () => now });
  assert.deepEqual(cache.read('/stocks/600519/tags').data, valid);
  for (const key of ['/stocks/600520/tags', '/stocks/600521/tags', '/stocks/600522/tags', path]) assert.equal(cache.read(key), undefined);
});

test('unquoted constituents remain available without becoming zero-price market quotes', async () => {
  const path = '/market/cn/boards/BK0596/members?page=325&sort=amount';
  const row = { ticker: '002129', name: 'Fixture', price: null, change_percent: null, volume: null, amount: null };
  const valid = { rows: [row], total: 3890, page: 325, page_size: 12, source: 'Fixture', updated_at: '2026-11-05T08:00:00Z' };
  let body = valid;
  const cache = new ResourceCache({ fetcher: async () => Response.json(body) });
  assert.deepEqual((await cache.request(path, path)).data, valid);
  for (const invalid of [{ ...row, price: '—' }, { ...row, volume: 'missing' }, { ...row, ticker: '' }]) {
    body = { ...valid, rows: [invalid] };
    await assert.rejects(cache.request(path, path), /Invalid market data/);
    assert.deepEqual(cache.read(path).data, valid);
  }
  body = valid;
  await assert.rejects(cache.request('/market/cn/boards', '/boards'), /Invalid market data/);
});

test('bad or regressing news refreshes retain usable headlines across a reload', async () => {
  const newsPath = '/news?market=ALL&limit=80';
  const story = { title: 'Headline', summary: 'Summary', source: 'Fixture', market: 'CN', published_at: '2026-11-04T05:21:00Z' };
  const feed = { items: [story], keywords: [], market: 'ALL', updated_at: '2026-11-04T05:22:00Z' };
  const session = storage();
  let payload = feed;
  const cache = new ResourceCache({ storage: session, fetcher: async () => Response.json(payload) });
  await cache.request(newsPath, '/test');
  for (const bad of [
    { ...feed, items: [{ ...story, published_at: 'unavailable' }] },
    { ...feed, updated_at: '2026-11-04T05:20:00Z' },
    { ...feed, market: 'CN' },
    { ...feed, items: [] },
  ]) {
    payload = bad;
    await assert.rejects(cache.request(newsPath, '/test'), /news/i);
    assert.deepEqual(cache.read(newsPath).data, feed);
  }
  cache.flushPersistence();
  const reloaded = new ResourceCache({ storage: session, fetcher: async () => new Response(null, { status: 503 }) });
  await assert.rejects(reloaded.request(newsPath, '/test'));
  assert.deepEqual(reloaded.read(newsPath).data, feed);
  assert.equal(reloaded.read('/news?market=US&limit=80'), undefined);
});

test('an aborted old request cannot overwrite or remove a replacement request', async () => {
  let releaseOld, releaseNew, calls = 0;
  const old = new Promise(resolve => { releaseOld = resolve; });
  const fresh = new Promise(resolve => { releaseNew = resolve; });
  const updated = { data: [{ ...history.data[0], close: 102 }] };
  const cache = new ResourceCache({ storage: storage(), fetcher: async () => {
    calls++;
    const first = calls === 1;
    await (first ? old : fresh);
    return Response.json(first ? history : updated);
  } });
  const original = cache.request(path, '/test');
  const rejected = assert.rejects(original, { name: 'AbortError' });
  cache.cancel(path);
  const replacement = cache.request(path, '/test');
  releaseOld();
  await rejected;
  const shared = cache.request(path, '/test');
  assert.equal(calls, 2);
  releaseNew();
  assert.deepEqual(await replacement, await shared);
  assert.deepEqual(cache.read(path).data, updated);
});

test('a response for a different ticker cannot enter the market cache', async () => {
  const quote = { ticker: 'AAPL', price: 100, change_percent: 1, volume: 1000 };
  const cache = new ResourceCache({ storage: storage(), fetcher: async () => Response.json(quote) });
  await assert.rejects(cache.request('/stocks/600519/quote', '/test'));
  assert.equal(cache.read('/stocks/600519/quote'), undefined);
  const wrongHistory = new ResourceCache({ storage: storage(), fetcher: async () => Response.json({ ...history, ticker: 'AAPL' }) });
  await assert.rejects(wrongHistory.request(path, '/test'));
});

test('snapshot data cannot masquerade as genuine minute candles', async () => {
  const cache = new ResourceCache({ storage: storage(), fetcher: async () => Response.json({ ...history, price_type: 'snapshot' }) });
  await assert.rejects(cache.request('/stocks/600519/history?period=1d&interval=1m&candles=true', '/test'));
});

test('inconsistent OHLC cannot replace valid cached prices', async () => {
  let invalid = false;
  const cache = new ResourceCache({ storage: storage(), fetcher: async () => Response.json(invalid ? { data: [{ ...history.data[0], high: 90 }] } : history) });
  await cache.request(path, '/test');
  invalid = true;
  await assert.rejects(cache.request(path, '/test'));
  assert.deepEqual(cache.read(path).data, history);
});

test('history cache survives a reload and stays isolated by ticker and period', async () => {
  const session = storage();
  const cache = new ResourceCache({ storage: session, now: () => 1000, fetcher: async () => Response.json(history) });
  await cache.request(path, '/test');
  cache.flushPersistence();
  const reloaded = new ResourceCache({ storage: session, now: () => 2000 });
  assert.deepEqual(reloaded.read(path).data, history);
  assert.equal(reloaded.read('/stocks/AAPL/history?period=1mo&interval=1d'), undefined);
  assert.equal(reloaded.read('/stocks/600519/history?period=5d&interval=1m'), undefined);
});

test('simultaneous reads share one request and preserve its original start time', async () => {
  let calls = 0, now = 1000, release;
  const waiting = new Promise(resolve => { release = resolve; });
  const cache = new ResourceCache({ storage: storage(), now: () => now,
    fetcher: async () => { calls++; await waiting; return Response.json(history); } });
  const first = cache.request(path, '/test');
  now = 2000;
  assert.equal(cache.pendingSince(path), 1000);
  const second = cache.request(path, '/test');
  assert.equal(calls, 1);
  now = 3000;
  release();
  const response = await first;
  assert.deepEqual(response, await second);
  assert.equal(response.requestedAt, 1000);
  assert.equal(response.savedAt, 3000);
  assert.equal(cache.pendingSince(path), undefined);
  assert.deepEqual(cache.read(path).data, history);
});

test('a failed refresh retains real history and can be retried', async () => {
  let fail = false;
  const cache = new ResourceCache({ storage: storage(), fetcher: async () => fail ? new Response('', { status: 503 }) : Response.json(history) });
  await cache.request(path, '/test');
  fail = true;
  await assert.rejects(cache.request(path, '/test'));
  assert.deepEqual(cache.read(path).data, history);
  fail = false;
  assert.deepEqual((await cache.request(path, '/test')).data, history);
});

test('a lagging or empty history refresh cannot erase the last valid chart', async () => {
  let response = history;
  const cache = new ResourceCache({ storage: storage(), fetcher: async () => Response.json(response) });
  await cache.request(path, '/test');
  for (const data of [[], [{ ...history.data[0], timestamp: '2026-10-30T00:00:00+08:00' }]]) {
    response = { data };
    await assert.rejects(cache.request(path, '/test'), /moved backwards/);
    assert.deepEqual(cache.read(path).data, history);
  }
  response = { data: [{ ...history.data[0], timestamp: '2026-11-03T00:00:00+08:00' }] };
  assert.deepEqual((await cache.request(path, '/test')).data, response);
});

test('malformed or expired session entries cannot become displayed candles', async () => {
  const session = storage();
  const cache = new ResourceCache({ storage: session, now: () => 1000, fetcher: async () => Response.json(history) });
  await cache.request(path, '/test');
  cache.flushPersistence();
  assert.equal(new ResourceCache({ storage: session, now: () => 1000 + 24 * 60 * 60 * 1000 }).read(path), undefined);
  session.setItem('marketdesk:market-cache:v1', JSON.stringify([{ path, savedAt: 1000, data: { data: [{ close: 0 }] } }]));
  assert.equal(new ResourceCache({ storage: session, now: () => 2000 }).read(path), undefined);
});

test('storage failure does not block a live response or memory cache', async () => {
  const cache = new ResourceCache({ storage: { getItem() { throw new Error(); }, setItem() { throw new Error(); } }, fetcher: async () => Response.json(history) });
  assert.equal(cache.read(path), undefined);
  await cache.request(path, '/test');
  cache.flushPersistence();
  assert.deepEqual(cache.read(path).data, history);
});

test('a burst of stock updates writes once, with no writes for board requests', async () => {
  const session = storage();
  const writes = [];
  const cache = new ResourceCache({
    storage: { getItem: session.getItem, setItem: (key, value) => { writes.push(value); session.setItem(key, value); } },
    fetcher: async url => Response.json(url === '/market/boards' ? { rows: [] } : history),
  });
  const other = path.replace('600519', '600520');
  await Promise.all([cache.request(path, '/history'), cache.request(other, '/history')]);
  assert.equal(writes.length, 0);
  await cache.request('/market/boards', '/market/boards');
  cache.flushPersistence();
  assert.equal(writes.length, 1);
  assert.deepEqual(JSON.parse(writes[0]).map(entry => entry.path).sort(), [path, other].sort());
  await cache.request('/market/boards', '/market/boards');
  cache.flushPersistence();
  assert.equal(writes.length, 1);
  await cache.request(path, '/history');
  await new Promise(resolve => setTimeout(resolve, 350));
  assert.equal(writes.length, 2);
});

test('an oversized history cannot evict a usable smaller entry from session storage', async () => {
  const session = storage();
  const cache = new ResourceCache({
    storage: session,
    fetcher: async url => Response.json(url === '/huge' ? { ...history, padding: 'x'.repeat(1_200_000) } : history),
  });
  await cache.request(path, '/small');
  await cache.request(path.replace('600519', '600520'), '/huge');
  cache.flushPersistence();
  const reloaded = new ResourceCache({ storage: session });
  assert.deepEqual(reloaded.read(path).data, history);
  assert.equal(reloaded.read(path.replace('600519', '600520')), undefined);
});

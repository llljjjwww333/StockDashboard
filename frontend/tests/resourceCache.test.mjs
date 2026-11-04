import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ResourceCache } from '../src/lib/resourceCache.ts';

const path = '/stocks/600519/history?period=1mo&interval=1d';
const history = { data: [{ timestamp: '2026-11-02T00:00:00+08:00', open: 100, high: 102, low: 99, close: 101, volume: 123 }] };
const storage = () => { const values = new Map(); return { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) }; };

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
  const reloaded = new ResourceCache({ storage: session, now: () => 2000 });
  assert.deepEqual(reloaded.read(path).data, history);
  assert.equal(reloaded.read('/stocks/AAPL/history?period=1mo&interval=1d'), undefined);
  assert.equal(reloaded.read('/stocks/600519/history?period=5d&interval=1m'), undefined);
});

test('simultaneous reads share one request and completed requests populate the cache', async () => {
  let calls = 0, release;
  const waiting = new Promise(resolve => { release = resolve; });
  const cache = new ResourceCache({ storage: storage(), fetcher: async () => { calls++; await waiting; return Response.json(history); } });
  const first = cache.request(path, '/test');
  const second = cache.request(path, '/test');
  assert.equal(calls, 1);
  release();
  assert.deepEqual(await first, await second);
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
  assert.equal(new ResourceCache({ storage: session, now: () => 1000 + 24 * 60 * 60 * 1000 }).read(path), undefined);
  session.setItem('marketdesk:market-cache:v1', JSON.stringify([{ path, savedAt: 1000, data: { data: [{ close: 0 }] } }]));
  assert.equal(new ResourceCache({ storage: session, now: () => 2000 }).read(path), undefined);
});

test('storage failure does not block a live response or memory cache', async () => {
  const cache = new ResourceCache({ storage: { getItem() { throw new Error(); }, setItem() { throw new Error(); } }, fetcher: async () => Response.json(history) });
  assert.equal(cache.read(path), undefined);
  await cache.request(path, '/test');
  assert.deepEqual(cache.read(path).data, history);
});

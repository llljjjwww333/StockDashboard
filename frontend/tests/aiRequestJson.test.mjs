import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestAiJson } from '../src/ai/requestJson.ts';

test('HTML gateway failures produce an actionable error instead of a browser JSON SyntaxError', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('<html>Bad Gateway</html>', { status: 502 }));
  await assert.rejects(requestAiJson('https://fixture.invalid', {}, new AbortController().signal), /网关.*HTTP 502/);
});

test('JSON API errors retain their useful server message and malformed success bodies are rejected', async t => {
  const mocked = t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ detail: '模型返回了不兼容的指标比较' }), { status: 502 }));
  await assert.rejects(requestAiJson('https://fixture.invalid', {}, new AbortController().signal), /不兼容的指标比较/);
  mocked.mock.mockImplementation(async () => new Response('<html>Unexpected page</html>'));
  await assert.rejects(requestAiJson('https://fixture.invalid', {}, new AbortController().signal), /本次生成未完成/);
});

test('timeouts remain reportable without aborting the caller controller', async t => {
  t.mock.method(globalThis, 'fetch', (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })));
  const controller = new AbortController();
  await assert.rejects(requestAiJson('https://fixture.invalid', {}, controller.signal, 5), /请求超时/);
  assert.equal(controller.signal.aborted, false);
});

test('Safari syntax errors are normalized and a valid JSON success is returned intact', async t => {
  const mocked = t.mock.method(globalThis, 'fetch', async () => { throw new SyntaxError('The string did not match the expected pattern.'); });
  await assert.rejects(requestAiJson('https://fixture.invalid', {}, new AbortController().signal), /本次生成未完成/);
  mocked.mock.mockImplementation(async () => new Response(JSON.stringify({ proposal: { name: 'valid' } })));
  assert.deepEqual(await requestAiJson('https://fixture.invalid', {}, new AbortController().signal), { proposal: { name: 'valid' } });
});

test('lost job submission response retries the same request ID and never changes credentials', async t => {
  const submissions = [];
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const body = JSON.parse(options.body); submissions.push(body);
    if (submissions.length === 1) throw new TypeError('network reset');
    return Response.json({ id: body.id, state: 'completed', result: { ok: true } });
  });
  const result = await requestAiJson('https://fixture.invalid/api/v1/ai/providers/test', { settings: { api_key: 'fixture-only' } }, new AbortController().signal);
  assert.deepEqual(result, { ok: true });
  assert.equal(submissions.length, 2);
  assert.deepEqual(submissions[0], submissions[1]);
});

test('polling resumes after a temporary gateway outage without reposting the model request', async t => {
  let id, posts = 0, polls = 0;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    if (options.method === 'POST') { id = JSON.parse(options.body).id; posts++; return Response.json({ id, state: 'running' }); }
    polls++;
    if (polls === 1) return new Response('<html>gateway</html>', { status: 503 });
    return Response.json({ id, state: 'completed', result: { summary: 'fixture' } });
  });
  assert.deepEqual(await requestAiJson('https://fixture.invalid/api/v1/ai/analyze', {}, new AbortController().signal), { summary: 'fixture' });
  assert.equal(posts, 1); assert.equal(polls, 2);
});

test('provider authentication errors are shown once without automatic generation retries', async t => {
  const calls = t.mock.method(globalThis, 'fetch', async (_url, options) => Response.json({ id: JSON.parse(options.body).id,
    state: 'failed', detail: 'API Key 无效' }));
  await assert.rejects(requestAiJson('https://fixture.invalid/api/v1/ai/providers/test', {}, new AbortController().signal), /API Key 无效/);
  assert.equal(calls.mock.callCount(), 1);
});

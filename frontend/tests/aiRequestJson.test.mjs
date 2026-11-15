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

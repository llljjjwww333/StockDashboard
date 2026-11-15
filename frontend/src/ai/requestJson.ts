export function aiRequestError(error: unknown, fallback = 'AI 请求失败') {
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : '';
  if (name === 'TimeoutError') return 'AI 请求超时，请重试';
  if (name === 'SyntaxError' || /string did not match the expected pattern|unexpected token|JSON/i.test(message)) return 'AI 服务未返回有效数据，本次生成未完成';
  if (name === 'TypeError') return 'AI 服务连接失败，请检查网络后重试';
  return message || fallback;
}

export async function requestAiJson(url: string, body: object, signal: AbortSignal, timeoutMs = 95000): Promise<unknown> {
  // Avoid requiring AbortSignal.any/timeout on older mobile browsers.
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) controller.abort();
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal, body: JSON.stringify(body) });
    const text = await response.text();
    let result: unknown;
    try { result = JSON.parse(text); }
    catch { throw new Error(response.ok ? 'AI 服务未返回有效数据，本次生成未完成' : `AI 网关返回异常响应（HTTP ${response.status}），请重试`); }
    if (!response.ok) {
      const detail = result && typeof result === 'object' && 'detail' in result ? result.detail : null;
      throw new Error(typeof detail === 'string' ? detail : `AI 请求失败（HTTP ${response.status}）`);
    }
    return result;
  } catch (error) {
    if (timedOut) throw new Error('AI 请求超时，请重试');
    throw new Error(aiRequestError(error));
  } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
}

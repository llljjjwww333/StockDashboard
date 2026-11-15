export function aiRequestError(error: unknown, fallback = 'AI 请求失败') {
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : '';
  if (name === 'TimeoutError') return 'AI 请求超时，请重试';
  if (name === 'SyntaxError' || /string did not match the expected pattern|unexpected token|JSON/i.test(message)) return 'AI 服务未返回有效数据，本次生成未完成';
  if (name === 'TypeError') return 'AI 服务连接失败，请检查网络后重试';
  return message || fallback;
}

class HttpError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

async function fetchJson(url: string, options: RequestInit, signal: AbortSignal, budget = 18000): Promise<unknown> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) controller.abort();
  const timer = setTimeout(abort, budget);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal, cache: 'no-store' });
    const text = await response.text();
    let result: unknown;
    try { result = JSON.parse(text); }
    catch { throw new HttpError(response.ok ? 'AI 服务未返回有效数据，本次生成未完成' : `AI 网关返回异常响应（HTTP ${response.status}），请重试`, response.ok ? 422 : response.status); }
    if (!response.ok) {
      const detail = result && typeof result === 'object' && 'detail' in result ? result.detail : null;
      throw new HttpError(typeof detail === 'string' ? detail : `AI 请求失败（HTTP ${response.status}）`, response.status);
    }
    return result;
  } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
}

function pause(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { signal.removeEventListener('abort', abort); abort(); }
  });
}

export async function requestAiJson(url: string, body: object, signal: AbortSignal, timeoutMs = 270000,
  onProgress?: (message: string) => void): Promise<unknown> {
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) controller.abort();
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  const match = url.match(/^(.*\/ai)\/(analyze|providers\/test|strategies\/generate|portfolios\/review|portfolios\/design)\/?$/);
  let jobUrl: string | null = null;
  try {
    if (!match) return await fetchJson(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, controller.signal, timeoutMs);
    const id = crypto.randomUUID(), endpoint = `${match[1]}/jobs`;
    jobUrl = `${endpoint}/${id}`;
    const submission = JSON.stringify({ id, operation: match[2], payload: body });
    let accepted = false, failures = 0;
    onProgress?.('正在连接服务…');
    while (!controller.signal.aborted) {
      let value: unknown;
      try {
        value = await fetchJson(accepted ? jobUrl : endpoint, accepted ? {} : {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: submission,
        }, controller.signal);
        failures = 0;
      } catch (error) {
        if (controller.signal.aborted) throw error;
        if (error instanceof HttpError && ![408, 425, 429, 500, 502, 503, 504].includes(error.status)) throw error;
        onProgress?.('正在恢复连接…');
        failures++;
        await pause(Math.min(500 * 2 ** Math.min(failures, 3), 4000), controller.signal);
        continue;
      }
      const job = value as { id?: string; state?: string; result?: unknown; detail?: string };
      if (!job || job.id !== id || !['queued', 'running', 'completed', 'failed'].includes(job.state ?? '')) throw new Error('AI 服务未返回有效任务');
      accepted = true;
      if (job.state === 'completed') return job.result;
      if (job.state === 'failed') throw new Error(job.detail || 'AI 请求失败');
      onProgress?.(job.state === 'queued' ? '等待模型处理…' : '模型处理中…');
      await pause(900, controller.signal);
    }
    throw new DOMException('Aborted', 'AbortError');
  } catch (error) {
    if (timedOut) throw new Error('AI 请求超时，请重试');
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    throw new Error(aiRequestError(error));
  } finally {
    clearTimeout(timer); signal.removeEventListener('abort', abort);
    if (controller.signal.aborted && jobUrl) {
      // Best effort cancellation; it must never keep the UI waiting.
      void fetch(jobUrl, { method: 'DELETE', signal: AbortSignal.timeout(5000) }).catch(() => {});
    }
  }
}

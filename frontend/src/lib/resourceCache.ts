type Stored = { data: unknown; savedAt: number };
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
const KEY = 'marketdesk:market-cache:v1';
const MAX_AGE = 24 * 60 * 60 * 1000;

function persistable(path: string, data: unknown): boolean {
  if (!path.startsWith('/stocks/') || !data || typeof data !== 'object') return false;
  const item = data as Record<string, unknown>;
  const ticker = path.split('/')[2];
  if (item.ticker !== undefined && item.ticker !== ticker) return false;
  if (path.endsWith('/quote')) return item.ticker === ticker && typeof item.price === 'number' && item.price > 0 &&
    Number.isFinite(item.price) && Number.isFinite(item.change_percent) && typeof item.volume === 'number' && Number.isFinite(item.volume) && item.volume >= 0;
  if (!path.includes('/history?') || !Array.isArray(item.data)) return false;
  if (new URLSearchParams(path.split('?')[1]).get('candles') === 'true' && item.price_type !== 'ohlc') return false;
  return item.data.every(p => p && typeof p.timestamp === 'string' && Number.isFinite(Date.parse(p.timestamp)) &&
    ['open', 'high', 'low', 'close'].every(k => typeof p[k] === 'number' && Number.isFinite(p[k]) && p[k] > 0) &&
    p.high >= Math.max(p.open, p.close) && p.low <= Math.min(p.open, p.close) && Number.isFinite(p.volume) && p.volume >= 0);
}

export class ResourceCache {
  private entries = new Map<string, Stored>();
  private pending = new Map<string, { request: Promise<Stored>; controller: AbortController }>();
  private hydrated = false;
  private storage: StorageLike | undefined;
  private fetcher: typeof fetch;
  private now: () => number;
  constructor(options: { storage?: StorageLike; fetcher?: typeof fetch; now?: () => number } = {}) {
    this.storage = options.storage;
    this.fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
    this.now = options.now ?? Date.now;
  }
  private getStorage() { return this.storage ?? (typeof sessionStorage === 'undefined' ? undefined : sessionStorage); }
  read<T>(path: string): { data: T; savedAt: number } | undefined {
    if (!this.hydrated) {
      this.hydrated = true;
      try {
        const saved = JSON.parse(this.getStorage()?.getItem(KEY) ?? '[]');
        if (Array.isArray(saved)) for (const entry of saved.slice(-12)) {
          if (entry && typeof entry.path === 'string' && typeof entry.savedAt === 'number' &&
            this.now() - entry.savedAt >= 0 && this.now() - entry.savedAt < MAX_AGE && persistable(entry.path, entry.data)) {
            this.entries.set(entry.path, { data: entry.data, savedAt: entry.savedAt });
          }
        }
      } catch { /* An unavailable or corrupt cache never prevents live requests. */ }
    }
    const entry = this.entries.get(path);
    if (!entry || this.now() - entry.savedAt >= MAX_AGE || this.now() < entry.savedAt) return undefined;
    return entry as { data: T; savedAt: number };
  }
  request<T>(path: string, url: string): Promise<{ data: T; savedAt: number }> {
    const previous = this.read<{ data?: Array<{ timestamp: string }> }>(path);
    const existing = this.pending.get(path);
    if (existing && !existing.controller.signal.aborted) return existing.request as Promise<{ data: T; savedAt: number }>;
    const controller = new AbortController();
    const request = this.fetcher(url, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) }).then(async response => {
      if (!response.ok) throw new Error('Resource unavailable');
      const data: unknown = await response.json();
      controller.signal.throwIfAborted();
      if ((path.includes('/history?') || path.endsWith('/quote')) && !persistable(path, data)) throw new Error('Invalid market data');
      if (path.includes('/history?')) {
        const previousTail = previous?.data.data?.at(-1);
        const nextTail = (data as { data: Array<{ timestamp: string }> }).data.at(-1);
        if (previousTail && (!nextTail || Date.parse(nextTail.timestamp) < Date.parse(previousTail.timestamp))) {
          throw new Error('Market history moved backwards');
        }
      }
      const entry = { data, savedAt: this.now() };
      this.entries.delete(path);
      this.entries.set(path, entry);
      if (this.entries.size > 64) this.entries.delete(this.entries.keys().next().value!);
      try {
        const saved = [...this.entries].filter(([key, value]) => persistable(key, value.data))
          .slice(-12).map(([key, value]) => ({ path: key, ...value }));
        let text = JSON.stringify(saved);
        while (text.length > 1_200_000 && saved.length > 1) { saved.shift(); text = JSON.stringify(saved); }
        this.getStorage()?.setItem(KEY, text);
      } catch { /* Memory cache still works when session storage is full. */ }
      return entry;
    }).finally(() => { if (this.pending.get(path)?.request === request) this.pending.delete(path); });
    this.pending.set(path, { request, controller });
    return request as Promise<{ data: T; savedAt: number }>;
  }
  cancel(path: string) { this.pending.get(path)?.controller.abort(); }
}

export const resourceCache = new ResourceCache();

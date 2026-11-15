import { isStockMemberships } from './instrumentIdentity.ts';
import { isMarketPayload, isMarketQuote, isNewsResponse } from './marketPayload.ts';
import type { HistoryResponse, NewsResponse } from '../terminal/types';

type ResourceEntry<T> = { data: T; savedAt: number; requestedAt?: number };
type Stored = ResourceEntry<unknown> & { persistent: boolean };
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
const KEY = 'marketdesk:market-cache:v1';
const MEMBERSHIP_KEY = 'marketdesk:membership-cache:v1';
const MAX_AGE = 24 * 60 * 60 * 1000;
const WRITE_DELAY_MS = 300;
const MAX_SESSION_CHARS = 1_200_000;
const isNewsPath = (path: string) => path === '/news' || path.startsWith('/news?');
const isMembershipPath = (path: string) => /^\/stocks\/\d{6}\/tags$/.test(path);

function matchesNewsPath(path: string, data: unknown): data is NewsResponse {
  const requested = new URLSearchParams(path.split('?')[1]).get('market')?.toUpperCase();
  const market = requested === 'CN' || requested === 'US' || requested === 'CRYPTO' ? requested : 'ALL';
  return isNewsResponse(data) && data.market === market;
}

function persistable(path: string, data: unknown): boolean {
  if (isNewsPath(path)) return matchesNewsPath(path, data);
  if (!path.startsWith('/stocks/') || !data || typeof data !== 'object') return false;
  const item = data as Record<string, unknown>;
  const ticker = path.split('/')[2];
  if (item.ticker !== undefined && item.ticker !== ticker) return false;
  if (isMembershipPath(path)) return isStockMemberships(data);
  if (path.endsWith('/quote')) return item.ticker === ticker && isMarketQuote(data);
  if (!path.includes('/history?') || !Array.isArray(item.data)) return false;
  if (new URLSearchParams(path.split('?')[1]).get('candles') === 'true' && item.price_type !== 'ohlc') return false;
  return item.data.every(p => p && typeof p.timestamp === 'string' && Number.isFinite(Date.parse(p.timestamp)) &&
    ['open', 'high', 'low', 'close'].every(k => typeof p[k] === 'number' && Number.isFinite(p[k]) && p[k] > 0) &&
    p.high >= Math.max(p.open, p.close) && p.low <= Math.min(p.open, p.close) && Number.isFinite(p.volume) && p.volume >= 0);
}

export class ResourceCache {
  private entries = new Map<string, Stored>();
  private pending = new Map<string, { request: Promise<Stored>; controller: AbortController; requestedAt: number }>();
  private hydrated = false;
  private writeTimer: ReturnType<typeof setTimeout> | null = null;
  private storage: StorageLike | undefined;
  private fetcher: typeof fetch;
  private now: () => number;
  private scope: 'market' | 'memberships';
  constructor(options: { storage?: StorageLike; fetcher?: typeof fetch; now?: () => number; scope?: 'market' | 'memberships' } = {}) {
    this.storage = options.storage;
    this.fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
    this.now = options.now ?? Date.now;
    this.scope = options.scope ?? 'market';
  }
  private get persistenceKey() { return this.scope === 'memberships' ? MEMBERSHIP_KEY : KEY; }
  private persistentPath(path: string) {
    return this.scope === 'memberships' ? isMembershipPath(path) : isNewsPath(path) || path.includes('/history?') || path.endsWith('/quote');
  }
  private getStorage() { return this.storage ?? (typeof sessionStorage === 'undefined' ? undefined : sessionStorage); }
  pendingSince(path: string) {
    const pending = this.pending.get(path);
    return pending && !pending.controller.signal.aborted ? pending.requestedAt : undefined;
  }
  read<T>(path: string): ResourceEntry<T> | undefined {
    if (!this.hydrated) {
      this.hydrated = true;
      try {
        const saved = JSON.parse(this.getStorage()?.getItem(this.persistenceKey) ?? '[]');
        if (Array.isArray(saved)) for (const entry of saved.slice(this.scope === 'memberships' ? -128 : -12)) {
          if (entry && typeof entry.path === 'string' && typeof entry.savedAt === 'number' &&
            this.now() - entry.savedAt >= 0 && this.now() - entry.savedAt < MAX_AGE && this.persistentPath(entry.path) && persistable(entry.path, entry.data)) {
            this.entries.set(entry.path, { data: entry.data, savedAt: entry.savedAt, persistent: true });
          }
        }
      } catch { /* An unavailable or corrupt cache never prevents live requests. */ }
    }
    const entry = this.entries.get(path);
    if (!entry || this.now() - entry.savedAt >= MAX_AGE || this.now() < entry.savedAt) return undefined;
    return entry as ResourceEntry<T>;
  }
  request<T>(path: string, url: string): Promise<ResourceEntry<T>> {
    const previous = this.read(path);
    const existing = this.pending.get(path);
    if (existing && !existing.controller.signal.aborted) return existing.request as Promise<ResourceEntry<T>>;
    const controller = new AbortController();
    const requestedAt = this.now();
    const request = this.fetcher(url, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
      ...(this.scope === 'memberships' ? { priority: 'low' as const } : {}) }).then(async response => {
      if (!response.ok) throw new Error('Resource unavailable');
      const data: unknown = await response.json();
      controller.signal.throwIfAborted();
      const news = isNewsPath(path);
      const persistent = this.persistentPath(path);
      if (path.startsWith('/stocks/') && path.endsWith('/tags') && !isStockMemberships(data)) throw new Error('Invalid stock tags');
      if (news) {
        if (!matchesNewsPath(path, data)) throw new Error('Invalid news feed');
        if (isNewsResponse(previous?.data) &&
          (Date.parse(data.updated_at) < Date.parse(previous.data.updated_at) ||
            (data.market === 'ALL' && previous.data.items.length > 0 && !data.items.length))) {
          throw new Error('News refresh would replace newer headlines');
        }
      } else if ((persistent && !persistable(path, data)) || (path.startsWith('/market/') && !isMarketPayload(path, data))) {
        throw new Error('Invalid market data');
      }
      if (path.includes('/history?')) {
        const previousTail = (previous?.data as HistoryResponse | undefined)?.data.at(-1);
        const nextTail = (data as { data: Array<{ timestamp: string }> }).data.at(-1);
        if (previousTail && (!nextTail || Date.parse(nextTail.timestamp) < Date.parse(previousTail.timestamp))) {
          throw new Error('Market history moved backwards');
        }
      }
      const entry = { data, savedAt: this.now(), requestedAt, persistent };
      this.entries.delete(path);
      this.entries.set(path, entry);
      if (this.entries.size > (this.scope === 'memberships' ? 128 : 64)) this.entries.delete(this.entries.keys().next().value!);
      if (persistent && this.writeTimer === null) {
        this.writeTimer = setTimeout(() => this.flushPersistence(), WRITE_DELAY_MS);
      }
      return entry;
    }).finally(() => { if (this.pending.get(path)?.request === request) this.pending.delete(path); });
    this.pending.set(path, { request, controller, requestedAt });
    return request as Promise<ResourceEntry<T>>;
  }

  flushPersistence() {
    if (this.writeTimer === null) return;
    clearTimeout(this.writeTimer);
    this.writeTimer = null;
    try {
      const storage = this.getStorage();
      if (!storage) return;
      const now = this.now();
      const saved = [...this.entries]
        .filter(([, entry]) => entry.persistent && now >= entry.savedAt && now - entry.savedAt < MAX_AGE)
        .slice(this.scope === 'memberships' ? -128 : -12).reverse();
      const records: string[] = [];
      let length = 2;
      for (const [path, { data, savedAt }] of saved) {
        const record = JSON.stringify({ path, data, savedAt });
        const extra = record.length + (records.length ? 1 : 0);
        if (length + extra > (this.scope === 'memberships' ? 128_000 : MAX_SESSION_CHARS)) continue;
        records.push(record);
        length += extra;
      }
      storage.setItem(this.persistenceKey, `[${records.reverse().join(',')}]`);
    } catch { /* Memory cache still works when session storage is full. */ }
  }

  cancel(path: string) { this.pending.get(path)?.controller.abort(); }
}

export const resourceCache = new ResourceCache();
export const stockMembershipCache = new ResourceCache({ scope: 'memberships' });

if (typeof window !== 'undefined') {
  const flush = () => { resourceCache.flushPersistence(); stockMembershipCache.flushPersistence(); };
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) flush();
  });
}

export const isCryptoTicker = (ticker: string) => /^[A-Z0-9]{2,16}USDT$/.test(ticker);
export const instrumentMarket = (ticker: string) => isCryptoTicker(ticker) ? 'CRYPTO' as const : isChinaTicker(ticker) ? 'CN' as const : 'US' as const;
export const isChinaIndex = (ticker: string) => /^(SH|SZ|BJ)\d{6}$/i.test(ticker);
export const isChinaTicker = (ticker: string) => /^\d{6}$/.test(ticker) || isChinaIndex(ticker);
export const isChinaEquity = (ticker: string) => /^(?:(?:60|00|30|68)\d{4}|920\d{3})$/.test(ticker);
export const isInstrumentTicker = (ticker: unknown): ticker is string =>
  typeof ticker === 'string' && /^[A-Z0-9^][A-Z0-9.^-]{0,19}$/.test(ticker);

export type StockMemberships = { industry: string | null; boards: string[]; source: string; stale?: boolean; updated_at?: string };

export function isStockMemberships(value: unknown): value is StockMemberships {
  if (!value || typeof value !== 'object') return false;
  const { industry, boards, source, stale, updated_at } = value as Record<string, unknown>;
  return (industry === null || typeof industry === 'string') && typeof source === 'string'
    && Array.isArray(boards) && boards.every(board => typeof board === 'string')
    && (stale === undefined || typeof stale === 'boolean')
    && (updated_at === undefined || typeof updated_at === 'string' && Number.isFinite(Date.parse(updated_at)));
}

const identityLabels = new Set(['北交所', '创业板', '科创板', '主板', 'ST', '*ST', 'ST股', 'ETF', '基金', '指数']);

export function chinaInstrumentTags(ticker: string, name: string, memberships?: StockMemberships | null) {
  if (isChinaIndex(ticker)) return [{ label: '指数', tone: 'index' }];
  if (!/^\d{6}$/.test(ticker)) return [];
  const normalized = name.normalize('NFKC').trim().toUpperCase();
  const risk = /^S?\*\s*ST/.test(normalized) ? '*ST' : /^S?ST/.test(normalized) ? 'ST' : null;
  const board = /^(688|689)/.test(ticker) ? '科创板'
    : /^(300|301)/.test(ticker) ? '创业板'
    : /^920/.test(ticker) ? '北交所'
    : /^(15|51|52|56|58)/.test(ticker) ? 'ETF'
    : /^(16|50)/.test(ticker) ? '基金'
    : /^(60|00)/.test(ticker) ? '主板' : null;
  const tags = [
    ...(risk ? [{ label: risk, tone: 'risk' }] : []),
    ...(board ? [{ label: board, tone: board === '主板' ? 'main' : 'board' }] : []),
  ];
  const industry = memberships?.industry?.trim();
  if (industry && !identityLabels.has(industry)) tags.push({ label: industry, tone: 'industry' });
  for (const label of new Set(memberships?.boards.map(board => board.trim()))) {
    if (label && label !== industry && !identityLabels.has(label)) tags.push({ label, tone: 'membership' });
  }
  return tags;
}

export type NewsScope = 'ALL' | 'US' | 'CN' | 'CRYPTO';
export type NewsView = { query: string; source: string; scope?: NewsScope; coin?: string; topic?: string; language?: 'ALL'|'zh'|'en'; window?: 'ALL'|'24h'|'7d'; savedOnly?: boolean; unreadOnly?: boolean };
export function normalizeNewsView(value: unknown): NewsView {
  const view = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    query: typeof view.query === 'string' ? view.query.slice(0, 100) : '',
    source: typeof view.source === 'string' && view.source.trim() && view.source.length <= 200 ? view.source : 'ALL',
    scope: view.scope === 'CRYPTO' || view.scope === 'US' || view.scope === 'CN' ? view.scope : 'ALL',
    ...(typeof view.coin==='string'&&/^(?:ALL|[A-Z0-9]{2,16}USDT)$/.test(view.coin)?{coin:view.coin}:{}),
    ...(typeof view.topic==='string'&&view.topic.length<=40?{topic:view.topic}:{}),
    ...(['ALL','zh','en'].includes(String(view.language))?{language:view.language as 'ALL'|'zh'|'en'}:{}),
    ...(['ALL','24h','7d'].includes(String(view.window))?{window:view.window as 'ALL'|'24h'|'7d'}:{}),
    ...(typeof view.savedOnly==='boolean'?{savedOnly:view.savedOnly}:{}),
    ...(typeof view.unreadOnly==='boolean'?{unreadOnly:view.unreadOnly}:{}),
  };
}

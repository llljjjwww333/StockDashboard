const rawApiBaseUrl = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000';

const normalizeBaseUrl = (url: string) => url.replace(/\/+$/, '');

const ensureApiPrefix = (url: string) => {
  const normalized = normalizeBaseUrl(url);
  return normalized.endsWith('/api/v1') ? normalized : `${normalized}/api/v1`;
};

const apiBaseUrl = ensureApiPrefix(rawApiBaseUrl);

export const buildApiUrl = (path: string) => `${apiBaseUrl}${path.startsWith('/') ? path : `/${path}`}`;

export const getCurrencySymbol = (ticker: string) =>
  ticker.length === 6 && !Number.isNaN(Number(ticker)) ? '¥' : '$';

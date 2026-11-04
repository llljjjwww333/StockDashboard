const getDefaultApiBaseUrl = () => {
  if (typeof window === 'undefined') {
    return '';
  }

  return window.location.origin;
};

const rawApiBaseUrl = import.meta.env.VITE_API_URL || getDefaultApiBaseUrl();

const normalizeBaseUrl = (url: string) => url.replace(/\/+$/, '');

const ensureApiPrefix = (url: string) => {
  const normalized = normalizeBaseUrl(url);
  return normalized.endsWith('/api/v1') ? normalized : `${normalized}/api/v1`;
};

const apiBaseUrl = ensureApiPrefix(rawApiBaseUrl);

export const buildApiUrl = (path: string) =>
  `${apiBaseUrl}${path.startsWith('/') ? path : `/${path}`}`;

export const getWebSocketUrl = () => {
  const base = import.meta.env.VITE_WS_URL || rawApiBaseUrl;
  const url = new URL(base || 'http://127.0.0.1');
  url.protocol = url.protocol === 'https:' || url.protocol === 'wss:' ? 'wss:' : 'ws:';
  url.pathname = `${url.pathname.replace(/\/(?:api\/v1|ws\/stock-updates)\/?$/, '').replace(/\/+$/, '')}/ws/stock-updates`;
  return url.toString();
};

export const getCurrencySymbol = (ticker: string) =>
  ticker.length === 6 && !Number.isNaN(Number(ticker)) ? '\u00A5' : '$';

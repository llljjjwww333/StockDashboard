import type { HistoryResponse } from '../terminal/types';

function cell(value: string | number | boolean | null | undefined) {
  if (value === null || value === undefined || typeof value === 'number' && !Number.isFinite(value)) return '';
  let text = String(value);
  if (typeof value === 'string' && /^\s*[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function chartCsv(ticker: string, period: string, interval: string, history: HistoryResponse) {
  const header = ['ticker', 'period', 'interval', 'timestamp', 'open', 'high', 'low', 'close', 'volume_shares', 'average_price', 'price_type', 'adjustment', 'source', 'cached'];
  const rows = history.data.map(point => [ticker, period, history.interval ?? interval, point.timestamp,
    point.open, point.high, point.low, point.close, point.volume, point.average_price,
    history.price_type, history.adjustment, history.source, history.stale ?? false].map(cell).join(','));
  return '\uFEFF' + [header.join(','), ...rows].join('\r\n') + '\r\n';
}

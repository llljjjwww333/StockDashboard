import { instrumentMarket, isInstrumentTicker } from './instrumentIdentity.ts';

export type BackupStock = { ticker: string; name: string; market: 'US' | 'CN' | 'CRYPTO' };
export const watchlistBackupMaxBytes = 2 * 1024 * 1024;
const maxStocks = 2000;

export function exportWatchlist(stocks: readonly BackupStock[]) {
  return JSON.stringify({
    format: 'zpboard-watchlist', version: 1,
    stocks: stocks.map(({ ticker, name, market }) => ({ ticker, name, market })),
  }, null, 2);
}

export function parseWatchlistBackup(text: string): { stocks: BackupStock[]; duplicates: number } {
  let payload: unknown;
  try { payload = JSON.parse(text); } catch { throw new Error('文件不是有效的自选备份'); }
  if (!payload || typeof payload !== 'object') throw new Error('文件不是有效的自选备份');
  const { format, version, stocks } = payload as Record<string, unknown>;
  if (format !== 'zpboard-watchlist' || version !== 1 || !Array.isArray(stocks)) throw new Error('文件不是有效的自选备份');
  if (!stocks.length) throw new Error('备份中没有自选股');
  if (stocks.length > maxStocks) throw new Error('备份中的股票数量过多');
  const unique = new Map<string, BackupStock>();
  for (const stock of stocks) {
    if (!stock || typeof stock !== 'object') throw new Error('备份包含无效的股票信息');
    const { ticker, name, market } = stock as Record<string, unknown>;
    if (typeof ticker !== 'string' || typeof name !== 'string' || !name.trim() || name.length > 200
      || (market !== 'US' && market !== 'CN' && market !== 'CRYPTO')) throw new Error('备份包含无效的股票信息');
    const normalized = ticker.trim().toUpperCase();
    if (!isInstrumentTicker(normalized) || instrumentMarket(normalized) !== market) throw new Error('备份包含无效的股票信息');
    if (!unique.has(normalized)) unique.set(normalized, { ticker: normalized, name: name.trim(), market });
  }
  return { stocks: [...unique.values()], duplicates: stocks.length - unique.size };
}

export function mergeWatchlist(current: readonly BackupStock[], incoming: readonly BackupStock[]) {
  const tickers = new Set(current.map(stock => stock.ticker));
  const result = [...current];
  for (const stock of incoming) {
    if (tickers.has(stock.ticker)) continue;
    tickers.add(stock.ticker);
    result.push({ ticker: stock.ticker, name: stock.name, market: stock.market });
  }
  return result;
}

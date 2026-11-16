import { isCryptoTicker } from './instrumentIdentity.ts';
import { pricePrecision } from './pricePrecision.ts';

const formats = new Map<string, Intl.NumberFormat>();
function numberFormat(locale: string, minimumFractionDigits: number, maximumFractionDigits: number) {
  const key = `${locale}:${minimumFractionDigits}:${maximumFractionDigits}`;
  if (!formats.has(key)) formats.set(key, new Intl.NumberFormat(locale, { minimumFractionDigits, maximumFractionDigits }));
  return formats.get(key)!;
}

export function formatTradingQuantity(value: number, locale: string) {
  return numberFormat(locale, 0, 8).format(value);
}

export function formatTradingPrice(ticker: string, value: number, locale: string) {
  const digits = Math.min(12, Math.max(pricePrecision(ticker, value), value > 0 && value < 1 ? -Math.floor(Math.log10(value)) + 2 : 0));
  return numberFormat(locale, digits, digits).format(value);
}

export function formatTradingFee(ticker: string, value: number, locale: string) {
  const digits = isCryptoTicker(ticker) ? 8 : 2;
  if (digits === 8 && value > 0 && value < 1e-8) return '<0.00000001';
  return numberFormat(locale, 0, digits).format(value);
}

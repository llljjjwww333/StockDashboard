import type { MarketType } from '../store/stockStore';

const formats = new Map<string, Intl.NumberFormat>();
export function volumeUnit(market: MarketType, locale: string) {
  if(market === 'CRYPTO') return locale.startsWith('zh') ? '币' : 'coins';
  return locale.startsWith('zh') ? market === 'CN' ? '手' : '股' : market === 'CN' ? 'lots' : 'shares';
}

export function formatVolume(value: number, market: MarketType, locale: string, withUnit = true) {
  if (!Number.isFinite(value)) return '--';
  let format = formats.get(locale);
  if (!format) { format = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 2 }); formats.set(locale, format); }
  const text = format.format(value / (market === 'CN' ? 100 : 1));
  return withUnit ? `${text}${locale.startsWith('zh') ? '' : ' '}${volumeUnit(market, locale)}` : text;
}

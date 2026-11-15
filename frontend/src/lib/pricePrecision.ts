import { isCryptoTicker, isChinaTicker } from './instrumentIdentity.ts';

export function pricePrecision(ticker: string, price: number) {
  if(isCryptoTicker(ticker)) return price > 0 && price < .001 ? 8 : price < 1 ? 6 : price < 100 ? 4 : 2;
  return /^\d{6}$/.test(ticker) && /^(15|16|50|51|52|56|58)/.test(ticker) ? 3
    : !isChinaTicker(ticker) && price > 0 && price < 1 ? 4 : 2;
}

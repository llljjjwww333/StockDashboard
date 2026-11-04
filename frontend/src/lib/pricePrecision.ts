import { isChinaTicker } from './instrumentIdentity.ts';

export function pricePrecision(ticker: string, price: number) {
  return /^\d{6}$/.test(ticker) && /^(15|16|50|51|52|56|58)/.test(ticker) ? 3
    : !isChinaTicker(ticker) && price > 0 && price < 1 ? 4 : 2;
}

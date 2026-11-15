import type { HistoryPoint } from './types';
export type Series = Array<number | null>;

export function sma(values: number[], period: number): Series {
  let sum = 0;
  return values.map((v, i) => { sum += v; if (i >= period) sum -= values[i - period]; return i >= period - 1 ? sum / period : null; });
}
export function bollingerSeries(closes: number[], period: number, multiplier: number) {
  const middle = sma(closes, period), upper: Series = [], lower: Series = [];
  middle.forEach((mean, i) => {
    if (mean === null) { upper.push(null); lower.push(null); return; }
    const deviation = Math.sqrt(closes.slice(i - period + 1, i + 1).reduce((s, v) => s + (v - mean) ** 2, 0) / period);
    upper.push(mean + multiplier * deviation); lower.push(mean - multiplier * deviation);
  });
  return { middle, upper, lower };
}
export function ema(values: Series, period: number): Series {
  let seed: number[] = [], previous: number | null = null;
  return values.map(v => {
    if (v === null) return null;
    if (previous === null) { seed.push(v); if (seed.length < period) return null; previous = seed.reduce((s, n) => s + n, 0) / period; seed = []; }
    else previous += 2 / (period + 1) * (v - previous);
    return previous;
  });
}
export function wilder(values: Series, period: number): Series {
  let count = 0, sum = 0, previous: number | null = null;
  return values.map(v => {
    if (v === null) return null;
    if (previous === null) { sum += v / period; if (++count < period) return null; previous = sum; }
    else previous = ((period - 1) * previous + v) / period;
    return previous;
  });
}
export function rsiSeries(closes: number[], period: number): Series {
  const changes = closes.map((v, i) => i ? v - closes[i - 1] : null);
  const gain = wilder(changes.map(v => v === null ? null : Math.max(v, 0)), period);
  const loss = wilder(changes.map(v => v === null ? null : Math.max(-v, 0)), period);
  return gain.map((v, i) => v === null ? null : loss[i] ? 100 - 100 / (1 + v / loss[i]!) : v ? 100 : 50);
}
export function trueRanges(data: HistoryPoint[]): number[] {
  return data.map((p, i) => i ? Math.max(p.high - p.low, Math.abs(p.high - data[i - 1].close), Math.abs(p.low - data[i - 1].close)) : p.high - p.low);
}
export const atrSeries = (data: HistoryPoint[], period: number) => wilder(trueRanges(data).map((v, i) => i ? v : null), period);
export function obvSeries(data: HistoryPoint[]): number[] {
  let value = 0;
  return data.map((p, i) => { if (i) value += Math.sign(p.close - data[i - 1].close) * p.volume; return value; });
}
export function cciSeries(data: HistoryPoint[], period: number): Series {
  const typical = data.map(p => (p.high + p.low + p.close) / 3), mean = sma(typical, period);
  return mean.map((m, i) => {
    if (m === null) return null;
    const mad = typical.slice(i - period + 1, i + 1).reduce((s, v) => s + Math.abs(v - m), 0) / period;
    return mad > Number.EPSILON * Math.max(1, Math.abs(m)) * 32 ? (typical[i] - m) / (.015 * mad) : 0;
  });
}
export const rocSeries = (closes: number[], period: number): Series => closes.map((v, i) => i >= period && closes[i - period] ? (v / closes[i - period] - 1) * 100 : null);
export function rangePosition(data: HistoryPoint[], period: number): Series {
  return data.map((p, i) => {
    if (i < period - 1) return null;
    const window = data.slice(i - period + 1, i + 1);
    const high = Math.max(...window.map(p => p.high)), low = Math.min(...window.map(p => p.low));
    return high === low ? 50 : (p.close - low) / (high - low) * 100;
  });
}
export function adxSeries(data: HistoryPoint[], period: number) {
  const plus: Series = [null], minus: Series = [null], tr: Series = [null];
  const ranges = trueRanges(data);
  for (let i = 1; i < data.length; i++) {
    const up = data[i].high - data[i - 1].high, down = data[i - 1].low - data[i].low;
    plus.push(up > down && up > 0 ? up : 0); minus.push(down > up && down > 0 ? down : 0); tr.push(ranges[i]);
  }
  const smoothPlus = wilder(plus, period), smoothMinus = wilder(minus, period), smoothRange = wilder(tr, period);
  const diPlus = smoothPlus.map((v, i) => v === null ? null : smoothRange[i] ? 100 * v / smoothRange[i]! : 0);
  const diMinus = smoothMinus.map((v, i) => v === null ? null : smoothRange[i] ? 100 * v / smoothRange[i]! : 0);
  const dx = diPlus.map((v, i) => v === null ? null : v + diMinus[i]! ? 100 * Math.abs(v - diMinus[i]!) / (v + diMinus[i]!) : 0);
  return { plus: diPlus, minus: diMinus, adx: wilder(dx, period) };
}
export function supertrendSeries(data: HistoryPoint[], period: number, multiplier: number): Series {
  const atr = atrSeries(data, period);
  let upper = 0, lower = 0, direction = -1;
  return data.map((p, i) => {
    if (atr[i] === null) return null;
    const middle = (p.high + p.low) / 2, basicUpper = middle + multiplier * atr[i]!, basicLower = middle - multiplier * atr[i]!;
    if (i === period) { upper = basicUpper; lower = basicLower; direction = -1; }
    else {
      const nextUpper = basicUpper < upper || data[i - 1].close > upper ? basicUpper : upper;
      const nextLower = basicLower > lower || data[i - 1].close < lower ? basicLower : lower;
      direction = direction === -1 ? (p.close > nextUpper ? 1 : -1) : (p.close < nextLower ? -1 : 1);
      upper = nextUpper; lower = nextLower;
    }
    return direction;
  });
}

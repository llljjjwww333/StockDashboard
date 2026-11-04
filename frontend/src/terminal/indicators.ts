import type { HistoryPoint } from './types';

export type Series = Array<number | null>;
export type OverlayKey = 'ma5' | 'ma10' | 'ma20' | 'ma60' | 'ema12' | 'ema26' | 'boll';
export type PanelKey = 'volume' | 'macd' | 'rsi' | 'kdj' | 'atr' | 'obv' | 'cci' | 'roc';
export type IndicatorLine = { name: string; color: string; values: Series };
export type IndicatorPanel = { id: PanelKey; label: string; lines: IndicatorLine[]; bars?: Series; guides?: number[] };

export const overlayOptions: Array<{ id: OverlayKey; label: string; color: string }> = [
  { id: 'ma5', label: 'MA5', color: 'var(--indicator-gold)' }, { id: 'ma10', label: 'MA10', color: 'var(--indicator-purple)' },
  { id: 'ma20', label: 'MA20', color: 'var(--indicator-orange)' }, { id: 'ma60', label: 'MA60', color: 'var(--indicator-blue)' },
  { id: 'ema12', label: 'EMA12', color: 'var(--indicator-teal)' }, { id: 'ema26', label: 'EMA26', color: 'var(--indicator-rose)' },
  { id: 'boll', label: 'BOLL(20,2)', color: 'var(--indicator-slate)' },
];
export const panelOptions: Array<{ id: PanelKey; label: string }> = [
  { id: 'volume', label: '成交量' }, { id: 'macd', label: 'MACD(12,26,9)' }, { id: 'rsi', label: 'RSI(14)' },
  { id: 'kdj', label: 'KDJ(9,3,3)' }, { id: 'atr', label: 'ATR(14)' }, { id: 'obv', label: 'OBV' },
  { id: 'cci', label: 'CCI(20)' }, { id: 'roc', label: 'ROC(12)' },
];

export function sma(values: number[], period: number): Series {
  let sum = 0;
  return values.map((value, index) => {
    sum += value;
    if (index >= period) sum -= values[index - period];
    return index >= period - 1 ? sum / period : null;
  });
}

export function ema(values: Series, period: number): Series {
  let seed: number[] = [];
  let previous: number | null = null;
  return values.map(value => {
    if (value === null) return null;
    if (previous === null) {
      seed.push(value);
      if (seed.length < period) return null;
      previous = seed.reduce((sum, item) => sum + item, 0) / period;
      seed = [];
    } else previous += (2 / (period + 1)) * (value - previous);
    return previous;
  });
}

export function calculateIndicators(data: HistoryPoint[], warmup: HistoryPoint[] = []) {
  const last = data.length ? Date.parse(data[data.length - 1].timestamp) : -Infinity;
  const merged = new Map<number, HistoryPoint>();
  for (const bar of [...warmup, ...data]) {
    const time = Date.parse(bar.timestamp);
    if (Number.isFinite(time) && time <= last) merged.set(time, bar);
  }
  const all = [...merged.entries()].sort((a, b) => a[0] - b[0]).map(([, bar]) => bar);
  const closes = all.map(p => p.close);
  const ma5 = sma(closes, 5), ma10 = sma(closes, 10), ma20 = sma(closes, 20), ma60 = sma(closes, 60);
  const ema12 = ema(closes, 12), ema26 = ema(closes, 26);
  const dif = closes.map((_, i) => ema12[i] !== null && ema26[i] !== null ? ema12[i]! - ema26[i]! : null);
  const dea = ema(dif, 9);
  const macd = dif.map((value, i) => value !== null && dea[i] !== null ? 2 * (value - dea[i]!) : null);
  const upper: Series = [], lower: Series = [], rsi: Series = [], atr: Series = [], obv: Series = [], cci: Series = [], roc: Series = [];
  const k: Series = [], d: Series = [], j: Series = [];
  let averageGain = 0, averageLoss = 0, averageRange = 0, cumulativeVolume = 0;
  let previousK = 50, previousD = 50;
  const typical = all.map(p => (p.high + p.low + p.close) / 3);
  const cciMean = sma(typical, 20);
  for (let i = 0; i < all.length; i++) {
    const point = all[i];
    if (ma20[i] !== null) {
      const window = closes.slice(i - 19, i + 1);
      const deviation = Math.sqrt(window.reduce((sum, v) => sum + (v - ma20[i]!) ** 2, 0) / 20);
      upper.push(ma20[i]! + 2 * deviation); lower.push(ma20[i]! - 2 * deviation);
      const mad = typical.slice(i - 19, i + 1).reduce((sum, v) => sum + Math.abs(v - cciMean[i]!), 0) / 20;
      const tolerance = Number.EPSILON * Math.max(1, Math.abs(cciMean[i]!)) * 32;
      cci.push(mad > tolerance ? (typical[i] - cciMean[i]!) / (.015 * mad) : 0);
    } else { upper.push(null); lower.push(null); cci.push(null); }
    const change = i ? point.close - all[i - 1].close : 0;
    if (i > 0 && i <= 14) { averageGain += Math.max(change, 0) / 14; averageLoss += Math.max(-change, 0) / 14; }
    if (i > 14) { averageGain = (13 * averageGain + Math.max(change, 0)) / 14; averageLoss = (13 * averageLoss + Math.max(-change, 0)) / 14; }
    rsi.push(i >= 14 ? (averageLoss ? 100 - 100 / (1 + averageGain / averageLoss) : averageGain ? 100 : 50) : null);
    const tr = i ? Math.max(point.high - point.low, Math.abs(point.high - all[i - 1].close), Math.abs(point.low - all[i - 1].close)) : point.high - point.low;
    if (i < 14) averageRange += tr / 14;
    else averageRange = (averageRange * 13 + tr) / 14;
    atr.push(i >= 13 ? averageRange : null);
    if (i && change) cumulativeVolume += Math.sign(change) * point.volume;
    obv.push(cumulativeVolume);
    roc.push(i >= 12 && closes[i - 12] !== 0 ? (point.close / closes[i - 12] - 1) * 100 : null);
    if (i >= 8) {
      const window = all.slice(i - 8, i + 1);
      const high = Math.max(...window.map(p => p.high)), low = Math.min(...window.map(p => p.low));
      const rsv = high === low ? 50 : (point.close - low) / (high - low) * 100;
      previousK = (previousK * 2 + rsv) / 3;
      previousD = (previousD * 2 + previousK) / 3;
      k.push(previousK); d.push(previousD); j.push(3 * previousK - 2 * previousD);
    } else { k.push(null); d.push(null); j.push(null); }
  }
  const indices = new Map(all.map((p, i) => [Date.parse(p.timestamp), i]));
  const align = (values: Series): Series => data.map(p => {
    const i = indices.get(Date.parse(p.timestamp));
    const value = i === undefined ? null : values[i];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  });
  const line = (name: string, color: string, values: Series): IndicatorLine => ({ name, color, values: align(values) });
  const overlays: Record<OverlayKey, IndicatorLine[]> = {
    ma5: [line('MA5', 'var(--indicator-gold)', ma5)], ma10: [line('MA10', 'var(--indicator-purple)', ma10)], ma20: [line('MA20', 'var(--indicator-orange)', ma20)],
    ma60: [line('MA60', 'var(--indicator-blue)', ma60)], ema12: [line('EMA12', 'var(--indicator-teal)', ema12)], ema26: [line('EMA26', 'var(--indicator-rose)', ema26)],
    boll: [line('BOLL MID', 'var(--indicator-slate)', ma20), line('BOLL UP', 'var(--indicator-band)', upper), line('BOLL LOW', 'var(--indicator-band)', lower)],
  };
  const panels: Record<PanelKey, IndicatorPanel> = {
    volume: { id: 'volume', label: '成交量', lines: [], bars: data.map(p => p.volume) },
    macd: { id: 'macd', label: 'MACD(12,26,9)', lines: [line('DIF', 'var(--indicator-gold)', dif), line('DEA', 'var(--indicator-purple)', dea)], bars: align(macd), guides: [0] },
    rsi: { id: 'rsi', label: 'RSI(14)', lines: [line('RSI', 'var(--indicator-purple)', rsi)], guides: [30, 70] },
    kdj: { id: 'kdj', label: 'KDJ(9,3,3)', lines: [line('K', 'var(--indicator-gold)', k), line('D', 'var(--indicator-purple)', d), line('J', 'var(--indicator-teal)', j)], guides: [20, 80] },
    atr: { id: 'atr', label: 'ATR(14)', lines: [line('ATR', 'var(--indicator-teal)', atr)] },
    obv: { id: 'obv', label: 'OBV', lines: [line('OBV', 'var(--indicator-blue)', obv)] },
    cci: { id: 'cci', label: 'CCI(20)', lines: [line('CCI', 'var(--indicator-gold)', cci)], guides: [-100, 100] },
    roc: { id: 'roc', label: 'ROC(12)', lines: [line('ROC', 'var(--indicator-rose)', roc)], guides: [0] },
  };
  return { overlays, panels };
}

export function seriesPath(values: Series, getX: (i: number) => number, getY: (v: number) => number, breaks: ReadonlySet<number> = new Set()) {
  let connected = false;
  return values.map((value, i) => {
    if (breaks.has(i)) connected = false;
    if (value === null || !Number.isFinite(value)) { connected = false; return ''; }
    const prefix = connected ? 'L' : 'M'; connected = true;
    return `${prefix}${getX(i).toFixed(2)},${getY(value).toFixed(2)}`;
  }).join(' ');
}

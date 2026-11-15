import type { HistoryPoint } from './types';

import { atrSeries, bollingerSeries, cciSeries, ema, obvSeries, rangePosition, rocSeries, rsiSeries, sma, type Series } from './technicalSeries.ts';
export { ema, sma } from './technicalSeries.ts';
export type { Series } from './technicalSeries.ts';
export type OverlayKey = 'ma5' | 'ma10' | 'ma20' | 'ma60' | 'ema12' | 'ema26' | 'boll';
export type PanelKey = 'volume' | 'macd' | 'rsi' | 'kdj' | 'atr' | 'obv' | 'cci' | 'roc';
export type IndicatorLine = { name: string; color: string; values: Series };
export type IndicatorPanel = { id: PanelKey; label: string; lines: IndicatorLine[]; bars?: Series; guides?: number[] };

export function indicatorPrecision(key: PanelKey, priceDigits: number) {
  return key === 'macd' || key === 'atr' ? Math.max(4, priceDigits + 1) : 2;
}

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

export function calculateIndicators(data: HistoryPoint[], warmup: HistoryPoint[] = []) {
  const last = data.length ? Date.parse(data[data.length - 1].timestamp) : -Infinity;
  const merged = new Map<number, HistoryPoint>();
  for (const bar of [...warmup, ...data]) {
    const time = Date.parse(bar.timestamp);
    if (Number.isFinite(time) && time <= last) merged.set(time, bar);
  }
  const all = [...merged.entries()].sort((a, b) => a[0] - b[0]).map(([, bar]) => bar);
  const closes = all.map(p => p.close);
  const band = bollingerSeries(closes, 20, 2);
  const ma5 = sma(closes, 5), ma10 = sma(closes, 10), ma20 = band.middle, ma60 = sma(closes, 60);
  const ema12 = ema(closes, 12), ema26 = ema(closes, 26);
  const dif = closes.map((_, i) => ema12[i] !== null && ema26[i] !== null ? ema12[i]! - ema26[i]! : null);
  const dea = ema(dif, 9);
  const macd = dif.map((value, i) => value !== null && dea[i] !== null ? 2 * (value - dea[i]!) : null);
  const { upper, lower } = band;
  const rsi = rsiSeries(closes, 14), atr = atrSeries(all, 14), obv = obvSeries(all), cci = cciSeries(all, 20), roc = rocSeries(closes, 12);
  const k: Series = [], d: Series = [], j: Series = [];
  const rsv = rangePosition(all, 9);
  let previousK = 50, previousD = 50;
  for (const value of rsv) {
    if (value !== null) {
      previousK = (previousK * 2 + value) / 3;
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

export function analysisIndicatorValues(data: HistoryPoint[], warmup: HistoryPoint[], includeOhlc: boolean) {
  const { overlays, panels } = calculateIndicators(data, warmup);
  const latest = (values: Series) => values.at(-1) ?? null;
  const lastLine = (panel: PanelKey, index = 0) => latest(panels[panel].lines[index].values);
  return {
    ma5: latest(overlays.ma5[0].values), ma10: latest(overlays.ma10[0].values),
    ma20: latest(overlays.ma20[0].values), ma60: latest(overlays.ma60[0].values),
    ema12: latest(overlays.ema12[0].values), ema26: latest(overlays.ema26[0].values),
    boll_mid: latest(overlays.boll[0].values), boll_upper: latest(overlays.boll[1].values), boll_lower: latest(overlays.boll[2].values),
    rsi14: lastLine('rsi'), macd: lastLine('macd'), macd_signal: lastLine('macd', 1),
    macd_histogram: latest(panels.macd.bars ?? []), obv: lastLine('obv'), roc12: lastLine('roc'),
    ...(includeOhlc ? {
      atr14: lastLine('atr'), cci20: lastLine('cci'), kdj_k: lastLine('kdj'), kdj_d: lastLine('kdj', 1), kdj_j: lastLine('kdj', 2),
    } : {}),
  };
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

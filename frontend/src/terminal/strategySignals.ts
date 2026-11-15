import { getStrategy, type Regime, type RegimeMethod } from './strategyCatalog.ts';
import type { HistoryPoint } from './types';
import type { StrategyConfig } from './backtest';
import { customStrategySignals } from './strategyRules.ts';
import { adxSeries, atrSeries, bollingerSeries, cciSeries, ema, obvSeries, rangePosition, rocSeries, rsiSeries, sma, supertrendSeries, type Series } from './technicalSeries.ts';

export type StrategySignals = { enter: boolean[]; exit: boolean[]; regimes?: { regime: Regime; method: RegimeMethod }[] };
export function strategySignals(data: HistoryPoint[], c: Required<StrategyConfig>): StrategySignals {
  if (c.kind === 'adaptive') {
    const close = data.map(p => p.close), macro = sma(close, c.slow), strength = adxSeries(data, c.fast), atr = atrSeries(data, c.fast);
    const methods = new Map<RegimeMethod, StrategySignals>();
    for (const method of Object.values(c.regimeMethods)) if (method !== 'cash' && !methods.has(method)) {
      methods.set(method, strategySignals(data, { ...c, ...getStrategy(method)!.defaults, kind: method }));
    }
    let active: Regime = 'defensive', pending: Regime = active, count = 0;
    const regimes: NonNullable<StrategySignals['regimes']> = [];
    const enter: boolean[] = [], exit: boolean[] = [];
    data.forEach((p, i) => {
      const ready = macro[i] !== null && strength.adx[i] !== null && atr[i] !== null;
      const candidate: Regime = !ready || p.close < macro[i]! ? 'defensive' : atr[i]! / p.close * 100 >= c.bandWidth ? 'volatile' : strength.adx[i]! >= c.adxThreshold ? 'trend' : 'range';
      if (candidate !== pending) { pending = candidate; count = 1; } else count++;
      if (count >= c.signalPeriod) active = pending;
      const method = c.regimeMethods[active], signals = methods.get(method);
      regimes.push({ regime: active, method });
      enter.push(ready && (signals?.enter[i] ?? false)); exit.push(!ready || method === 'cash' || !!signals?.exit[i]);
    });
    return { enter, exit, regimes };
  }
  if (c.kind === 'custom') return customStrategySignals(data, c.rules!);
  const close = data.map(p => p.close), enter = data.map(() => false), exit = data.map(() => false);
  const trend = (condition: (i: number) => boolean) => data.forEach((_, i) => { enter[i] = condition(i); exit[i] = !enter[i]; });
  const oscillator = (series: Series) => data.forEach((_, i) => { if (series[i] !== null) { enter[i] = series[i]! < c.entryThreshold; exit[i] = series[i]! >= c.exitThreshold; } });
  switch (c.kind) {
    case 'sma': case 'ema': case 'obv': {
      const values = c.kind === 'obv' ? obvSeries(data) : close;
      const average = c.kind === 'sma' ? sma : ema;
      const fast = average(values, c.fast), slow = average(values, c.slow), price = sma(close, c.slow);
      trend(i => fast[i] !== null && slow[i] !== null && fast[i]! > slow[i]! && (c.kind !== 'obv' || close[i] > price[i]!)); break;
    }
    case 'macd': {
      const fast = ema(close, c.fast), slow = ema(close, c.slow);
      const dif = close.map((_, i) => fast[i] !== null && slow[i] !== null ? fast[i]! - slow[i]! : null), dea = ema(dif, c.signalPeriod);
      trend(i => dif[i] !== null && dea[i] !== null && dif[i]! > dea[i]!); break;
    }
    case 'breakout': case 'volume': {
      const price = sma(close, c.fast);
      data.forEach((p, i) => {
        if (i < Math.max(c.fast, c.slow)) return;
        enter[i] = p.close > Math.max(...data.slice(i - c.slow, i).map(p => p.high));
        if (c.kind === 'volume') {
          const averageVolume = data.slice(i - c.fast, i).reduce((s, p) => s + p.volume, 0) / c.fast;
          enter[i] = enter[i] && averageVolume > 0 && p.volume >= averageVolume * c.volumeMultiplier;
          exit[i] = p.close < price[i]!;
        } else exit[i] = p.close < Math.min(...data.slice(i - c.fast, i).map(p => p.low));
      }); break;
    }
    case 'bands': {
      const bands = bollingerSeries(close, c.slow, c.bandWidth);
      data.forEach((p, i) => {
        if (bands.middle[i] === null) return;
        enter[i] = p.close < bands.lower[i]!; exit[i] = p.close >= bands.middle[i]!;
      }); break;
    }
    case 'rsi': oscillator(rsiSeries(close, c.fast)); break;
    case 'cci': oscillator(cciSeries(data, c.fast)); break;
    case 'williams': oscillator(rangePosition(data, c.fast).map(v => v === null ? null : v - 100)); break;
    case 'stochastic': {
      const k = rangePosition(data, c.fast), d: Series = data.map(() => null);
      // %D is the simple average of the most recent valid %K values.
      for (let i = 0; i < k.length; i++) d[i] = i >= c.fast + c.slow - 2 ? k.slice(i - c.slow + 1, i + 1).reduce<number>((s, v) => s + v!, 0) / c.slow : null;
      data.forEach((_, i) => {
        if (!i || k[i] === null || d[i] === null || d[i - 1] === null) return;
        enter[i] = k[i]! > d[i]! && k[i - 1]! <= d[i - 1]! && k[i]! <= c.entryThreshold;
        exit[i] = k[i]! < d[i]! || k[i]! >= c.exitThreshold;
      }); break;
    }
    case 'momentum': {
      const roc = rocSeries(close, c.fast), average = sma(close, c.slow);
      trend(i => roc[i] !== null && average[i] !== null && roc[i]! > c.momentumThreshold && close[i] > average[i]!); break;
    }
    case 'keltner': {
      const average = ema(close, c.slow), atr = atrSeries(data, c.fast);
      data.forEach((p, i) => { if (average[i] !== null && atr[i] !== null) { enter[i] = p.close > average[i]! + c.atrMultiplier * atr[i]!; exit[i] = p.close <= average[i]!; } }); break;
    }
    case 'supertrend': { const direction = supertrendSeries(data, c.fast, c.atrMultiplier); trend(i => direction[i] === 1); break; }
    case 'adx': { const di = adxSeries(data, c.fast); trend(i => di.adx[i] !== null && di.adx[i]! >= c.adxThreshold && di.plus[i]! > di.minus[i]!); break; }
  }
  return { enter, exit };
}

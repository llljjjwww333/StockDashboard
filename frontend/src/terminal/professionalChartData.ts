import { isChinaTicker } from '../lib/instrumentIdentity.ts';
import type { CandlestickData, UTCTimestamp } from 'lightweight-charts';
import type { HistoryPoint } from './types';

// The engine displays UTC. Encode exchange-local wall time so its axes follow
// New York DST and Shanghai sessions while the original source timestamps remain intact.
export function chartCandles(data: HistoryPoint[], ticker: string): CandlestickData<UTCTimestamp>[] {
  const format = new Intl.DateTimeFormat('en-CA', { timeZone: isChinaTicker(ticker) ? 'Asia/Shanghai' : 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  return data.map(point => {
    const parts = Object.fromEntries(format.formatToParts(new Date(point.timestamp)).map(p => [p.type, p.value]));
    return { time: (Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) / 1000) as UTCTimestamp,
      open: point.open, high: point.high, low: point.low, close: point.close };
  });
}

export function candleUpdatePlan(previous: CandlestickData<UTCTimestamp>[], next: CandlestickData<UTCTimestamp>[]) {
  const equal = (a: CandlestickData<UTCTimestamp>, b: CandlestickData<UTCTimestamp>) => a.time === b.time && a.open === b.open && a.high === b.high && a.low === b.low && a.close === b.close;
  if (!previous.length || next.length < previous.length) return { replace: true, rows: next };
  const tail = previous.length - 1;
  if (previous[tail].time !== next[tail].time) return { replace: true, rows: next };
  for (let i = 0; i < previous.length - 1; i++) {
    if (!equal(previous[i], next[i])) return { replace: true, rows: next };
  }
  const start = equal(previous[tail], next[tail]) ? previous.length : tail;
  return { replace: false, rows: next.slice(start) };
}

export function readPriceLevels(ticker: string, storage?: Pick<Storage, 'getItem'>): number[] {
  try {
    const values = JSON.parse((storage ?? localStorage).getItem(`marketdesk:levels:${ticker}`) ?? '[]');
    return Array.isArray(values) ? values.filter(value => typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 1e12).slice(-12) : [];
  } catch { return []; }
}

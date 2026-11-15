import { isCryptoTicker, isChinaTicker } from '../lib/instrumentIdentity.ts';
import { marketHours } from '../lib/marketCalendar.ts';

export type MarketPhase = '休市' | '集合竞价' | '交易时段' | '午间休市' | '盘前' | '盘后' | '已收盘';

const sessionClock = (timeZone: string) => new Intl.DateTimeFormat('en-US', {
  timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const shanghaiClock = sessionClock('Asia/Shanghai');
const newYorkClock = sessionClock('America/New_York');

export function marketPhase(ticker: string, now: Date): MarketPhase {
  if (isCryptoTicker(ticker)) return '交易时段';
  const cn = isChinaTicker(ticker);
  const clock = cn ? shanghaiClock : newYorkClock;
  const parts = Object.fromEntries(clock.formatToParts(now).map(part => [part.type, part.value]));
  const minutes = +parts.hour * 60 + +parts.minute;
  const hours = marketHours(cn ? 'CN' : 'US', `${parts.year}-${parts.month}-${parts.day}`);
  if (!hours) return '休市';
  if (cn) {
    if ((minutes >= 555 && minutes < 565) || (minutes >= 897 && minutes < 900)) return '集合竞价';
    if ((minutes >= 570 && minutes < 690) || (minutes >= 780 && minutes < 897)) return '交易时段';
    if (minutes >= 690 && minutes < 780) return '午间休市';
    return minutes < 570 ? '盘前' : '已收盘';
  }
  if (minutes >= 570 && minutes < hours.regular) return '交易时段';
  if (minutes >= 240 && minutes < 570) return '盘前';
  if (minutes >= hours.regular && minutes < hours.late) return '盘后';
  return '已收盘';
}

export const isActivePhase = (phase: MarketPhase) => phase === '交易时段' || phase === '集合竞价';

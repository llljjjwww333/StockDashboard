import { isChinaTicker } from '../lib/instrumentIdentity.ts';
export function marketPhase(ticker: string, now: Date) {
  const cn = isChinaTicker(ticker);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: cn ? 'Asia/Shanghai' : 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).map(part => [part.type, part.value]));
  const minutes = +parts.hour * 60 + +parts.minute;
  if (parts.weekday === 'Sat' || parts.weekday === 'Sun') return '休市';
  if (cn) {
    if ((minutes >= 555 && minutes < 565) || (minutes >= 897 && minutes < 900)) return '集合竞价';
    if ((minutes >= 570 && minutes < 690) || (minutes >= 780 && minutes < 897)) return '交易时段';
    if (minutes >= 690 && minutes < 780) return '午间休市';
    return minutes < 570 ? '盘前' : '已收盘';
  }
  if (minutes >= 570 && minutes < 960) return '交易时段';
  if (minutes >= 240 && minutes < 570) return '盘前';
  if (minutes >= 960 && minutes < 1200) return '盘后';
  return '已收盘';
}

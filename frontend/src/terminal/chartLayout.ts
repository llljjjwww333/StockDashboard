import { isChinaTicker } from '../lib/instrumentIdentity.ts';
import type { HistoryPoint } from './types';

export const CHART_LEFT = 18;
export const CHART_RIGHT = 76;

export function buildChartLayout(data: HistoryPoint[], ticker: string, intraday: boolean, left: number, right: number, intervalMinutes = 1) {
  const cn = isChinaTicker(ticker);
  const format = new Intl.DateTimeFormat('en-CA', { timeZone: cn ? 'Asia/Shanghai' : 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const times = data.map(point => {
    const parts = Object.fromEntries(format.formatToParts(new Date(point.timestamp)).map(p => [p.type, p.value]));
    return { date: `${parts.year}-${parts.month}-${parts.day}`, minute: Number(parts.hour) * 60 + Number(parts.minute) };
  });
  const dates = [...new Set(times.map(t => t.date))];
  const breaks = new Set<number>();
  const gap = intraday && dates.length > 1 ? Math.min(12, (right - left) / (dates.length * 4)) : 0;
  const dayWidth = (right - left - gap * Math.max(dates.length - 1, 0)) / Math.max(dates.length, 1);
  const slots = cn ? 241 : 390;
  const clockSlot = (minute: number) => cn && minute >= 780 ? minute - 780 + 121 : minute - 570;
  const positions = data.map((_, index) => {
    if (!intraday) return data.length === 1 ? (left + right) / 2 : left + (right - left) * index / (data.length - 1);
    const time = times[index], previous = times[index - 1];
    const lunchSlot = cn && previous?.minute <= 690 && time.minute >= 780 ? 1 : 0;
    if (previous && (previous.date !== time.date || clockSlot(time.minute) - clockSlot(previous.minute) - lunchSlot > Math.max(5, intervalMinutes))) breaks.add(index);
    const slot = clockSlot(time.minute);
    return left + dates.indexOf(time.date) * (dayWidth + gap) + Math.max(0, Math.min(slot, slots)) / slots * dayWidth;
  });
  const sessions = dates.map((date, i) => ({ date, center: left + i * (dayWidth + gap) + dayWidth / 2,
    divider: left + i * (dayWidth + gap) - gap / 2 }));
  return { positions, breaks, sessions, step: intraday ? dayWidth / slots * intervalMinutes : (right - left) / Math.max(data.length - 1, 1) };
}

export function nearestPoint(positions: number[], x: number) {
  let low = 0, high = positions.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (positions[middle] < x) low = middle + 1;
    else high = middle;
  }
  return low > 0 && Math.abs(positions[low - 1] - x) <= Math.abs(positions[low] - x) ? low - 1 : low;
}

export function areaPaths(values: number[], x: (i: number) => number, y: (v: number) => number, bottom: number, breaks: Set<number>) {
  if (!values.length) return [];
  const starts = [0, ...breaks].sort((a, b) => a - b);
  return starts.map((start, group) => {
    const end = (starts[group + 1] ?? values.length) - 1;
    const line = values.slice(start, end + 1).map((v, offset) => `${offset ? 'L' : 'M'}${x(start + offset).toFixed(2)},${y(v).toFixed(2)}`).join(' ');
    return `${line} L${x(end)},${bottom} L${x(start)},${bottom} Z`;
  });
}

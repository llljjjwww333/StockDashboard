import data from './marketCalendar.json' with { type: 'json' };

type Market = 'CN' | 'US';
type Hours = { regular: number; late: number };
const calendars = data.markets as Record<Market, { closures: string[][]; early_closes: Record<string, Hours> }>;

export function marketHours(market: Market, date: string): Hours | null {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  const calendar = calendars[market];
  if (day === 0 || day === 6 || calendar.closures.some(([start, end]) => date >= start && date <= end)) return null;
  return calendar.early_closes[date] ?? (market === 'CN' ? { regular: 900, late: 900 } : { regular: 960, late: 1200 });
}

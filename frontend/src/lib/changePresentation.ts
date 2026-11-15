export type ChangeTone = 'positive' | 'negative' | 'neutral';

export function changeTone(value: number, digits = 2): ChangeTone {
  const rounded = Number.isFinite(value) ? Number(value.toFixed(digits)) : 0;
  return rounded > 0 ? 'positive' : rounded < 0 ? 'negative' : 'neutral';
}

export function formatSigned(value: number, digits = 2) {
  if (!Number.isFinite(value)) return '--';
  const rounded = Number(value.toFixed(digits));
  return `${rounded > 0 ? '+' : ''}${(rounded || 0).toFixed(digits)}`;
}

export function changeDirection(value: number) {
  const tone = changeTone(value);
  return tone === 'positive' ? 'up' : tone === 'negative' ? 'down' : 'flat';
}

export function priceChangeTone(price: number, base: number | null | undefined, digits = 2): ChangeTone | undefined {
  return Number.isFinite(price) && price > 0 && typeof base === 'number' && Number.isFinite(base) && base > 0
    ? changeTone(price - base, digits) : undefined;
}

export function volumeDirection(close: number, comparison: number | null) {
  if (comparison === null || !Number.isFinite(comparison) || comparison <= 0 || close === comparison) return 'muted';
  return close > comparison ? 'up' : 'down';
}

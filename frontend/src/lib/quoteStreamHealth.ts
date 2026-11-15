export function isQuoteStreamHealthy(startedAt: number | undefined, confirmedAt: number | null | undefined,
  failed: boolean, active: boolean, now: number) {
  if (failed || startedAt === undefined || !Number.isFinite(startedAt) || !Number.isFinite(now)) return false;
  // Give a new subscription one feed interval to receive its first quote.
  const since = Math.max(startedAt, Number.isFinite(confirmedAt) ? confirmedAt! : startedAt);
  return now >= since && now - since < (active ? 10000 : 40000);
}

export function remainingFreshTime(entry: { savedAt: number; data: unknown } | undefined, ttl: number, now: number) {
  if (!entry || !entry.data || typeof entry.data !== 'object' || !Number.isFinite(entry.savedAt) ||
    !Number.isFinite(now) || !Number.isFinite(ttl) || ttl <= 0 || now < entry.savedAt) return 0;
  const data = entry.data as { stale?: boolean; updated_at?: string };
  if (data.stale) return 0;
  const sourceAt = data.updated_at === undefined ? entry.savedAt : Date.parse(data.updated_at);
  if (!Number.isFinite(sourceAt)) return 0;
  // Receiving an already cached server response must not renew its source freshness.
  return Math.max(0, ttl - (now - Math.min(sourceAt, entry.savedAt)));
}

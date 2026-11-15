export function newsSourceLink(value: unknown): { href: string; hostname: string } | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password) return null;
    return { href: url.href, hostname: url.hostname };
  } catch { return null; }
}

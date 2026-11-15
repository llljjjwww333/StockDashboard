type RecoveryPort = {
  currentEntry: string | null;
  latestEntry: (signal: AbortSignal) => Promise<string | null>;
  lastReloadedEntry: () => string | null;
  rememberEntry: (entry: string) => void;
  canReload: () => boolean;
  reload: () => void;
};

export async function recoverChartModule(error: unknown, port: RecoveryPort, signal: AbortSignal) {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  if (!/fetch dynamically imported module|importing a module script failed|loading dynamically imported module|unable to preload css/i.test(message) ||
    !port.currentEntry || signal.aborted) return false;
  try {
    const next = await port.latestEntry(signal);
    if (signal.aborted || !next || next === port.currentEntry || next === port.lastReloadedEntry() || !port.canReload()) return false;
    port.rememberEntry(next);
    port.reload();
    return true;
  } catch { return false; }
}

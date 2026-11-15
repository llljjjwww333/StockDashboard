type ResumeEvent = 'visibilitychange' | 'online' | 'offline' | 'pageshow';
const EVENT_BURST_MS = 500;
type Resume = { revision: number; startedAt: number };

export class PageResumeClock {
  private revision = 0;
  current: Resume | null = null;

  record(type: ResumeEvent, now: number, visible: boolean, online: boolean, persisted = false) {
    if (!visible || !online || type === 'offline') { this.current = null; return; }
    if (type === 'pageshow' && !persisted) return;
    // Browsers can report one activation through visibility, network and BFCache events.
    // A genuine intervening background/offline transition always starts a new cycle.
    if (this.boundary(now) !== undefined) return;
    this.current = { revision: ++this.revision, startedAt: now };
  }

  boundary(now: number) {
    return this.current && now >= this.current.startedAt && now - this.current.startedAt <= EVENT_BURST_MS
      ? this.current.startedAt : undefined;
  }
}

export const pageResumeClock = new PageResumeClock();

if (typeof window !== 'undefined') {
  const record = (event: Event) => pageResumeClock.record(event.type as ResumeEvent, Date.now(), !document.hidden,
    navigator.onLine, event.type === 'pageshow' && (event as PageTransitionEvent).persisted);
  // Capture the shared boundary before React's market clock can replace resource effects.
  document.addEventListener('visibilitychange', record, true);
  window.addEventListener('online', record, true);
  window.addEventListener('offline', record, true);
  window.addEventListener('pageshow', record, true);
}

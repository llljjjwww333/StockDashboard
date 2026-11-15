import type { MarketType, WatchlistStock } from '../store/stockStore';
import type { ChartSelection } from './chartSelection';
import type { ChinaBoardView, DeskView } from './types';
import { readCryptoDeskRoute, readDeskRoute, writeDeskRoute } from './deskRoute.ts';
import { normalizeNewsView, type NewsView } from './newsView.ts';

export type MarketOrigin = { ticker: string; market: MarketType; anchorId: string; top: number; scroll: number; fromBoard: boolean };
export type DeskLocation = {
  view: DeskView;
  market: MarketType;
  stock: WatchlistStock | null;
  chart: ChartSelection;
  boardView: ChinaBoardView;
  marketOrigin: MarketOrigin | null;
  immersive: boolean;
  newsView?: NewsView;
};
export type DeskEntry = { version: 1; id: number; previousId: number | null; previousKey?: string | null; location: DeskLocation; scroll: number };
type HistoryPort = Pick<History, 'state' | 'pushState' | 'replaceState'>;
const key = (location: DeskLocation) => [location.view, location.market,
  location.view === 'overview' ? location.stock?.ticker ?? '' : ''].join(':');

// Only navigation data is persisted; quotes, analysis results and API profiles stay out of history.
function copyLocation(location: DeskLocation): DeskLocation {
  return {
    view: location.view, market: location.market,
    stock: location.stock ? { ticker: location.stock.ticker, name: location.stock.name, market: location.stock.market } : null,
    chart: { ...location.chart },
    boardView: { ...location.boardView, selection: location.boardView.selection
      ? { ...location.boardView.selection, board: { ...location.boardView.selection.board } } : null },
    marketOrigin: location.marketOrigin ? { ...location.marketOrigin } : null,
    immersive: location.immersive,
    newsView: normalizeNewsView(location.newsView),
  };
}

export class DeskNavigation {
  private current: DeskEntry | null = null;
  private sequence = Date.now();
  private entries = new Map<number, DeskEntry>();
  private history: HistoryPort;
  private url: () => URL;
  private cryptoOnly: boolean;

  constructor(history: HistoryPort, url: () => URL, cryptoOnly = false) { this.history = history; this.url = url; this.cryptoOnly = cryptoOnly; }
  private get stateKey() { return this.cryptoOnly ? 'zpboardCryptoNavigation' : 'zpboardNavigation'; }

  private write(entry: DeskEntry, push: boolean) {
    const url = this.url();
    const location = entry.location;
    writeDeskRoute(url, location.view, location.market, location.stock?.ticker ?? null, location.chart);
    const state = { ...this.history.state, [this.stateKey]: entry };
    if (push) this.history.pushState(state, '', url);
    else this.history.replaceState(state, '', url);
    this.entries.set(entry.id, entry);
  }

  commit(location: DeskLocation) {
    const previous = this.current;
    const push = previous !== null && key(previous.location) !== key(location);
    if (push) {
      // Opening a member can pin the default board in the same React update as the stock change.
      // Keep that selection on the departing market entry, rather than a reordered default board.
      if (previous.location.view === 'markets') {
        const next = copyLocation(location);
        previous.location = { ...previous.location, boardView: next.boardView, marketOrigin: next.marketOrigin };
      }
      this.write(previous, false);
    }
    const entry: DeskEntry = {
      version: 1, id: push || !previous ? ++this.sequence : previous.id,
      previousId: push ? previous.id : previous?.previousId ?? null,
      previousKey: push ? key(previous.location) : previous?.previousKey ?? null,
      location: copyLocation(location), scroll: push ? 0 : previous?.scroll ?? 0,
    };
    this.write(entry, push);
    this.current = entry;
    return push;
  }

  recordScroll(scroll: number) {
    if (this.current && Number.isFinite(scroll)) this.current.scroll = Math.max(0, scroll);
  }

  flush() { if (this.current) this.write(this.current, false); }

  restore(state: unknown): DeskEntry | null {
    const candidate = state && typeof state === 'object' ? (state as Record<string, unknown>)[this.stateKey] as DeskEntry | undefined : undefined;
    if (!candidate || candidate.version !== 1 || !Number.isSafeInteger(candidate.id) || !candidate.location?.chart ||
      !candidate.location.boardView || !Number.isFinite(candidate.scroll)) {
      this.current = null;
      return null;
    }
    const route = (this.cryptoOnly ? readCryptoDeskRoute : readDeskRoute)(this.url().searchParams);
    const location = candidate.location;
    if (route.view !== location.view || route.market !== location.market ||
      (location.view === 'overview' && route.ticker !== (location.stock?.ticker ?? null))) {
      this.current = null;
      return null;
    }
    const saved = this.entries.get(candidate.id) ?? candidate;
    this.current = { ...saved, location: copyLocation(saved.location) };
    this.entries.set(this.current.id, this.current);
    this.sequence = Math.max(this.sequence, candidate.id);
    return this.current;
  }

  canReturnToMarket(origin: MarketOrigin) {
    const previous = this.current?.previousId != null ? this.entries.get(this.current.previousId) : undefined;
    return previous?.location.view === 'markets' && previous.location.market === origin.market ||
      this.current?.previousId != null && this.current.previousKey === `markets:${origin.market}:`;
  }
}

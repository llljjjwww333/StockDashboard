import { createStore } from 'zustand/vanilla';
import { readPriceLevels } from './professionalChartData.ts';

type Levels = readonly number[];
type Update = Levels | ((levels: Levels) => Levels);
type LevelHistory = {
  past: readonly Levels[]; present: Levels; future: readonly Levels[];
  setLevels: (update: Update) => void; undo: () => void; redo: () => void;
  syncLevels: (levels: Levels) => void;
};
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
const prefix = 'marketdesk:levels:';
const same = (left: Levels, right: Levels) => left.length === right.length && left.every((value, index) => value === right[index]);
const valid = (levels: unknown): levels is number[] => Array.isArray(levels) && levels.every(value =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 1e12);

export function createPriceLevelHistory(ticker: string, storage?: StorageLike) {
  const store = createStore<LevelHistory>(set => ({
    past: [], present: readPriceLevels(ticker, storage), future: [],
    setLevels: update => set(state => {
      const next = typeof update === 'function' ? update(state.present) : update;
      if (!valid(next)) return state;
      const present = next.slice(-12);
      return same(present, state.present) ? state : { past: [...state.past.slice(-31), state.present], present, future: [] };
    }),
    undo: () => set(state => state.past.length ? { past: state.past.slice(0, -1), present: state.past.at(-1)!,
      future: [state.present, ...state.future].slice(0, 32) } : state),
    redo: () => set(state => state.future.length ? { past: [...state.past.slice(-31), state.present], present: state.future[0],
      future: state.future.slice(1) } : state),
    syncLevels: levels => set(state => !valid(levels) || same(state.present, levels.slice(-12)) ? state
      : { past: [], present: levels.slice(-12), future: [] }),
  }));
  store.subscribe((state, previous) => {
    if (state.present === previous.present) return;
    try { (storage ?? localStorage).setItem(`${prefix}${ticker}`, JSON.stringify(state.present)); } catch { /* Drawing edits remain available in memory. */ }
  });
  return store;
}

const stores = new Map<string, ReturnType<typeof createPriceLevelHistory>>();
export function priceLevelHistory(ticker: string) {
  let store = stores.get(ticker);
  if (!store) store = createPriceLevelHistory(ticker);
  stores.delete(ticker);
  stores.set(ticker, store);
  if (stores.size > 128) stores.delete(stores.keys().next().value!);
  return store;
}

if (typeof window !== 'undefined') window.addEventListener('storage', event => {
  if (event.key === null) { for (const store of stores.values()) store.getState().syncLevels([]); return; }
  if (!event.key.startsWith(prefix)) return;
  const store = stores.get(event.key.slice(prefix.length));
  if (!store) return;
  try {
    const levels: unknown = JSON.parse(event.newValue ?? '[]');
    if (valid(levels)) store.getState().syncLevels(levels);
  } catch { /* A corrupt external edit must not erase the current drawing. */ }
});

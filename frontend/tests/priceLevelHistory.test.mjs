import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPriceLevelHistory } from '../src/terminal/priceLevelHistory.ts';
function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

test('draw, undo, redo and clear restore exactly the previous price levels', () => {
  const session = storage();
  const store = createPriceLevelHistory('600519', session);
  const act = store.getState();
  act.setLevels([100]); act.setLevels(prev => [...prev, 110]);
  act.undo(); assert.deepEqual(store.getState().present, [100]);
  act.redo(); assert.deepEqual(store.getState().present, [100, 110]);
  act.setLevels([]); assert.deepEqual(store.getState().present, []);
  act.undo(); assert.deepEqual(store.getState().present, [100, 110]);
  assert.equal(session.getItem('marketdesk:levels:600519'), '[100,110]');
});

test('a new edit after undo discards the abandoned redo branch', () => {
  const store = createPriceLevelHistory('600519', storage());
  const act = store.getState();
  act.setLevels([100]); act.setLevels([100, 110]); act.undo(); act.setLevels([100, 120]);
  act.redo();
  assert.deepEqual(store.getState().present, [100, 120]);
  assert.equal(store.getState().future.length, 0);
});

test('no-op and invalid edits do not change the history or overwrite storage', () => {
  const session = storage({ 'marketdesk:levels:AAPL': '[100]' });
  const store = createPriceLevelHistory('AAPL', session), initial = store.getState();
  initial.setLevels([100]); initial.setLevels([NaN]); initial.setLevels([-1]); initial.undo(); initial.redo();
  assert.equal(store.getState(), initial);
  assert.equal(session.getItem('marketdesk:levels:AAPL'), '[100]');
});

test('saved legacy levels and different stocks remain isolated through undo and reload', () => {
  const session = storage({ 'marketdesk:levels:AAPL': '[100]', 'marketdesk:levels:NVDA': '[200,210]' });
  const aapl = createPriceLevelHistory('AAPL', session), nvda = createPriceLevelHistory('NVDA', session);
  aapl.getState().setLevels([100, 120]); aapl.getState().undo();
  assert.deepEqual(nvda.getState().present, [200, 210]);
  assert.deepEqual(createPriceLevelHistory('AAPL', session).getState().present, [100]);
});

test('undo restores a level displaced by the twelve-line limit and keeps history bounded', () => {
  const store = createPriceLevelHistory('600519', storage());
  const act = store.getState();
  act.setLevels(Array.from({ length: 12 }, (_, i) => i + 1));
  act.setLevels(prev => [...prev, 13]);
  act.undo(); assert.deepEqual(store.getState().present, Array.from({ length: 12 }, (_, i) => i + 1));
  for (let i = 14; i < 80; i++) act.setLevels(prev => [...prev, i]);
  assert.equal(store.getState().past.length, 32);
  assert.equal(store.getState().present.length, 12);
  for (let i = 0; i < 40; i++) act.undo();
  assert.equal(store.getState().future.length, 32);
});

test('an external drawing update clears obsolete undo steps and ignores malformed replacements', () => {
  const store = createPriceLevelHistory('600519', storage());
  const act = store.getState();
  act.setLevels([100]); act.setLevels([100, 110]);
  act.syncLevels([100, 110]); assert.equal(store.getState().past.length, 2);
  act.syncLevels([120]); act.undo();
  assert.deepEqual(store.getState().present, [120]);
  assert.equal(store.getState().past.length, 0);
  act.syncLevels([Infinity]); assert.deepEqual(store.getState().present, [120]);
});

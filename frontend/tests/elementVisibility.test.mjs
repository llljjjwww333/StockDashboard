import { test } from 'node:test';
import assert from 'node:assert/strict';
import { observeElementVisibility } from '../src/lib/elementVisibility.ts';

test('visibility listeners share observation, receive current state and ignore callbacks after cleanup', t => {
  const original = globalThis.IntersectionObserver;
  const observers = [], stops = [];
  globalThis.IntersectionObserver = class {
    observed = []; removed = []; disconnected = false;
    constructor(notify) { this.notify = notify; observers.push(this); }
    observe(element) { this.observed.push(element); }
    unobserve(element) { this.removed.push(element); }
    disconnect() { this.disconnected = true; }
  };
  t.after(() => {
    for (const stop of stops) stop();
    if (original === undefined) delete globalThis.IntersectionObserver;
    else globalThis.IntersectionObserver = original;
  });
  const first = {}, second = {}, events = [], shared = [], late = [];
  const stopFirst = observeElementVisibility(first, visible => events.push(visible)); stops.push(stopFirst);
  const stopShared = observeElementVisibility(first, visible => shared.push(visible)); stops.push(stopShared);
  const stopSecond = observeElementVisibility(second, () => {}); stops.push(stopSecond);
  assert.equal(observers.length, 1);
  assert.deepEqual(observers[0].observed, [first, second]);
  observers[0].notify([{ target: first, isIntersecting: true }]);
  assert.deepEqual(events, [true]);
  assert.deepEqual(shared, [true]);
  const stopLate = observeElementVisibility(first, visible => late.push(visible)); stops.push(stopLate);
  assert.deepEqual(late, [true]);
  stopFirst();
  observers[0].notify([{ target: first, isIntersecting: false }]);
  assert.deepEqual(events, [true]);
  assert.deepEqual(shared, [true, false]);
  stopShared(); stopLate();
  observers[0].notify([{ target: first, isIntersecting: true }]);
  assert.deepEqual(late, [true, false]);
  stopSecond();
  assert.equal(observers[0].disconnected, true);
});

test('browsers without visibility observation keep the existing immediate-load behavior', t => {
  const original = globalThis.IntersectionObserver;
  delete globalThis.IntersectionObserver;
  t.after(() => { if (original !== undefined) globalThis.IntersectionObserver = original; });
  const events = [];
  const stop = observeElementVisibility({}, visible => events.push(visible));
  assert.deepEqual(events, [true]);
  assert.doesNotThrow(stop);
});

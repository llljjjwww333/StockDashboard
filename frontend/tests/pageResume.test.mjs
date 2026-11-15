import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PageResumeClock } from '../src/lib/pageResume.ts';

test('visibility, online and persisted pageshow share one immediate resume boundary', () => {
  const clock = new PageResumeClock();
  clock.record('visibilitychange', 1000, true, true);
  const first = clock.current;
  clock.record('online', 1100, true, true);
  clock.record('pageshow', 1400, true, true, true);
  assert.equal(clock.current, first);
  assert.equal(clock.boundary(1500), 1000);
  assert.equal(clock.boundary(1501), undefined);
});

test('a real second background transition resumes even inside the coalescing window', () => {
  const clock = new PageResumeClock();
  clock.record('visibilitychange', 1000, true, true);
  const first = clock.current;
  clock.record('visibilitychange', 1100, false, true);
  assert.equal(clock.current, null);
  clock.record('visibilitychange', 1200, true, true);
  assert.equal(clock.current.startedAt, 1200);
  assert.equal(clock.current.revision, first.revision + 1);
});

test('offline restoration starts a new boundary and hidden/offline events do not start requests', () => {
  const clock = new PageResumeClock();
  clock.record('visibilitychange', 1000, true, true);
  clock.record('offline', 1100, true, false);
  clock.record('visibilitychange', 1150, true, false);
  assert.equal(clock.current, null);
  clock.record('online', 1200, true, true);
  assert.deepEqual(clock.current, { revision: 2, startedAt: 1200 });
  clock.record('visibilitychange', 1300, false, true);
  clock.record('online', 1400, false, true);
  assert.equal(clock.current, null);
});

test('normal pageshow does not duplicate boot; a later BFCache restore creates a new cycle', () => {
  const clock = new PageResumeClock();
  clock.record('pageshow', 1000, true, true);
  assert.equal(clock.current, null);
  clock.record('pageshow', 2000, true, true, true);
  const first = clock.current;
  clock.record('pageshow', 3000, true, true, true);
  assert.equal(clock.current.revision, first.revision + 1);
  assert.equal(clock.boundary(1999), undefined);
});

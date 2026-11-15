import { test } from 'node:test';
import assert from 'node:assert/strict';
import { remainingFreshTime } from '../src/lib/resourceFreshness.ts';
const hour = 3600000;
const entry = (updated_at, savedAt = 9 * hour) => ({ savedAt, data: { updated_at } });

test('a cached server response expires from its source time instead of its arrival time', () => {
  assert.equal(remainingFreshTime(entry(new Date(5 * hour).toISOString()), 6 * hour, 10 * hour), hour);
  assert.equal(remainingFreshTime(entry(new Date(4 * hour).toISOString()), 6 * hour, 10 * hour), 0);
});

test('a future source clock cannot grant more freshness than the client receipt', () => {
  assert.equal(remainingFreshTime(entry(new Date(11 * hour).toISOString()), 6 * hour, 10 * hour), 5 * hour);
  assert.equal(remainingFreshTime(entry(undefined, 11 * hour), 6 * hour, 10 * hour), 0);
});

test('legacy metadata remains usable while stale or malformed timestamps force refresh', () => {
  assert.equal(remainingFreshTime(entry(undefined), 6 * hour, 10 * hour), 5 * hour);
  assert.equal(remainingFreshTime({ ...entry(undefined), data: { stale: true } }, 6 * hour, 10 * hour), 0);
  assert.equal(remainingFreshTime(entry('invalid'), 6 * hour, 10 * hour), 0);
});

test('missing data and invalid clock or lifetime values cannot create an immediate retry loop', () => {
  for (const item of [undefined, { savedAt: 0, data: null }, { savedAt: NaN, data: {} }]) assert.equal(remainingFreshTime(item, hour, 10 * hour), 0);
  assert.equal(remainingFreshTime(entry(undefined), 0, 10 * hour), 0);
  assert.equal(remainingFreshTime(entry(undefined), hour, NaN), 0);
});

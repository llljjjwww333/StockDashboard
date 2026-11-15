import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isQuoteStreamHealthy } from '../src/lib/quoteStreamHealth.ts';

test('a new subscription gets a first-quote grace period appropriate to its market session', () => {
  assert.equal(isQuoteStreamHealthy(1000, undefined, false, true, 10999), true);
  assert.equal(isQuoteStreamHealthy(1000, undefined, false, true, 11000), false);
  assert.equal(isQuoteStreamHealthy(1000, null, false, false, 40999), true);
  assert.equal(isQuoteStreamHealthy(1000, null, false, false, 41000), false);
});

test('subscription errors trigger fallback immediately and successful stream confirmations restore health', () => {
  assert.equal(isQuoteStreamHealthy(1000, 6000, true, true, 7000), false);
  assert.equal(isQuoteStreamHealthy(1000, 6000, false, true, 7000), true);
  assert.equal(isQuoteStreamHealthy(1000, 6000, false, true, 16000), false);
  assert.equal(isQuoteStreamHealthy(1000, 15000, false, true, 16000), true);
});

test('old connection confirmations cannot bypass first-quote grace or revive a silent subscription', () => {
  assert.equal(isQuoteStreamHealthy(20000, 1000, false, true, 20001), true);
  assert.equal(isQuoteStreamHealthy(20000, 1000, false, true, 30000), false);
  assert.equal(isQuoteStreamHealthy(undefined, 30000, false, true, 30001), false);
  assert.equal(isQuoteStreamHealthy(NaN, 30000, false, true, 30001), false);
});

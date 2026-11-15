import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatSigned, changeTone, changeDirection, priceChangeTone } from '../src/lib/changePresentation.ts';

test('rounded zero and negative zero have no directional sign or color', () => {
  for (const value of [0, -0, 0.001, -0.001]) {
    assert.equal(formatSigned(value), '0.00');
    assert.equal(changeTone(value), 'neutral');
    assert.equal(changeDirection(value), 'flat');
  }
  assert.equal(formatSigned(.001, 3), '+0.001');
  assert.equal(changeTone(.001, 3), 'positive');
  assert.equal(formatSigned(-.001, 3), '-0.001');
  assert.equal(changeTone(-.001, 3), 'negative');
});

test('real positive and negative changes keep their displayed precision and direction', () => {
  assert.equal(formatSigned(1.234), '+1.23');
  assert.equal(formatSigned(-1.234), '-1.23');
  assert.equal(changeDirection(1.234), 'up');
  assert.equal(changeDirection(-1.234), 'down');
  for (const invalid of [NaN, Infinity, -Infinity]) assert.equal(formatSigned(invalid), '--');
});

test('price statistics use the actual previous close and stay uncolored without a usable reference', () => {
  assert.equal(priceChangeTone(110, 100), 'positive');
  assert.equal(priceChangeTone(90, 100), 'negative');
  assert.equal(priceChangeTone(100, 100), 'neutral');
  for (const base of [undefined, null, 0, NaN, -10]) assert.equal(priceChangeTone(100, base), undefined);
  assert.equal(priceChangeTone(0, 100), undefined);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatVolume, volumeUnit } from '../src/lib/volumePresentation.ts';

test('China volume displays in lots while US volume retains shares in both languages', () => {
  assert.equal(formatVolume(4284800, 'CN', 'zh-CN'), '4.28万手');
  assert.equal(formatVolume(4284800, 'CN', 'en-US'), '42.85K lots');
  assert.equal(formatVolume(4284800, 'US', 'zh-CN'), '428.48万股');
  assert.equal(formatVolume(4284800, 'US', 'en-US'), '4.28M shares');
  assert.equal(volumeUnit('CN', 'zh-CN'), '手');
  assert.equal(volumeUnit('US', 'en-US'), 'shares');
});

test('odd lots, zero volume and negative OBV remain representable without rounding to full lots', () => {
  assert.equal(formatVolume(1, 'CN', 'zh-CN'), '0.01手');
  assert.equal(formatVolume(123, 'CN', 'zh-CN'), '1.23手');
  assert.equal(formatVolume(0, 'CN', 'en-US'), '0 lots');
  assert.equal(formatVolume(-512, 'CN', 'zh-CN'), '-5.12手');
  assert.equal(formatVolume(123, 'US', 'en-US'), '123 shares');
});

test('axis labels share the same conversion while invalid values never masquerade as zero', () => {
  assert.equal(formatVolume(4284800, 'CN', 'zh-CN', false), '4.28万');
  assert.equal(formatVolume(4284800, 'US', 'en-US', false), '4.28M');
  assert.equal(formatVolume(NaN, 'CN', 'zh-CN'), '--');
  assert.equal(formatVolume(Infinity, 'US', 'en-US'), '--');
});

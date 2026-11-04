import { test } from 'node:test';
import assert from 'node:assert/strict';
import { marketPhase } from '../src/terminal/marketSession.ts';
import { chinaInstrumentTags } from '../src/lib/instrumentIdentity.ts';

test('China session state distinguishes auctions, lunch and the close', () => {
  const phase = time => marketPhase('510300', new Date(`2026-11-03T${time}:00+08:00`));
  assert.equal(phase('09:20'), '集合竞价');
  assert.equal(phase('10:00'), '交易时段');
  assert.equal(phase('12:00'), '午间休市');
  assert.equal(phase('14:58'), '集合竞价');
  assert.equal(phase('16:00'), '已收盘');
});

test('US market phases follow New York DST and weekends', () => {
  assert.equal(marketPhase('AAPL', new Date('2026-10-30T13:30:00Z')), '交易时段');
  assert.equal(marketPhase('AAPL', new Date('2026-11-03T14:30:00Z')), '交易时段');
  assert.equal(marketPhase('AAPL', new Date('2026-11-03T14:00:00Z')), '盘前');
  assert.equal(marketPhase('AAPL', new Date('2026-11-03T21:10:00Z')), '盘后');
  assert.equal(marketPhase('AAPL', new Date('2026-11-07T16:00:00Z')), '休市');
});

test('China indices have Shanghai sessions and stock labels combine risk and board', () => {
  assert.equal(marketPhase('SH000001', new Date('2026-11-03T10:00:00+08:00')), '交易时段');
  assert.deepEqual(chinaInstrumentTags('688066', '＊ＳＴ航图').map(tag => tag.label), ['*ST', '科创板']);
  assert.deepEqual(chinaInstrumentTags('920002', '万达轴承').map(tag => tag.label), ['北交所']);
  assert.deepEqual(chinaInstrumentTags('SH000001', '上证指数').map(tag => tag.label), ['指数']);
  assert.deepEqual(chinaInstrumentTags('000001', '平安银行').map(tag => tag.label), ['主板']);
});

test('industry and related boards extend a stock identity without overriding its listing', () => {
  const tags = chinaInstrumentTags('920117', '龙鑫智能', {
    industry: '通用设备', boards: ['创业板', '通用设备', '高端装备', '固态电池', '高端装备'], source: 'fixture',
  });
  assert.deepEqual(tags.map(tag => tag.label), ['北交所', '通用设备', '高端装备', '固态电池']);
});

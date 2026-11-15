import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { marketPhase, isActivePhase } from '../src/terminal/marketSession.ts';
import { marketHours } from '../src/lib/marketCalendar.ts';
import { quoteFreshness } from '../src/lib/quotes.ts';
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

test('frontend and backend ship the same official exchange calendar', () => {
  const source = readFileSync(new URL('../../backend/app/data/market_calendar.json', import.meta.url), 'utf8');
  assert.equal(readFileSync(new URL('../src/lib/marketCalendar.json', import.meta.url), 'utf8'), source);
  const calendar = JSON.parse(source);
  for (const market of Object.values(calendar.markets)) {
    for (const [start, end] of market.closures) {
      assert(start <= end);
      assert(market.covered_years.includes(Number(start.slice(0, 4))));
      assert(market.covered_years.includes(Number(end.slice(0, 4))));
    }
  }
});

test('Chinese exchange holidays close weekdays and government makeup weekends remain closed', () => {
  for (const date of ['2026-01-01', '2026-02-23', '2026-04-06', '2026-05-05', '2026-06-19', '2026-09-25', '2026-10-07', '2026-02-14', '2026-09-20', '2026-10-10']) {
    assert.equal(marketPhase('SH000001', new Date(`${date}T10:30:00+08:00`)), '休市', date);
  }
  for (const date of ['2026-02-24', '2026-05-06', '2026-10-08']) {
    assert.equal(marketPhase('600519', new Date(`${date}T10:30:00+08:00`)), '交易时段', date);
  }
});

test('regular Chinese auctions, lunch and closing boundaries remain distinct', () => {
  for (const [time, phase] of [['09:15', '集合竞价'], ['09:25', '盘前'], ['09:30', '交易时段'],
    ['11:30', '午间休市'], ['13:00', '交易时段'], ['14:57', '集合竞价'], ['15:00', '已收盘']]) {
    assert.equal(marketPhase('510300', new Date(`2026-11-04T${time}:00+08:00`)), phase);
  }
});

test('US full-day closures and half-day close boundaries follow the published dates', () => {
  assert.equal(marketPhase('AAPL', new Date('2026-11-26T10:30:00-05:00')), '休市');
  assert.equal(marketPhase('AAPL', new Date('2027-12-24T10:30:00-05:00')), '休市');
  for (const [time, phase] of [['12:59', '交易时段'], ['13:00', '盘后'], ['16:59', '盘后'], ['17:00', '已收盘']]) {
    assert.equal(marketPhase('AAPL', new Date(`2026-11-27T${time}:00-05:00`)), phase);
    assert.equal(isActivePhase(phase), phase === '交易时段');
  }
  assert.equal(marketPhase('AAPL', new Date('2026-07-02T14:30:00-04:00')), '交易时段');
  assert.equal(marketPhase('AAPL', new Date('2027-12-31T10:30:00-05:00')), '交易时段');
  assert.equal(marketHours('US', '2028-07-03').regular, 780);
});

test('New York opening times follow daylight saving rather than the computer timezone', () => {
  assert.equal(marketPhase('AAPL', new Date('2026-03-09T13:30:00Z')), '交易时段');
  assert.equal(marketPhase('AAPL', new Date('2026-11-02T14:30:00Z')), '交易时段');
  assert.equal(marketPhase('AAPL', new Date('2026-11-02T13:30:00Z')), '盘前');
});

test('holiday quotes are not mislabeled as late when the provider freshly confirms the last session', () => {
  const now = Date.parse('2026-10-01T10:30:00+08:00');
  const quote = { price: 100, volume: 1000, changePercent: 1, asOf: '2026-09-30T15:00:00+08:00', fetchedAt: new Date(now).toISOString() };
  assert.equal(quoteFreshness('600519', quote, now), null);
  assert.equal(quoteFreshness('600519', { ...quote, stale: true }, now), 'cached');
});

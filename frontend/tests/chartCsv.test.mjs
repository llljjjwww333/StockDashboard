import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chartCsv } from '../src/lib/chartCsv.ts';

const point = { timestamp: '2026-11-06T09:31:00+08:00', open: 4.092, high: 4.095, low: 4.091, close: 4.093, volume: 50 };

test('chart export retains timestamp, price precision, raw shares and explicit source metadata', () => {
  const csv = chartCsv('510300', '1d', '1m', { data: [point], interval: '1m', price_type: 'snapshot', adjustment: 'none', source: '腾讯财经', stale: true });
  assert(csv.startsWith('\uFEFFticker,period,interval,timestamp,'));
  assert(csv.includes('volume_shares,average_price,price_type,adjustment,source,cached\r\n'));
  assert(csv.endsWith('510300,1d,1m,2026-11-06T09:31:00+08:00,4.092,4.095,4.091,4.093,50,,snapshot,none,腾讯财经,true\r\n'));
});

test('CSV escapes embedded commas, quotes and newlines without discarding values', () => {
  const source = 'Source, "quoted"\nline';
  const csv = chartCsv('AAPL', '1mo', '1d', { data: [{ ...point, volume: 0, average_price: 0 }], source });
  assert(csv.includes(',0,0,,,"Source, ""quoted""\nline",false\r\n'));
});

test('untrusted text cannot become a spreadsheet formula while numeric fields remain numeric', () => {
  const csv = chartCsv('AAPL', '1mo', '1d', { data: [point], source: '=HYPERLINK("x")' });
  assert(csv.endsWith(',"\'=HYPERLINK(""x"")",false\r\n'));
  assert(csv.includes(',4.092,4.095,4.091,4.093,50,'));
  const empty = chartCsv('AAPL', '1mo', '1d', { data: [] });
  assert.equal(empty.split('\r\n').length, 2);
});

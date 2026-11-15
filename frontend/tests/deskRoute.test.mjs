import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyLinkedChart, readDeskRoute, writeDeskRoute } from '../src/terminal/deskRoute.ts';
import { initialChartSelection } from '../src/terminal/chartSelection.ts';

for (const view of ['strategy', 'simulation']) test(view + ' page round-trips through the address without leaking chart parameters', () => {
  const url = new URL('https://example.com/?ticker=AAPL&period=1y');
  writeDeskRoute(url, view, 'US', 'AAPL', initialChartSelection);
  assert.equal(readDeskRoute(url.searchParams).view, view);
  assert.equal(url.searchParams.has('ticker'), false);
});

test('a link restores the stock, market and compatible candle range', () => {
  const route = readDeskRoute(new URLSearchParams('ticker=sh000001&market=US&period=5d&chart=candles&interval=15m'));
  assert.equal(route.ticker, 'SH000001');
  assert.equal(route.market, 'CN');
  const chart = applyLinkedChart(initialChartSelection, route.chart);
  assert.equal(chart.period, '5d');
  assert.equal(chart.mode, 'candles');
  assert.equal(chart.candleInterval, '15m');
});

test('invalid ticker paths and incompatible charts fall back to the existing preferences', () => {
  assert.equal(readDeskRoute(new URLSearchParams('ticker=../../api')).ticker, null);
  const route = readDeskRoute(new URLSearchParams('ticker=AAPL&period=5d&chart=candles&interval=1m'));
  assert.equal(route.ticker, 'AAPL');
  assert.equal(applyLinkedChart(initialChartSelection, route.chart), initialChartSelection);
});

test('the address round-trips chart state and drops stock-specific parameters on other views', () => {
  const url = new URL('https://example.com/?entry=home&interval=15m#top');
  const chart = { ...initialChartSelection, period: '1y' };
  writeDeskRoute(url, 'overview', 'US', '^GSPC', chart);
  assert.equal(readDeskRoute(url.searchParams).ticker, '^GSPC');
  assert.deepEqual(readDeskRoute(url.searchParams).chart, { mode: 'line', period: '1y' });
  assert.equal(url.searchParams.has('interval'), false);
  writeDeskRoute(url, 'markets', 'CN', '^GSPC', chart);
  assert.equal(url.searchParams.toString(), 'entry=home&view=markets&market=CN');
  assert.equal(url.hash, '#top');
});

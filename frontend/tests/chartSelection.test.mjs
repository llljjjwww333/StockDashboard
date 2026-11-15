import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chartSelection, initialChartSelection, loadChartSelection } from '../src/terminal/chartSelection.ts';

test('saved chart interval and range restore together after reload', () => {
  const state = { ...initialChartSelection, mode: 'candles', period: '5d', candleInterval: '15m', lastMinutePeriod: '5d', lastCandlePeriod: '3mo' };
  assert.deepEqual(loadChartSelection({ getItem: () => JSON.stringify(state) }), state);
});

test('invalid preferences cannot restore an incompatible candle range', () => {
  assert.deepEqual(loadChartSelection({ getItem: () => '{bad' }), initialChartSelection);
  assert.deepEqual(loadChartSelection({ getItem: () => JSON.stringify({ mode: 'wrong' }) }), initialChartSelection);
  assert.deepEqual(loadChartSelection({ getItem: () => { throw new Error('blocked'); } }), initialChartSelection);
  const state = loadChartSelection({ getItem: () => JSON.stringify({ ...initialChartSelection, mode: 'candles', period: '5d', candleInterval: '1m' }) });
  assert.equal(state.period, '1d');
  assert.equal(state.candleInterval, '1m');
});

test('switching from a line chart keeps the visible range and selects a supported candle interval', () => {
  for (const [period, interval] of [['1d', '1m'], ['5d', '5m'], ['1mo', '1d'], ['3mo', '1d'], ['1y', '1d']]) {
    const state = chartSelection({ ...initialChartSelection, period }, { type: 'mode', mode: 'candles' });
    assert.equal(state.mode, 'candles');
    assert.equal(state.period, period);
    assert.equal(state.candleInterval, interval);
  }
});

test('changing the candle interval can restore the last daily range without losing the five-day preference', () => {
  let state = chartSelection(initialChartSelection, { type: 'interval', interval: '1d' });
  state = chartSelection(state, { type: 'period', period: '3mo' });
  state = chartSelection(state, { type: 'mode', mode: 'line' });
  state = chartSelection(state, { type: 'period', period: '5d' });
  assert.equal(state.mode, 'line');
  state = chartSelection(state, { type: 'mode', mode: 'candles' });
  assert.equal(state.mode, 'candles');
  assert.equal(state.period, '5d');
  assert.equal(state.candleInterval, '5m');
  state = chartSelection(state, { type: 'interval', interval: '1d' });
  assert.equal(state.period, '3mo');
  state = chartSelection(state, { type: 'interval', interval: '15m' });
  assert.equal(state.period, '5d');
});

test('an existing compatible minute interval is reused across chart types', () => {
  const line = { ...initialChartSelection, period: '5d', candleInterval: '30m' };
  const candles = chartSelection(line, { type: 'mode', mode: 'candles' });
  assert.equal(candles.candleInterval, '30m');
  assert.equal(candles.period, '5d');
  assert.equal(chartSelection(candles, { type: 'mode', mode: 'line' }).period, '5d');
  assert.equal(chartSelection({ ...line, candleInterval: '1m' }, { type: 'mode', mode: 'candles' }).candleInterval, '5m');
});

test('minute candles and daily candles retain separate ranges without changing chart mode', () => {
  let state = chartSelection(initialChartSelection, { type: 'interval', interval: '5m' });
  assert.equal(state.mode, 'candles');
  assert.equal(state.period, '1d');
  state = chartSelection(state, { type: 'period', period: '5d' });
  state = chartSelection(state, { type: 'interval', interval: '1d' });
  assert.equal(state.period, '1mo');
  state = chartSelection(state, { type: 'period', period: '3mo' });
  state = chartSelection(state, { type: 'interval', interval: '30m' });
  assert.equal(state.period, '5d');
  state = chartSelection(state, { type: 'interval', interval: '1d' });
  assert.equal(state.period, '3mo');
});

test('one minute candles use the supported single session and incompatible range clicks are ignored', () => {
  let state = chartSelection(initialChartSelection, { type: 'interval', interval: '5m' });
  state = chartSelection(state, { type: 'period', period: '5d' });
  state = chartSelection(state, { type: 'interval', interval: '1m' });
  assert.equal(state.period, '1d');
  assert.equal(state.mode, 'candles');
  assert.deepEqual(chartSelection(state, { type: 'period', period: '5d' }), state);
  assert.deepEqual(chartSelection(state, { type: 'period', period: '1mo' }), state);
});

test('repeated minute candle clicks preserve the interval and session range', () => {
  let state = chartSelection(initialChartSelection, { type: 'interval', interval: '15m' });
  state = chartSelection(state, { type: 'period', period: '5d' });
  for (let i = 0; i < 10; i++) state = chartSelection(state, { type: 'mode', mode: 'candles' });
  assert.equal(state.period, '5d');
  assert.equal(state.candleInterval, '15m');
  assert.equal(state.mode, 'candles');
});

test('repeated candle clicks cannot switch to five-day or line mode', () => {
  let state = chartSelection(initialChartSelection, { type: 'interval', interval: '1d' });
  for (let i = 0; i < 20; i++) {
    state = chartSelection(state, { type: 'mode', mode: 'candles' });
    assert.equal(state.mode, 'candles');
    assert.equal(state.period, '1mo');
  }
});

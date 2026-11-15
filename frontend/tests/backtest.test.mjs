import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runBacktest } from '../src/terminal/backtest.ts';

const config = { kind: 'sma', fast: 2, slow: 3, capital: 10000, feeBps: 0, slippageBps: 0 };
const bars = closes => closes.map((close, i) => ({ timestamp: new Date(Date.UTC(2025, 0, i + 1)).toISOString(), open: close, high: close + .1, low: close - .1, close, volume: 100 }));
const near = (a, b) => assert(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

test('signal reads previous close and fills next open; equal-date benchmark uses same entry cost', () => {
  const data = bars([1, 2, 3, 4, 10, 20]);
  const result = runBacktest(data, { ...config, feeBps: 10, slippageBps: 20 });
  assert.equal(result.trades.length, 1);
  assert.equal(result.trades[0].date, data[4].timestamp);
  near(result.trades[0].price, 10 * 1.002);
  near(result.trades[0].shares, 10000 / (10 * 1.002 * 1.001));
  near(result.curve[1].equity, result.trades[0].shares * 20);
  near(result.totalReturn, result.benchmarkReturn);
  assert.equal(result.invested, true);
});

test('an unexpected same-day crash does not create a sale until the following open', () => {
  const data = bars([1, 2, 3, 4, 5, 1, 1, 1]);
  const result = runBacktest(data, config);
  assert.equal(result.trades[1].date, data[6].timestamp);
  assert.equal(result.closedTrades, 1);
  assert.equal(result.wins, 0);
  near(result.totalReturn, -.8);
  near(result.maxDrawdown, .8);
});

test('changing future bars never alters earlier signals or equity', () => {
  for (const kind of ['sma', 'breakout']) {
    const data = bars([1, 2, 3, 4, 5, 6, 1, 2, 3, 4]);
    const short = runBacktest(data.slice(0, 7), { ...config, kind });
    const full = runBacktest(data, { ...config, kind });
    assert.deepEqual(full.curve.slice(0, short.curve.length), short.curve);
    assert.deepEqual(full.trades.filter(t => t.date <= data[6].timestamp), short.trades);
  }
});

test('breakout compares the full prior window and excludes signal-day high', () => {
  const data = bars([1, 2, 3, 4, 5, 6]);
  data[0].high = 100;
  const result = runBacktest(data, { ...config, kind: 'breakout' });
  // At signal index 3 the prior three bars still include the high of 100.
  assert.equal(result.trades[0].date, data[5].timestamp);
});

test('cash-only strategy returns zero and never manufactures a win rate', () => {
  const result = runBacktest(bars([10, 9, 8, 7, 6, 5, 4]), config);
  assert.equal(result.trades.length, 0);
  assert.equal(result.totalReturn, 0);
  assert.equal(result.closedTrades, 0);
  assert.equal(result.maxDrawdown, 0);
});

test('flat data generates no trades; input is not mutated', () => {
  const data = bars([10, 10, 10, 10, 10, 10]).reverse();
  const copy = structuredClone(data);
  assert.equal(runBacktest(data, config).totalReturn, 0);
  assert.deepEqual(data, copy);
});

test('rejects insufficient, corrupt and duplicate bars and invalid configuration', () => {
  assert.throws(() => runBacktest(bars([1, 2, 3, 4]), config), /历史数据不足/);
  const data = bars([1, 2, 3, 4, 5, 6]);
  for (const change of [{ fast: 3 }, { fast: 1 }, { slow: 201 }, { capital: NaN }, { feeBps: -1 }, { slippageBps: 101 }]) {
    assert.throws(() => runBacktest(data, { ...config, ...change }));
  }
  assert.throws(() => runBacktest([...data, data[0]], config), /重复日期/);
  assert.throws(() => runBacktest(data.map((p, i) => i ? p : { ...p, close: NaN }), config), /无效价格/);
});

test('fees are charged on both fills and closed win rate uses net proceeds', () => {
  const result = runBacktest(bars([1, 2, 3, 4, 5, 1, 1, 1]), { ...config, feeBps: 100, slippageBps: 100 });
  const [buy, sell] = result.trades;
  near(buy.fee, buy.price * buy.shares * .01);
  near(sell.fee, sell.price * sell.shares * .01);
  near(result.curve.at(-1).equity, sell.price * sell.shares - sell.fee);
});

test('custom date bounds preserve prior warmup and keep trades within the requested range', () => {
  const data = bars([1, 2, 3, 4, 5, 6, 7, 8]);
  const result = runBacktest(data, { ...config, startDate: '2025-01-06', endDate: '2025-01-07' });
  assert.equal(result.start, data[5].timestamp);
  assert.equal(result.end, data[6].timestamp);
  assert.equal(result.warmupBars, 5);
  assert.equal(result.testedBars, 2);
  assert(result.trades.every(t => t.date >= result.start && t.date <= result.end));
  assert.throws(() => runBacktest(data, { ...config, startDate: '2025-01-02' }), /预热/);
  assert.throws(() => runBacktest(data, { ...config, endDate: '2025-01-02' }), /没有可回测/);
  assert.throws(() => runBacktest(data, { ...config, startDate: '2025-02-30' }), /日期/);
});

test('position size and round lots reserve cash; insufficient lots never create fractional trades', () => {
  const data = bars([1, 2, 3, 4, 5, 6]);
  const result = runBacktest(data, { ...config, positionPct: 50, lotSize: 100 });
  assert.equal(result.shares, 1000);
  assert.equal(result.cash, 5000);
  near(result.finalEquity, 11000);
  const small = runBacktest(data, { ...config, capital: 100, lotSize: 100 });
  assert.equal(small.shares, 0);
  assert.equal(small.cash, 100);
  assert.equal(small.skippedEntries, 2);
});

test('close-based stop exits at next open including gaps, then allows a new entry', () => {
  const data = bars([1, 2, 3, 4, 10, 8, 2, 3]);
  const result = runBacktest(data, { ...config, stopLossPct: 10 });
  assert.equal(result.closed[0].reason, 'stop');
  assert.equal(result.trades[1].signalDate, data[5].timestamp);
  assert.equal(result.trades[1].date, data[6].timestamp);
  near(result.closed[0].exitPrice, 2);
  near(result.closed[0].returnPct, -.8);
});

test('take profit triggers on a completed close and not an unknown future high', () => {
  const data = bars([1, 2, 3, 4, 5, 6, 8]);
  const result = runBacktest(data, { ...config, takeProfitPct: 10 });
  assert.equal(result.closed[0].reason, 'profit');
  assert.equal(result.closed[0].exitDate, data[6].timestamp);
  near(result.closed[0].exitPrice, 8);
});

test('scheduled end liquidation charges both strategy and benchmark exit costs', () => {
  const data = bars([1, 2, 3, 4, 5, 6]);
  const result = runBacktest(data, { ...config, feeBps: 100, slippageBps: 100, liquidateEnd: true });
  assert.equal(result.invested, false);
  assert.equal(result.shares, 0);
  assert.equal(result.closed[0].reason, 'end');
  near(result.totalReturn, result.benchmarkReturn);
  near(result.finalEquity - config.capital, result.closed.reduce((s, t) => s + t.pnl, 0));
  near(result.totalFees, result.trades.reduce((s, t) => s + t.fee, 0));
});

test('realized and open PnL reconcile to total assets at partial allocation', () => {
  const data = bars([1, 2, 3, 4, 5, 1, 1, 2, 3, 4, 5]);
  const result = runBacktest(data, { ...config, feeBps: 5, positionPct: 60 });
  near(result.finalEquity - config.capital, result.closed.reduce((s, t) => s + t.pnl, 0) + result.unrealizedPnl);
  near(result.finalEquity, result.cash + result.shares * data.at(-1).close);
});

test('monthly returns compound to total return and daily risk metrics use explicit sample formulas', () => {
  const data = bars(Array.from({ length: 90 }, (_, i) => 100 + i + Math.sin(i) * 4));
  const result = runBacktest(data, config);
  near(result.monthly.reduce((n, m) => n * (1 + m.strategy), 1) - 1, result.totalReturn);
  const returns = result.curve.map((p, i) => p.equity / (i ? result.curve[i - 1].equity : config.capital) - 1);
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const sd = Math.sqrt(returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1));
  near(result.volatility, sd * Math.sqrt(252));
  near(result.sharpe, mean / sd * Math.sqrt(252));
  near(result.annualReturn, (result.finalEquity / config.capital) ** (252 / result.testedBars) - 1);
  assert.equal(runBacktest(data.slice(0, 8), config).annualReturn, null);
});

test('bands enter below lower band and exit at the mean, with no dependency on future bars', () => {
  const data = bars([10, 10, 10, 5, 5, 10, 10, 11]);
  const bandConfig = { ...config, kind: 'bands', bandWidth: 1 };
  const result = runBacktest(data, bandConfig);
  assert.equal(result.trades[0].date, data[4].timestamp);
  assert.equal(result.trades[1].date, data[6].timestamp);
  const prefix = runBacktest(data.slice(0, 6), bandConfig);
  assert.deepEqual(result.curve.slice(0, prefix.curve.length), prefix.curve);
});

test('invalid risk inputs fail before any trading occurs', () => {
  for (const changes of [{ positionPct: 0 }, { positionPct: 101 }, { lotSize: 7 }, { stopLossPct: -1 }, { takeProfitPct: NaN }, { bandWidth: 0 }, { liquidateEnd: 'yes' }]) {
    assert.throws(() => runBacktest(bars([1, 2, 3, 4, 5, 6]), { ...config, ...changes }));
  }
});

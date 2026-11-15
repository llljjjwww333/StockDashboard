import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configForStrategy, runBacktest, strategyDefaults, validateStrategyConfig } from '../src/terminal/backtest.ts';
import { strategySignals } from '../src/terminal/strategySignals.ts';
import { createPaperAccount, executePaperOrder, paperDecision, paperOrderQuantity, quoteExecutionIssue, sellableShares } from '../src/terminal/paperTrading.ts';
import { marketHours } from '../src/lib/marketCalendar.ts';

const now = new Date('2026-11-09T15:00:00Z');
const quote = { ticker: 'AAPL', price: 100, as_of: now.toISOString(), stale: false, source: 'fixture', delay_note: '免费源可能延迟，以报价时间为准' };
const near = (a, b) => assert(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
const bars = Array.from({ length: 300 }, (_, i) => {
  const close = i < 100 ? 100 + i : i < 200 ? 200 + Math.sin(i) * 10 : 200 - (i - 200);
  return { timestamp: new Date(Date.UTC(2025, 0, i + 1)).toISOString(), open: close, high: close + (i < 100 ? .3 : 3), low: close - (i < 100 ? .3 : 3), close, volume: 1000 };
});
test('adaptive strategy confirms regimes and switches to cash in a sustained downtrend', () => {
  const c = validateStrategyConfig(configForStrategy(strategyDefaults, 'adaptive'));
  const signals = strategySignals(bars, c);
  assert(signals.regimes.some(r => r.regime === 'trend'));
  assert(signals.regimes.some(r => r.regime === 'volatile'));
  assert.equal(signals.regimes.at(-1).regime, 'defensive');
  assert.equal(signals.regimes.at(-1).method, 'cash');
  assert.equal(signals.enter.at(-1), false);
  assert.equal(signals.exit.at(-1), true);
  const result = runBacktest(bars, c);
  assert.equal(result.regimes.length, result.curve.length);
  for (const row of result.regimes) assert.equal(row.method, signals.regimes[bars.findIndex(b => b.timestamp === row.date) - 1].method);
  const immediate = strategySignals(bars, { ...c, signalPeriod: 1 });
  const firstTrend = signals.regimes.findIndex(r => r.regime === 'trend');
  assert(firstTrend >= immediate.regimes.findIndex(r => r.regime === 'trend') + c.signalPeriod - 1);
});
test('adaptive methods accept AI rules, preserve mapping, and reject recursion and unknown methods', () => {
  const rules = { entry: { mode: 'all', conditions: [{ left: { indicator: 'close' }, operator: 'gt', right: { value: 0 } }] }, exit: { mode: 'all', conditions: [{ left: { indicator: 'close' }, operator: 'lt', right: { value: 0 } }] } };
  const config = configForStrategy({ ...strategyDefaults, kind: 'custom', rules }, 'adaptive');
  assert.equal(config.regimeMethods.trend, 'custom');
  const c = validateStrategyConfig(config);
  assert(runBacktest(bars, c).trades.length > 0);
  assert.deepEqual(configForStrategy(c, 'adaptive').regimeMethods, c.regimeMethods);
  assert.throws(() => validateStrategyConfig({ ...c, regimeMethods: { ...c.regimeMethods, trend: 'adaptive' } }));
  assert.throws(() => validateStrategyConfig({ ...c, regimeMethods: { ...c.regimeMethods, trend: 'fake' } }));
  const cash = { ...c, regimeMethods: { trend: 'cash', range: 'cash', volatile: 'cash', defensive: 'cash' } };
  assert.equal(runBacktest(bars, cash).trades.length, 0);
});
test('paper fills reconcile cash, costs, realized PnL and fees after partial sales', () => {
  const initial = createPaperAccount('AAPL', 'Apple', { ...strategyDefaults, capital: 10000, feeBps: 10, slippageBps: 20 }, now);
  const bought = executePaperOrder(initial, quote, 'buy', 20, 'manual', now);
  assert.equal(initial.shares, 0);
  near(bought.cost, 20 * 100.2 * 1.001);
  const sold = executePaperOrder(bought, { ...quote, price: 110 }, 'sell', 7, 'manual', now);
  assert.equal(sold.shares, 13);
  near(sold.cash + sold.shares * 110 - initial.config.capital, sold.realized + sold.shares * 110 - sold.cost);
  near(sold.fees, sold.fills.reduce((s, f) => s + f.fee, 0));
  assert.equal(sold.fills[1].quoteTime, quote.as_of);
  assert.throws(() => executePaperOrder(sold, quote, 'sell', 14, 'manual', now));
  assert.throws(() => executePaperOrder(sold, quote, 'buy', 100000, 'manual', now));
});
test('paper execution rejects stale, future, missing, mismatched and off-session quotes', () => {
  const account = createPaperAccount('AAPL', 'Apple', strategyDefaults, now);
  assert.equal(quoteExecutionIssue('AAPL', quote, now), '');
  for (const changed of [{ ...quote, stale: true }, { ...quote, price: NaN }, { ...quote, ticker: 'NVDA' }, { ...quote, as_of: undefined }, { ...quote, as_of: '2026-11-09T14:00:00Z' }, { ...quote, as_of: '2026-11-09T15:01:00Z' }]) assert.throws(() => executePaperOrder(account, changed, 'buy', 1, 'manual', now));
  assert.throws(() => executePaperOrder(account, quote, 'buy', 1, 'manual', new Date('2026-11-08T15:00:00Z')));
  assert.throws(() => executePaperOrder(account, quote, 'buy', .5, 'manual', now));
});
test('A-share accounts use round lots, T+1, and only sell settled holdings', () => {
  const cnNow = new Date('2026-11-09T02:00:00Z');
  const cnQuote = { ...quote, ticker: '600519', as_of: cnNow.toISOString() };
  const account = createPaperAccount('600519', 'stock', strategyDefaults, cnNow);
  assert.equal(account.config.lotSize, 100);
  assert.throws(() => executePaperOrder(account, cnQuote, 'buy', 1, 'manual', cnNow));
  const bought = executePaperOrder(account, cnQuote, 'buy', 100, 'manual', cnNow);
  assert.equal(sellableShares(bought, cnNow), 0);
  assert.throws(() => executePaperOrder(bought, cnQuote, 'sell', 100, 'manual', cnNow));
  const tomorrow = new Date('2026-11-10T02:00:00Z');
  const sold = executePaperOrder(bought, { ...cnQuote, as_of: tomorrow.toISOString() }, 'sell', 100, 'manual', tomorrow);
  assert.equal(sold.shares, 0);
  assert.equal(sold.lots.length, 0);
  assert.throws(() => createPaperAccount('SH000001', 'index', strategyDefaults, cnNow));
});
test('automatic allocation reserves fees and respects the configured position limit', () => {
  const a = createPaperAccount('AAPL', 'Apple', { ...strategyDefaults, positionPct: 50 }, now);
  const n = paperOrderQuantity(a, quote);
  const b = executePaperOrder(a, quote, 'buy', n, 'auto', now);
  assert(b.cash >= a.config.capital / 2);
});
test('paper signals exclude incomplete daily bars and require the previous session', () => {
  const a = createPaperAccount('AAPL', 'Apple', strategyDefaults, now);
  const history = [];
  for (let date = new Date('2026-05-01T00:00:00Z'); date < now; date.setUTCDate(date.getUTCDate() + 1)) {
    const day = date.toISOString().slice(0, 10);
    if (!marketHours('US', day)) continue;
    const close = 100 + history.length;
    history.push({ timestamp: date.toISOString(), open: close, high: close + 1, low: close - 1, close, volume: 100 });
  }
  const decision = paperDecision(a, history, now);
  assert.equal(decision.signal, '2026-11-06');
  assert.equal(decision.target, true);
  const poisoned = history.map(p => p.timestamp.startsWith('2026-11-09') ? { ...p, close: .1 } : p);
  assert.deepEqual(paperDecision(a, poisoned, now), decision);
  const weekend={...history[0],timestamp:'2026-11-01T00:00:00Z',open:10000,high:10001,low:9999,close:10000};
  assert.deepEqual(paperDecision(a,[...history,weekend],now),decision);
  assert.throws(() => paperDecision(a, history.filter(p => p.timestamp < '2026-11-06'), now));
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPortfolio, applyPortfolioTargets, portfolioEquity, portfolioUniverse, defaultMandate, migratePaperAccount } from '../src/terminal/portfolio.ts';
import { createPaperAccount, executePaperOrder } from '../src/terminal/paperTrading.ts';
import { strategyDefaults } from '../src/terminal/backtest.ts';
import { parsePortfolioReview } from '../src/terminal/portfolioReview.ts';
const now = new Date('2026-11-09T15:00:00Z');
const universe = ['AAPL', 'MSFT', 'NVDA'].map(ticker => ({ ticker, name: ticker, market: 'US' }));
const quotes = Object.fromEntries(universe.map(s => [s.ticker, { ticker: s.ticker, price: 100, volume: 1000, change_percent: 0, source: 'fixture', stale: false, as_of: now.toISOString() }]));
const targets = (weights) => Object.entries(weights).map(([ticker, weight_pct]) => ({ ticker, weight_pct, reason: '策略判断' }));
const near = (a, b) => assert(Math.abs(a - b) < 1e-7, `${a} != ${b}`);

test('portfolio starts with one fixed cash balance and no preselected stock or trades', () => {
  const p = createPortfolio('组合', 100000, 'US');
  assert.equal(p.cash, 100000); assert.equal(p.positions.length, 0); assert.equal(p.orders.length, 0);
  assert.equal(p.mode, 'ai'); assert.deepEqual(p.pool, []);
  const wait = applyPortfolioTargets(p, [], quotes, universe, now);
  assert.equal(wait.cash, p.capital); assert.equal(wait.orders.length, 0);
});
test('multiple stocks share one cash pool and reconcile equity with fees and PnL', () => {
  const initial = createPortfolio('组合', 100000, 'US');
  const p = applyPortfolioTargets(initial, targets({ AAPL: 30, MSFT: 30, NVDA: 20 }), quotes, universe, now);
  assert.equal(initial.positions.length, 0); assert.equal(p.positions.length, 3);
  assert(p.cash > 19000 && p.cash < 22000);
  assert(p.positions.every(h => h.shares <= 300));
  const pnl = p.positions.reduce((sum, h) => sum + h.shares * quotes[h.ticker].price - h.cost, 0);
  near(portfolioEquity(p, quotes) - p.capital, p.realized + pnl);
  near(p.fees, p.orders.reduce((sum, o) => sum + o.fill.fee, 0));
});
test('rotation sells before buying and never allocates separate initial capital to each asset', () => {
  const p = applyPortfolioTargets(createPortfolio('组合', 100000, 'US'), targets({ AAPL: 30, MSFT: 30 }), quotes, universe, now);
  const next = applyPortfolioTargets(p, targets({ AAPL: 0, MSFT: 20, NVDA: 30 }), quotes, universe, now);
  assert(!next.positions.some(h => h.ticker === 'AAPL'));
  const fills = next.orders.slice(p.orders.length);
  assert.equal(fills[0].side, 'sell'); assert.equal(fills.at(-1).side, 'buy');
  assert(next.cash >= 0); assert(portfolioEquity(next, quotes) < p.capital);
});
test('invalid model allocations, missing held positions and unknown securities do not execute', () => {
  const p = createPortfolio('组合', 100000, 'US');
  for (const plan of [targets({ AAPL: 31 }), targets({ BAD: 20 }), [...targets({ AAPL: 10 }), ...targets({ AAPL: 10 })], targets({ AAPL: 30, MSFT: 30, NVDA: 30 })]) assert.throws(() => applyPortfolioTargets(p, plan, quotes, universe, now));
  const invested = applyPortfolioTargets(p, targets({ AAPL: 30 }), quotes, universe, now);
  assert.throws(() => applyPortfolioTargets(invested, [], quotes, universe, now));
});
test('stale and off-session quotes create rejected orders without moving cash', () => {
  const p = createPortfolio('组合', 100000, 'US');
  const result = applyPortfolioTargets(p, targets({ AAPL: 30 }), { ...quotes, AAPL: { ...quotes.AAPL, stale: true } }, universe, now);
  assert.equal(result.cash, p.cash); assert.equal(result.positions.length, 0); assert.equal(result.orders[0].status, 'rejected');
  const closed = applyPortfolioTargets(p, targets({ AAPL: 30 }), quotes, universe, new Date('2026-11-08T15:00:00Z'));
  assert.equal(closed.positions.length, 0);
});
test('A-share T+1 rejections do not free fictitious cash for replacement buys', () => {
  const cnNow = new Date('2026-11-09T02:00:00Z');
  const cnUniverse = ['600519', '300059'].map(ticker => ({ ticker, name: ticker, market: 'CN' }));
  const cnQuotes = Object.fromEntries(cnUniverse.map(s => [s.ticker, { ...quotes.AAPL, ticker: s.ticker, as_of: cnNow.toISOString() }]));
  const p = createPortfolio('A股', 100000, 'CN', { ...defaultMandate, maxGross: 30 });
  const first = applyPortfolioTargets(p, targets({ '600519': 30 }), cnQuotes, cnUniverse, cnNow);
  const next = applyPortfolioTargets(first, targets({ '600519': 0, '300059': 30 }), cnQuotes, cnUniverse, cnNow);
  assert(next.positions.some(h => h.ticker === '600519'));
  assert(!next.positions.some(h => h.ticker === '300059'));
  assert(next.orders.slice(first.orders.length).every(o => o.status === 'rejected'));
  assert.equal(next.cash, first.cash);
});
test('currency-specific universe keeps every matching watchlist item and always includes held assets', () => {
  const p = createPortfolio('US', 100000, 'US');
  assert.equal(portfolioUniverse(p, [...universe, { ticker: '600519', name: 'CN', market: 'CN' }]).length, 3);
  const invested = applyPortfolioTargets(p, targets({ AAPL: 30 }), quotes, universe, now);
  invested.poolMode = 'custom'; invested.pool = [];
  assert.equal(portfolioUniverse(invested, []).at(0).ticker, 'AAPL');
});
test('legacy account migration preserves balances, actual fills, holdings and cost', () => {
  const old = executePaperOrder(createPaperAccount('AAPL', 'Apple', strategyDefaults, now), quotes.AAPL, 'buy', 100, 'legacy', now);
  const next = migratePaperAccount(old);
  assert.equal(next.cash, old.cash); assert.equal(next.positions[0].cost, old.cost); assert.equal(next.positions[0].shares, old.shares);
  assert.deepEqual(next.orders[0].fill, old.fills[0]); assert.equal(next.mode, 'rules');
});
test('malformed AI evidence and nonfinite targets are rejected by the client parser', () => {
  const r = { id: '1', reviewed_at: now.toISOString(), provider: 'fixture', model: 'fixture', decision: { regime: 'range', method: 'wait', summary: 'Wait', reconsider_when: 'Price confirmation', targets: [], evidence_ids: ['Q:AAPL'] }, evidence: [{ id: 'Q:AAPL', title: 'quote', source: 'fixture', timestamp: now.toISOString() }] };
  assert.equal(parsePortfolioReview(r).decision.targets.length, 0);
  assert.throws(() => parsePortfolioReview({ ...r, decision: { ...r.decision, evidence_ids: ['fake'] } }));
  assert.throws(() => parsePortfolioReview({ ...r, decision: { ...r.decision, targets: [{ ticker: 'AAPL', weight_pct: NaN, reason: 'bad' }] } }));
});

test('individual stock strategies use separate budgets without replacing other bindings', async () => {
  const { bindStockStrategy, applyStockTarget, executePortfolioOrder } = await import('../src/terminal/portfolio.ts');
  let p = createPortfolio('individual', 100000, 'US');
  const binding = (ticker, allocationPct) => ({ ticker, name: ticker, label: ticker + ' strategy', mode: 'rules', mandate: { ...defaultMandate, instrument: { ticker, name: ticker, market: 'US' } }, config: strategyDefaults, profileId: '', allocationPct, enabled: true });
  const a = binding('AAPL', 30), b = binding('MSFT', 40);
  p = bindStockStrategy(bindStockStrategy(p, a), b);
  assert.equal(p.bindings.length, 2);
  assert.throws(() => bindStockStrategy(p, binding('NVDA', 40)));
  p = applyStockTarget(p, a, 25, quotes, 'A entry', now);
  const aShares = p.positions.find(h => h.ticker === 'AAPL').shares;
  p = applyStockTarget(p, b, 20, quotes, 'B entry', now);
  assert.equal(p.positions.find(h => h.ticker === 'AAPL').shares, aShares);
  assert.equal(p.positions.length, 2); assert(p.cash >= 0);
  const bShares = p.positions.find(h => h.ticker === 'MSFT').shares;
  const manual = executePortfolioOrder(p, 'NVDA', 'buy', 10, quotes.NVDA, 'manual', 'Nvidia', p.config, now);
  assert.equal(manual.positions.length, 3);
  assert.equal(manual.positions.find(h => h.ticker === 'MSFT').shares, bShares);
  assert.equal(manual.bindings.length, 2);
  const exited = applyStockTarget(manual, a, 0, quotes, 'A exit', now);
  assert(!exited.positions.some(h => h.ticker === 'AAPL'));
  assert.equal(exited.positions.find(h => h.ticker === 'MSFT').shares, bShares);
  assert(exited.positions.some(h => h.ticker === 'NVDA'));
});

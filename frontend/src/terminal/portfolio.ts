import type { WatchlistStock } from '../store/stockStore';
import { instrumentMarket, isChinaEquity, isChinaIndex, isChinaTicker, isInstrumentTicker } from '../lib/instrumentIdentity.ts';
import { executePaperOrder, sellableShares, quoteExecutionIssue, type PaperAccount, type PaperFill } from './paperTrading.ts';
import { strategyDefaults, validateStrategyConfig, type StrategyConfig } from './backtest.ts';
import type { Quote } from './types';
import { positionMarkPrice } from './portfolioValuation.ts';
import { rebalanceQuantity } from './volatilityAllocation.ts';

export type Mandate = { sourceGoal?: string; goalMode?: 'generated'; summary?: string; execution?: StrategyConfig; executionGoal?: string; executionTicker?: string; revision?: number; instrument?: WatchlistStock; id: string; name: string; goal: string; maxSingle: number; maxGross: number; maxPositions: number; reviewMinutes: number; news: boolean };
export const defaultMandate: Mandate = { id: 'adaptive', name: 'AI 现货策略', goal: '根据该USDT现货交易对的行情、新闻和持仓，动态判断买卖时机与仓位，初始保持现金，仅在满足信号时交易。', maxSingle: 30, maxGross: 80, maxPositions: 5, reviewMinutes: 5, news: true };
export type PortfolioPosition = { ticker: string; name: string; shares: number; cost: number; lots: PaperAccount['lots']; lastPrice: number; lastQuoteAt?:string; lastQuoteSource?:string };
export type PortfolioOrder = { planReductionTargetShares?: number; planStage?: string; planKey?:string; strategy?: string; id: string; ticker: string; side: 'buy' | 'sell'; quantity: number; time: string; status: 'filled' | 'rejected'; reason: string; fill?: PaperFill };
export type PortfolioTarget = { ticker: string; weight_pct: number; reason: string };
export type PortfolioReview = { ruleKey?: string; ticker?: string; strategy?: string; id: string; reviewed_at: string; provider: string; model: string; decision: { regime: string; method: string; summary: string; reconsider_when: string; targets: PortfolioTarget[]; evidence_ids: string[] }; evidence: { id: string; title: string; source: string | null; timestamp: string }[]; execution?: string };
export type StockBinding = { ticker: string; name: string; label: string; mode: 'ai' | 'rules'; mandate: Mandate; config: StrategyConfig; profileId: string; allocationPct: number; enabled: boolean };
export type Portfolio = { bindings?: StockBinding[]; settingsVersion?: number; version: 2; id: string; name: string; market: 'CN' | 'US' | 'CRYPTO'; capital: number; cash: number; createdAt: string; positions: PortfolioPosition[]; fees: number; realized: number; orders: PortfolioOrder[]; reviews: PortfolioReview[]; curve: { time: string; equity: number }[]; poolMode: 'watchlist' | 'custom'; pool: WatchlistStock[]; mandate: Mandate; mode: 'ai' | 'rules'; profileId: string; config: StrategyConfig; strategyLabel: string; lastRulesDay?: string };
export function validMandate(value: Mandate) {
  if (!value || typeof value.id !== 'string' || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 80 || typeof value.goal !== 'string' || !value.goal.trim() || value.goal.length > 16000 || typeof value.news !== 'boolean' || !Number.isFinite(value.maxSingle) || value.maxSingle < 1 || value.maxSingle > 100 || !Number.isFinite(value.maxGross) || value.maxGross < 1 || value.maxGross > 100 || !Number.isInteger(value.maxPositions) || value.maxPositions < 1 || value.maxPositions > 20 || ![1, 5, 15, 30].includes(value.reviewMinutes)) throw new Error('请检查组合目标和仓位设置');
  if (value.instrument && (!isInstrumentTicker(value.instrument.ticker) || typeof value.instrument.name !== 'string' || !['CN','US','CRYPTO'].includes(value.instrument.market))) throw new Error('策略标的无效');
  if (value.execution) validateStrategyConfig(value.execution);
  if (value.summary !== undefined && (typeof value.summary !== 'string' || value.summary.length > 800)) throw new Error('策略说明无效');
  if (value.sourceGoal !== undefined && (typeof value.sourceGoal!=='string'||value.sourceGoal.length>16000)) throw new Error('原始策略目标无效');
  if (value.goalMode !== undefined && value.goalMode !== 'generated') throw new Error('策略目标来源无效');
  if (value.revision !== undefined && (!Number.isSafeInteger(value.revision) || value.revision < 1)) throw new Error('策略版本无效');
  return structuredClone(value);
}
export function createPortfolio(name: string, capital: number, market: 'CN' | 'US' | 'CRYPTO', mandate = defaultMandate): Portfolio {
  if (!Number.isFinite(capital) || capital < 100 || capital > 1e9 || !name.trim()) throw new Error('请填写账户名称和有效初始资金');
  return { bindings: [], version: 2, id: crypto.randomUUID(), name: name.trim().slice(0, 80), capital, cash: capital, market, createdAt: new Date().toISOString(), positions: [], fees: 0, realized: 0, orders: [], reviews: [], curve: [], poolMode: 'watchlist', pool: [], mandate: validMandate(mandate), mode: 'ai', profileId: '', config: { ...strategyDefaults }, strategyLabel: mandate.name };
}
export const portfolioEquity = (p: Portfolio, quotes: Record<string, Quote>) => p.cash + p.positions.reduce((s, h) => s + h.shares * positionMarkPrice(h,quotes[h.ticker]), 0);
export function portfolioUniverse(p: Portfolio, watchlist: WatchlistStock[]): WatchlistStock[] {
  const rows = [...(p.poolMode === 'watchlist' ? watchlist : p.pool), ...(p.bindings ?? []).map(b => ({ ticker: b.ticker, name: b.name, market: p.market })), ...p.positions.map(h => ({ ticker: h.ticker, name: h.name, market: p.market }))].filter(s => s.market === p.market && !isChinaIndex(s.ticker) && !s.ticker.startsWith('^'));
  return rows.filter((s, i) => rows.findIndex(n => n.ticker === s.ticker) === i);
}
export function positionAccount(p: Portfolio, ticker: string): PaperAccount {
  const h = p.positions.find(h => h.ticker === ticker);
  return { id: p.id, ticker, name: h?.name ?? ticker, createdAt: p.createdAt, config: validateStrategyConfig({ ...p.config, capital: p.capital, lotSize: p.market === 'CRYPTO' ? 0 : p.market === 'CN' ? 100 : 1 }), cash: p.cash, shares: h?.shares ?? 0, cost: h?.cost ?? 0, lots: h?.lots ?? [], fees: 0, realized: 0, fills: [], curve: [], lastSignal: '' };
}
export const portfolioSellable = (p: Portfolio, ticker: string, now: Date) => sellableShares(positionAccount(p, ticker), now);
export function applyPortfolioTargets(input: Portfolio, targets: PortfolioTarget[], quotes: Record<string, Quote>, universe: WatchlistStock[], now = new Date()): Portfolio {
  validMandate(input.mandate);
  const m = input.mandate, ids = new Set(targets.map(t => t.ticker));
  if (ids.size !== targets.length || targets.some(t => !universe.some(s => s.ticker === t.ticker) || !Number.isFinite(t.weight_pct) || t.weight_pct < 0 || t.weight_pct > m.maxSingle) || targets.reduce((s, t) => s + t.weight_pct, 0) > m.maxGross + 1e-8 || targets.filter(t => t.weight_pct > 0).length > m.maxPositions || input.positions.some(h => h.shares && !ids.has(h.ticker))) throw new Error('目标组合超出股票池或仓位限制');
  const p = structuredClone(input), equity = portfolioEquity(p, quotes);
  if (p.positions.some(h => !quotes[h.ticker] || quoteExecutionIssue(h.ticker, quotes[h.ticker], now))) throw new Error('等待持仓有效报价');
  const intents = targets.map(t => {
    const price = quotes[t.ticker]?.price, lot = p.market === 'CRYPTO' ? 1e-8 : p.market === 'CN' ? 100 : 1, holding = p.positions.find(h => h.ticker === t.ticker);
    const desired = price > 0 ? Math.floor(equity * t.weight_pct / 100 / price / lot + 1e-9) * lot : 0;
    const delta = desired - (holding?.shares ?? 0);
    return { t, delta: holding && t.weight_pct > 0 && Math.abs(delta) * price < equity * .005 ? 0 : delta };
  }).sort((a, b) => a.delta - b.delta);
  for (const { t, delta } of intents) {
    if (!delta) continue;
    const side = delta > 0 ? 'buy' : 'sell', q = quotes[t.ticker];
    let quantity = Math.abs(delta);
    try {
      const issue = quoteExecutionIssue(t.ticker, q, now);
      if (issue) throw new Error(issue);
      if (side === 'buy') {
        if (!p.positions.some(h => h.ticker === t.ticker && h.shares) && p.positions.filter(h => h.shares).length >= m.maxPositions) throw new Error('持仓数量达到上限');
        const eq = portfolioEquity(p, quotes), gross = eq - p.cash, currentValue = (p.positions.find(h => h.ticker === t.ticker)?.shares ?? 0) * q.price;
        const budget = Math.max(0, Math.min(p.cash, eq * m.maxGross / 100 - gross, eq * m.maxSingle / 100 - currentValue));
        const c = validateStrategyConfig(p.config), unit = p.market === 'CRYPTO' ? 1e-8 : p.market === 'CN' ? 100 : 1;
        quantity = Math.min(quantity, Math.floor(budget / (q.price * (1 + c.slippageBps / 10000) * (1 + c.feeBps / 10000)) / unit) * unit);
        if (!quantity) throw new Error('可用资金或仓位不足一个交易单位');
      } else {
        quantity = Math.min(quantity, portfolioSellable(p, t.ticker, now));
        if (!quantity) throw new Error(isChinaEquity(t.ticker) ? '等待 T+1 持仓可卖' : '可卖持仓不足');
      }
      const done = executePaperOrder(positionAccount(p, t.ticker), q, side, quantity, t.reason, now), fill = done.fills[0];
      p.cash = done.cash; p.fees += fill.fee; p.realized += fill.realized;
      p.positions = p.positions.filter(h => h.ticker !== t.ticker);
      if (done.shares) p.positions.push({ ticker: t.ticker, name: universe.find(s => s.ticker === t.ticker)?.name ?? t.ticker, shares: done.shares, cost: done.cost, lots: done.lots, lastPrice: q.price });
      p.orders.push({ id: fill.id, ticker: t.ticker, side, quantity, time: now.toISOString(), status: 'filled', reason: t.reason, fill });
    } catch (e) {
      p.orders.push({ id: crypto.randomUUID(), ticker: t.ticker, side, quantity, time: now.toISOString(), status: 'rejected', reason: e instanceof Error ? e.message : '委托失败' });
    }
  }
  return p;
}
export function migratePaperAccount(a: PaperAccount): Portfolio {
  const p = createPortfolio(a.name + ' · 旧账户', a.config.capital, isChinaTicker(a.ticker) ? 'CN' : 'US');
  Object.assign(p, { id: a.id, cash: a.cash, createdAt: a.createdAt, fees: a.fees, realized: a.realized, config: a.config, strategyLabel: a.strategyLabel || a.config.kind, mode: 'rules', poolMode: 'custom', pool: [{ ticker: a.ticker, name: a.name, market: p.market }], curve: a.curve });
  if (a.shares) p.positions.push({ ticker: a.ticker, name: a.name, shares: a.shares, cost: a.cost, lots: a.lots, lastPrice: a.cost / a.shares });
  p.bindings = [{ ticker: a.ticker, name: a.name, label: p.strategyLabel, mode: 'rules', mandate: { ...p.mandate, instrument: { ticker: a.ticker, name: a.name, market: p.market } }, config: p.config, profileId: '', allocationPct: 100, enabled: true }];
  p.orders = a.fills.map(fill => ({ id: fill.id, ticker: a.ticker, side: fill.side, quantity: fill.quantity, time: fill.time, status: 'filled', reason: fill.reason, fill }));
  return p;
}

export function bindStockStrategy(p: Portfolio, binding: StockBinding): Portfolio {
  if (!isInstrumentTicker(binding.ticker) || isChinaIndex(binding.ticker) || instrumentMarket(binding.ticker) !== p.market || !Number.isFinite(binding.allocationPct) || binding.allocationPct < 1 || binding.allocationPct > 100) throw new Error('请检查标的与资金比例');
  validMandate(binding.mandate); validateStrategyConfig(binding.config);
  if (binding.mandate.instrument && binding.mandate.instrument.ticker !== binding.ticker) throw new Error('策略与标的不一致');
  const others = (p.bindings ?? []).filter(b => b.ticker !== binding.ticker);
  if (others.reduce((s, b) => s + b.allocationPct, 0) + binding.allocationPct > 100 + 1e-8) throw new Error('策略资金比例合计不能超过100%');
  return { ...p, bindings: [...others, structuredClone(binding)] };
}
export function strategyAllocationAvailable(p: Portfolio, ticker: string) {
  return Math.max(0, 100 - (p.bindings ?? []).filter(b => b.ticker !== ticker).reduce((sum, b) => sum + b.allocationPct, 0));
}
export function bindingExecutionMode(binding: Pick<StockBinding, 'mode' | 'config'>): StockBinding['mode'] {
  return binding.config.plan || binding.config.allocation ? 'rules' : binding.mode;
}
export function strategyPositionLimit(binding: Pick<StockBinding, 'mode' | 'config' | 'mandate'>) {
  const limits = bindingExecutionMode(binding) === 'rules'
    ? [binding.config.positionPct ?? 100, binding.config.plan?.maxPositionPct ?? 100, ...(binding.mandate.execution ? [binding.mandate.maxSingle, binding.mandate.maxGross] : [])]
    : [binding.mandate.maxSingle, binding.mandate.maxGross];
  return limits.every(n => Number.isFinite(n) && n >= 0) ? Math.min(100, ...limits) : 0;
}
export function bindingPositionLimit(binding: Pick<StockBinding, 'mode' | 'config' | 'mandate' | 'allocationPct'>) {
  return Math.max(0, Math.min(binding.allocationPct, strategyPositionLimit(binding)));
}
export function detachStockStrategy(p: Portfolio, ticker: string): Portfolio {
  return { ...p, bindings: (p.bindings ?? []).filter(b => b.ticker !== ticker) };
}
export function executePortfolioOrder(input: Portfolio, ticker: string, side: 'buy' | 'sell', quantity: number, quote: Quote, reason: string, name = ticker, config = input.config, now = new Date()): Portfolio {
  const done = executePaperOrder(positionAccount({ ...input, config }, ticker), quote, side, quantity, reason, now), fill = done.fills[0];
  const positions = input.positions.filter(h => h.ticker !== ticker);
  if (done.shares) positions.push({ ticker, name, shares: done.shares, cost: done.cost, lots: done.lots, lastPrice: quote.price });
  return { ...input, cash: done.cash, fees: input.fees + fill.fee, realized: input.realized + fill.realized, positions, orders: [...input.orders, { id: fill.id, ticker, side, quantity, time: now.toISOString(), status: 'filled', reason, fill }] };
}
export function applyStockTarget(input: Portfolio, binding: StockBinding, weight: number, quotes: Record<string, Quote>, reason: string, now = new Date()): Portfolio {
  if (!Number.isFinite(weight) || weight < 0 || weight > bindingPositionLimit(binding) + 1e-8) throw new Error('目标仓位超过策略执行上限');
  const quote = quotes[binding.ticker], issue = quoteExecutionIssue(binding.ticker, quote, now);
  if (issue) throw new Error(issue);
  const equity = portfolioEquity(input, quotes), holding = input.positions.find(h => h.ticker === binding.ticker), unit = input.market === 'CRYPTO' ? 1e-8 : input.market === 'CN' ? 100 : 1;
  const currentWeight = (holding?.shares ?? 0) * quote.price / equity * 100, aboveLimit = currentWeight > bindingPositionLimit(binding) + 1e-8;
  // Staged targets can encode an exact partial-exit quantity or validated initial lot.
  const desired = Math.floor(equity * weight / 100 / quote.price / unit + 1e-9) * unit;
  const delta = binding.config.plan ? desired - (holding?.shares ?? 0) : rebalanceQuantity(input.cash, holding?.shares ?? 0, quote.price, weight,
    binding.config.feeBps, binding.config.slippageBps, unit, equity);
  if (binding.config.allocation && weight > 0 && !aboveLimit && Math.abs(weight - currentWeight) <= binding.config.allocation.rebalanceThresholdPct) return input;
  if (!delta || !binding.config.plan && !binding.config.allocation && holding && weight > 0 && !aboveLimit && Math.abs(delta) * quote.price < equity * .005) return input;
  const side = delta > 0 ? 'buy' : 'sell';
  let quantity = Math.abs(delta);
  const c = validateStrategyConfig(binding.config);
  if (side === 'buy') quantity = Math.min(quantity,
    Math.max(0, rebalanceQuantity(input.cash, holding?.shares ?? 0, quote.price, bindingPositionLimit(binding), c.feeBps, c.slippageBps, unit, equity)),
    Math.floor(input.cash / (quote.price * (1 + c.slippageBps / 10000) * (1 + c.feeBps / 10000)) / unit) * unit);
  else quantity = Math.min(quantity, portfolioSellable(input, binding.ticker, now));
  if (!quantity) throw new Error(side === 'buy' ? '可用资金不足' : '可卖持仓不足');
  const done = executePortfolioOrder(input, binding.ticker, side, quantity, quote, reason, binding.name, binding.config, now);
  done.orders[done.orders.length - 1].strategy = binding.label;
  return done;
}

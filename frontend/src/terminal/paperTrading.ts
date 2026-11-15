import { validateStrategyConfig, type StrategyConfig } from './backtest.ts';
import { strategySignals } from './strategySignals.ts';
import { getStrategy } from './strategyCatalog.ts';
import { isCryptoTicker, isChinaEquity, isChinaIndex, isChinaTicker } from '../lib/instrumentIdentity.ts';
import { marketPhase } from './marketSession.ts';
import { previousTradingDay, completedDailyBars } from './dailyHistory.ts';
import type { HistoryPoint, Quote } from './types';
import { annualizedLogVolatility, allocationWeight } from './volatilityAllocation.ts';

export type PaperFill = { id: string; time: string; side: 'buy' | 'sell'; quantity: number; price: number; fee: number; reason: string; source: string; quoteTime: string; cash: number; realized: number };
export type PaperAccount = {
  strategyLabel?: string;
  id: string; ticker: string; name: string; createdAt: string; config: StrategyConfig;
  cash: number; shares: number; cost: number; realized: number; fees: number;
  lots: { date: string; quantity: number }[]; fills: PaperFill[];
  curve: { time: string; equity: number }[]; lastSignal: string;
};
export const exchangeDay = (ticker: string, now: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: isCryptoTicker(ticker) ? 'UTC' : isChinaTicker(ticker) ? 'Asia/Shanghai' : 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
export function createPaperAccount(ticker: string, name: string, config: StrategyConfig, now = new Date()): PaperAccount {
  if (isChinaIndex(ticker)) throw new Error('请选择可交易证券');
  const c = validateStrategyConfig({ ...config, lotSize: isCryptoTicker(ticker) ? 0 : isChinaTicker(ticker) ? 100 : 1, startDate: '', endDate: '', liquidateEnd: false });
  return { id: crypto.randomUUID(), ticker, name, createdAt: now.toISOString(), config: c, cash: c.capital, shares: 0, cost: 0, realized: 0, fees: 0, lots: [], fills: [], curve: [], lastSignal: '' };
}
export function quoteExecutionIssue(ticker: string, quote: Quote | undefined, now: Date): string {
  if (marketPhase(ticker, now) !== '交易时段') return marketPhase(ticker, now);
  if (!quote || quote.ticker !== ticker || !Number.isFinite(quote.price) || quote.price <= 0) return '等待有效报价';
  const age = now.getTime() - Date.parse(quote.as_of ?? '');
  if (quote.stale || !Number.isFinite(age) || age < -5000 || age > 120000) return '等待新鲜报价';
  return '';
}
export function sellableShares(account: PaperAccount, now: Date) {
  return isChinaEquity(account.ticker) ? account.lots.filter(l => l.date < exchangeDay(account.ticker, now)).reduce((s, l) => s + l.quantity, 0) : account.shares;
}
export function executePaperOrder(account: PaperAccount, quote: Quote, side: 'buy' | 'sell', quantity: number, reason: string, now = new Date()): PaperAccount {
  const issue = quoteExecutionIssue(account.ticker, quote, now);
  if (issue) throw new Error(issue);
  const c = validateStrategyConfig(account.config), lot = c.lotSize || (isCryptoTicker(account.ticker) ? 1e-8 : 1);
  if (account.fills.length >= 10000) throw new Error('成交记录已满，请导出并创建新账户');
  if (!Number.isFinite(quantity) || quantity <= 0 || (!isCryptoTicker(account.ticker) && !Number.isSafeInteger(quantity)) || isCryptoTicker(account.ticker) && Math.abs(quantity*1e8-Math.round(quantity*1e8)) > 1e-5 || side === 'buy' && !isCryptoTicker(account.ticker) && quantity % lot !== 0) throw new Error('请检查委托数量');
  const price = quote.price * (1 + (side === 'buy' ? 1 : -1) * c.slippageBps / 10000);
  const fee = quantity * price * c.feeBps / 10000;
  if (side === 'buy' && quantity * price + fee > account.cash + 1e-8) throw new Error('可用资金不足');
  if (side === 'sell' && quantity > sellableShares(account, now) + 1e-8) throw new Error(isChinaEquity(account.ticker) ? '可卖数量不足（T+1）' : '可卖数量不足');
  const next = structuredClone(account), today = exchangeDay(account.ticker, now);
  const realized = side === 'sell' ? quantity * price - fee - account.cost * quantity / account.shares : 0;
  if (side === 'buy') {
    next.cash -= quantity * price + fee; next.cost += quantity * price + fee; next.shares += quantity;
    next.lots.push({ date: today, quantity });
  } else {
    next.cash += quantity * price - fee; next.cost *= 1 - quantity / account.shares; next.shares -= quantity;
    let remaining = quantity;
    for (const l of next.lots) {
      if (isChinaEquity(account.ticker) && l.date >= today) continue;
      const take = Math.min(remaining, l.quantity); l.quantity -= take; remaining -= take;
    }
    next.lots = next.lots.filter(l => l.quantity > 0);
  }
  next.cash = Math.max(0, next.cash); next.fees += fee; next.realized += realized;
  next.fills.push({ id: crypto.randomUUID(), time: now.toISOString(), side, quantity, price, fee, reason, source: quote.source ?? '', quoteTime: quote.as_of!, cash: next.cash, realized });
  return next;
}
export function paperDecision(account: PaperAccount, input: HistoryPoint[], now: Date) {
  const c = validateStrategyConfig(account.config), today = exchangeDay(account.ticker, now),previous=previousTradingDay(account.ticker,today);
  const bars = completedDailyBars(input,account.ticker,previous);
  if (bars.length <= getStrategy(c.kind)!.warmup(c)) throw new Error('日线预热数据不足');
  if (bars.at(-1)!.timestamp.slice(0, 10) !== previous) throw new Error('等待上一交易日日线');
  if (bars.some((p, i) => [p.open, p.high, p.low, p.close].some(n => !Number.isFinite(n) || n <= 0) || p.high < Math.max(p.open, p.close, p.low) || p.low > Math.min(p.open, p.close) || i > 0 && p.timestamp.slice(0, 10) === bars[i - 1].timestamp.slice(0, 10))) throw new Error('日线数据无效');
  const signals = strategySignals(bars, c), i = bars.length - 1;
  let target = account.shares > 0 ? !signals.exit[i] : signals.enter[i];
  let reason = '策略信号';
  if (account.shares > 0) {
    const change = bars[i].close / (account.cost / account.shares) - 1;
    if (c.stopLossPct > 0 && change <= -c.stopLossPct / 100) { target = false; reason = '收盘止损'; }
    else if (c.takeProfitPct > 0 && change >= c.takeProfitPct / 100) { target = false; reason = '收盘止盈'; }
  }
  const volatility = c.allocation ? annualizedLogVolatility(bars, c.allocation)[i] : null;
  const targetPct = c.allocation ? allocationWeight(target, volatility, c.allocation, c.positionPct) : target ? c.positionPct : 0;
  return { target, targetPct, reason, signal: bars[i].timestamp.slice(0, 10), regime: signals.regimes?.[i] };
}
export function paperOrderQuantity(account: PaperAccount, quote: Quote) {
  const c = validateStrategyConfig(account.config), lot = c.lotSize || (isCryptoTicker(account.ticker) ? 1e-8 : 1);
  return Math.floor(account.cash * c.positionPct / 100 / (quote.price * (1 + c.slippageBps / 10000) * (1 + c.feeBps / 10000)) / lot) * lot;
}

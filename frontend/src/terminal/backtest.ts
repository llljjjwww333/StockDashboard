import type { HistoryPoint } from './types';
import { getStrategy, defaultRegimeMethods, type Regime, type RegimeMethod, type StrategyKind } from './strategyCatalog.ts';
import { strategySignals } from './strategySignals.ts';
import { parseStrategyRules, rulesNeedVolume, type CustomStrategyRules } from './strategyRules.ts';
import { parseStagedPlan, stagedEvaluator, stagedPurchaseQuantity, type StagedPlan } from './stagedPlan.ts';

export type StrategyConfig = {
  sessionsPerYear?: number;
  regimeMethods?: Record<Regime, RegimeMethod>;
  kind: StrategyKind; fast: number; slow: number;
  capital: number; feeBps: number; slippageBps: number;
  positionPct?: number; stopLossPct?: number; takeProfitPct?: number;
  lotSize?: number; bandWidth?: number; startDate?: string; endDate?: string; liquidateEnd?: boolean;
  signalPeriod?: number; entryThreshold?: number; exitThreshold?: number; atrMultiplier?: number;
  adxThreshold?: number; volumeMultiplier?: number; momentumThreshold?: number;
  rules?: CustomStrategyRules | null;
  plan?: StagedPlan | null;
};
export const strategyDefaults: StrategyConfig = {
  sessionsPerYear: 252, kind: 'sma', fast: 5, slow: 20, capital: 100000, feeBps: 5, slippageBps: 5,
  positionPct: 100, stopLossPct: 0, takeProfitPct: 0, lotSize: 0, bandWidth: 2,
  startDate: '', endDate: '', liquidateEnd: false,
  signalPeriod: 9, entryThreshold: 30, exitThreshold: 70, atrMultiplier: 2,
  adxThreshold: 25, volumeMultiplier: 1.5, momentumThreshold: 0,
  rules: null, plan: null, regimeMethods: defaultRegimeMethods,
};
export type ExitReason = 'signal' | 'stop' | 'profit' | 'end';
export type StrategyTrade = {
  stage?: string; detail?: string;
  date: string; signalDate: string; side: 'buy' | 'sell'; reason: ExitReason;
  price: number; shares: number; fee: number; equity: number; cash: number;
};
export type ClosedTrade = {
  entryDate: string; exitDate: string; entryPrice: number; exitPrice: number; shares: number;
  pnl: number; returnPct: number; fees: number; sessions: number; reason: ExitReason;
};
export type BacktestResult = {
  entrySignals?: number; exitSignals?: number;
  regimes?: { date: string; regime: Regime; method: RegimeMethod }[];
  curve: { date: string; equity: number; benchmark: number; drawdown: number; exposure: number }[];
  trades: StrategyTrade[]; closed: ClosedTrade[];
  totalReturn: number; benchmarkReturn: number; maxDrawdown: number;
  annualReturn: number | null; volatility: number | null; sharpe: number | null;
  profitFactor: number | null; grossProfit: number; grossLoss: number;
  totalFees: number; averageExposure: number; averageHolding: number | null;
  monthly: { month: string; strategy: number; benchmark: number }[];
  finalEquity: number; cash: number; shares: number; unrealizedPnl: number;
  skippedEntries: number; warmupBars: number; testedBars: number;
  wins: number; closedTrades: number; invested: boolean; start: string; end: string; bars: number;
};
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

export function validateStrategyConfig(config: StrategyConfig) {
  if (config?.sessionsPerYear !== undefined && ![252,365].includes(config.sessionsPerYear)) throw new Error('年化日数无效');
  if (!config || typeof config !== 'object') throw new Error('策略配置无效。');
  const definition = getStrategy(config.kind);
  if (!definition) throw new Error('策略配置无效。');
  const c = { ...strategyDefaults, ...definition.defaults };
  for (const key of Object.keys(strategyDefaults) as (keyof StrategyConfig)[]) {
    if (Object.hasOwn(config, key)) Object.assign(c, { [key]: config[key] });
  }
  c.regimeMethods = { ...defaultRegimeMethods, ...c.regimeMethods };
  if (Object.keys(c.regimeMethods).length !== 4 || Object.values(c.regimeMethods).some(k => k !== 'cash' && (!getStrategy(k) || String(k) === 'adaptive'))) throw new Error('状态策略映射无效。');
  c.plan = c.kind === 'custom' && c.plan ? parseStagedPlan(c.plan) : null;
  c.rules = !c.plan && (c.kind === 'custom' || c.kind === 'adaptive' && Object.values(c.regimeMethods).includes('custom')) ? parseStrategyRules(c.rules) : null;
  if(c.plan && c.positionPct!==c.plan.maxPositionPct)throw new Error('分批计划与仓位上限不一致');
  if (!Number.isInteger(c.fast) || !Number.isInteger(c.slow) ||
      c.fast < 2 || c.fast > 199 || c.slow < 2 || (definition.orderedWindows && c.slow <= c.fast) || c.slow > 200 || !Number.isFinite(c.capital) || c.capital < 100 || c.capital > 1e9 ||
      !Number.isFinite(c.feeBps) || c.feeBps < 0 || c.feeBps > 100 ||
      !Number.isFinite(c.slippageBps) || c.slippageBps < 0 || c.slippageBps > 100) throw new Error('请检查参数：短周期至少为 2，长周期大于短周期且不超过 200。');
  for (const [value, min, max] of [[c.positionPct, 1, 100], [c.stopLossPct, 0, 100], [c.takeProfitPct, 0, 1000], [c.bandWidth, .1, 5]]) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min! || value > max!) throw new Error('仓位、止盈止损或通道参数无效。');
  }
  for (const p of definition.parameters) {
    const value = c[p.key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < p.min || value > p.max || p.step === 1 && !Number.isInteger(value)) throw new Error('策略参数超出范围。');
  }
  if (definition.parameters.some(p => p.key === 'entryThreshold') && c.entryThreshold! >= c.exitThreshold!) throw new Error('入场阈值必须小于离场阈值。');
  if (['signalPeriod', 'entryThreshold', 'exitThreshold', 'atrMultiplier', 'adxThreshold', 'volumeMultiplier', 'momentumThreshold'].some(key => !Number.isFinite(c[key as keyof StrategyConfig]))) throw new Error('策略参数超出范围。');
  if (![0, 1, 100].includes(c.lotSize!) || typeof c.liquidateEnd !== 'boolean' ||
      typeof c.startDate !== 'string' || typeof c.endDate !== 'string' ||
      c.startDate && !validDate(c.startDate) || c.endDate && !validDate(c.endDate) ||
      c.startDate && c.endDate && c.startDate > c.endDate) throw new Error('回测日期或交易单位无效。');
  return c as Required<StrategyConfig>;
}

export function configForStrategy(config: StrategyConfig, kind: StrategyKind): StrategyConfig {
  const definition = getStrategy(kind);
  if (!definition) throw new Error('策略配置无效。');
  const next = { ...strategyDefaults, ...definition.defaults, kind };
  if (kind === 'custom' || kind === 'adaptive') next.rules = config.rules ?? null;
  if (kind === 'custom') next.plan = config.plan ?? null;
  if (kind === 'adaptive' && config.kind === 'custom' && config.rules) next.regimeMethods = { ...defaultRegimeMethods, trend: 'custom' };
  else if (kind === 'adaptive' && config.kind === 'adaptive') next.regimeMethods = { ...defaultRegimeMethods, ...config.regimeMethods };
  for (const key of ['capital', 'feeBps', 'slippageBps', 'positionPct', 'stopLossPct', 'takeProfitPct', 'lotSize', 'startDate', 'endDate', 'liquidateEnd'] as const) {
    if (Object.hasOwn(config, key)) Object.assign(next, { [key]: config[key] });
  }
  return next;
}

// Signals use completed bars; execution uses the following open, including risk exits.
export function runBacktest(input: HistoryPoint[], config: StrategyConfig): BacktestResult {
  const c = validateStrategyConfig(config);
  const definition = getStrategy(c.kind)!;
  const warmup = definition.warmup(c);
  if (!Array.isArray(input) || input.some(p => !p || typeof p.timestamp !== 'string')) throw new Error('行情含无效价格或重复日期，无法回测。');
  const data = [...input].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  if (data.some((p, i) => !Number.isFinite(Date.parse(p.timestamp)) || !validDate(p.timestamp.slice(0, 10)) ||
      [p.open, p.high, p.low, p.close].some(n => !Number.isFinite(n) || n <= 0) ||
      p.high < Math.max(p.open, p.close, p.low) || p.low > Math.min(p.open, p.close) ||
      (i > 0 && p.timestamp.slice(0, 10) === data[i - 1].timestamp.slice(0, 10)))) throw new Error('行情含无效价格或重复日期，无法回测。');
  if ((c.plan || definition.volume || c.kind === 'adaptive' && Object.values(c.regimeMethods).some(k => getStrategy(k)?.volume || k === 'custom' && rulesNeedVolume(c.rules!)) || c.kind === 'custom' && c.rules && rulesNeedVolume(c.rules)) && data.some(p => !Number.isFinite(p.volume) || p.volume < 0)) throw new Error('该策略需要有效成交量。');
  if (data.length < warmup + 1) throw new Error('历史数据不足，请缩短周期或选择一年范围。');
  const requested = c.startDate ? data.findIndex(p => p.timestamp.slice(0, 10) >= c.startDate) : warmup;
  if (requested < 0) throw new Error('所选日期没有可回测数据。');
  if (requested < warmup) throw new Error('开始日期前的预热数据不足，请推迟开始日期或缩短周期。');
  const firstIndex = requested;
  const eligible = data.map((p, i) => ({ p, i })).filter(({ p, i }) => i >= firstIndex && (!c.endDate || p.timestamp.slice(0, 10) <= c.endDate));
  if (!eligible.length) throw new Error('所选日期没有可回测数据。');
  const feeRate = c.feeBps / 10000, slip = c.slippageBps / 10000;
  const units = (budget: number, price: number) => {
    const n = budget / (price * (1 + feeRate));
    return c.lotSize ? Math.floor(n / c.lotSize) * c.lotSize : n;
  };
  let cash = c.capital, shares = 0, peak = c.capital, maxDrawdown = 0, totalFees = 0, skippedEntries = 0;
  type Entry={date:string;price:number;cost:number;fee:number;index:number};
  let entry: Entry | null = null;
  const trades: StrategyTrade[] = [], closed: ClosedTrade[] = [], curve: BacktestResult['curve'] = [];
  const first = eligible[0].p;
  const benchmarkPrice = first.open * (1 + slip);
  const benchmarkShares = units(c.capital, benchmarkPrice);
  const benchmarkCash = c.capital - benchmarkShares * benchmarkPrice * (1 + feeRate);
  const signals = c.plan ? {enter:data.map(()=>false),exit:data.map(()=>false),regimes:undefined} : strategySignals(data, c);
  const staged = c.plan ? stagedEvaluator(data,c.plan) : null, usedStages=new Set<string>();
  let reduction:{stage:string;label:string;targetShares:number}|null=null;
  let stagedEntries=0,stagedExits=0;
  const regimes: NonNullable<BacktestResult['regimes']> = [];
  const sell = (p: HistoryPoint, i: number, rawPrice: number, reason: ExitReason, signalDate: string, quantity=shares, stage?:string, detail?:string) => {
    if (!entry || !shares) return;
    const qty=Math.min(quantity,shares);if(qty<=0)return;
    const fraction=qty/shares,allocatedCost=entry.cost*fraction,allocatedFee=entry.fee*fraction;
    const price = rawPrice * (1 - slip), fee = qty * price * feeRate;
    const proceeds = qty * price - fee;
    cash += proceeds; totalFees += fee;
    closed.push({ entryDate: entry.date, exitDate: p.timestamp, entryPrice: entry.price, exitPrice: price,
      shares:qty, pnl: proceeds - allocatedCost, returnPct: proceeds / allocatedCost - 1,
      fees: allocatedFee + fee, sessions: i - entry.index, reason });
    shares -= qty;
    trades.push({ date: p.timestamp, signalDate, side: 'sell', reason, price, shares:qty, fee, equity: cash+shares*rawPrice, cash,...(stage?{stage,detail}:{}) });
    if(shares<=1e-8){shares=0;entry=null;usedStages.clear();reduction=null;}else{entry.cost-=allocatedCost;entry.fee-=allocatedFee;}
  };
  for (const { p, i } of eligible) {
    const signal = i - 1, previous = data[signal];
    if (signals.regimes?.[signal]) regimes.push({ date: p.timestamp, ...signals.regimes[signal] });
    let target = shares > 0 ? !signals.exit[signal] : signals.enter[signal];
    let reason: ExitReason = 'signal';
    if(staged&&c.plan){
      const previousEquity=cash+shares*previous.close;
      let decision=staged.decide(signal,{positionPct:shares*previous.close/previousEquity*100,entryPrice:entry?.price??0,usedStages:[...usedStages]});
      if(reduction&&shares>reduction.targetShares+1e-8&&!decision?.urgent)decision={stage:reduction.stage,label:reduction.label,action:'reduce',value:1-reduction.targetShares/shares,urgent:false};
      if(decision){
        const openEquity=cash+shares*p.open;
        if(decision.action==='reduce'&&!reduction){const sellQty:number=c.lotSize?Math.floor(shares*decision.value/c.lotSize+1e-9)*c.lotSize:shares*decision.value;if(sellQty>0)reduction={stage:decision.stage,label:decision.label,targetShares:shares-sellQty};}
        const desired=decision.action==='reduce'?(reduction?.targetShares??shares):openEquity*Math.min(decision.value,c.plan.maxPositionPct)/100/p.open;
        const delta=desired-shares,cap=openEquity*c.plan.maxOrderPct/100;
        if(delta>1e-8){
          stagedEntries++;const price=p.open*(1+slip),qty=stagedPurchaseQuantity(c.plan,decision,openEquity,cash,shares,p.open,feeRate,slip,c.lotSize);
          if(qty>0){const fee=qty*price*feeRate,cost=qty*price+fee,oldShares=shares;
            shares+=qty;cash-=cost;totalFees+=fee;
            const priorEntry=entry as Entry|null;entry=priorEntry?{...priorEntry,price:(priorEntry.price*oldShares+price*qty)/shares,cost:priorEntry.cost+cost,fee:priorEntry.fee+fee}:{date:p.timestamp,price,cost,fee,index:i};
            usedStages.add(decision.stage);trades.push({date:p.timestamp,signalDate:previous.timestamp,side:'buy',reason:'signal',price,shares:qty,fee,equity:cash+shares*p.open,cash,stage:decision.stage,detail:decision.label});
          }else skippedEntries++;
        }else if(delta< -1e-8&&shares>0){
          stagedExits++;const wanted=decision.urgent&&c.plan.emergencyExitAll?shares:Math.min(-delta,cap/p.open);
          const qty=decision.urgent&&c.plan.emergencyExitAll?shares:c.lotSize?Math.floor(wanted/c.lotSize+1e-9)*c.lotSize:wanted;
          if(qty>0){sell(p,i,p.open,decision.stage==='stop'||decision.stage==='range-stop'?'stop':'signal',previous.timestamp,qty,decision.stage,decision.label);if(shares>0){if(decision.action!=='reduce'||!reduction||shares<=reduction.targetShares+1e-8){usedStages.add(decision.stage);reduction=null;}}}
        }
      }
    }
    if (entry && shares > 0) {
      const change = previous.close / entry.price - 1;
      if (c.stopLossPct > 0 && change <= -c.stopLossPct / 100) { target = false; reason = 'stop'; }
      else if (c.takeProfitPct > 0 && change >= c.takeProfitPct / 100) { target = false; reason = 'profit'; }
    }
    if (!staged && target && shares === 0) {
      const price = p.open * (1 + slip), qty = units(cash * c.positionPct / 100, price);
      if (qty > 0) {
        shares = qty;
        const fee = shares * price * feeRate, cost = shares * price + fee;
        cash -= cost; if (Math.abs(cash) < 1e-8) cash = 0;
        totalFees += fee; entry = { date: p.timestamp, price, cost, fee, index: i };
        trades.push({ date: p.timestamp, signalDate: previous.timestamp, side: 'buy', reason: 'signal', price, shares, fee, equity: cash + shares * p.open, cash });
      } else skippedEntries++;
    } else if (!staged && !target && shares > 0) sell(p, i, p.open, reason, previous.timestamp);
    const last = i === eligible[eligible.length - 1].i;
    if (last && c.liquidateEnd) sell(p, i, p.close, 'end', p.timestamp);
    const equity = cash + shares * p.close;
    peak = Math.max(peak, equity); maxDrawdown = Math.max(maxDrawdown, 1 - equity / peak);
    const benchmark = benchmarkCash + benchmarkShares * p.close * (last && c.liquidateEnd ? (1 - slip) * (1 - feeRate) : 1);
    if (![equity, benchmark].every(n => Number.isFinite(n) && n > 0)) throw new Error('行情价格尺度异常，无法可靠计算。');
    curve.push({ date: p.timestamp, equity, benchmark, drawdown: 1 - equity / peak, exposure: equity > 0 ? shares * p.close / equity : 0 });
  }
  const last = curve[curve.length - 1];
  const daily = curve.map((p, i) => p.equity / (i ? curve[i - 1].equity : c.capital) - 1);
  const average = daily.reduce((a, b) => a + b, 0) / daily.length;
  const stdev = daily.length > 1 ? Math.sqrt(daily.reduce((s, r) => s + (r - average) ** 2, 0) / (daily.length - 1)) : 0;
  if (!Number.isFinite(stdev) || !Number.isFinite(average)) throw new Error('行情价格尺度异常，无法可靠计算。');
  const grossProfit = closed.reduce((s, t) => s + Math.max(0, t.pnl), 0);
  const grossLoss = -closed.reduce((s, t) => s + Math.min(0, t.pnl), 0);
  const monthly: BacktestResult['monthly'] = [];
  let previousEquity = c.capital, previousBenchmark = c.capital;
  for (let i = 0; i < curve.length; i++) {
    const month = curve[i].date.slice(0, 7);
    if (i === curve.length - 1 || curve[i + 1].date.slice(0, 7) !== month) {
      monthly.push({ month, strategy: curve[i].equity / previousEquity - 1, benchmark: curve[i].benchmark / previousBenchmark - 1 });
      previousEquity = curve[i].equity; previousBenchmark = curve[i].benchmark;
    }
  }
  const annual = (last.equity / c.capital) ** (c.sessionsPerYear / curve.length) - 1;
  return { entrySignals: staged?stagedEntries:eligible.filter(({ i }) => signals.enter[i - 1]).length, exitSignals: staged?stagedExits:eligible.filter(({ i }) => signals.exit[i - 1]).length, curve, trades, closed, ...(regimes.length ? { regimes } : {}), totalReturn: last.equity / c.capital - 1, benchmarkReturn: last.benchmark / c.capital - 1,
    maxDrawdown, annualReturn: curve.length >= 20 && Number.isFinite(annual) ? annual : null,
    volatility: curve.length >= 20 ? stdev * Math.sqrt(c.sessionsPerYear) : null,
    sharpe: curve.length >= 20 && stdev > 1e-12 ? average / stdev * Math.sqrt(c.sessionsPerYear) : null,
    profitFactor: grossLoss ? grossProfit / grossLoss : null, grossProfit, grossLoss, totalFees,
    averageExposure: curve.reduce((s, p) => s + p.exposure, 0) / curve.length,
    averageHolding: closed.length ? closed.reduce((s, t) => s + t.sessions, 0) / closed.length : null,
    monthly, finalEquity: last.equity, cash, shares, unrealizedPnl: entry ? shares * data[eligible[eligible.length - 1].i].close - entry.cost : 0,
    skippedEntries, warmupBars: firstIndex, testedBars: curve.length,
    wins: closed.filter(t => t.pnl > 0).length, closedTrades: closed.length, invested: shares > 0,
    start: first.timestamp, end: last.date, bars: data.length };
}


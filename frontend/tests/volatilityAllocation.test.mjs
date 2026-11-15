import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { allocationWeight, annualizedLogVolatility, rebalanceQuantity, allocationExecutionDue } from '../src/terminal/volatilityAllocation.ts';
import { defaultMandate, createPortfolio, applyStockTarget } from '../src/terminal/portfolio.ts';
import { applyGeneratedStrategy, executableStrategy, strategyBacktestConfig } from '../src/terminal/strategyDefinition.ts';
import { strategyCapabilityIssues } from '../src/terminal/strategyCapabilities.ts';
import { runBacktest, validateStrategyConfig } from '../src/terminal/backtest.ts';
const fixture = JSON.parse(fs.readFileSync(new URL('../../backend/tests/fixtures/volatility_target_design.json', import.meta.url)));
const policy = fixture.proposal.execution.allocation;
const instrument = { ticker: 'BTCUSDT', name: 'Bitcoin / USDT', market: 'CRYPTO' };
const generated = () => applyGeneratedStrategy({ ...defaultMandate, goal: fixture.goal }, instrument, fixture.proposal);
function bars(count = 420) {
  return Array.from({ length: count }, (_, i) => {
    const close = 100 + i * .8 + Math.sin(i / 3) * 2;
    return { timestamp: new Date(Date.UTC(2025,0,1+i)).toISOString(), open: close - .2, high: close + 1, low: close - 1, close, volume: .1234 };
  });
}

test('full user table becomes exact editable rules, dynamic sizing, costs and dates', () => {
  assert.deepEqual(strategyCapabilityIssues(fixture.goal), []);
  const strategy = generated(), c = strategy.execution;
  assert(executableStrategy(strategy)); assert.equal(strategy.sourceGoal, fixture.goal);
  assert.deepEqual(c.rules.entry.conditions[0].right, { indicator: 'sma', period: 200, factor: 1.01 });
  assert.deepEqual(c.rules.entry.conditions[1].left, { indicator: 'momentum', period: 90 });
  assert.equal(c.rules.exit.mode, 'any'); assert.equal(c.rules.exit.conditions[0].operator, 'lte');
  assert.equal(c.positionPct, 45); assert.equal(c.allocation.targetVolPct, 10); assert.equal(c.allocation.period, 30);
  assert.equal(c.sessionsPerYear, 365); assert.equal(c.feeBps, 10); assert.equal(c.slippageBps, 5);
  assert.equal(c.stopLossPct, 0); assert.equal(c.takeProfitPct, 0);
  assert.equal(c.dataStartDate, '2017-08-17'); assert.equal(c.startDate, '2018-03-06');
  assert(!strategy.goal.includes('年化收益率8.0%')); assert.equal(c.plan, null);
  assert.deepEqual(validateStrategyConfig(JSON.parse(JSON.stringify(c))), c);
});

test('volatility-to-weight mapping matches every row and the gate permits all cash', () => {
  for (const [vol, expected] of [[.2,45],[.3,100/3],[.4,25],[.5,20],[.6,50/3],[.7,100/7],[.8,12.5],[1,10]]) {
    assert(Math.abs(allocationWeight(true,vol,policy,45)-expected)<1e-10);
    assert.equal(allocationWeight(false,vol,policy,45),0);
  }
  assert.equal(allocationWeight(true,0,policy,45),45);
  assert.equal(allocationWeight(true,null,policy,45),0);
});

test('sigma uses the trailing log returns and the selected sample/population divisor', () => {
  const returns = [.1,-.05,.02], close = [100];
  returns.forEach(r => close.push(close.at(-1)*Math.exp(r)));
  const data = close.map(c => ({ close:c })), mean = returns.reduce((a,b)=>a+b)/3;
  const expected = Math.sqrt(returns.reduce((sum,r)=>sum+(r-mean)**2,0)/2*365);
  const sample = annualizedLogVolatility(data,{...policy,period:3});
  assert.deepEqual(sample.slice(0,3),[null,null,null]); assert(Math.abs(sample[3]-expected)<1e-12);
  const population = annualizedLogVolatility(data,{...policy,period:3,ddof:0})[3];
  assert(Math.abs(population/expected-Math.sqrt(2/3))<1e-12);
});

test('post-cost sizing reaches the target on both buys and sells without borrowing', () => {
  for (const [cash,shares,target] of [[100000,0,45],[50000,500,25],[1000,10,0]]) {
    const mark = 100, delta = rebalanceQuantity(cash,shares,mark,target,10,5);
    const executed = mark*(delta>0?1.0005:.9995), fee=Math.abs(delta)*executed*.001;
    const nextCash=cash-delta*executed-fee, nextShares=shares+delta;
    assert(nextCash>=-1e-8); assert(nextShares>=-1e-8);
    assert(Math.abs(nextShares*mark/(nextCash+nextShares*mark)*100-target)<1e-9);
  }
});

test('daily rebalance uses yesterday signal and volatility; future bars cannot change earlier fills', () => {
  const strategy=generated(), data=bars(), config={...strategy.execution,startDate:'',endDate:'',dataStartDate:'',dataEndDate:''};
  const result=runBacktest(data,config);
  assert.equal(result.warmupBars,200); assert(result.trades.length>150);
  assert(result.trades.some((trade,i)=>i&&trade.side===result.trades[i-1].side));
  for(const trade of result.trades)assert(Date.parse(trade.signalDate)<Date.parse(trade.date));
  const changed=data.map((p,i)=>i<320?p:{...p,open:p.open*2,high:p.high*2,low:p.low*2,close:p.close*2});
  const next=runBacktest(changed,config),cutoff=data[320].timestamp;
  assert.deepEqual(result.trades.filter(t=>t.date<cutoff),next.trades.filter(t=>t.date<cutoff));
  assert.deepEqual(result.curve.slice(0,120),next.curve.slice(0,120));
  const first=result.trades[0], point=data.find(p=>p.timestamp===first.date);
  assert(first.shares*point.open/first.equity<=.45+1e-10);
});

test('unsupported or missing allocation cannot silently become the fixed SMA20 default', () => {
  const bad=structuredClone(fixture.proposal);delete bad.execution.allocation;
  assert.throws(()=>applyGeneratedStrategy({...defaultMandate,goal:fixture.goal},instrument,bad),/动态仓位/);
  const strategy=generated();assert.throws(()=>strategyBacktestConfig({...strategy,goal:'目标波动率已改变'},{}),/修改/);
});

test('strict paper rebalancing does not suppress a valid change smaller than half a percent', () => {
  const strategy=generated(),account=createPortfolio('fixture',100000,'CRYPTO',strategy);
  const binding={ticker:'BTCUSDT',name:'BTC',label:strategy.name,mode:'rules',mandate:strategy,config:strategy.execution,allocationPct:45,enabled:true,profileId:''};
  const now=new Date('2026-11-15T00:00:10Z');
  const quote={ticker:'BTCUSDT',price:100,volume:1,change_percent:0,as_of:now.toISOString(),source:'fixture'};
  const bought=applyStockTarget(account,binding,45,{BTCUSDT:quote},'rebalance',now);
  assert.equal(bought.orders.length,1);
  const changed={...quote,price:100.01};
  const adjusted=applyStockTarget(bought,binding,45,{BTCUSDT:changed},'rebalance',now);
  assert.equal(adjusted.orders.length,2);assert.equal(adjusted.orders.at(-1).side,'sell');
  assert(allocationExecutionDue(now));assert(!allocationExecutionDue(new Date('2026-11-15T00:01:00Z')));
  assert(!allocationExecutionDue(new Date('2026-11-15T12:00:00Z')));
});

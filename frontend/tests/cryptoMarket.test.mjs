import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isCryptoTicker, instrumentMarket } from '../src/lib/instrumentIdentity.ts';
import { marketPhase } from '../src/terminal/marketSession.ts';
import { completedDailyBars, completedDailyCutoff, previousTradingDay } from '../src/terminal/dailyHistory.ts';
import { createPaperAccount, executePaperOrder, sellableShares, exchangeDay } from '../src/terminal/paperTrading.ts';
import { createPortfolio, applyPortfolioTargets, portfolioEquity } from '../src/terminal/portfolio.ts';
import { manualOrderDetails } from '../src/terminal/manualOrder.ts';
import { strategyBacktestConfig } from '../src/terminal/strategyDefinition.ts';
import { strategyDefaults, runBacktest } from '../src/terminal/backtest.ts';
import { readCryptoDeskRoute } from '../src/terminal/deskRoute.ts';
import { pricePrecision } from '../src/lib/pricePrecision.ts';
import { volumeUnit, formatVolume } from '../src/lib/volumePresentation.ts';
import { buildChartLayout } from '../src/terminal/chartLayout.ts';

const now = new Date('2026-11-08T02:00:00Z'); // Sunday, Shanghai morning.
const quote = { ticker:'BTCUSDT', price:75000, as_of:now.toISOString(), fetched_at:now.toISOString(), stale:false, source:'Controlled Binance', volume:.234, change_percent:1 };

test('crypto minute plots retain all 24 hours and never collapse prices into stock-market hours', () => {
  const bars=Array.from({length:1441},(_,i)=>({timestamp:new Date(Date.UTC(2026,10,7,3,0)+i*60000).toISOString()}));
  const layout=buildChartLayout(bars,'BTCUSDT',true,10,1010);
  assert.equal(layout.positions[0],10); assert.equal(layout.positions.at(-1),1010);
  assert.equal(new Set(layout.positions).size,1441); assert.equal(layout.breaks.size,0);
  assert.equal(layout.sessions[0].date,'2026-11-07');
});

test('crypto is active on weekends and uses UTC calendar days without equity holiday gaps', () => {
  assert(isCryptoTicker('BTCUSDT')); assert.equal(instrumentMarket('BTCUSDT'),'CRYPTO');
  assert.equal(marketPhase('BTCUSDT', now),'交易时段'); assert.equal(exchangeDay('BTCUSDT',now),'2026-11-08');
  assert.equal(previousTradingDay('BTCUSDT','2026-11-09'),'2026-11-08');
  assert.equal(completedDailyCutoff('BTCUSDT',now,now.toISOString()),'2026-11-07');
  const input=['2026-11-06','2026-11-07','2026-11-08'].map(day=>({timestamp:day+'T00:00:00Z',open:1,high:1,low:1,close:1,volume:.1}));
  assert.deepEqual(completedDailyBars(input,'BTCUSDT','2026-11-07').map(p=>p.timestamp.slice(0,10)),['2026-11-06','2026-11-07']);
});

test('fractional spot buy and same-day full sell reconcile balance and fees without T+1', () => {
  const account=createPaperAccount('BTCUSDT','Bitcoin', {...strategyDefaults,capital:1000,feeBps:10,slippageBps:0},now);
  const buy=executePaperOrder(account,quote,'buy',.001,'test',now);
  assert.equal(buy.shares,.001); assert.equal(buy.cash,924.925); assert.equal(sellableShares(buy,now),.001);
  const sell=executePaperOrder(buy,quote,'sell',.001,'test',now);
  assert.equal(sell.shares,0); assert.equal(sell.lots.length,0); assert(Math.abs(sell.cash-999.85)<1e-8);
  assert.throws(()=>executePaperOrder(account,quote,'buy',.000000001,'test',now),/委托数量/);
});

test('spot portfolio targets buy fractional BTC and can be cleared in the same session', () => {
  const p=createPortfolio('Crypto',1000,'CRYPTO'), universe=[{ticker:'BTCUSDT',name:'Bitcoin',market:'CRYPTO'}];
  p.config={...strategyDefaults,feeBps:0,slippageBps:0};
  const bought=applyPortfolioTargets(p,[{ticker:'BTCUSDT',weight_pct:7,reason:'signal'}],{BTCUSDT:quote},universe,now);
  assert(bought.positions[0].shares>0 && bought.positions[0].shares<1);
  assert(Math.abs(portfolioEquity(bought,{BTCUSDT:quote})-1000)<1e-8);
  const sold=applyPortfolioTargets(bought,[{ticker:'BTCUSDT',weight_pct:0,reason:'stop'}],{BTCUSDT:quote},universe,now);
  assert.equal(sold.positions.length,0); assert(Math.abs(sold.cash-1000)<1e-8);
});

test('manual tickets accept coin fractions, retain tiny coin prices and label coin volume', () => {
  const p=createPortfolio('Crypto',1000,'CRYPTO');
  const order=manualOrderDetails(p,'BTCUSDT','buy',.001,quote,now);
  assert.equal(order.error,''); assert(order.amount>75); assert.equal(order.unit,1e-8);
  assert.match(manualOrderDetails(p,'BTCUSDT','buy',1e-9,quote,now).error,/8位/);
  assert.equal(pricePrecision('PEPEUSDT',.00001352),8); assert.equal(volumeUnit('CRYPTO','zh-CN'),'币');
  assert.equal(formatVolume(.23,'CRYPTO','en-US'), '0.23 coins');
});

test('crypto-only links ignore old equity instruments while retaining the requested page', () => {
  const old=readCryptoDeskRoute(new URLSearchParams('view=strategy&market=CN&ticker=920117'));
  assert.equal(old.market,'CRYPTO'); assert.equal(old.ticker,null); assert.equal(old.view,'strategy');
  const crypto=readCryptoDeskRoute(new URLSearchParams('ticker=ethusdt&period=1y'));
  assert.equal(crypto.ticker,'ETHUSDT'); assert.equal(crypto.market,'CRYPTO'); assert.equal(crypto.chart.period,'1y');
});

test('crypto research uses fractional sizing, 365-day annualization and causal daily fills', () => {
  const execution={...strategyDefaults,fast:2,slow:3};
  const strategy={execution,instrument:{ticker:'BTCUSDT',name:'Bitcoin',market:'CRYPTO'},goal:'trend',executionGoal:'trend',executionTicker:'BTCUSDT',maxSingle:25};
  const c=strategyBacktestConfig(strategy,{capital:1000,feeBps:0,slippageBps:0,startDate:'',endDate:'',lotSize:1,liquidateEnd:false});
  assert.equal(c.lotSize,0); assert.equal(c.sessionsPerYear,365);
  const bars=Array.from({length:40},(_,i)=>({timestamp:new Date(Date.UTC(2026,8,i+1)).toISOString(),open:75000+i*100,high:75001+i*100,low:74999+i*100,close:75000+i*100,volume:.13}));
  const result=runBacktest(bars,c); assert(result.trades[0].shares<1); assert(result.trades[0].shares>0);
  assert(Math.abs(result.annualReturn-((1+result.totalReturn)**(365/result.testedBars)-1))<1e-8);
});

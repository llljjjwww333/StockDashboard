import fs from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPortfolio,defaultMandate,bindStockStrategy,bindingExecutionMode,bindingPositionLimit,strategyPositionLimit,applyStockTarget,portfolioEquity,executePortfolioOrder} from '../src/terminal/portfolio.ts';
import {strategyDefaults} from '../src/terminal/backtest.ts';
const now=new Date('2026-11-15T13:00:00Z');
const quote={ticker:'BTCUSDT',price:100,volume:10000,change_percent:0,source:'fixture',as_of:now.toISOString()};
const quotes={BTCUSDT:quote};
const setup=(changes={})=>{
 const binding={ticker:'BTCUSDT',name:'BTC',label:'cap-test',mode:'rules',mandate:{...defaultMandate,maxSingle:20,maxGross:20},config:{...strategyDefaults,positionPct:20,feeBps:10,slippageBps:5},profileId:'',allocationPct:60,enabled:true,...changes};
 return {binding,account:bindStockStrategy(createPortfolio('caps',100000,'CRYPTO'),binding)};
};
const weight=p=>(p.positions[0]?.shares??0)*quote.price/portfolioEquity(p,quotes)*100;
const policy={method:'volatility_target',period:30,targetVolPct:10,minPositionPct:0,annualization:365,ddof:1,rebalanceThresholdPct:10};

test('binding budget and saved rule cap both limit exposure while legacy bindings remain readable',()=>{
 const {binding,account}=setup();assert.equal(bindingPositionLimit(binding),20);assert.equal(account.bindings[0].allocationPct,60);
 assert.equal(bindingPositionLimit({...binding,allocationPct:10}),10);
 assert.throws(()=>applyStockTarget(account,binding,60,quotes,'oversized',now),/执行上限/);
 const bought=applyStockTarget(account,binding,20,quotes,'entry',now);assert(weight(bought)<=20+1e-8);assert(weight(bought)>19.999);
});

test('AI limit respects both saved single-asset and gross constraints',()=>{
 const {binding,account}=setup({mode:'ai',mandate:{...defaultMandate,maxSingle:30,maxGross:18}});
 assert.equal(strategyPositionLimit(binding),18);assert.equal(bindingPositionLimit(binding),18);
 assert.throws(()=>applyStockTarget(account,binding,20,quotes,'oversized AI',now),/执行上限/);
});

test('staged and volatility policies keep rule execution even on old AI-labelled bindings',()=>{
 const {binding}=setup();
 for(const config of [{...binding.config,plan:{maxPositionPct:15}},{...binding.config,allocation:policy}]){
  const legacy={...binding,mode:'ai',config};assert.equal(bindingExecutionMode(legacy),'rules');
  assert.equal(bindingPositionLimit(legacy),config.plan?15:20);
 }
 assert.equal(bindingExecutionMode({...binding,mode:'ai'}),'ai');
});

test('normal rule buys include trading costs in the target NAV and cash never becomes negative',()=>{
 const {binding,account}=setup({allocationPct:45,config:{...strategyDefaults,positionPct:45,feeBps:100,slippageBps:100}});
 const bought=applyStockTarget(account,binding,45,quotes,'entry',now);
 assert(bought.cash>=0);assert(weight(bought)<=45+1e-8);assert(weight(bought)>44.99999);
 const exit=applyStockTarget(bought,binding,0,quotes,'clear',now);
 assert.equal(exit.positions.length,0);assert.equal(exit.orders.at(-1).side,'sell');
});

test('cash signals exit all holdings even when the allocation rebalance threshold is larger than exposure',()=>{
 const {binding,account}=setup({allocationPct:20,config:{...strategyDefaults,positionPct:20,allocation:policy}});
 const holding=executePortfolioOrder(account,'BTCUSDT','buy',40,quote,'manual','BTC',binding.config,now);
 assert(weight(holding)<10);
 const exited=applyStockTarget(holding,binding,0,quotes,'signal failed',now);
 assert.equal(exited.positions.length,0);assert.equal(exited.orders.at(-1).quantity,40);
});

test('exposure above the saved cap is reduced even inside ordinary drift and allocation thresholds',()=>{
 for(const allocation of [null,policy]){
  const {binding,account}=setup({config:{...strategyDefaults,positionPct:20,allocation}});
  const holding=executePortfolioOrder(account,'BTCUSDT','buy',201,quote,'manual','BTC',binding.config,now);
  assert(weight(holding)>20);
  const reduced=applyStockTarget(holding,binding,20,quotes,'cap',now);
  assert.equal(reduced.orders.at(-1).side,'sell');assert(weight(reduced)<20.000001);
 }
});

test('staged share quantities stay exact while new buys remain inside the cost-adjusted cap',()=>{
 const plan=JSON.parse(fs.readFileSync(new URL('../../backend/tests/fixtures/staged_plan.json',import.meta.url),'utf8'));
 const {binding,account}=setup({allocationPct:60,config:{...strategyDefaults,kind:'custom',rules:null,plan,positionPct:25,feeBps:100,slippageBps:100}});
 const bought=applyStockTarget(account,binding,7,quotes,'validated initial quantity',now);
 assert.equal(bought.orders[0].quantity,70);
 const equity=portfolioEquity(bought,quotes),trimTarget=35*quote.price/equity*100;
 const trimmed=applyStockTarget(bought,binding,trimTarget,quotes,'half the held shares',now);
 assert.equal(trimmed.orders.at(-1).quantity,35);assert.equal(trimmed.positions[0].shares,35);
 const capped=applyStockTarget(account,binding,25,quotes,'entry at cap',now);
 assert(weight(capped)<=25.000001);
});

test('old generated snapshots cannot bypass their saved mandate cap with a larger execution field',()=>{
 const {binding}=setup({config:{...strategyDefaults,positionPct:100},mandate:{...defaultMandate,maxSingle:20,maxGross:18,execution:{...strategyDefaults,positionPct:100}}});
 assert.equal(bindingPositionLimit(binding),18);
});

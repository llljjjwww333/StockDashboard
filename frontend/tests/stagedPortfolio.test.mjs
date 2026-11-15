import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {stagedHoldingState,stagedPortfolioDecision} from '../src/terminal/stagedPortfolio.ts';
import {strategyDefaults} from '../src/terminal/backtest.ts';
import {defaultMandate,createPortfolio,bindStockStrategy,applyStockTarget} from '../src/terminal/portfolio.ts';
const plan=JSON.parse(fs.readFileSync(new URL('../../backend/tests/fixtures/staged_plan.json',import.meta.url),'utf8'));
const setup=()=>{
 const config={...strategyDefaults,kind:'custom',plan,rules:null,positionPct:25};
 const mandate={...defaultMandate,id:'staged',instrument:{ticker:'AAPL',name:'Apple',market:'US'},maxSingle:25};
 const binding={ticker:'AAPL',name:'Apple',label:'staged',mode:'rules',config,mandate,profileId:'',allocationPct:25,enabled:true};
 return {binding,account:bindStockStrategy(createPortfolio('Test',100000,'US',mandate),binding)};
};
test('stage use and weighted entry prices are reconstructed from actual fills, not unexecuted reviews',()=>{
 const {account,binding}=setup(),key=JSON.stringify(plan);
 const order=(side,quantity,price,stage)=>({ticker:'AAPL',status:'filled',side,quantity,fill:{price},planStage:stage,planKey:key});
 account.orders=[order('buy',100,20,'initial'),order('buy',100,30,'breakout'),order('sell',100,30,'trim-ma')];
 account.positions=[{ticker:'AAPL',name:'Apple',shares:100,cost:2500,lastPrice:30,lots:[]}];
 const state=stagedHoldingState(account,binding);assert.equal(state.entryPrice,25);assert.deepEqual(state.usedStages,['initial','breakout','trim-ma']);
 account.orders.push(order('sell',100,30,'clear'));account.positions=[];assert.deepEqual(stagedHoldingState(account,binding).usedStages,[]);
});
test('live rules use the previous completed session, do not create opening trades on bearish waiting data',()=>{
 const {account,binding}=setup(),now=new Date('2026-11-09T15:00:00Z');
 const data=[];for(let d=new Date('2026-06-01T00:00:00Z');d<new Date('2026-11-07T00:00:00Z');d.setUTCDate(d.getUTCDate()+1)){if([0,6].includes(d.getUTCDay()))continue;const c=30-data.length*.05;data.push({timestamp:d.toISOString(),open:c,close:c,high:c+.02,low:c-.02,volume:1000});}
 const result=stagedPortfolioDecision(account,binding,data,{AAPL:{ticker:'AAPL',price:24,volume:1000,change_percent:0}},now);
 assert.equal(result.signal,'2026-11-06');assert.equal(result.decision,null);assert.equal(result.target,0);
});

test('a capped reduction resumes toward the original half-position instead of halving the remainder again',()=>{
 const {account,binding}=setup(),key=JSON.stringify(plan),order=(side,quantity,price,stage,target)=>({ticker:'AAPL',status:'filled',side,quantity,fill:{price},planStage:stage,planKey:key,planReductionTargetShares:target});
 account.orders=[order('buy',1000,24,'breakout'),order('sell',400,24,'trim-ma',500)];account.positions=[{ticker:'AAPL',name:'Apple',shares:600,cost:14400,lastPrice:24,lots:[]}];
 const state=stagedHoldingState(account,binding);assert.deepEqual(state.pendingReduction,{stage:'trim-ma',targetShares:500});assert(!state.usedStages.includes('trim-ma'));
 account.orders.push(order('sell',100,24,'trim-ma',500));account.positions[0].shares=500;
 const done=stagedHoldingState(account,binding);assert.equal(done.pendingReduction,null);assert(done.usedStages.includes('trim-ma'));
});

test('a small remaining staged reduction is executed instead of being discarded as rebalance drift',()=>{
 const {account,binding}=setup();account.capital=1000000;account.cash=976000;account.positions=[{ticker:'AAPL',name:'Apple',shares:1000,cost:24000,lastPrice:24,lots:[{date:'2026-11-06',quantity:1000}]}];
 const now=new Date('2026-11-09T15:00:00Z'),quote={ticker:'AAPL',price:24,volume:1000,change_percent:0,source:'Controlled',as_of:now.toISOString(),stale:false};
 const next=applyStockTarget(account,binding,2.16,{AAPL:quote},'完成本轮减仓',now);
 assert.equal(next.positions[0].shares,900);assert.equal(next.orders[0].quantity,100);
});

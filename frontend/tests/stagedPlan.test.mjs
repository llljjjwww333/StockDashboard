import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseStagedPlan,stagedEvaluator,stagedWarmup} from '../src/terminal/stagedPlan.ts';
import {runBacktest,strategyDefaults,validateStrategyConfig} from '../src/terminal/backtest.ts';
import {applyGeneratedStrategy,executableStrategy} from '../src/terminal/strategyDefinition.ts';
import {defaultMandate} from '../src/terminal/portfolio.ts';
const saved=JSON.parse(fs.readFileSync(new URL('../../backend/tests/fixtures/staged_plan.json',import.meta.url),'utf8'));
const plan=changes=>parseStagedPlan({...saved,...changes});
const bars=(closes,volumes=[])=>closes.map((c,i)=>({timestamp:new Date(Date.UTC(2026,0,i+1)).toISOString(),open:c,high:c+.05,low:c-.05,close:c,volume:volumes[i]??1000}));
const config=p=>({...strategyDefaults,kind:'custom',plan:p,rules:null,positionPct:p.maxPositionPct,stopLossPct:p.stopLossPct});

test('the supplied goal fills distinct periods, actual thresholds and staged allocation without changing its text',()=>{
 const goal=fs.readFileSync(new URL('../../backend/tests/fixtures/strategy_goal_920117.txt',import.meta.url),'utf8'),p=plan();
 const original={...defaultMandate,id:'input',goal,instrument:{ticker:'920117',name:'龙鑫智能',market:'CN'}};
 const next=applyGeneratedStrategy(original,original.instrument,{name:'分批',goal,summary:'解析',max_single_pct:25,review_minutes:30,news:true,execution:{plan:p,stop_loss_pct:8,take_profit_pct:0}});
 assert.equal(next.goal,goal);assert.equal(next.sourceGoal,goal);assert.equal(executableStrategy(next),true);
 assert.equal(next.execution.plan.initialPct,7);assert.equal(next.execution.plan.maLong,60);assert.equal(next.execution.plan.rsiPeriod,14);assert.equal(next.execution.plan.maxOrderPct,10);assert.equal(next.execution.rules,null);
 assert.deepEqual(validateStrategyConfig(next.execution).plan,p);
});

test('breakout confirmation waits for three completed closes and checks volume on the actual breakout day',()=>{
 const p=plan({breakoutUpper:25.3,breakoutLower:24,maxChasePct:100,trimMaEnabled:false,trimRsiEnabled:false});
 const d=bars([...Array(70).fill(24),25.4,25.5,25.6,25.7]);d[70].volume=2000;
 const evals=stagedEvaluator(d,p),state={positionPct:7,entryPrice:24,usedStages:[]};
 assert.equal(evals.decide(70,state),null);assert.equal(evals.decide(71,state),null);assert.equal(evals.decide(72,state).stage,'breakout');assert.equal(evals.decide(72,state).value,15);
 assert.equal(evals.decide(73,{...state,usedStages:['breakout']}),null);
});

test('rolling-low stop excludes the signal bar; urgent liquidation remains available above the ordinary order cap',()=>{
 const p=plan({stopLossPct:8});const d=bars([...Array(70).fill(24),21.9]);
 const decision=stagedEvaluator(d,p).decide(70,{positionPct:25,entryPrice:24,usedStages:['breakout']});
 assert.equal(decision.stage,'stop');assert.equal(decision.urgent,true);assert.equal(decision.value,0);
 const range=stagedEvaluator(d,plan({stopLossPct:0})).decide(70,{positionPct:7,entryPrice:22,usedStages:[]});assert.equal(range.stage,'range-stop');
});

test('half-position reduction is emitted once per holding cycle with observable stagnation criteria',()=>{
 const p=plan({trimMaEnabled:true,trimRsiEnabled:false,stopLossPct:0});const d=bars(Array(75).fill(24));
 const e=stagedEvaluator(d,p),s={positionPct:15,entryPrice:23,usedStages:[]};
 assert.equal(e.decide(70,s).action,'reduce');assert.equal(e.decide(70,s).value,.5);assert.equal(e.decide(71,{...s,usedStages:['trim-ma']}),null);
});

test('the RSI, volume and long-upper-wick branch reduces held shares and is not repeatedly triggered',()=>{
 const p=plan({trimMaEnabled:false}),d=bars([...Array(70).fill(24),30]);d[70]={...d[70],open:29.8,high:32,low:29.7,volume:2000};
 const e=stagedEvaluator(d,p),s={positionPct:15,entryPrice:29,usedStages:[]};
 assert.equal(e.decide(70,s).stage,'trim-rsi');assert.equal(e.decide(70,s).value,.5);
 assert.equal(e.decide(70,{...s,usedStages:['trim-rsi']}),null);
});

test('staged replay performs adds and partial exits, reconciles cash and costs, and cannot see future bars',()=>{
 const p=plan({breakoutLower:24,breakoutUpper:25.3,maxChasePct:100,initialEnabled:false,pullbackEnabled:false,maResistanceTolerancePct:10,stagnationBars:1,stagnationMaxChangePct:10});
 const d=bars([...Array(70).fill(24),25.4,25.5,25.6,25.7,25.8,25.8,22,22,22]);d[70].volume=2000;
 const r=runBacktest(d,config(p));
 const buy=r.trades.find(t=>t.side==='buy');assert(buy);assert.equal(buy.stage,'breakout');assert(buy.shares*buy.price<=100000*.1+1e-6);
 const trim=r.trades.find(t=>t.stage==='trim-ma');assert(trim);assert(trim.shares<buy.shares);
 const stop=r.trades.find(t=>t.reason==='stop');assert(stop);assert.equal(r.shares,0);
 assert(Math.abs(r.cash-100000-r.closed.reduce((s,t)=>s+t.pnl,0))<1e-6);
 assert(Math.abs(r.totalFees-r.trades.reduce((s,t)=>s+t.fee,0))<1e-6);
 const cut=76,early=runBacktest(d.slice(0,cut),config(p)),changed=structuredClone(d);for(let i=cut;i<changed.length;i++)changed[i]={...changed[i],open:50,close:50,high:51,low:49};
 const other=runBacktest(changed,config(p));assert.deepEqual(other.curve.slice(0,early.curve.length),early.curve);assert.deepEqual(other.trades.filter(t=>t.date<d[cut].timestamp),early.trades);
 assert(stagedWarmup(p)>=63);
});

test('unknown fields are not retained and inconsistent positions or incomplete plan fields are rejected',()=>{
 const p=plan();assert.equal(parseStagedPlan({...p,apiKey:'hidden'}).apiKey,undefined);
 assert.throws(()=>plan({initialPct:9}));assert.throws(()=>plan({maxOrderPct:30}));assert.throws(()=>parseStagedPlan({version:1}));
});

test('the requested first position, later add, half reduction and full risk exit form distinct fills',()=>{
 const p=plan({maResistanceTolerancePct:10,stagnationMaxChangePct:.05,trimRsiEnabled:false});
 const d=bars([...Array(70).fill(24),24.2,24.3,24.6,24.8,25,25.4,25.6,25.7,25.8,25.8,25.8,25.8,25.8,22,22,22]);d[70].volume=2000;d[75].volume=2000;
 const r=runBacktest(d,{...config(p),feeBps:0,slippageBps:0});
 assert.deepEqual(r.trades.map(t=>t.stage),['initial','breakout','trim-ma','stop']);
 const [initial,add,trim,stop]=r.trades;
 assert(Math.abs(initial.shares*initial.price/100000*100-7)<1e-6);
 assert(add.shares>0);assert(add.shares*add.price<add.equity*.1);
 assert(Math.abs(trim.shares/(initial.shares+add.shares)-.5)<1e-9);
 assert(Math.abs(stop.shares-trim.shares)<1e-9);assert.equal(r.shares,0);
 const noTrim=runBacktest(d,{...config({...p,trimMaEnabled:false}),feeBps:0,slippageBps:0});
 const risk=noTrim.trades.find(t=>t.stage==='stop');assert(risk.shares*risk.price>risk.equity*.1);
});

test('round lots keep the first allocation inside 6 to 8 percent or skip when no valid lot exists',()=>{
 const p=plan({breakoutEnabled:false,pullbackEnabled:false,trimMaEnabled:false,trimRsiEnabled:false});
 const d=bars([...Array(70).fill(24),24.2,24.3,24.4]);d[70].volume=2000;
 const r=runBacktest(d,{...config(p),lotSize:100,feeBps:0,slippageBps:0});
 assert.equal(r.trades[0].shares,300);const exposure=r.trades[0].shares*r.trades[0].price/100000*100;assert(exposure>=6&&exposure<=8);
 const small=runBacktest(d,{...config(p),capital:5000,lotSize:100,feeBps:0,slippageBps:0});assert.equal(small.trades.length,0);assert(small.skippedEntries>0);
});

test('half reductions above the ten-percent order cap finish in bounded pieces and then stop',()=>{
 const p=plan({breakoutLower:38,breakoutUpper:39,addTargetPct:25,pullbackEnabled:false,maxChasePct:100,maResistanceTolerancePct:20,stagnationMaxChangePct:.01,trimRsiEnabled:false});
 const d=bars([...Array(70).fill(24),24.2,24.3,24.5,25,30,...Array(70).fill(40)]);d[70].volume=2000;d[75].volume=2000;
 const r=runBacktest(d,{...config(p),feeBps:0,slippageBps:0});
 const buys=r.trades.filter(t=>t.side==='buy'),trims=r.trades.filter(t=>t.stage==='trim-ma');assert.equal(buys.length,2);assert.equal(trims.length,2);
 const before=buys.reduce((sum,t)=>sum+t.shares,0);assert(Math.abs(trims.reduce((sum,t)=>sum+t.shares,0)-before/2)<1e-6);
 assert(trims.every(t=>t.shares*t.price<=t.equity*.1+1e-6));assert(Math.abs(r.shares-before/2)<1e-6);
});

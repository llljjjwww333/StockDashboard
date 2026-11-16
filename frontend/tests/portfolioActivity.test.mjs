import {test} from 'node:test';
import assert from 'node:assert/strict';
import {filterPortfolioOrders,filterPortfolioReviews,portfolioOrdersCsv} from '../src/terminal/portfolioActivityData.ts';
import {copyBindingStrategy} from '../src/terminal/bindingStrategyCopy.ts';
import {strategyDefaults} from '../src/terminal/backtest.ts';
import {defaultMandate} from '../src/terminal/portfolio.ts';
import {defaultCustomRules} from '../src/terminal/strategyRules.ts';
import {withExecution,executableStrategy} from '../src/terminal/strategyDefinition.ts';
const order=(id,ticker,side,status)=>({id,ticker,side,status,time:'2026-11-16T00:00:00Z',quantity:.00000001,strategy:'测试策略',reason:'价格确认'});

test('order filters combine direction, status and normalized search without changing the source ledger',()=>{
 const rows=[order('1','BTCUSDT','buy','filled'),order('2','ETHUSDT','sell','rejected'),order('3','BTCUSDT','sell','filled')],before=structuredClone(rows);
 assert.deepEqual(filterPortfolioOrders(rows,{query:' ｂｔｃＵＳＤＴ ',side:'all',status:'filled'}).map(o=>o.id),['3','1']);
 assert.deepEqual(filterPortfolioOrders(rows,{query:'价格',side:'sell',status:'rejected'}).map(o=>o.id),['2']);assert.deepEqual(rows,before);
});
test('decision searches include target reasons and return newest first',()=>{
 const reviews=['first','last'].map(id=>({id,ticker:'BTCUSDT',decision:{method:'rule',summary:'等待',targets:[{ticker:'BTCUSDT',reason:'量比确认'}]}}));
 assert.deepEqual(filterPortfolioReviews(reviews,'量比').map(o=>o.id),['last','first']);assert.equal(filterPortfolioReviews(reviews,'ETHUSDT').length,0);
});
test('filtered CSV includes every matching page and retains tiny values, escaping text cells',()=>{
 const rows=Array.from({length:125},(_,i)=>({...order(String(i),'BTCUSDT','buy','filled'),reason:'=risk,"quoted"\nline',fill:{price:.00001867,fee:1e-10}}));
 const selected=filterPortfolioOrders(rows,{query:'risk',side:'buy',status:'filled'}),csv=portfolioOrdersCsv(selected);
 assert(csv.startsWith('\uFEFFid,time,'));assert(csv.includes('1e-8,0.00001867,1e-10'));assert(csv.includes('"\'=risk,""quoted""\nline"'));assert.equal((csv.match(/BTCUSDT/g)||[]).length,125);
});
const instrument={ticker:'BTCUSDT',name:'Bitcoin',market:'CRYPTO'};
const saved=withExecution({...defaultMandate,id:'old-id',name:'策略',goal:'原始目标',instrument,maxSingle:25,maxGross:25},{...strategyDefaults,kind:'custom',rules:defaultCustomRules(),positionPct:25});
const binding={ticker:'BTCUSDT',name:'Bitcoin',label:'已绑定策略',mode:'rules',mandate:saved,config:structuredClone(saved.execution),allocationPct:10,enabled:false,profileId:''};
test('copying a bound snapshot creates an independent definition and never overwrites its source',()=>{
 const old=structuredClone(binding);binding.config.rules.entry.conditions[0].right.period=37;
 const before=structuredClone(binding),copy=copyBindingStrategy(binding,'CRYPTO','new-id');
 assert.equal(copy.id,'new-id');assert.equal(copy.execution.rules.entry.conditions[0].right.period,37);assert.equal(copy.maxSingle,25);assert.equal(copy.revision,1);assert(executableStrategy(copy));
 copy.execution.rules.entry.conditions[0].right.period=50;assert.deepEqual(binding,before);assert.equal(saved.execution.rules.entry.conditions[0].right.period,20);
 Object.assign(binding,old);
});
test('text-only AI snapshots remain text-only when copied instead of acquiring default SMA rules',()=>{
 const copy=copyBindingStrategy({...binding,mode:'ai',mandate:{...defaultMandate,instrument}},'CRYPTO','text-copy');
 assert.equal(copy.execution,undefined);assert.equal(copy.goal,defaultMandate.goal);assert.equal(copy.id,'text-copy');
});

test('snapshot copies preserve a saved strategy cap even when an older config field is larger',()=>{
 const copy=copyBindingStrategy({...binding,config:{...binding.config,positionPct:100}},'CRYPTO','limited-copy');
 assert.equal(copy.maxSingle,25);assert.equal(copy.execution.positionPct,25);assert(executableStrategy(copy));
});

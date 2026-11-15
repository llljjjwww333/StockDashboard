import {test} from 'node:test';
import assert from 'node:assert/strict';
import {defaultMandate} from '../src/terminal/portfolio.ts';
import {strategyDefaults} from '../src/terminal/backtest.ts';
import {withExecution,executableStrategy} from '../src/terminal/strategyDefinition.ts';
import {copyMandate,portableMandate,mandateEntries,mandateKeys,writeMandateCollection} from '../src/terminal/mandateLibrary.ts';
const sample=()=>withExecution({...defaultMandate,id:'original',name:'原策略',instrument:{ticker:'AAPL',name:'Apple',market:'US'}},strategyDefaults);
test('copy has an independent identity and rule object without refreshing outdated rules',()=>{
 const original=sample(),copy=copyMandate(original,'copy');copy.execution.fast=9;
 assert.equal(original.execution.fast,5);assert.equal(copy.id,'copy');assert.equal(copy.revision,1);
 assert.equal(executableStrategy(copyMandate({...original,goal:'changed'},'copy2')),false);
});
test('strategy export contains only portable definition fields',()=>{
 const original=sample();original.settings={apiKey:'hidden-secret'};original.execution.apiKey='hidden-secret';original.instrument.secret='hidden-secret';
 const exported=portableMandate(original);assert.equal(JSON.stringify(exported).includes('hidden-secret'),false);assert.equal(exported.execution.fast,5);assert.equal(exported.instrument.ticker,'AAPL');
});
test('collection view includes the live draft once and preserves other pending edits',()=>{
 const original=sample(),pending={...original,name:'pending'},other={...sample(),id:'other'},live={...pending,name:'typing'};
 assert.deepEqual(mandateEntries([original,other],[pending],live),[live,other]);
});
test('failed collection write restores earlier keys before leaving memory untouched',()=>{
 const data=new Map([[mandateKeys.library,'old-library'],[mandateKeys.drafts,'old-drafts'],[mandateKeys.active,'old-active']]);
 const storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>{if(k===mandateKeys.drafts)throw new Error('quota');data.set(k,v);},removeItem:k=>data.delete(k)};
 assert.throws(()=>writeMandateCollection(storage,[sample()],[],'original'),/quota/);assert.equal(data.get(mandateKeys.library),'old-library');assert.equal(data.get(mandateKeys.active),'old-active');
});

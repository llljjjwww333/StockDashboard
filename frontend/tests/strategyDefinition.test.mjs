import {test} from 'node:test';
import assert from 'node:assert/strict';
import {defaultMandate,validMandate} from '../src/terminal/portfolio.ts';
import {strategyDefaults} from '../src/terminal/backtest.ts';
import {defaultCustomRules} from '../src/terminal/strategyRules.ts';
import {withExecution,executableStrategy,generatedExecution,applyGeneratedStrategy,editStrategyExecution,strategyBacktestConfig} from '../src/terminal/strategyDefinition.ts';
const base=()=>({...defaultMandate,id:'strategy-1',name:'AI strategy',goal:'close above SMA20',instrument:{ticker:'AAPL',name:'Apple',market:'US'}});
const environment={capital:100000,feeBps:10,slippageBps:10,startDate:'2026-01-01',endDate:'2026-11-06',lotSize:1,liquidateEnd:false};
test('text-only strategies cannot silently fall back to an unrelated SMA backtest',()=>{
 const strategy=base();assert.equal(executableStrategy(strategy),false);assert.throws(()=>strategyBacktestConfig(strategy,environment),/生成或设置规则/);
 assert.equal(validMandate(strategy).goal,strategy.goal);
 assert.throws(()=>generatedExecution(undefined,30));
});
test('AI rules become the exact executable definition used by backtesting',()=>{
 const rules=defaultCustomRules(),execution=generatedExecution({rules,stop_loss_pct:3,take_profit_pct:12},25),strategy=withExecution({...base(),maxSingle:25},execution);
 const config=strategyBacktestConfig(strategy,environment);
 assert.equal(config.kind,'custom');assert.deepEqual(config.rules,rules);assert.equal(config.stopLossPct,3);assert.equal(config.takeProfitPct,12);assert.equal(config.positionPct,25);
 assert.equal(config.capital,100000);assert.equal(config.feeBps,10);assert.equal(config.slippageBps,10);assert.equal(strategy.revision,1);assert.equal(executableStrategy(strategy),true);
});
test('editing the goal or changing the stock invalidates the compiled definition',()=>{
 const strategy=withExecution(base(),{...strategyDefaults,kind:'custom',rules:defaultCustomRules()});
 assert.equal(executableStrategy({...strategy,goal:'new goal'}),false);
 assert.equal(executableStrategy({...strategy,instrument:{ticker:'MSFT',name:'Microsoft',market:'US'}}),false);
 assert.throws(()=>strategyBacktestConfig({...strategy,goal:'new goal'},environment),/更新规则/);
 const updated=withExecution({...strategy,goal:'new goal'},strategy.execution);assert.equal(updated.revision,2);assert.equal(executableStrategy(updated),true);
});
test('execution environment changes do not rewrite strategy rules or its version',()=>{
 const strategy=withExecution(base(),{...strategyDefaults,kind:'custom',rules:defaultCustomRules()}),before=structuredClone(strategy);
 strategyBacktestConfig(strategy,{...environment,capital:200000,feeBps:20});assert.deepEqual(strategy,before);
});
test('malformed AI execution is rejected instead of being treated as a valid strategy',()=>{
 const rules=defaultCustomRules();rules.entry.conditions[0].left={indicator:'execute'};
 assert.throws(()=>generatedExecution({rules,stop_loss_pct:3,take_profit_pct:12},30));
 assert.throws(()=>generatedExecution({rules:defaultCustomRules(),stop_loss_pct:NaN,take_profit_pct:12},30));
});

test('generation replaces every rule and risk field atomically without retaining template defaults',()=>{
 const original=withExecution(base(),strategyDefaults),before=structuredClone(original),rules=defaultCustomRules();
 rules.entry.conditions.push({left:{indicator:'volume_ratio',period:7},operator:'gte',right:{value:1.6}},{left:{indicator:'macd'},operator:'gt',right:{indicator:'macd_signal'}});
 rules.exit.conditions=[{left:{indicator:'rsi',period:14},operator:'lt',right:{value:45}}];
 const proposal={name:'Generated',goal:'exact rules',summary:'all fields',execution:{rules,stop_loss_pct:8,take_profit_pct:20},max_single_pct:25,review_minutes:15,news:false};
 const next=applyGeneratedStrategy(original,original.instrument,proposal);
 assert.deepEqual(next.execution.rules,rules);assert.equal(next.execution.kind,'custom');assert.equal(next.execution.positionPct,25);assert.equal(next.maxSingle,25);assert.equal(next.execution.stopLossPct,8);assert.equal(next.execution.takeProfitPct,20);assert.equal(next.reviewMinutes,15);assert.equal(next.news,false);assert.equal(executableStrategy(next),true);
 assert.throws(()=>applyGeneratedStrategy(original,original.instrument,{...proposal,execution:undefined}));assert.deepEqual(original,before);
});

test('removing the last condition or typing an invalid parameter cannot leave a runnable strategy',()=>{
 const strategy=withExecution(base(),{...strategyDefaults,kind:'custom',rules:defaultCustomRules()});
 strategy.execution.rules.entry.conditions=[];assert.equal(executableStrategy(strategy),false);
 assert.throws(()=>strategyBacktestConfig(strategy,environment));
 assert.equal(executableStrategy({...withExecution(base(),strategyDefaults),maxSingle:NaN}),false);
});

test('manual parameter edits update an AI-generated description but never replace a newly typed goal',()=>{
 const proposal={name:'Generated',goal:'independent model prose',summary:'rules',execution:{rules:defaultCustomRules(),stop_loss_pct:8,take_profit_pct:20},max_single_pct:25,review_minutes:15,news:false};
 const generated=applyGeneratedStrategy(base(),base().instrument,proposal),config=structuredClone(generated.execution);
 config.rules.entry.conditions[0].right.period=23;
 const edited=editStrategyExecution(generated,generated.instrument,config);
 assert.match(edited.goal,/SMA\(23\)/);assert.equal(edited.executionGoal,edited.goal);assert.equal(executableStrategy(edited),true);
 const goal='new requirements needing generation';
 const stale=editStrategyExecution({...edited,goal,goalMode:undefined},edited.instrument,config);
 assert.equal(stale.goal,goal);assert.equal(executableStrategy(stale),false);
 const empty=structuredClone(edited.execution);empty.rules.entry.conditions=[];
 const draft=editStrategyExecution(edited,edited.instrument,empty);assert.equal(executableStrategy(draft),false);assert.equal(draft.goal,edited.goal);
});

test('legacy incompatible comparisons remain recoverable as drafts but cannot execute or replace rules from AI',()=>{
 const rules=defaultCustomRules();rules.entry.conditions.push({left:{indicator:'volume_ratio',period:20},operator:'gt',right:{indicator:'sma',period:20}});
 const legacy={...base(),execution:{...strategyDefaults,kind:'custom',rules},executionGoal:base().goal,executionTicker:'AAPL',revision:3};
 assert.deepEqual(validMandate(legacy).execution.rules,rules);
 assert.equal(executableStrategy(legacy),false);assert.throws(()=>strategyBacktestConfig(legacy,environment),/量比/);
 assert.throws(()=>generatedExecution({rules,stop_loss_pct:8,take_profit_pct:0},25),/量比/);
});

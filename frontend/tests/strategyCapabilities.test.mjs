import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { strategyCapabilityIssues } from '../src/terminal/strategyCapabilities.ts';
import { applyGeneratedStrategy, executableStrategy, withExecution } from '../src/terminal/strategyDefinition.ts';
import { defaultMandate } from '../src/terminal/portfolio.ts';
import { strategyDefaults } from '../src/terminal/backtest.ts';

test('the exact supplied multi-stage goal is retained and cannot be silently compiled to a default SMA strategy', () => {
 const goal=readFileSync(new URL('../../backend/tests/fixtures/strategy_goal_920117.txt',import.meta.url),'utf8');
 const issues=strategyCapabilityIssues(goal);assert.equal(issues.length,7);
 const strategy=withExecution({...defaultMandate,id:'legacy',goal,instrument:{ticker:'920117',name:'龙鑫智能',market:'CN'}},strategyDefaults),before=structuredClone(strategy);
 assert.equal(executableStrategy(strategy),false);
 assert.throws(()=>applyGeneratedStrategy(strategy,strategy.instrument,{name:'Simple SMA'}),/分批|未返回/);
 assert.deepEqual(strategy,before);
});

test('ordinary supported rule goals and an explicit instruction not to add positions remain usable',()=>{
 assert.deepEqual(strategyCapabilityIssues('收盘高于MA20且量比>1；MACD上穿信号线；止损8%，持仓25%，不加仓'),[]);
});

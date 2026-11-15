import {test} from 'node:test';
import assert from 'node:assert/strict';
import {defaultMandate} from '../src/terminal/portfolio.ts';
import {strategyDefaults} from '../src/terminal/backtest.ts';
import {withExecution,executableStrategy} from '../src/terminal/strategyDefinition.ts';
import {defaultCustomRules} from '../src/terminal/strategyRules.ts';
import {readMandateDrafts,stashMandateDraft} from '../src/terminal/mandateDrafts.ts';
const strategy=id=>withExecution({...defaultMandate,id,instrument:{ticker:'AAPL',name:'Apple',market:'US'}},strategyDefaults);
test('draft recovery retains edited rules and a separate draft for each strategy',()=>{
 const a=strategy('a'),b=strategy('b');
 const rows=stashMandateDraft(stashMandateDraft([],a),b);
 const edited=withExecution(a,{...a.execution,fast:9});
 const restored=readMandateDrafts(JSON.stringify(stashMandateDraft(rows,edited)));
 assert.deepEqual(restored.find(m=>m.id==='a'),edited);assert.deepEqual(restored.find(m=>m.id==='b'),b);assert.equal(a.execution.fast,5);
});
test('edited target remains pending after draft restoration',()=>{
 const edited={...strategy('a'),goal:'new target needs new rules'};
 const [restored]=readMandateDrafts(JSON.stringify(stashMandateDraft([],edited)));
 assert.equal(restored.goal,edited.goal);assert.equal(executableStrategy(restored),false);
});
test('invalid intermediate input cannot overwrite the last restorable draft',()=>{
 const rows=stashMandateDraft([],strategy('a'));
 assert.throws(()=>stashMandateDraft(rows,{...rows[0],execution:{...rows[0].execution,fast:NaN}}));
 assert.deepEqual(readMandateDrafts(JSON.stringify(rows)),rows);
 assert.deepEqual(readMandateDrafts(JSON.stringify([null,...rows])),rows);
});

test('deleting every condition survives draft recovery without restoring a default trade rule',()=>{
 const edited=withExecution(strategy('a'),{...strategyDefaults,kind:'custom',rules:defaultCustomRules()});
 edited.execution.rules.entry.conditions=[];
 const raw=JSON.stringify(stashMandateDraft([],edited)),[restored]=readMandateDrafts(raw);
 assert.deepEqual(restored.execution.rules.entry.conditions,[]);assert.equal(executableStrategy(restored),false);
 assert.deepEqual(readMandateDrafts(raw,false),[]);
});

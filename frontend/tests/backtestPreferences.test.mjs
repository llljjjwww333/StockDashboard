import {test} from 'node:test';
import assert from 'node:assert/strict';
import {rememberBacktestPreference,readBacktestPreferences} from '../src/terminal/backtestPreferences.ts';
const value=(id,ticker,capital)=>({id,ticker,period:'3mo',environment:{capital,feeBps:12,slippageBps:7,startDate:'2026-03-01',endDate:'2026-11-06',lotSize:ticker==='AAPL'?1:100,liquidateEnd:true}});
test('each strategy retains its environment independently after serialization',()=>{
 const a=value('a','AAPL',200000),b=value('b','600519',500000),rows=rememberBacktestPreference(rememberBacktestPreference([],a),b);
 assert.deepEqual(readBacktestPreferences(JSON.stringify(rows)),[b,a]);
 const edited=rememberBacktestPreference(rows,{...a,environment:{...a.environment,feeBps:30}});assert.equal(edited[1].environment.capital,500000);assert.equal(rows[1].environment.feeBps,12);
});
test('invalid dates and intermediate input cannot overwrite the last valid test environment',()=>{
 const a=value('a','AAPL',200000),rows=[a];
 for(const environment of [{...a.environment,capital:NaN},{...a.environment,startDate:'2027-01-01'},{...a.environment,feeBps:-1}])assert.throws(()=>rememberBacktestPreference(rows,{...a,environment}));
 assert.deepEqual(readBacktestPreferences(JSON.stringify([null,a])),[a]);assert.deepEqual(readBacktestPreferences('broken'),[]);
});

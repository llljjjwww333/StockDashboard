import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hasExecutedDailyRule,mergePortfolioReview} from '../src/terminal/ruleExecution.ts';
const now=new Date('2026-11-09T15:00:00Z');
const review=(execution,id='attempt')=>({id,ticker:'AAPL',ruleKey:'same-rules',reviewed_at:now.toISOString(),provider:'rules',model:'sma',execution,decision:{regime:'trend',method:'sma',summary:'trend',reconsider_when:'next close',targets:[{ticker:'AAPL',weight_pct:30,reason:'signal'}],evidence_ids:['H1']},evidence:[{id:'H1',title:'daily',source:'fixture',timestamp:'2026-11-06'}]});
test('failed execution can retry but a completed daily target is consumed once',()=>{
 assert.equal(hasExecutedDailyRule([review('可用资金不足')],'AAPL','same-rules',now),false);
 for(const status of ['已成交','未下单'])assert.equal(hasExecutedDailyRule([review(status)],'AAPL','same-rules',now),true);
 assert.equal(hasExecutedDailyRule([review('已成交')],'AAPL','new-rules',now),false);
 assert.equal(hasExecutedDailyRule([review('已成交')],'AAPL','same-rules',new Date('2026-11-10T15:00:00Z')),false);
});
test('repeated identical failures update one decision while later success stays in the ledger',()=>{
 const first=review('可用资金不足','first'),retry={...review('可用资金不足','retry'),reviewed_at:'2026-11-09T15:00:15Z'};
 const merged=mergePortfolioReview([first],retry);assert.equal(merged.length,1);assert.equal(merged[0].id,'first');assert.equal(merged[0].reviewed_at,retry.reviewed_at);assert.equal(first.reviewed_at,now.toISOString());
 const done=mergePortfolioReview(merged,review('已成交','done'));assert.equal(done.length,2);assert.equal(done[0].execution,'可用资金不足');assert.equal(done[1].execution,'已成交');
});
test('different outcomes and dynamic AI reviews retain separate records',()=>{
 assert.equal(mergePortfolioReview([review('可用资金不足')],review('可卖持仓不足','second')).length,2);
 assert.equal(mergePortfolioReview([{...review('未成交'),ruleKey:undefined}],{...review('未成交','second'),ruleKey:undefined}).length,2);
});

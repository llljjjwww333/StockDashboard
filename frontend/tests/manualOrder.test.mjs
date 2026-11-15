import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPortfolio,executePortfolioOrder} from '../src/terminal/portfolio.ts';
import {manualOrderDetails} from '../src/terminal/manualOrder.ts';
const now=new Date('2026-11-09T15:00:00Z');
const quote=(ticker,time=now)=>({ticker,price:100,volume:1000,change_percent:0,as_of:time.toISOString(),source:'Controlled'});
test('maximum manual buy includes fees and slippage and matches execution capacity',()=>{
 const p=createPortfolio('test',100000,'US'),q=quote('AAPL');
 const check=manualOrderDetails(p,'AAPL','buy',1,q,now);
 assert.equal(check.maximum,999);
 assert.equal(manualOrderDetails(p,'AAPL','buy',1000,q,now).error,'可用资金不足');
 const details=manualOrderDetails(p,'AAPL','buy',check.maximum,q,now),done=executePortfolioOrder(p,'AAPL','buy',check.maximum,q,'test','Apple',p.config,now);
 assert.equal(details.error,'');assert(Math.abs(p.cash-done.cash-details.amount)<1e-8);
});
test('CN buys enforce lots while sales can dispose of odd shares and obey T+1',()=>{
 const cnTime=new Date('2026-11-09T02:00:00Z'),q=quote('600519',cnTime),p=createPortfolio('test',100000,'CN');
 assert.match(manualOrderDetails(p,q.ticker,'buy',101,q,cnTime).error,/100 股/);
 p.positions=[{ticker:q.ticker,name:'test',shares:151,cost:15000,lastPrice:100,lots:[{date:'2026-11-06',quantity:51},{date:'2026-11-09',quantity:100}]}];
 const details=manualOrderDetails(p,q.ticker,'sell',51,q,cnTime);assert.equal(details.maximum,51);assert.equal(details.error,'');
 assert.equal(manualOrderDetails(p,q.ticker,'sell',52,q,cnTime).error,'超出可卖数量');
 const done=executePortfolioOrder(p,q.ticker,'sell',51,q,'test','test',p.config,cnTime);assert.equal(done.positions[0].shares,100);
});
test('invalid, unavailable and stale orders do not show a valid submit state',()=>{
 const p=createPortfolio('test',100000,'US'),q=quote('AAPL');
 for(const quantity of [0,-1,NaN,Infinity,1.5])assert.equal(manualOrderDetails(p,'AAPL','buy',quantity,q,now).error,'请输入有效数量');
 assert.equal(manualOrderDetails(p,'AAPL','sell',1,q,now).error,'暂无可卖持仓');
 assert.equal(manualOrderDetails(p,'AAPL','buy',1,undefined,now).error,'等待有效报价');
 assert.equal(manualOrderDetails(p,'AAPL','buy',1,{...q,stale:true},now).error,'等待新鲜报价');
});

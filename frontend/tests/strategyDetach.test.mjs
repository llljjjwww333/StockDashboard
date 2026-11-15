import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPortfolio,defaultMandate,bindStockStrategy,detachStockStrategy,strategyAllocationAvailable} from '../src/terminal/portfolio.ts';
const binding=(ticker,allocationPct)=>({ticker,name:ticker,label:'test '+ticker,mode:'rules',mandate:{...defaultMandate,instrument:{ticker,name:ticker,market:'US'}},config:createPortfolio('config',100000,'US').config,profileId:'',allocationPct,enabled:true});
test('detaching strategy preserves holdings, cash, ledger and other strategy references',()=>{
 let p=createPortfolio('test',100000,'US');p=bindStockStrategy(bindStockStrategy(p,binding('AAPL',70)),binding('MSFT',20));
 p.positions=[{ticker:'AAPL',name:'Apple',shares:10,cost:1000,lastPrice:100,lots:[{date:'2026-11-06',quantity:10}]}];p.cash=99000;
 const before=structuredClone(p),next=detachStockStrategy(p,'AAPL');
 assert.deepEqual(p,before);assert.equal(next.cash,p.cash);assert.equal(next.positions,p.positions);assert.equal(next.orders,p.orders);assert.equal(next.reviews,p.reviews);assert.equal(next.bindings[0],p.bindings[1]);assert.equal(strategyAllocationAvailable(next,'NVDA'),80);
});
test('restoring only the removed strategy does not roll back intervening account changes',()=>{
 const p=bindStockStrategy(bindStockStrategy(createPortfolio('test',100000,'US'),binding('AAPL',70)),binding('MSFT',20));
 const removed=detachStockStrategy(p,'AAPL'),changed={...removed,cash:98000,realized:15,fees:3};
 const restored=bindStockStrategy(changed,{...p.bindings[0],enabled:false});assert.equal(restored.cash,98000);assert.equal(restored.realized,15);assert.equal(restored.fees,3);assert.equal(restored.bindings.find(b=>b.ticker==='AAPL').enabled,false);
});
test('released allocation can be reassigned and an over-budget restore is rejected',()=>{
 let p=bindStockStrategy(bindStockStrategy(createPortfolio('test',100000,'US'),binding('AAPL',70)),binding('MSFT',20));const old=p.bindings[0];
 p=bindStockStrategy(detachStockStrategy(p,'AAPL'),binding('NVDA',80));assert.equal(strategyAllocationAvailable(p,'AAPL'),0);assert.equal(strategyAllocationAvailable(p,'NVDA'),80);assert.throws(()=>bindStockStrategy(p,old),/100%/);
});

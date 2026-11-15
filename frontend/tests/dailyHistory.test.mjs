import {test} from 'node:test';
import assert from 'node:assert/strict';
import {completedDailyCutoff,completedDailyBars,previousTradingDay} from '../src/terminal/dailyHistory.ts';
test('CN daily history includes the closing day only after a post-close fetch',()=>{
 const before=new Date('2026-11-09T14:59:59+08:00'),after=new Date('2026-11-09T15:00:01+08:00');
 assert.equal(completedDailyCutoff('600519',before,before.toISOString()),'2026-11-06');
 assert.equal(completedDailyCutoff('600519',after,before.toISOString()),'2026-11-06');
 assert.equal(completedDailyCutoff('600519',after,after.toISOString()),'2026-11-09');
 assert.equal(completedDailyCutoff('600519',after),'2026-11-06');
});
test('US early closes, DST and exchange holidays use the exchange calendar',()=>{
 const early=new Date('2026-11-27T13:00:00-05:00');assert.equal(completedDailyCutoff('AAPL',early,early.toISOString()),'2026-11-27');
 const before=new Date('2026-11-27T12:59:59-05:00');assert.equal(completedDailyCutoff('AAPL',before,before.toISOString()),'2026-11-25');
 const summer=new Date('2026-03-09T20:00:01Z');assert.equal(completedDailyCutoff('AAPL',summer,summer.toISOString()),'2026-03-09');
 assert.equal(previousTradingDay('600519','2026-10-08'),'2026-09-30');
 assert.equal(completedDailyCutoff('AAPL',new Date('2026-11-26T18:00:00Z')),'2026-11-25');
});
test('current, future and non-session rows do not enter the completed daily window',()=>{
 const rows=['2026-11-06','2026-11-07','2026-11-08','2026-11-09','2026-11-10'].map(timestamp=>({timestamp:timestamp+'T00:00:00+08:00',open:100,high:101,low:99,close:100,volume:100}));
 assert.deepEqual(completedDailyBars(rows,'600519','2026-11-09').map(p=>p.timestamp.slice(0,10)),['2026-11-06','2026-11-09']);
 const now=new Date('2026-11-09T15:01:00+08:00');assert.equal(completedDailyCutoff('600519',now,'2026-11-10T15:00:00+08:00'),'2026-11-06');
});

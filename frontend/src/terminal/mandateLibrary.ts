import { validMandate, type Mandate } from './portfolio.ts';
import { validateStrategyConfig } from './backtest.ts';

export const mandateKeys={library:'marketdesk:crypto:portfolio-strategies:v1',drafts:'marketdesk:crypto:strategy-editor-drafts:v1',active:'marketdesk:crypto:selected-strategy:v1'};
export function mandateEntries(library:Mandate[],drafts:Mandate[],current?:Mandate){
 const rows=[...library,...drafts.filter(d=>!library.some(m=>m.id===d.id))].map(m=>drafts.find(d=>d.id===m.id)??m);
 if(current){const index=rows.findIndex(m=>m.id===current.id);if(index<0)rows.unshift(current);else rows[index]=current;}
 return rows;
}
export function portableMandate(value:Mandate):Mandate{
 const m=validMandate(value);
 return {id:m.id,name:m.name,goal:m.goal,maxSingle:m.maxSingle,maxGross:m.maxGross,maxPositions:m.maxPositions,reviewMinutes:m.reviewMinutes,news:m.news,
  ...(m.instrument?{instrument:{ticker:m.instrument.ticker,name:m.instrument.name,market:m.instrument.market}}:{}),
  ...(m.sourceGoal?{sourceGoal:m.sourceGoal}:{}),...(m.goalMode==='generated'?{goalMode:m.goalMode}:{}),...(typeof m.summary==='string'?{summary:m.summary}:{}),...(m.execution?{execution:validateStrategyConfig(m.execution)}:{}),
  ...(typeof m.executionGoal==='string'?{executionGoal:m.executionGoal}:{}),...(typeof m.executionTicker==='string'?{executionTicker:m.executionTicker}:{}),...(m.revision?{revision:m.revision}:{})};
}
export function copyMandate(value:Mandate,id=crypto.randomUUID(),suffix=' 副本'):Mandate{
 const m=portableMandate(value);return {...m,id,name:m.name.slice(0,80-suffix.length)+suffix,...(m.execution?{revision:1}:{})};
}
type StoragePort=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
export function writeMandateCollection(storage:StoragePort,library:Mandate[],drafts:Mandate[],active:string){
 const updates:[[string,string],[string,string],[string,string]]=[[mandateKeys.library,JSON.stringify(library)],[mandateKeys.drafts,JSON.stringify(drafts)],[mandateKeys.active,active]];
 const previous=updates.map(([key])=>storage.getItem(key));let written=0;
 try{for(const [key,value]of updates){storage.setItem(key,value);written++;}}
 catch(error){for(let i=written-1;i>=0;i--){try{if(previous[i]===null)storage.removeItem(updates[i][0]);else storage.setItem(updates[i][0],previous[i]!);}catch{/* Leave the in-memory collection intact if storage is unavailable. */}}throw error;}
}

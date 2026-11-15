import type { HistoryPoint } from './types';
import { ema, rsiSeries, sma } from './technicalSeries.ts';

export const stagedFields = [
  ['指标', 'maFast', '复核短均线周期', 2, 200, 1], ['指标','maEntry','入场均线周期',2,200,1], ['指标','maLong','长期 / 阻力均线周期',2,200,1],
  ['指标','rsiPeriod','RSI 周期',2,100,1], ['指标','macdFast','MACD 快线周期',2,100,1], ['指标','macdSlow','MACD 慢线周期',3,200,1], ['指标','macdSignal','MACD 信号周期',2,100,1], ['指标','volumePeriod','量比均量回看周期',2,100,1],
  ['首次建仓','initialMinPct','首仓下限（%）',1,100,.1], ['首次建仓','initialMaxPct','首仓上限（%）',1,100,.1], ['首次建仓','initialPct','本次选定首仓（%）',1,100,.1], ['首次建仓','entryVolumeRatio','首仓量比须大于',0,20,.1],
  ['突破加仓','breakoutLower','震荡区下沿',.0001,1e9,.01], ['突破加仓','breakoutUpper','突破区上沿',.0001,1e9,.01], ['突破加仓','confirmBars','站稳交易日数',1,20,1], ['突破加仓','breakoutVolumeRatio','突破日最低量比',0,20,.1], ['突破加仓','addTargetPct','加仓后目标仓位（%）',1,100,.1],
  ['回踩买入','pullbackTolerancePct','回踩均线容差（%）',0,20,.1], ['回踩买入','pullbackMaxVolumeRatio','缩量量比须低于',0,20,.1], ['回踩买入','pullbackRsi','RSI 回升上穿阈值',0,100,1], ['回踩买入','pullbackTargetPct','回踩后目标仓位（%）',1,100,.1],
  ['退出条件','stopLossPct','相对持仓均价止损（%）',0,100,.1], ['退出条件','lowLookback','前期低点回看交易日',2,200,1], ['退出条件','stagnationBars','滞涨观察交易日',1,20,1], ['退出条件','stagnationMaxChangePct','滞涨最大绝对涨跌（%）',0,20,.1], ['退出条件','maResistanceTolerancePct','接近长期均线容差（%）',0,20,.1],
  ['退出条件','trimRsi','减仓 RSI 须高于',0,100,1], ['退出条件','trimVolumeRatio','减仓最低量比',0,20,.1], ['退出条件','wickFraction','上影占振幅最低比例',0,1,.05], ['退出条件','wickBodyRatio','上影 / 实体最低倍数',0,10,.1], ['退出条件','trimFraction','减仓占现有持仓比例',.01,1,.05], ['退出条件','clearVolumeRatio','跌破入场均线清仓量比',0,20,.1],
  ['仓位与等待','maxChasePct','高于入场均线不追阈值（%）',0,100,.1], ['仓位与等待','waitVolumeRatio','空头排列缩量等待阈值',0,20,.1], ['仓位与等待','maxPositionPct','单股总仓位上限（%）',1,100,.1], ['仓位与等待','maxOrderPct','普通单次交易上限（%）',1,100,.1],
] as const;
export type StagedKey = typeof stagedFields[number][1];
export const stagedSwitches = ['initialEnabled','breakoutEnabled','pullbackEnabled','trimMaEnabled','trimRsiEnabled','clearEnabled','emergencyExitAll','includeNews','reviewTurnover'] as const;
export type StagedPlan = Record<StagedKey, number> & Record<typeof stagedSwitches[number], boolean> & { version: 1; assumptions: string[] };
export const stagedGroups = [...new Set(stagedFields.map(p=>p[0]))];
export function stagedDescriptions(p:StagedPlan){return [
 ['首次建仓',`空仓时：收盘>SMA${p.maEntry}、量比>${p.entryVolumeRatio}、MACD(${p.macdFast}/${p.macdSlow}/${p.macdSignal})柱首次转正并增大，首仓${p.initialPct}%（允许${p.initialMinPct}%–${p.initialMaxPct}%）。`],
 ['突破加仓',`突破${p.breakoutLower}–${p.breakoutUpper}区间上沿，突破日量比≥${p.breakoutVolumeRatio}，连续站稳${p.confirmBars}个交易日，目标仓位${p.addTargetPct}%。`],
 ['回踩买入',`低点在SMA${p.maEntry}±${p.pullbackTolerancePct}%内，收盘不低于均线，量比<${p.pullbackMaxVolumeRatio}，RSI${p.rsiPeriod}上穿${p.pullbackRsi}，目标${p.pullbackTargetPct}%。`],
 ['止损与清仓',`收盘跌破持仓均价${p.stopLossPct}%或此前${p.lowLookback}日低点即退出；跌破SMA${p.maEntry}且量比>${p.clearVolumeRatio}清仓。`],
 ['减仓',`距SMA${p.maLong}≤${p.maResistanceTolerancePct}%、${p.stagnationBars}日绝对涨跌≤${p.stagnationMaxChangePct}%，或RSI>${p.trimRsi}且量比≥${p.trimVolumeRatio}、上影占振幅≥${p.wickFraction*100}%且≥实体${p.wickBodyRatio}倍，目标减持触发时持仓${p.trimFraction*100}%。每轮持仓一次减仓事件，受单次上限时分次完成。`],
 ['仓位与等待',`总仓≤${p.maxPositionPct}%，普通单次≤${p.maxOrderPct}%；${p.emergencyExitAll?'止损/清仓一次退出':'风险退出也受单次上限约束'}。高于SMA${p.maEntry} ${p.maxChasePct}%不追；收盘<SMA${p.maEntry}<SMA${p.maLong}且量比<${p.waitVolumeRatio}时等待。`],
 ['复核',`日收盘复核MA${p.maFast}/${p.maEntry}/${p.maLong}、RSI${p.rsiPeriod}、MACD及${p.volumePeriod}日均量比；次日开盘执行。${p.includeNews?'跟踪实时新闻，':''}${p.reviewTurnover?'复核换手率，':''}`],
] as const;}

export function parseStagedPlan(raw: unknown): StagedPlan {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('分批策略参数缺失');
  const p = raw as Record<string, unknown>, result: Record<string, unknown> = {version:1};
  if(p.version!==1)throw new Error('分批策略版本无效');
  for(const [,key,label,min,max,step] of stagedFields){const v=p[key];if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max||step===1&&!Number.isInteger(v))throw new Error(label+'无效');result[key]=v;}
  for(const key of stagedSwitches){if(typeof p[key]!=='boolean')throw new Error('分批策略开关缺失');result[key]=p[key];}
  if(!Array.isArray(p.assumptions)||p.assumptions.length>20||p.assumptions.some(s=>typeof s!=='string'||s.length>600))throw new Error('分批策略判定口径无效');
  result.assumptions=[...p.assumptions];const plan=result as StagedPlan;
  if(plan.macdFast>=plan.macdSlow||plan.maEntry>=plan.maLong||plan.breakoutLower>=plan.breakoutUpper||plan.initialMinPct>plan.initialPct||plan.initialPct>plan.initialMaxPct||Math.max(plan.initialMaxPct,plan.addTargetPct,plan.pullbackTargetPct,plan.maxOrderPct)>plan.maxPositionPct)throw new Error('分批仓位、区间或指标周期关系无效');
  return plan;
}
export const stagedWarmup=(p:StagedPlan)=>Math.max(p.maFast,p.maEntry,p.maLong,p.rsiPeriod+1,p.macdSlow+p.macdSignal,p.volumePeriod+1,p.lowLookback+1,p.stagnationBars+1)+p.confirmBars;
export type StagedState={positionPct:number;entryPrice:number;usedStages:readonly string[]};
export type StagedDecision={stage:string;label:string;action:'target'|'reduce';value:number;urgent:boolean};
export function stagedPurchaseQuantity(p:StagedPlan,d:StagedDecision,equity:number,cash:number,shares:number,rawPrice:number,fee:number,slippage:number,lot:number){
 const price=rawPrice*(1+slippage),unitCost=price*(1+fee),desired=equity*Math.min(d.value,p.maxPositionPct)/100/rawPrice-shares;
 const budget=Math.min(desired*rawPrice,equity*p.maxOrderPct/100,cash);
 if(budget<=0)return 0;
 if(d.stage==='initial'&&lot>0){
  const raw=equity*p.initialPct/100/unitCost,candidates=[Math.floor(raw/lot)*lot,Math.ceil(raw/lot)*lot];
  const valid=candidates.filter(q=>q>0&&q*price>=equity*p.initialMinPct/100-1e-8&&q*unitCost<=Math.min(equity*p.initialMaxPct/100,equity*p.maxOrderPct/100,cash)+1e-8);
  return valid.sort((a,b)=>Math.abs(a*unitCost-equity*p.initialPct/100)-Math.abs(b*unitCost-equity*p.initialPct/100))[0]??0;
 }
 return lot?Math.floor(budget/unitCost/lot)*lot:budget/unitCost;
}
export function stagedEvaluator(data:HistoryPoint[],p:StagedPlan){
 const close=data.map(b=>b.close), short=sma(close,p.maFast),ma=sma(close,p.maEntry),long=sma(close,p.maLong),rsi=rsiSeries(close,p.rsiPeriod),vol=sma(data.map(b=>b.volume),p.volumePeriod),fast=ema(close,p.macdFast),slow=ema(close,p.macdSlow);
 const dif=close.map((_,i)=>fast[i]!==null&&slow[i]!==null?fast[i]!-slow[i]!:null),dea=ema(dif,p.macdSignal),hist=dif.map((v,i)=>v!==null&&dea[i]!==null?v-dea[i]!:null);
 const ratio=(i:number)=>i>0&&vol[i-1]!==null&&vol[i-1]!>0?data[i].volume/vol[i-1]!:null;
 const diagnostics=(i:number)=>({shortMa:short[i],entryMa:ma[i],longMa:long[i],rsi:rsi[i],macdDif:dif[i],macdDea:dea[i],macdHistogram:hist[i],volumeRatio:ratio(i)});
 const decide=(i:number,state:StagedState):StagedDecision|null=>{
  const b=data[i],v=ratio(i);if(!b||i<1||ma[i]===null||long[i]===null||rsi[i]===null||v===null||hist[i]===null||hist[i-1]===null)return null;
  const make=(stage:string,label:string,action:'target'|'reduce',value:number,urgent=false):StagedDecision=>({stage,label,action,value,urgent});
  const held=state.positionPct>1e-8;
  if(held){
   if(p.stopLossPct>0&&state.entryPrice>0&&b.close<=state.entryPrice*(1-p.stopLossPct/100))return make('stop','持仓均价止损','target',0,true);
   if(i>=p.lowLookback&&b.close<Math.min(...data.slice(i-p.lowLookback,i).map(x=>x.low)))return make('range-stop','跌破此前区间低点','target',0,true);
   if(p.clearEnabled&&b.close<ma[i]!&&v>p.clearVolumeRatio)return make('clear','跌破均线并放量清仓','target',0,true);
   if(state.positionPct>p.maxPositionPct+.01)return make('cap','仓位上限再平衡','target',p.maxPositionPct);
   const near=Math.abs(b.close/long[i]!-1)*100<=p.maResistanceTolerancePct,stalled=i>=p.stagnationBars&&Math.abs(b.close/data[i-p.stagnationBars].close-1)*100<=p.stagnationMaxChangePct;
   const trimmed=state.usedStages.includes('trim-ma')||state.usedStages.includes('trim-rsi');
   if(p.trimMaEnabled&&!trimmed&&near&&stalled)return make('trim-ma','长期均线附近滞涨减仓','reduce',p.trimFraction);
   const wick=b.high-Math.max(b.open,b.close),body=Math.abs(b.close-b.open),range=b.high-b.low;
   if(p.trimRsiEnabled&&!trimmed&&rsi[i]!>p.trimRsi&&v>=p.trimVolumeRatio&&range>0&&wick/range>=p.wickFraction&&wick>=body*p.wickBodyRatio)return make('trim-rsi','RSI高位放量长上影减仓','reduce',p.trimFraction);
  }
  if(b.close>ma[i]!*(1+p.maxChasePct/100)||b.close<ma[i]!&&ma[i]!<long[i]!&&v<p.waitVolumeRatio)return null;
  // Stronger confirmed breakout takes priority over a fresh initial-entry signal.
  let start=i;while(start>0&&data[start-1].close>p.breakoutUpper)start--;
  if(p.breakoutEnabled&&!state.usedStages.includes('breakout')&&b.close>p.breakoutUpper&&i-start+1>=p.confirmBars&&(ratio(start)??0)>=p.breakoutVolumeRatio&&state.positionPct<p.addTargetPct-.01)return make('breakout','放量突破并连续站稳','target',p.addTargetPct);
  const touch=b.low<=ma[i]!*(1+p.pullbackTolerancePct/100)&&b.low>=ma[i]!*(1-p.pullbackTolerancePct/100)&&b.close>=ma[i]!;
  if(p.pullbackEnabled&&!state.usedStages.includes('pullback')&&touch&&v<p.pullbackMaxVolumeRatio&&rsi[i-1]!==null&&rsi[i-1]!<=p.pullbackRsi&&rsi[i]!>p.pullbackRsi&&state.positionPct<p.pullbackTargetPct-.01)return make('pullback','缩量回踩且RSI回升','target',p.pullbackTargetPct);
  if(p.initialEnabled&&!held&&b.close>ma[i]!&&v>p.entryVolumeRatio&&hist[i]!>0&&hist[i-1]!<=0&&hist[i]!>hist[i-1]!)return make('initial','均线量能和MACD转正首仓','target',p.initialPct);
  return null;
 };
 return {decide,diagnostics};
}

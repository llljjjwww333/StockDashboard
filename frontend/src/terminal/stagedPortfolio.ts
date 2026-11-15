import type { Portfolio, StockBinding } from './portfolio';
import { portfolioEquity, bindingPositionLimit } from './portfolio.ts';
import type { HistoryPoint, Quote } from './types';
import { completedDailyBars, previousTradingDay } from './dailyHistory.ts';
import { exchangeDay } from './paperTrading.ts';
import { parseStagedPlan, stagedEvaluator, stagedWarmup, stagedPurchaseQuantity } from './stagedPlan.ts';

export function stagedHoldingState(p:Portfolio,b:StockBinding){
 const planKey=JSON.stringify(b.config.plan),used=new Set<string>();let quantity=0,cost=0,pendingReduction:{stage:string;targetShares:number}|null=null;
 for(const o of p.orders){if(o.ticker!==b.ticker||o.status!=='filled'||!o.fill)continue;
  if(o.side==='buy'){quantity+=o.quantity;cost+=o.quantity*o.fill.price;}
  else if(quantity>0){cost*=Math.max(0,1-o.quantity/quantity);quantity=Math.max(0,quantity-o.quantity);}
  if(quantity<=1e-8){used.clear();cost=0;pendingReduction=null;}
  else if(o.planKey===planKey&&o.planStage){if(o.planReductionTargetShares!==undefined&&quantity>o.planReductionTargetShares+1e-8)pendingReduction={stage:o.planStage,targetShares:o.planReductionTargetShares};else{used.add(o.planStage);if(pendingReduction?.stage===o.planStage)pendingReduction=null;}}
 }
 const holding=p.positions.find(h=>h.ticker===b.ticker);
 return {entryPrice:quantity>0&&Math.abs(quantity-(holding?.shares??0))<1e-6?cost/quantity:holding?holding.cost/holding.shares:0,usedStages:holding?[...used]:[],pendingReduction:holding?pendingReduction:null,planKey};
}
export function stagedPortfolioDecision(p:Portfolio,b:StockBinding,input:HistoryPoint[],quotes:Record<string,Quote>,now:Date){
 const plan=parseStagedPlan(b.config.plan),last=previousTradingDay(b.ticker,exchangeDay(b.ticker,now));
 const bars=completedDailyBars(input,b.ticker,last);
 if(bars.length<=stagedWarmup(plan)||bars.at(-1)!.timestamp.slice(0,10)!==last)throw new Error('等待完整分批策略日线与预热数据');
 if(bars.some((bar,i)=>[bar.open,bar.high,bar.low,bar.close,bar.volume].some(v=>!Number.isFinite(v))||bar.close<=0||bar.high<Math.max(bar.open,bar.close)||bar.low>Math.min(bar.open,bar.close)||i>0&&bars[i-1].timestamp.slice(0,10)===bar.timestamp.slice(0,10)))throw new Error('分批策略日线无效');
 const holding=p.positions.find(h=>h.ticker===b.ticker),equity=portfolioEquity(p,quotes),price=quotes[b.ticker]?.price??bars.at(-1)!.close,current=(holding?.shares??0)*price/equity*100;
 const limit=bindingPositionLimit(b),state=stagedHoldingState(p,b),evaluator=stagedEvaluator(bars,plan);let decision=evaluator.decide(bars.length-1,{...state,positionPct:current});
 if(state.pendingReduction&&holding&&!decision?.urgent)decision={stage:state.pendingReduction.stage,label:'继续完成本轮减仓',action:'reduce',value:1-state.pendingReduction.targetShares/holding.shares,urgent:false};
 if(!decision&&current>limit+.01)decision={stage:'cap',label:'仓位执行上限再平衡',action:'target',value:limit,urgent:false};
 let reductionTargetShares:number|undefined;
 let target=current;
 if(decision){
  if(decision.action==='reduce'&&holding){const lot=p.market==='CRYPTO'?1e-8:p.market==='CN'?100:1;reductionTargetShares=state.pendingReduction?.targetShares??holding.shares-Math.floor(holding.shares*decision.value/lot+1e-9)*lot;const wanted=holding.shares-reductionTargetShares,sellQty=Math.min(wanted,Math.floor(equity*plan.maxOrderPct/100/price/lot+1e-9)*lot);target=(holding.shares-sellQty)*price/equity*100;}
  else target=decision.value;
  target=Math.max(current-plan.maxOrderPct,Math.min(current+plan.maxOrderPct,target));
  if(decision.urgent&&plan.emergencyExitAll)target=0;
  if(decision.stage==='initial'){
   if(b.allocationPct<plan.initialMinPct)throw new Error('绑定资金比例低于首仓下限');
   const qty=stagedPurchaseQuantity(plan,decision,equity,p.cash,holding?.shares??0,price,b.config.feeBps/10000,b.config.slippageBps/10000,p.market==='CRYPTO'?1e-8:p.market==='CN'?100:1);
   target=((holding?.shares??0)+qty)*price/equity*100;
  }
 }
 return {target:Math.max(0,Math.min(limit,target)),decision,reductionTargetShares,signal:last,planKey:state.planKey,diagnostics:evaluator.diagnostics(bars.length-1)};
}

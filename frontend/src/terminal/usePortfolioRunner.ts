import { useEffect } from 'react';
import { buildApiUrl } from '../lib/api';
import { useAiProfiles, providerSettings } from '../ai/profileStore';
import { useLanguage } from '../lib/i18n';
import { useStockStore } from '../store/stockStore';
import { usePortfolioStore, loadPortfolios, updatePortfolio } from './portfolioStore';
import { portfolioUniverse, portfolioEquity, portfolioSellable, positionAccount, applyStockTarget, type Portfolio, type PortfolioReview, type StockBinding } from './portfolio';
import { paperDecision, quoteExecutionIssue } from './paperTrading';
import { parsePortfolioReview } from './portfolioReview';
import { hasExecutedDailyRule, mergePortfolioReview } from './ruleExecution';
import { requestAiJson } from '../ai/requestJson';
import { stagedPortfolioDecision } from './stagedPortfolio';
import type { HistoryResponse, Quote } from './types';
import { allocationExecutionDue } from './volatilityAllocation';
export function usePortfolioRunner() {
 useEffect(()=>{
  const controller=new AbortController(), quoteBusy=new Set<string>(), busy=new Set<string>(), due=new Map<string,number>(), epochs=new Map<string,number>(),lastBinding=new Map<string,StockBinding>();
  let stopped=false, release:(()=>void)|undefined;
  const get=async<T,>(path:string):Promise<T>=>{const r=await fetch(buildApiUrl(path),{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])});if(!r.ok)throw new Error('行情暂不可用');return r.json();};
  const status=(id:string,message:string)=>{if(!stopped)usePortfolioStore.setState(s=>({status:{...s.status,[id]:message}}));};
  const refresh=async(tickers:string[])=>{
   const data=await get<{quotes:Quote[]}>('/market/quotes?tickers='+tickers.map(encodeURIComponent).join(','));
   const rows:Record<string,Quote>=Object.fromEntries(tickers.map(t=>[t,{...(usePortfolioStore.getState().quotes[t]??{ticker:t,price:0,volume:0,change_percent:0}),stale:true}]));
   for(const q of data.quotes??[])if(tickers.includes(q.ticker)&&Number.isFinite(q.price)&&q.price>0)rows[q.ticker]=q;
   if(!stopped)usePortfolioStore.setState(s=>({quotes:{...s.quotes,...rows}}));return rows;
  };
  const run=async(p:Portfolio,b:StockBinding)=>{
   const key=p.id+':'+b.ticker;
   if(b.config.allocation&&!allocationExecutionDue(new Date())){status(key,'等待00:00 UTC再平衡');return;}
   if(lastBinding.get(key)!==b){lastBinding.set(key,b);due.delete(key);}
   if(busy.has(key)||(due.get(key)??0)>Date.now())return;
   busy.add(key);const epoch=epochs.get(p.id)??0, holding=p.positions.find(h=>h.ticker===b.ticker);
   due.set(key,Date.now()+(b.mode==='rules'?15000:b.mandate.reviewMinutes*60000));usePortfolioStore.setState(s=>({pending:[...s.pending,key]}));
   try{
    let result:PortfolioReview;let staged:ReturnType<typeof stagedPortfolioDecision>|undefined;
    const profile=useAiProfiles.getState().profiles.find(a=>a.id===(b.profileId||useAiProfiles.getState().activeId));
    if(b.mode==='ai'&&!b.config.plan&&!b.config.allocation){
     if(!profile)throw new Error('请选择 AI 接口');status(key,'研判中');
     const quotes=usePortfolioStore.getState().quotes;
     const ownValue=(holding?.shares??0)*(quotes[b.ticker]?.price??holding?.lastPrice??0);
     const raw=await requestAiJson(buildApiUrl('/ai/portfolios/review'),{settings:providerSettings(profile),language:useLanguage.getState().language,market:p.market,goal:b.mandate.goal,universe:[b.ticker],holdings:holding?[{ticker:b.ticker,shares:holding.shares,cost:holding.cost,sellable:portfolioSellable(p,b.ticker,new Date())}]:[],cash:p.cash,other_equity:Math.max(0,portfolioEquity(p,quotes)-p.cash-ownValue),max_single_pct:b.allocationPct,max_gross_pct:b.allocationPct,max_positions:1,fee_bps:b.config.feeBps,slippage_bps:b.config.slippageBps,previous_summary:p.reviews.filter(r=>r.ticker===b.ticker).at(-1)?.decision.summary??'',include_news:b.mandate.news,strategy_rules:b.config.rules??null,strategy_revision:b.mandate.revision??null},controller.signal);
     result=parsePortfolioReview(raw);
     if(useAiProfiles.getState().profiles.find(a=>a.id===profile.id)!==profile)return;
     if(result.decision.targets.some(t=>t.ticker!==b.ticker))throw new Error('策略返回了其他标的');
    }else{
     const ruleKey=JSON.stringify([b.config,b.allocationPct,b.label]);
     if(hasExecutedDailyRule(p.reviews,b.ticker,ruleKey,new Date())){status(key,'等待下一交易日信号');return;}
     const history=await get<HistoryResponse>('/stocks/'+encodeURIComponent(b.ticker)+'/history?period=1y&interval=1d');
     if(history.interval!=='1d'||history.price_type==='snapshot')throw new Error('等待有效日线');
     if(b.config.allocation&&(!history.fetched_at||history.fetched_at.slice(0,10)!==new Date().toISOString().slice(0,10)))throw new Error('等待收盘后的日K快照');
     if(b.config.plan){
      staged=stagedPortfolioDecision(p,b,history.data,usePortfolioStore.getState().quotes,new Date());
      const d=staged.diagnostics,summary=(staged.decision?.label??'等待条件')+'；MA '+[d.shortMa,d.entryMa,d.longMa].map(v=>v?.toFixed(2)??'缺失').join('/')+'；RSI '+(d.rsi?.toFixed(2)??'缺失')+'；量比 '+(d.volumeRatio?.toFixed(2)??'缺失')+'；MACD柱 '+(d.macdHistogram?.toFixed(4)??'缺失')+(b.config.plan.reviewTurnover?'；实时换手率：'+(typeof usePortfolioStore.getState().quotes[b.ticker]?.turnover_rate==='number'?usePortfolioStore.getState().quotes[b.ticker].turnover_rate+'%':'—'):'');
      result={ruleKey,id:crypto.randomUUID(),reviewed_at:new Date().toISOString(),provider:'分批规则引擎',model:'staged-v1',decision:{regime:'日收盘复核',method:staged.decision?.stage??'wait',summary,reconsider_when:'下一日收盘；重要新闻需复核并保存新规则版本',targets:[{ticker:b.ticker,weight_pct:staged.target,reason:staged.decision?.label??'等待条件'}],evidence_ids:['H1']},evidence:[{id:'H1',title:b.ticker+' 日线',source:history.source??'行情',timestamp:staged.signal}]};
      const quoteState=usePortfolioStore.getState().quotes,currentWeight=(holding?.shares??0)*(quoteState[b.ticker]?.price??0)/portfolioEquity(p,quoteState)*100,priceExit=!!staged.decision&&staged.target<currentWeight-.01;
      if(b.config.plan.includeNews&&!priceExit){try{const feed=await get<{items:{title:string;published_at:string;source:string}[]}>('/news?market='+p.market+'&limit=10');const related=(feed.items??[]).filter(n=>n.title.includes(b.ticker)||n.title.includes(b.name)).slice(0,3);result.decision.summary+='；新闻：'+(related.map(n=>n.title).join(' / ')||'市场快讯：'+(feed.items??[]).slice(0,3).map(n=>n.title).join(' / '));}catch{result.decision.summary+='；资讯连接中断';}}
      if(b.config.plan.includeNews&&profile&&!priceExit){
       try{
        const quotes=usePortfolioStore.getState().quotes,own=(holding?.shares??0)*(quotes[b.ticker]?.price??holding?.lastPrice??0),equity=portfolioEquity(p,quotes),currentPct=own/equity*100;
        const ai=parsePortfolioReview(await requestAiJson(buildApiUrl('/ai/portfolios/review'),{settings:providerSettings(profile),language:useLanguage.getState().language,market:p.market,goal:b.mandate.goal,universe:[b.ticker],holdings:holding?[{ticker:b.ticker,shares:holding.shares,cost:holding.cost,sellable:portfolioSellable(p,b.ticker,new Date())}]:[],cash:p.cash,other_equity:Math.max(0,equity-p.cash-own),max_single_pct:b.allocationPct,max_gross_pct:b.allocationPct,max_positions:1,fee_bps:b.config.feeBps,slippage_bps:b.config.slippageBps,include_news:true,strategy_revision:b.mandate.revision??null,rule_target_pct:staged.target},controller.signal));
        result.provider='分批规则+AI新闻复核';result.decision.summary=(result.decision.summary+'；AI新闻复核：'+ai.decision.summary).slice(0,800);
        const recommended=ai.decision.targets.find(t=>t.ticker===b.ticker)?.weight_pct??0;
        if(staged.decision&&staged.target>currentPct+.01&&recommended<=currentPct+.01){staged={...staged,decision:null,target:currentPct};result.decision.targets=[{ticker:b.ticker,weight_pct:currentPct,reason:'新闻风险复核暂停本次新增买入'}];result.decision.summary=(result.decision.summary+'；暂停本次新增买入').slice(0,800);}
        const extra=ai.evidence.slice(0,8);result.evidence.push(...extra);result.decision.evidence_ids.push(...ai.decision.evidence_ids.filter(id=>extra.some(e=>e.id===id)));
       }catch{if(staged.decision&&staged.decision.action==='target'&&staged.target>(holding?.shares??0)*(usePortfolioStore.getState().quotes[b.ticker]?.price??0)/portfolioEquity(p,usePortfolioStore.getState().quotes)*100+.01){const currentPct=(holding?.shares??0)*(usePortfolioStore.getState().quotes[b.ticker]?.price??0)/portfolioEquity(p,usePortfolioStore.getState().quotes)*100;staged={...staged,decision:null,target:currentPct};result.decision.targets=[{ticker:b.ticker,weight_pct:currentPct,reason:'新闻AI复核失败，暂停新增买入'}];}result.decision.summary=(result.decision.summary+'；新闻复核连接中断').slice(0,800);}
      }else if(b.config.plan.includeNews){result.decision.summary=(result.decision.summary+(priceExit?'；退出信号已执行':'；资讯跟踪已启用')).slice(0,800);}
     }else{
     const decision=paperDecision(positionAccount({...p,config:b.config},b.ticker),history.data,new Date());
     result={ruleKey,id:crypto.randomUUID(),reviewed_at:new Date().toISOString(),provider:'规则引擎',model:b.config.kind,decision:{regime:'日线信号',method:b.label,summary:decision.target?'持有或买入信号':'空仓或卖出信号',reconsider_when:'下一交易日信号',targets:[{ticker:b.ticker,weight_pct:b.config.allocation?Math.min(b.allocationPct,decision.targetPct):decision.target?b.allocationPct:0,reason:decision.reason}],evidence_ids:['H1']},evidence:[{id:'H1',title:b.ticker+' 日线',source:history.source??'行情',timestamp:decision.signal}]};
     }
    }
    const mayApply=()=>{
     const current=usePortfolioStore.getState().portfolios.find(a=>a.id===p.id), currentBinding=current?.bindings?.find(a=>a.ticker===b.ticker), currentHolding=current?.positions.find(h=>h.ticker===b.ticker);
     return !stopped&&(!b.config.allocation||allocationExecutionDue(new Date()))&&usePortfolioStore.getState().owner&&usePortfolioStore.getState().running.includes(p.id)&&(epochs.get(p.id)??0)===epoch&&currentBinding===b&&b.enabled&&currentHolding?.shares===holding?.shares&&currentHolding?.cost===holding?.cost;
    };
    if(!mayApply())return;await refresh([b.ticker]);if(!mayApply()||Date.now()-Date.parse(result.reviewed_at)>120000)return;
    const current=usePortfolioStore.getState().portfolios.find(a=>a.id===p.id)!;
    let next=current;const target=result.decision.targets.find(t=>t.ticker===b.ticker)?.weight_pct??0;
    try{next=staged&&!staged.decision?current:applyStockTarget(current,b,target,usePortfolioStore.getState().quotes,result.decision.targets.find(t=>t.ticker===b.ticker)?.reason??result.decision.summary);result.execution=next.orders.length>current.orders.length?'已成交':'未下单';if(staged?.decision&&result.execution==='已成交'){next.orders[next.orders.length-1].planStage=staged.decision.stage;next.orders[next.orders.length-1].planKey=staged.planKey;if(staged.reductionTargetShares!==undefined)next.orders[next.orders.length-1].planReductionTargetShares=staged.reductionTargetShares;}}
    catch(e){result.execution=e instanceof Error?e.message:'未成交';}
    result={...result,ticker:b.ticker,strategy:b.label};
    if(updatePortfolio({...next,reviews:mergePortfolioReview(next.reviews,result)}))status(key,result.execution??'已研判');
   }catch(e){status(key,e instanceof Error?e.message:'研判失败');}
   finally{busy.delete(key);if(!stopped)usePortfolioStore.setState(s=>({pending:s.pending.filter(id=>id!==key),status:s.status[key]==='研判中'?{...s.status,[key]:'待研判'}:s.status}));}
  };
  const tick=()=>{
   const state=usePortfolioStore.getState();if(stopped||!state.owner||!navigator.onLine)return;
   for(const p of state.portfolios){
    if(quoteBusy.has(p.id))continue;const universe=portfolioUniverse(p,useStockStore.getState().watchlist);
    if(!universe.length||universe.length>40)continue;quoteBusy.add(p.id);
    void refresh(universe.map(s=>s.ticker)).then(quotes=>{
     if(stopped)return;const current=usePortfolioStore.getState().portfolios.find(a=>a.id===p.id);if(!current)return;
     if(current.positions.every(h=>!quoteExecutionIssue(h.ticker,quotes[h.ticker],new Date()))){const point={time:new Date().toISOString(),equity:portfolioEquity(current,quotes)},curve=[...current.curve];if(curve.length&&Date.now()-Date.parse(curve.at(-1)!.time)<60000)curve[curve.length-1]=point;else curve.push(point);updatePortfolio({...current,curve:curve.slice(-2000)});}
     if(usePortfolioStore.getState().running.includes(p.id))for(const b of current.bindings??[]){if(!b.enabled)continue;const issue=quoteExecutionIssue(b.ticker,quotes[b.ticker],new Date());if(issue)status(p.id+':'+b.ticker,issue);else void run(usePortfolioStore.getState().portfolios.find(a=>a.id===p.id)!,b);}
    }).catch(()=>status(p.id,'行情暂不可用')).finally(()=>quoteBusy.delete(p.id));
   }
  };
  if(navigator.locks)void navigator.locks.request('marketdesk-portfolio-runner',{signal:controller.signal},async()=>{if(stopped)return;usePortfolioStore.setState({...loadPortfolios(),owner:true});tick();await new Promise<void>(resolve=>{release=resolve;});}).catch(()=>{});
  const unsubscribe=usePortfolioStore.subscribe((s,prev)=>{if(s.running!==prev.running){for(const id of new Set([...s.running,...prev.running]))if(s.running.includes(id)!==prev.running.includes(id))epochs.set(id,(epochs.get(id)??0)+1);tick();}else if(s.portfolios.length!==prev.portfolios.length)tick();});
  const sync=()=>{if(!usePortfolioStore.getState().owner)usePortfolioStore.setState(loadPortfolios());};window.addEventListener('storage',sync);const timer=window.setInterval(tick,15000);
  return()=>{stopped=true;controller.abort();release?.();unsubscribe();window.removeEventListener('storage',sync);clearInterval(timer);usePortfolioStore.setState({owner:false,running:[],pending:[]});};
 },[]);
}

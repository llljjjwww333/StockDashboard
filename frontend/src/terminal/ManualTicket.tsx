import { formatTradingPrice, formatTradingQuantity, formatTradingFee } from '../lib/tradingNumber';
import { getLocale } from '../lib/i18n';
import { useEffect, useRef, useState } from 'react';
import type { WatchlistStock } from '../store/stockStore';
import { buildApiUrl } from '../lib/api';
import { usePortfolioStore, updatePortfolio } from './portfolioStore';
import { executePortfolioOrder, portfolioEquity, portfolioSellable, portfolioUniverse, type Portfolio } from './portfolio';
import { useStockSearch } from './useTerminalData';
import { manualOrderDetails } from './manualOrder';
import type { Quote } from './types';

export type ManualOrderSelection={ticker:string;side:'buy'|'sell'};
export function ManualTicket({portfolio:p,watchlist,disabled,initialOrder,onOrders}:{portfolio:Portfolio;watchlist:WatchlistStock[];disabled:boolean;initialOrder?:ManualOrderSelection;onOrders:()=>void}){
 const [selectedTicker,setTicker]=useState(initialOrder?.ticker??portfolioUniverse(p,watchlist)[0]?.ticker??''),[query,setQuery]=useState(''),[side,setSide]=useState<'buy'|'sell'>(initialOrder?.side??'buy');
 const [quantity,setQuantity]=useState(initialOrder?.side==='sell'?portfolioSellable(p,initialOrder.ticker,new Date())||1:p.market==='CRYPTO'?.001:p.market==='CN'?100:1),[receipt,setReceipt]=useState(''),[failure,setFailure]=useState('');
 const quantityInput=useRef<HTMLInputElement>(null),search=useStockSearch(query,p.market),quotes=usePortfolioStore(s=>s.quotes),stocks=portfolioUniverse(p,watchlist),ticker=stocks.some(s=>s.ticker===selectedTicker)?selectedTicker:stocks[0]?.ticker??'',quote=quotes[ticker];
 const details=manualOrderDetails(p,ticker,side,quantity,quote);
 useEffect(()=>{if(initialOrder){quantityInput.current?.focus({preventScroll:true});quantityInput.current?.scrollIntoView({block:'center',behavior:'smooth'});}},[initialOrder]);
 useEffect(()=>{
  if(!ticker)return;const controller=new AbortController();
  void fetch(buildApiUrl('/stocks/'+encodeURIComponent(ticker)+'/quote'),{signal:controller.signal})
   .then(r=>r.ok?r.json():Promise.reject()).then((q:Quote)=>{if(!controller.signal.aborted&&q.ticker===ticker&&Number.isFinite(q.price)&&q.price>0)usePortfolioStore.setState(s=>({quotes:{...s.quotes,[ticker]:q}}));}).catch(()=>{});
  return()=>controller.abort();
 },[ticker]);
 const clear=()=>{setReceipt('');setFailure('');};
 const trade=()=>{
  try{
   const state=usePortfolioStore.getState(),current=state.portfolios.find(a=>a.id===p.id),currentQuote=state.quotes[ticker];
   if(disabled||!state.owner||!current)throw new Error('当前账户不可交易');
   const check=manualOrderDetails(current,ticker,side,quantity,currentQuote);if(check.error)throw new Error(check.error);
   const next=executePortfolioOrder(current,ticker,side,quantity,currentQuote,'手动交易',stocks.find(s=>s.ticker===ticker)?.name??ticker);
   next.orders[next.orders.length-1].strategy='手动';
   const point={time:new Date().toISOString(),equity:portfolioEquity(next,state.quotes)},curve=[...next.curve];if(curve.at(-1)?.time===point.time)curve[curve.length-1]=point;else curve.push(point);next.curve=curve.slice(-2000);next.bindings=(next.bindings??[]).map(b=>b.ticker===ticker?{...b,enabled:false}:b);
   if(updatePortfolio(next)){if(!next.bindings?.some(b=>b.enabled))usePortfolioStore.setState(s=>({running:s.running.filter(id=>id!==p.id)}));setFailure('');setReceipt(`已${side==='buy'?'买入':'卖出'} ${ticker} · ${quantity} 币`);}
   else setFailure(usePortfolioStore.getState().error||'账户保存失败');
  }catch(e){setReceipt('');setFailure(e instanceof Error?e.message:'交易失败');}
 };
 return <aside className="portfolio-control-panel manual-ticket" aria-label="手动交易"><header><h2>手动交易</h2></header>
  <label>标的<select aria-label="手动交易标的" value={ticker} onChange={e=>{setTicker(e.target.value);clear();}}><option value="" disabled>选择交易对</option>{stocks.map(s=><option key={s.ticker} value={s.ticker}>{s.ticker} · {s.name}</option>)}</select></label>
  <details className="manual-stock-search"><summary>搜索交易对</summary>  <input aria-label="搜索手动标的" type="search" placeholder="代码或名称" value={query} onChange={e=>setQuery(e.target.value)}/>
  {query.trim()&&<div className="manual-search-results">{search.results.map(s=><button key={s.ticker} disabled={disabled} onClick={()=>{
   const current=usePortfolioStore.getState().portfolios.find(a=>a.id===p.id);if(!current)return;
   if(updatePortfolio({...current,poolMode:'custom',pool:[...portfolioUniverse(current,watchlist).filter(n=>n.ticker!==s.ticker),{...s,market:p.market}]})){setTicker(s.ticker);setQuery('');clear();}
  }}>{s.ticker} · {s.name}</button>)}</div>}
</details>
  <div className="manual-quote"><strong>{quote?formatTradingPrice(ticker,quote.price,getLocale()):'—'}</strong><small>{quote?.source}</small></div>
  <div className="manual-side"><button aria-pressed={side==='buy'} onClick={()=>{setSide('buy');clear();}}>买入</button><button aria-pressed={side==='sell'} onClick={()=>{setSide('sell');clear();}}>卖出</button></div>
  <div className="manual-quantity-heading"><label htmlFor="manual-quantity">数量</label><button className="manual-max" disabled={disabled||details.maximum<=0} onClick={()=>{setQuantity(details.maximum);clear();}}>{side==='buy'?'可买':'可卖'} {formatTradingQuantity(details.maximum,getLocale())} 币</button></div>
  <div className="manual-order-size"><input id="manual-quantity" ref={quantityInput} aria-label="手动委托数量" aria-describedby="manual-quantity-status" aria-invalid={!!details.error} type="number" min={p.market==='CRYPTO'?1e-8:1} step={side==='buy'||p.market==='CRYPTO'?details.unit:1} value={Number.isFinite(quantity)?quantity:''} onChange={e=>{setQuantity(e.target.valueAsNumber);clear();}}/>
  <div className="manual-sizes">{[.25,.5,1].map(f=><button key={f} disabled={disabled||details.maximum<=0} onClick={()=>{setQuantity(side==='buy'||p.market==='CRYPTO'?Number((Math.floor(details.maximum*f/details.unit+1e-9)*details.unit).toFixed(8)):Math.floor(details.maximum*f));clear();}}>{f===1?'全部':f*100+'%'}</button>)}</div></div>
  <div className="manual-amount"><span>{side==='buy'?'预计支出':'预计收入'}</span><b>{details.amount===null?'—':formatTradingFee(ticker,details.amount,getLocale())}</b></div>
  <p id="manual-quantity-status" className="manual-feedback" role="status">{receipt?'':failure||details.error}</p>
  <button className="primary" disabled={disabled||!!details.error} onClick={trade}>提交{side==='buy'?'买入':'卖出'}</button>
  {receipt&&<div className="manual-receipt" role="status"><span>{receipt}</span><button onClick={onOrders}>查看成交</button></div>}
 </aside>;
}

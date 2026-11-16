import { memo, useMemo, useState } from 'react';
import type { PortfolioOrder, PortfolioReview } from './portfolio';
import { filterPortfolioOrders, filterPortfolioReviews, portfolioOrdersCsv, type OrderFilter } from './portfolioActivityData';
import { formatTradingPrice, formatTradingQuantity, formatTradingFee } from '../lib/tradingNumber';
import { downloadFile } from '../lib/downloadFile';

function Pager({ page, size, count, onPage, onSize }: { page: number; size: number; count: number; onPage: (page: number) => void; onSize: (size: number) => void }) {
 const pages=Math.max(1,Math.ceil(count/size)),current=Math.min(page,pages),start=(current-1)*size;
 return <div className="portfolio-activity-pages"><span role="status">{count?`${start+1}–${Math.min(start+size,count)} / ${count}`:'0 / 0'}</span>
  <label>每页<select aria-label="模拟记录每页条数" value={size} onChange={e=>onSize(Number(e.target.value))}>{[20,50,100].map(n=><option key={n} value={n}>{n}</option>)}</select></label>
  <button type="button" aria-label="上一页模拟记录" disabled={current===1} onClick={()=>onPage(current-1)}>上一页</button><span>{current} / {pages}</span>
  <button type="button" aria-label="下一页模拟记录" disabled={current===pages} onClick={()=>onPage(current+1)}>下一页</button>
 </div>;
}
export const PortfolioOrders=memo(function PortfolioOrders({orders,locale,accountName}:{orders:PortfolioOrder[];locale:string;accountName:string}){
 const [filter,setFilter]=useState<OrderFilter>({query:'',side:'all',status:'all'}),[page,setPage]=useState(1),[size,setSize]=useState(50),[notice,setNotice]=useState('');
 const rows=useMemo(()=>filterPortfolioOrders(orders,filter),[orders,filter]),current=Math.min(page,Math.max(1,Math.ceil(rows.length/size))),shown=rows.slice((current-1)*size,current*size);
 const update=(change:Partial<OrderFilter>)=>{setFilter({...filter,...change});setPage(1);setNotice('');};
 return <section className="portfolio-activity" aria-label="委托记录">
  <div className="portfolio-activity-filters"><input type="search" aria-label="筛选委托记录" placeholder="交易对、委托号、策略或原因" value={filter.query} onChange={e=>update({query:e.target.value})}/>
   <select aria-label="委托方向" value={filter.side} onChange={e=>update({side:e.target.value as OrderFilter['side']})}><option value="all">全部方向</option><option value="buy">买入</option><option value="sell">卖出</option></select>
   <select aria-label="委托状态" value={filter.status} onChange={e=>update({status:e.target.value as OrderFilter['status']})}><option value="all">全部状态</option><option value="filled">已成交</option><option value="rejected">未成交</option></select>
   <span>{rows.length} / {orders.length} 条委托</span><button type="button" disabled={!rows.length} onClick={()=>{try{downloadFile(portfolioOrdersCsv(rows),accountName+'-orders.csv','text/csv;charset=utf-8');setNotice('已导出 '+rows.length+' 条筛选记录');}catch{setNotice('导出失败，请重试');}}}>导出筛选记录 CSV</button>
  </div>{notice&&<p role="status">{notice}</p>}
  <Pager page={page} size={size} count={rows.length} onPage={setPage} onSize={n=>{setSize(n);setPage(1);}}/>
  <div className="portfolio-table"><table><thead><tr>{['时间','标的','方向','数量','成交价','费用','来源','状态','原因'].map(s=><th key={s}>{s}</th>)}</tr></thead><tbody>{shown.map(order=><tr key={order.id} data-order-id={order.id}>
   <td title={'委托编号：'+order.id}>{new Date(order.time).toLocaleString(locale)}</td><td>{order.ticker}</td><td>{order.side==='buy'?'买入':'卖出'}</td><td>{formatTradingQuantity(order.quantity,locale)}</td>
   <td>{order.fill?formatTradingPrice(order.ticker,order.fill.price,locale):'—'}</td><td>{order.fill?formatTradingFee(order.ticker,order.fill.fee,locale):'—'}</td>
   <td>{order.strategy??'历史交易'}</td><td>{order.status==='filled'?'已成交':'未成交'}</td><td>{order.reason}</td>
  </tr>)}</tbody></table>{!rows.length&&<div className="portfolio-empty">{orders.length?'没有匹配的委托':'暂无委托'}</div>}</div>
 </section>;
});
export const PortfolioDecisions=memo(function PortfolioDecisions({reviews,locale}:{reviews:PortfolioReview[];locale:string}){
 const [query,setQuery]=useState(''),[page,setPage]=useState(1),[size,setSize]=useState(20),rows=useMemo(()=>filterPortfolioReviews(reviews,query),[reviews,query]);
 const current=Math.min(page,Math.max(1,Math.ceil(rows.length/size))),shown=rows.slice((current-1)*size,current*size);
 return <section className="portfolio-activity" aria-label="决策记录"><div className="portfolio-activity-filters"><input type="search" aria-label="筛选决策记录" placeholder="交易对、策略或决策内容" value={query} onChange={e=>{setQuery(e.target.value);setPage(1);}}/><span>{rows.length} / {reviews.length} 条决策</span></div>
  <Pager page={page} size={size} count={rows.length} onPage={setPage} onSize={n=>{setSize(n);setPage(1);}}/>
  <div className="portfolio-decisions">{shown.map(review=><article key={review.id} data-review-id={review.id}><header><strong>{review.ticker??'历史组合'}</strong><span>{review.strategy??review.decision.method}</span><time>{new Date(review.reviewed_at).toLocaleString(locale)}</time><small>{review.execution}</small></header>
   <div className="portfolio-target-chips">{review.decision.targets.map(target=><span key={target.ticker}>{target.ticker}<b>{target.weight_pct}%</b></span>)}</div><details><summary>详情</summary><p>{review.decision.summary}</p><p>{review.decision.reconsider_when}</p>{review.decision.evidence_ids.map(id=>{const e=review.evidence.find(e=>e.id===id);return e?<p key={id}>{e.title} · {e.source} · {e.timestamp}</p>:null;})}</details>
  </article>)}{!rows.length&&<div className="portfolio-empty">{reviews.length?'没有匹配的决策':'暂无决策'}</div>}</div>
 </section>;
});

import { exchangeDay } from './paperTrading.ts';
import type { PortfolioReview } from './portfolio.ts';
const completed=(review:PortfolioReview)=>review.execution==='已成交'||review.execution==='未下单';
export function hasExecutedDailyRule(reviews:PortfolioReview[],ticker:string,ruleKey:string,now:Date){
 const day=exchangeDay(ticker,now);return reviews.some(r=>r.ticker===ticker&&r.ruleKey===ruleKey&&completed(r)&&exchangeDay(ticker,new Date(r.reviewed_at))===day);
}
export function mergePortfolioReview(reviews:PortfolioReview[],review:PortfolioReview){
 if(review.ruleKey&&review.ticker&&!completed(review)){
  const day=exchangeDay(review.ticker,new Date(review.reviewed_at)),previous=reviews.findLastIndex(r=>r.ticker===review.ticker&&r.ruleKey===review.ruleKey&&!completed(r)&&r.execution===review.execution&&exchangeDay(review.ticker!,new Date(r.reviewed_at))===day&&JSON.stringify(r.decision.targets)===JSON.stringify(review.decision.targets));
  if(previous>=0)return reviews.map((r,i)=>i===previous?{...review,id:r.id}:r);
 }
 return [...reviews,review].slice(-200);
}

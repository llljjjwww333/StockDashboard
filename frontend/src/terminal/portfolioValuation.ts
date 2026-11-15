import { isOlderQuote, toStoredQuote } from '../lib/quotes.ts';
import { marketPhase } from './marketSession.ts';
import { exchangeDay } from './paperTrading.ts';
import { completedDailyCutoff } from './dailyHistory.ts';
import type { Portfolio, PortfolioPosition } from './portfolio.ts';
import type { Quote } from './types';

export function valuationQuoteIssue(ticker:string,quote:Quote|undefined,now:Date){
 if(!quote||quote.ticker!==ticker||!Number.isFinite(quote.price)||quote.price<=0)return '等待有效报价';
 const stamp=Date.parse(quote.as_of??''),age=now.getTime()-stamp;
 if(!Number.isFinite(stamp)||age< -5000||quote.stale)return '旧报价';
 const fetched=quote.fetched_at===undefined?stamp:Date.parse(quote.fetched_at??''),confirmation=now.getTime()-fetched;
 if(!Number.isFinite(fetched)||confirmation< -5000||confirmation>120000)return '旧报价';
 if(marketPhase(ticker,now)==='交易时段'&&age>120000)return '旧报价';
 if(exchangeDay(ticker,new Date(stamp))<completedDailyCutoff(ticker,now,now.toISOString()))return '旧报价';
 return '';
}
export function mergePortfolioQuotes(current:Record<string,Quote>,tickers:string[],incoming:Quote[],now:Date){
 const rows:Record<string,Quote>={};
 for(const ticker of tickers){
  const previous=current[ticker];rows[ticker]={...(previous??{ticker,price:0,volume:0,change_percent:0}),stale:true};
  for(const quote of incoming.filter(q=>q.ticker===ticker)){
   if(valuationQuoteIssue(ticker,quote,now))continue;
   if(previous&&isOlderQuote(toStoredQuote(quote),toStoredQuote(previous))){rows[ticker]=previous;continue;}
   rows[ticker]=quote;
  }
 }
 return rows;
}
export function positionMarkPrice(position:PortfolioPosition,quote?:Quote){
 const recorded=Date.parse(position.lastQuoteAt??''),stamp=Date.parse(quote?.as_of??'');
 return quote?.ticker===position.ticker&&!quote.stale&&Number.isFinite(quote.price)&&quote.price>0&&(!Number.isFinite(recorded)||Number.isFinite(stamp)&&stamp>=recorded)?quote.price:position.lastPrice;
}
export function markPortfolio(input:Portfolio,quotes:Record<string,Quote>,now:Date){
 let changed=false,complete=true;
 const positions=input.positions.map(p=>{
  const quote=quotes[p.ticker],recorded=Date.parse(p.lastQuoteAt??'');
  if(valuationQuoteIssue(p.ticker,quote,now)||Number.isFinite(recorded)&&Date.parse(quote.as_of??'')<recorded){complete=false;return p;}
  if(p.lastPrice===quote.price&&p.lastQuoteAt===quote.as_of&&p.lastQuoteSource===quote.source)return p;
  changed=true;return {...p,lastPrice:quote.price,lastQuoteAt:quote.as_of,lastQuoteSource:quote.source??undefined};
 });
 let next=changed?{...input,positions}:input;
 if(complete){
  const point={time:now.toISOString(),equity:next.cash+positions.reduce((sum,p)=>sum+p.shares*p.lastPrice,0)},curve=[...next.curve],last=curve.at(-1);
  if(last&&now.getTime()-Date.parse(last.time)<60000)curve[curve.length-1]=point;else curve.push(point);
  next={...next,curve:curve.slice(-2000)};
 }
 return {portfolio:next,complete};
}

import { isCryptoTicker, isChinaTicker } from '../lib/instrumentIdentity.ts';
import { marketHours } from '../lib/marketCalendar.ts';
import type { HistoryPoint } from './types';
const clocks={CN:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}),US:new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'})};
function sessionTime(ticker:string,now:Date){const market=isChinaTicker(ticker)?'CN':'US',parts=Object.fromEntries(clocks[market].formatToParts(now).map(p=>[p.type,p.value]));return {market,day:`${parts.year}-${parts.month}-${parts.day}`,minutes:Number(parts.hour)*60+Number(parts.minute)} as const;}
export function previousTradingDay(ticker:string,day:string){
 if(isCryptoTicker(ticker))return new Date(Date.parse(day+'T00:00:00Z')-86400000).toISOString().slice(0,10);
 const market=isChinaTicker(ticker)?'CN':'US',date=new Date(day+'T00:00:00Z');
 do{date.setUTCDate(date.getUTCDate()-1);}while(!marketHours(market,date.toISOString().slice(0,10)));
 return date.toISOString().slice(0,10);
}
export function completedDailyCutoff(ticker:string,now:Date,fetchedAt?:string){
 if(isCryptoTicker(ticker))return previousTradingDay(ticker,now.toISOString().slice(0,10));
 const session=sessionTime(ticker,now),hours=marketHours(session.market,session.day),fetched=Date.parse(fetchedAt??'');
 if(hours&&session.minutes>=hours.regular&&Number.isFinite(fetched)&&fetched<=now.getTime()+5000){
  const source=sessionTime(ticker,new Date(fetched));if(source.day===session.day&&source.minutes>=hours.regular)return session.day;
 }
 return previousTradingDay(ticker,session.day);
}
export function completedDailyBars(input:HistoryPoint[],ticker:string,cutoff:string){
 const market=isChinaTicker(ticker)?'CN':'US';
 return input.filter(p=>p.timestamp.slice(0,10)<=cutoff&&(isCryptoTicker(ticker)||!!marketHours(market,p.timestamp.slice(0,10)))).sort((a,b)=>Date.parse(a.timestamp)-Date.parse(b.timestamp));
}

import type { NewsItem } from './types';
import type { NewsView } from './newsView';
import { isCryptoTicker } from '../lib/instrumentIdentity.ts';

export const newsId = (item:NewsItem) => item.id || item.url || JSON.stringify([item.source,item.title,item.published_at]);
const aliases:Record<string,string[]>={BTC:['比特币','bitcoin'],ETH:['以太坊','ethereum'],SOL:['solana'],BNB:['币安币'],XRP:['ripple'],DOGE:['狗狗币','dogecoin'],ADA:['cardano'],AVAX:['avalanche'],LINK:['chainlink'],SUI:[],TON:['toncoin'],TRX:['tron'],DOT:['polkadot'],LTC:['litecoin'],PEPE:[],HYPE:['hyperliquid']};
export function newsCoins(item:NewsItem) {
  if(item.tickers?.length)return item.tickers.filter(isCryptoTicker);
  const text=item.title+' '+item.summary;
  return Object.entries(aliases).filter(([coin,names])=>new RegExp(`(^|[^a-z0-9])${coin}(USDT)?([^a-z0-9]|$)`,'i').test(text)||names.some(name=>text.toLowerCase().includes(name))).map(([coin])=>coin+'USDT');
}
export const newsLanguage=(item:NewsItem)=>item.language==='zh'||item.language==='en'?item.language:/[\u3400-\u9fff]/.test(item.title)?'zh':'en';

export function filterNews(items:NewsItem[],view:NewsView,read:ReadonlySet<string>,now=Date.now()) {
  const query=view.query.normalize('NFKC').trim().toLocaleLowerCase(),language=view.language??'zh';
  const age=view.window==='24h'?86400000:view.window==='7d'?7*86400000:Infinity;
  return items.filter(item=>{
    const time=Date.parse(item.published_at),coins=newsCoins(item);
    return Number.isFinite(time)&&time<=now+300000&&now-time<=age&&
      (view.source==='ALL'||item.source===view.source)&&(language==='ALL'||newsLanguage(item)===language)&&
      (!view.coin||view.coin==='ALL'||coins.includes(view.coin))&&(!view.topic||view.topic==='ALL'||(item.topic??'市场')===view.topic)&&
      (!view.unreadOnly||!read.has(newsId(item)))&&
      (!query||`${item.title} ${item.summary} ${coins.join(' ')} ${item.source} ${item.topic??''}`.normalize('NFKC').toLocaleLowerCase().includes(query));
  }).sort((a,b)=>Date.parse(b.published_at)-Date.parse(a.published_at));
}

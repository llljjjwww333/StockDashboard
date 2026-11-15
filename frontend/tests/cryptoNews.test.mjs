import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterNews,newsCoins,newsId } from '../src/terminal/newsFilters.ts';
import { normalizeNewsView } from '../src/terminal/newsView.ts';
import { parseNewsLibrary,newsLibraryKey,toggleNewsSaved,markNewsRead,useNewsLibrary } from '../src/terminal/newsLibrary.ts';
import { ResourceCache } from '../src/lib/resourceCache.ts';
const now=Date.parse('2026-11-15T06:00:00Z');
const items=[
 {id:'btc',title:'比特币ETF新闻',summary:'BTC 资金流入',source:'PANews',market:'CRYPTO',language:'zh',tickers:['BTCUSDT'],topic:'ETF / 机构',published_at:'2026-11-15T05:00:00Z',url:'https://example.com/btc'},
 {id:'eth',title:'Ethereum staking activity',summary:'ETH staking',source:'CoinDesk',market:'CRYPTO',language:'en',tickers:['ETHUSDT'],topic:'DeFi / 链上',published_at:'2026-11-15T04:00:00Z',url:'https://example.com/eth'},
 {id:'old',title:'比特币市场动态',summary:'BTC',source:'ChainCatcher',market:'CRYPTO',language:'zh',tickers:['BTCUSDT'],topic:'市场',published_at:'2026-11-12T04:00:00Z'},
];
const base={query:'',source:'ALL'};
test('CRYPTO news is accepted and persisted by the shared resource cache',async()=>{
 const stored=new Map(),storage={getItem:k=>stored.get(k)??null,setItem:(k,v)=>stored.set(k,v)};
 const body={market:'CRYPTO',updated_at:new Date(now).toISOString(),keywords:['BTC'],items,sources:[{name:'PANews',language:'zh',status:'live',item_count:1,updated_at:new Date(now).toISOString()}]};
 let response=body;const cache=new ResourceCache({storage,now:()=>now,fetcher:async()=>Response.json(response)}),path='/news?market=CRYPTO&limit=200';
 await cache.request(path,path);cache.flushPersistence();assert.equal(cache.read(path).data.market,'CRYPTO');assert(stored.get('marketdesk:market-cache:v1').includes('PANews'));
 response={...body,market:'CN'};await assert.rejects(cache.request(path,path),/Invalid news feed/);assert.equal(cache.read(path).data.market,'CRYPTO');
 response={...body,items:[{...items[0],tickers:'BTC'}]};await assert.rejects(cache.request(path,path),/Invalid news feed/);
});
test('Chinese is the default and coin, source, topic, date and unread filters combine',()=>{
 assert.deepEqual(filterNews(items,base,new Set(),now).map(newsId),['btc','old']);
 assert.deepEqual(filterNews(items,{...base,language:'ALL',coin:'ETHUSDT'},new Set(),now).map(newsId),['eth']);
 assert.deepEqual(filterNews(items,{...base,coin:'BTCUSDT',topic:'ETF / 机构',window:'24h'},new Set(),now).map(newsId),['btc']);
 assert.deepEqual(filterNews(items,{...base,source:'PANews',query:'btc'},new Set(),now).map(newsId),['btc']);
 assert.deepEqual(filterNews(items,{...base,unreadOnly:true},new Set(['btc']),now).map(newsId),['old']);
});
test('filters survive navigation while unknown values and future items are rejected',()=>{
 const state={...base,scope:'CRYPTO',coin:'BTCUSDT',topic:'市场',language:'ALL',window:'7d',savedOnly:true,unreadOnly:false};
 assert.deepEqual(normalizeNewsView(state),state);
 assert.equal(normalizeNewsView({...base,coin:'../../',language:'bad'}).coin,undefined);
 assert.deepEqual(filterNews([{...items[0],published_at:'2026-11-16T00:00:00Z'}],base,new Set(),now),[]);
 assert.deepEqual(newsCoins({...items[0],tickers:undefined,title:'Bitcoin and ETH',summary:''}),['BTCUSDT','ETHUSDT']);
});
test('saved articles remain readable without their live feed and unsafe URLs are removed',()=>{
 const saved=parseNewsLibrary(JSON.stringify({saved:[items[0],items[0],null,{...items[1],url:'javascript:alert(1)'}],read:['btc','btc',4]}));
 assert.equal(saved.saved.length,2);assert.equal(saved.saved[1].url,null);assert.deepEqual(saved.read,['btc']);
 assert.deepEqual(filterNews(saved.saved,{...base,savedOnly:true},new Set(),now).map(newsId),['btc']);
 assert.deepEqual(parseNewsLibrary('broken'),{saved:[],read:[]});
});
test('save, unsave and read actions persist and storage failures preserve existing state',()=>{
 const rows=new Map();globalThis.localStorage={setItem:(k,v)=>rows.set(k,v),getItem:k=>rows.get(k)??null};
 useNewsLibrary.setState({saved:[],read:[],message:''});
 assert.equal(toggleNewsSaved(items[0]),true);markNewsRead(items[0]);
 assert.equal(parseNewsLibrary(rows.get(newsLibraryKey)).saved[0].id,'btc');assert.deepEqual(parseNewsLibrary(rows.get(newsLibraryKey)).read,['btc']);
 globalThis.localStorage.setItem=()=>{throw Error('full');};assert.equal(toggleNewsSaved(items[0]),false);assert.equal(useNewsLibrary.getState().saved.length,1);
 globalThis.localStorage.setItem=(k,v)=>rows.set(k,v);assert.equal(toggleNewsSaved(items[0]),true);assert.equal(useNewsLibrary.getState().saved.length,0);
 delete globalThis.localStorage;
});

import { useEffect, useMemo, useState } from 'react';
import { AiControls, AnalysisSummary } from '../ai/AiControls';
import { useAiProfiles } from '../ai/profileStore';
import { useAnalysis } from '../ai/useAnalysis';
import { ResourceError } from './ResourceError';
import { filterNews, newsCoins, newsId, newsLanguage } from './newsFilters';
import { toggleNewsSaved, useNewsLibrary } from './newsLibrary';
import type { NewsItem, NewsResponse } from './types';
import type { NewsView } from './newsView';
import './newsDesk.css';

type Props={feed:NewsResponse|null;loading:boolean;error:string|null;onRetry:()=>void;onOpenStory:(item:NewsItem)=>void;onOpenTicker:(ticker:string)=>void;onSettings:()=>void;filters:NewsView;onFiltersChange:(filters:NewsView)=>void};
const clock=(value:string)=>new Intl.DateTimeFormat('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value));
const day=(value:string)=>new Intl.DateTimeFormat('zh-CN',{month:'long',day:'numeric',weekday:'short'}).format(new Date(value));

export function NewsDesk({feed,loading,error,onRetry,onOpenStory,onOpenTicker,onSettings,filters,onFiltersChange}:Props){
  const library=useNewsLibrary(),{profiles,activeId}=useAiProfiles(),profile=profiles.find(p=>p.id===activeId);
  const [now,setNow]=useState(Date.now),[pagination,setPagination]=useState({key:'',limit:40});
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),30000);return()=>clearInterval(timer);},[]);
  const read=useMemo(()=>new Set(library.read),[library.read]),saved=useMemo(()=>new Set(library.saved.map(newsId)),[library.saved]);
  const pool=useMemo(()=>filters.savedOnly?library.saved:feed?.items??[],[filters.savedOnly,library.saved,feed?.items]);
  const filtered=useMemo(()=>filterNews(pool,filters,read,now),[pool,filters,read,now]);
  const key=JSON.stringify(filters),limit=pagination.key===key?pagination.limit:40,shown=filtered.slice(0,limit);
  const all=feed?.items??[],sources=[...new Set([...all,...library.saved].map(item=>item.source))];
  for(const source of feed?.sources??[])if(!sources.includes(source.name))sources.push(source.name);
  const coins=[...new Set(['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT',...pool.flatMap(newsCoins)])];
  const topics=[...new Set(['市场','监管','ETF / 机构','交易所','DeFi / 链上','安全','融资',...pool.map(item=>item.topic??'市场')])];
  const update=(value:Partial<NewsView>)=>onFiltersChange({...filters,...value});
  const analysis=useAnalysis('crypto-news:'+key,profile);
  const analyze=()=>analysis.run({scope:'news',market:'CRYPTO',query:[filters.query,filters.coin!=='ALL'?filters.coin:'',filters.topic!=='ALL'?filters.topic:''].filter(Boolean).join(' '),news_source:filters.source,
    news_items:filtered.slice(0,24).map(item=>({...item,title:item.title.slice(0,512),summary:item.summary.slice(0,512),url:item.url&&item.url.length<=1024?item.url:undefined}))});
  const chinese=all.filter(item=>newsLanguage(item)==='zh').length;
  return <div className="crypto-news-desk">
    <header className="page-header"><div><h1>情报</h1><p className="crypto-news-heading">加密市场快讯</p></div><div className="crypto-news-actions"><button type="button" onClick={onRetry} disabled={loading} aria-label="刷新资讯">{loading?'更新中…':'刷新'}</button><AiControls profile={profile} loading={analysis.loading} disabled={!filtered.length} onSettings={onSettings} onRun={analyze} onCancel={analysis.cancel} onClear={analysis.clear} hasResult={!!analysis.result}/></div></header>
    <div className="crypto-news-metrics"><span>中文资讯 <b>{chinese}</b></span><span>全部来源 <b>{sources.length}</b></span><span>收藏 <b>{library.saved.length}</b></span>{feed?.updated_at&&<time dateTime={feed.updated_at}>更新于 {clock(feed.updated_at)}</time>}{feed?.stale&&<small>上次更新</small>}</div>
    <div className="crypto-news-layout"><section className="crypto-news-main">
      <nav className="crypto-news-tabs" aria-label="资讯列表"><button type="button" aria-pressed={!filters.savedOnly&&!filters.unreadOnly} onClick={()=>update({savedOnly:false,unreadOnly:false})}>全部快讯</button><button type="button" aria-pressed={!!filters.unreadOnly&&!filters.savedOnly} onClick={()=>update({savedOnly:false,unreadOnly:true})}>未读</button><button type="button" aria-pressed={!!filters.savedOnly} onClick={()=>update({savedOnly:true,unreadOnly:false})}>收藏 {library.saved.length}</button></nav>
      <div className="crypto-news-filters"><input type="search" aria-label="搜索资讯" placeholder="搜索标题、币种或关键词" maxLength={100} value={filters.query} onChange={e=>update({query:e.target.value})}/><select aria-label="资讯语言" value={filters.language??'zh'} onChange={e=>update({language:e.target.value as NewsView['language']})}><option value="zh">中文</option><option value="ALL">全部语言</option><option value="en">English</option></select><select aria-label="资讯时间范围" value={filters.window??'ALL'} onChange={e=>update({window:e.target.value as NewsView['window']})}><option value="ALL">全部时间</option><option value="24h">24小时</option><option value="7d">近7天</option></select><select aria-label="资讯主题" value={filters.topic??'ALL'} onChange={e=>update({topic:e.target.value})}><option value="ALL">全部主题</option>{topics.map(topic=><option key={topic} value={topic}>{topic}</option>)}</select></div>
      <div className="crypto-news-result-line"><span>{filters.source==='ALL'?'全部来源':filters.source}{filters.coin&&filters.coin!=='ALL'?' · '+filters.coin.replace(/USDT$/,''):''} · {filtered.length} 条</span><button type="button" onClick={()=>onFiltersChange({query:'',source:'ALL',scope:'CRYPTO',language:'zh',window:'ALL',coin:'ALL',topic:'ALL'})}>重置筛选</button></div>
      <ResourceError error={error} loading={loading} onRetry={onRetry} label="重试资讯" hasData={!!all.length}/>
      {library.message&&<p role="status" className="strategy-error">{library.message}</p>}
      {analysis.error&&<p role="status" className="strategy-error">{analysis.error}</p>}{analysis.result&&<AnalysisSummary result={analysis.result}/>}
      <div className="crypto-news-list" aria-label="新闻列表">{shown.map((item,index)=>{
        const id=newsId(item),isSaved=saved.has(id),coins=newsCoins(item),date=day(item.published_at);
        return <div key={id}>{(!index||day(shown[index-1].published_at)!==date)&&<h2 className="crypto-news-date">{date}</h2>}<article className={'crypto-news-row'+(read.has(id)?' is-read':'')} data-news-id={id}>
          <time dateTime={item.published_at}>{clock(item.published_at)}{!read.has(id)&&<i aria-label="未读"/>}</time>
          <div className="crypto-news-copy"><button type="button" className="crypto-news-open" aria-label={'阅读 '+item.title} onClick={()=>onOpenStory(item)}><h3>{item.title}</h3>{item.summary&&<p>{item.summary}</p>}</button><div className="crypto-news-tags"><span>{item.source}</span><small>{item.topic??'市场'}</small>{coins.slice(0,4).map(coin=><button type="button" key={coin} aria-label={'查看 '+coin+' 行情'} onClick={()=>onOpenTicker(coin)}>{coin.replace(/USDT$/,'')} ↗</button>)}</div></div>
          <button type="button" className="crypto-news-save" aria-label={(isSaved?'取消收藏 ':'收藏 ')+item.title} aria-pressed={isSaved} title={isSaved?'取消收藏':'收藏'} onClick={()=>toggleNewsSaved(item)}>{isSaved?'★':'☆'}</button>
        </article></div>;
      })}</div>
      {!shown.length&&<div className="crypto-news-empty" role="status">{loading?'正在获取快讯…':filters.savedOnly?'暂无匹配收藏':error&&!all.length?'点击刷新重新连接':'暂无匹配资讯'}</div>}
      {filtered.length>shown.length&&<button type="button" className="crypto-news-more" onClick={()=>setPagination({key,limit:limit+40})}>加载更多 · 剩余 {filtered.length-shown.length} 条</button>}
    </section><aside className="crypto-news-sidebar"><section><header><h2>资讯来源</h2><button type="button" aria-pressed={filters.source==='ALL'} onClick={()=>update({source:'ALL'})}>全部</button></header><div className="crypto-news-sources">{sources.map(source=>{const state=feed?.sources?.find(s=>s.name===source);return <button type="button" key={source} aria-pressed={filters.source===source} data-source-status={state?.status??'live'} onClick={()=>update({source,language:'ALL'})}><span><i/>{source}</span><small>{state?.status==='cached'?'上次更新':state?.status==='unavailable'?'连接中断':state?.language==='zh'?'中文':'EN'}</small></button>;})}</div></section><section><header><h2>关注币种</h2></header><div className="crypto-news-coins"><button type="button" aria-pressed={!filters.coin||filters.coin==='ALL'} onClick={()=>update({coin:'ALL'})}>全部</button>{coins.slice(0,18).map(coin=><button type="button" key={coin} aria-pressed={filters.coin===coin} onClick={()=>update({coin})}>{coin.replace(/USDT$/,'')}</button>)}</div></section></aside></div>
  </div>;
}

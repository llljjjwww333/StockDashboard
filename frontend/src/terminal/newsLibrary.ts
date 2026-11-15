import { create } from 'zustand';
import type { NewsItem } from './types';
import { newsId } from './newsFilters.ts';
import { newsSourceLink } from '../lib/newsSource.ts';

export const newsLibraryKey='marketdesk:crypto:news-library:v1';
export function parseNewsLibrary(raw:string|null):{saved:NewsItem[];read:string[]} {
  try {
    if(raw&&raw.length>1500000)return {saved:[],read:[]};
    const data=JSON.parse(raw??'{}'),saved:NewsItem[]=[],seen=new Set<string>();
    for(const item of (Array.isArray(data.saved)?data.saved:[]).slice(0,200)){
      if(!item||typeof item.title!=='string'||!item.title.trim()||item.title.length>512||typeof item.source!=='string'||typeof item.summary!=='string'||!Number.isFinite(Date.parse(item.published_at)))continue;
      const next:NewsItem={title:item.title,summary:item.summary.slice(0,1000),source:item.source.slice(0,128),published_at:item.published_at,market:'CRYPTO',url:newsSourceLink(item.url)?.href??null,
        ...(typeof item.id==='string'&&item.id.length<=200?{id:item.id}:{}),...(typeof item.language==='string'?{language:item.language}:{}),...(typeof item.topic==='string'?{topic:item.topic.slice(0,40)}:{}),...(Array.isArray(item.tickers)?{tickers:item.tickers.filter((s:unknown)=>typeof s==='string')}:{} )};
      const id=newsId(next);if(!seen.has(id)){saved.push(next);seen.add(id);}
    }
    return {saved,read:Array.isArray(data.read)?[...new Set<string>(data.read.filter((s:unknown)=>typeof s==='string'&&s.length<=1500))].slice(0,500):[]};
  }catch{return {saved:[],read:[]};}
}
const initial=()=>{try{return parseNewsLibrary(localStorage.getItem(newsLibraryKey));}catch{return {saved:[],read:[]};}};
export const useNewsLibrary=create<{saved:NewsItem[];read:string[];message:string}>(()=>({...initial(),message:''}));
function commit(saved:NewsItem[],read:string[]){
  try{localStorage.setItem(newsLibraryKey,JSON.stringify({saved,read}));useNewsLibrary.setState({saved,read,message:''});return true;}
  catch{useNewsLibrary.setState({message:'未能保存，请重试'});return false;}
}
export function toggleNewsSaved(item:NewsItem){const {saved,read}=useNewsLibrary.getState(),id=newsId(item),exists=saved.some(n=>newsId(n)===id);if(!exists&&saved.length>=200){useNewsLibrary.setState({message:'收藏已满，请先整理'});return false;}return commit(exists?saved.filter(n=>newsId(n)!==id):[item,...saved],read);}
export function markNewsRead(item:NewsItem){const {saved,read}=useNewsLibrary.getState(),id=newsId(item);if(!read.includes(id))commit(saved,[id,...read].slice(0,500));}

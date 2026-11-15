import { useEffect, useRef, useState } from 'react';
import type { WatchlistStock } from '../store/stockStore';
import { t, useLanguage } from '../lib/i18n';
import { useAiProfiles } from '../ai/profileStore';
import { usePortfolioStore, savePortfolios, updatePortfolio, togglePortfolio, parsePortfolios } from './portfolioStore';
import { createPortfolio, defaultMandate, portfolioUniverse, portfolioEquity, portfolioSellable, bindStockStrategy, detachStockStrategy, strategyAllocationAvailable, type Portfolio, type StockBinding, type Mandate } from './portfolio';
import { useMandates } from './mandateStore';
import { useStrategyWorkspace } from './strategyWorkspace';
import { executableStrategy } from './strategyDefinition';
import { strategyDefaults } from './backtest';
import { useStockSearch } from './useTerminalData';
import { downloadFile } from '../lib/downloadFile';
import { ManualTicket, type ManualOrderSelection } from './ManualTicket';
import './portfolio.css';
const money=(n:number)=>n.toLocaleString(undefined,{maximumFractionDigits:2});
const pct=(n:number)=>(n*100).toFixed(2)+'%';
export function SimulationView({stock,watchlist,onStrategy,onSettings}:{stock?:WatchlistStock|null;watchlist:WatchlistStock[];onStrategy:()=>void;onSettings:()=>void}){
 useLanguage();const state=usePortfolioStore(),mandates=useMandates();
 const [creating,setCreating]=useState(false),[tab,setTab]=useState<'positions'|'strategies'|'orders'|'decisions'|'pool'>('positions'),[message,setMessage]=useState(''),[binding,setBinding]=useState<StockBinding|null|undefined>(undefined),[deployAccount,setDeployAccount]=useState(''),[allocation,setAllocation]=useState<number|null>(null);
 const [ticket,setTicket]=useState<(ManualOrderSelection&{accountId:string;nonce:number})|null>(null);
 const [removed,setRemoved]=useState<{accountId:string;binding:StockBinding}|null>(null);
 const p=state.portfolios.find(p=>p.id===state.selected)??state.portfolios[0],running=!!p&&state.running.includes(p.id),bindings=p?.bindings??[];
 const universe=p?portfolioUniverse(p,watchlist):[],equity=p?portfolioEquity(p,state.quotes):0;
 const importInput=useRef<HTMLInputElement>(null),ledger=useRef<HTMLDivElement>(null);
 const modalOpen=!!mandates.deployment||!!p&&(creating||binding!==undefined);
 const tradeHolding=(ticker:string,side:'buy'|'sell')=>{if(p)setTicket({accountId:p.id,ticker,side,nonce:Date.now()});};
 const reportError=(e:unknown)=>setMessage(e instanceof Error?e.message:'操作失败');
 const attach=(account:Portfolio,mandate:Mandate)=>{
  const s=mandate.instrument;if(!s)throw new Error('请选择策略标的');
  return bindStockStrategy(account,{ticker:s.ticker,name:s.name,label:mandate.name,mode:mandate.execution&&(mandate.execution.plan||mandate.execution.kind!=='custom')?'rules':'ai',mandate:structuredClone(mandate),config:mandate.execution??{...strategyDefaults},profileId:mandates.deploymentProfileId||useAiProfiles.getState().activeId,allocationPct:allocation??mandate.maxSingle,enabled:false});
 };
 const create=(name:string,capital:number,market:'CN'|'US'|'CRYPTO')=>{try{
  if(state.portfolios.length>=8)throw new Error('最多 8 个账户');
  let next=createPortfolio(name,capital,market);
  if(mandates.deployment)next=attach(next,mandates.deployment);
  if(savePortfolios([...state.portfolios,next])){usePortfolioStore.setState({selected:next.id});setCreating(false);setTab('strategies');setDeployAccount('');setAllocation(null);useMandates.setState({deployment:null,deploymentProfileId:undefined});}
 }catch(e){reportError(e);}};
 const startAll=()=>{
  if(!p)return;if(running){togglePortfolio(p.id);return;}
  if(!bindings.length){setMessage('');setTab('strategies');setBinding(null);return;}
  if(bindings.some(b=>b.mode==='ai'&&!useAiProfiles.getState().profiles.some(a=>a.id===(b.profileId||useAiProfiles.getState().activeId)))){setTab('strategies');setMessage('请选择币种策略的 AI 接口');return;}
  if(updatePortfolio({...p,bindings:bindings.map(b=>({...b,enabled:true}))}))togglePortfolio(p.id);setMessage('');
 };
 const toggleStock=(b:StockBinding)=>{
  if(!p)return;const active=running&&b.enabled;
  if(!active&&b.mode==='ai'&&!useAiProfiles.getState().profiles.some(a=>a.id===(b.profileId||useAiProfiles.getState().activeId))){setMessage('请为 '+b.ticker+' 选择 AI 接口');return;}
  const next={...p,bindings:bindings.map(n=>n.ticker===b.ticker?{...n,enabled:!active}:!running?{...n,enabled:false}:n)};
  if(updatePortfolio(next)){if(!active&&!running||active&&!next.bindings.some(b=>b.enabled))togglePortfolio(p.id);setMessage('');}
 };
 const removeBinding=(ticker:string)=>{
  const current=usePortfolioStore.getState().portfolios.find(a=>a.id===p?.id),binding=current?.bindings?.find(b=>b.ticker===ticker);
  if(!state.owner||!current||!binding)return;
  const next=detachStockStrategy(current,ticker);
  if(updatePortfolio(next)){if(!next.bindings?.some(b=>b.enabled))usePortfolioStore.setState(s=>({running:s.running.filter(id=>id!==current.id)}));setRemoved({accountId:current.id,binding});setMessage('');}
 };
 const undoRemoval=()=>{
  if(!state.owner||!removed)return;
  const current=usePortfolioStore.getState().portfolios.find(a=>a.id===removed.accountId);if(!current)return;
  try{if(current.bindings?.some(b=>b.ticker===removed.binding.ticker))throw new Error('该股已绑定策略');
   const next=bindStockStrategy(current,{...removed.binding,enabled:false});if(updatePortfolio(next)){setRemoved(null);setMessage('已恢复，待启动');}
  }catch(e){reportError(e);}
 };
 const importAccount=async(file:File)=>{try{
  if(file.size>8_000_000)throw new Error('文件过大');const raw:unknown=JSON.parse(await file.text()),imported=parsePortfolios(JSON.stringify(Array.isArray(raw)?raw:[raw])),current=usePortfolioStore.getState().portfolios,additions=imported.filter(n=>!current.some(p=>p.id===n.id));
  if(!additions.length)throw new Error('账户已存在');if(current.length+additions.length>8)throw new Error('最多 8 个账户');if(savePortfolios([...current,...additions])){usePortfolioStore.setState({selected:additions[0].id});setMessage('已导入');}
 }catch(e){reportError(e);}finally{if(importInput.current)importInput.current.value='';}};
 const targetMarket=mandates.deployment?.instrument?.market;
 const eligible=state.portfolios.filter(a=>!targetMarket||a.market===targetMarket),deployId=deployAccount||eligible[0]?.id||'new';
 return <section className="portfolio-desk"><header className="desk-module-header"><h1>{t('模拟')}</h1><div className="portfolio-header-actions"><input ref={importInput} type="file" accept="application/json,.json" hidden onChange={e=>{const file=e.target.files?.[0];if(file)void importAccount(file);}}/><button disabled={!state.owner} onClick={()=>importInput.current?.click()}>导入账户</button>{p&&<select aria-label="资金账户" value={p.id} onChange={e=>{usePortfolioStore.setState({selected:e.target.value});setBinding(undefined);setMessage('');}}>{state.portfolios.map(a=><option key={a.id} value={a.id}>{a.name} · {a.market==='CRYPTO'?'USDT':a.market==='CN'?'CNY':'USD'}</option>)}</select>}<button disabled={!state.owner} onClick={()=>{setMessage('');setCreating(true);}}>新建账户</button></div></header>
 {!modalOpen&&(message||state.error)&&<p className="strategy-error" role="alert">{message||state.error}</p>}
 {!p&&!mandates.deployment?<div className="portfolio-onboarding"><div><h2>新建账户</h2><AccountForm onCreate={create} defaultMarket={stock?.market??watchlist[0]?.market??'CRYPTO'} disabled={!state.owner}/></div></div>:p?<>
 <div className="portfolio-account-bar"><div><span className={'portfolio-live-dot'+(running?' active':'')}/><strong>{p.name}</strong><span>{p.market==='CRYPTO'?'USDT · 虚拟币现货':p.market==='CN'?'人民币 · A股':'美元 · 美股'}</span>{!state.owner&&<span>其他页面运行中</span>}</div><div><button onClick={()=>downloadFile(JSON.stringify(p,null,2),p.name+'-account.json','application/json')}>导出账户</button><button className={running?'':'primary'} disabled={!state.owner} onClick={startAll}>{running?'暂停全部':'启动全部'}</button></div></div>
 <div className="portfolio-summary">{[['总资产',money(equity)],['累计收益',pct(equity/p.capital-1)],['可用资金',money(p.cash)],['持仓市值',money(equity-p.cash)],['已实现盈亏',money(p.realized)],['资金使用率',pct(equity?(equity-p.cash)/equity:0)]].map(([label,value])=><div key={label}><small>{label}</small><strong>{value}</strong></div>)}</div>
 <div className="portfolio-main-grid"><div className="portfolio-chart-panel"><div className="portfolio-panel-header"><h2>账户净值</h2><span>初始资金 {p.market==='CRYPTO'?'USDT ':p.market==='CN'?'¥':'$'}{money(p.capital)}</span></div><PortfolioChart portfolio={p}/><div className="portfolio-chart-footer"><span>{p.positions.length} 个持仓</span><span>手续费 {money(p.fees)}</span><span>{p.orders.filter(o=>o.status==='filled').length} 笔成交</span></div></div><ManualTicket key={p.id+':'+(ticket?.accountId===p.id?ticket.nonce:0)} portfolio={p} watchlist={watchlist} disabled={!state.owner} initialOrder={ticket?.accountId===p.id?ticket:undefined} onOrders={()=>{setTab('orders');requestAnimationFrame(()=>ledger.current?.scrollIntoView({block:'start',behavior:'smooth'}));}}/></div>
 <div className="portfolio-runtime-strip"><span>{running?'运行中':'已暂停'}</span><span>行情 15 秒</span><span>策略额度 {money(bindings.reduce((sum,b)=>sum+b.allocationPct,0))}% / 100%</span><button disabled={!state.owner} onClick={()=>{setMessage('');setTab('strategies');setBinding(null);}}>添加币种策略</button></div>
 {removed?.accountId===p.id&&<div className="portfolio-undo" role="status"><span>已移除 {removed.binding.ticker} 策略</span><button disabled={!state.owner} onClick={undoRemoval}>撤销</button></div>}
 <div className="portfolio-ledger" ref={ledger}><nav>{([['positions','持仓'],['strategies','币种策略'],['orders','委托与成交'],['decisions','决策'],['pool','交易对池']]as const).map(([id,label])=><button key={id} aria-pressed={tab===id} onClick={()=>setTab(id)}>{label}<small>{id==='positions'?p.positions.length:id==='strategies'?bindings.length:id==='orders'?p.orders.length:id==='decisions'?p.reviews.length:universe.length}</small></button>)}</nav>
 {tab==='strategies'?<div className="portfolio-table"><table><thead><tr>{['标的','策略','资金比例','状态','操作'].map(s=><th key={s}>{s}</th>)}</tr></thead><tbody>{bindings.map(b=><tr key={b.ticker}><td><b>{b.ticker}</b><small>{b.name}</small></td><td>{b.label}<small>{b.mode==='ai'?'AI 动态':'日线规则'}</small></td><td>{b.allocationPct}%</td><td>{running&&b.enabled?(state.pending.includes(p.id+':'+b.ticker)?'研判中':state.status[p.id+':'+b.ticker]??'运行中'):'已暂停'}</td><td><div className="stock-strategy-actions"><button disabled={!state.owner} onClick={()=>toggleStock(b)}>{running&&b.enabled?'暂停':'启动'}</button><button disabled={!state.owner||running&&b.enabled} onClick={()=>{setMessage('');setBinding(b);}}>编辑</button><button onClick={()=>{useMandates.setState({draft:{...b.mandate,instrument:{ticker:b.ticker,name:b.name,market:p.market}}});useStrategyWorkspace.setState({instrument:{ticker:b.ticker,name:b.name,market:p.market},config:b.config});onStrategy();}}>研究</button><button disabled={!state.owner} aria-label={'移除策略 '+b.ticker} onClick={()=>removeBinding(b.ticker)}>移除</button></div></td></tr>)}</tbody></table>{!bindings.length&&<div className="portfolio-empty"><button disabled={!state.owner} onClick={()=>setBinding(null)}>添加币种策略</button></div>}</div>:tab==='pool'?<InvestmentUniverse portfolio={p} watchlist={watchlist} disabled={!state.owner}/>:tab==='decisions'?<div className="portfolio-decisions">{p.reviews.slice().reverse().map(r=><article key={r.id}><header><strong>{r.ticker??'历史组合'}</strong><span>{r.strategy??r.decision.method}</span><time>{new Date(r.reviewed_at).toLocaleString()}</time><small>{r.execution}</small></header><div className="portfolio-target-chips">{r.decision.targets.map(a=><span key={a.ticker}>{a.ticker}<b>{a.weight_pct}%</b></span>)}</div><details><summary>详情</summary><p>{r.decision.summary}</p><p>{r.decision.reconsider_when}</p>{r.decision.evidence_ids.map(id=>{const e=r.evidence.find(e=>e.id===id);return e?<p key={id}>{e.title} · {e.source} · {e.timestamp}</p>:null;})}</details></article>)}{!p.reviews.length&&<div className="portfolio-empty">暂无决策</div>}</div>:<div className="portfolio-table"><table><thead><tr>{(tab==='positions'?['标的','数量 / 可卖','现价 / 成本','市值','浮动盈亏','策略','操作']:['时间','标的','方向','数量','成交价','费用','来源','状态','原因']).map(s=><th key={s}>{s}</th>)}</tr></thead><tbody>{tab==='positions'?p.positions.map(h=>{const price=state.quotes[h.ticker]?.price||h.lastPrice,b=bindings.find(b=>b.ticker===h.ticker);return <tr key={h.ticker}><td><b>{h.ticker}</b><small>{h.name}</small></td><td>{h.shares}<small>{portfolioSellable(p,h.ticker,new Date())} 可卖</small></td><td>{money(price)}<small>{money(h.cost/h.shares)}</small></td><td>{money(h.shares*price)}</td><td>{money(h.shares*price-h.cost)}</td><td>{b?.label??'手动持仓'}</td><td><div className="stock-strategy-actions"><button disabled={!state.owner} aria-label={'买入 '+h.ticker} onClick={()=>tradeHolding(h.ticker,'buy')}>买入</button><button disabled={!state.owner||!portfolioSellable(p,h.ticker,new Date())} aria-label={'卖出 '+h.ticker} onClick={()=>tradeHolding(h.ticker,'sell')}>卖出</button></div></td></tr>;}):p.orders.slice().reverse().map(o=><tr key={o.id}><td>{new Date(o.time).toLocaleString()}</td><td>{o.ticker}</td><td>{o.side==='buy'?'买入':'卖出'}</td><td>{o.quantity}</td><td>{o.fill?money(o.fill.price):'—'}</td><td>{o.fill?money(o.fill.fee):'—'}</td><td>{o.strategy??'历史交易'}</td><td>{o.status==='filled'?'已成交':'未成交'}</td><td>{o.reason}</td></tr>)}</tbody></table>{(tab==='positions'?!p.positions.length:!p.orders.length)&&<div className="portfolio-empty">{tab==='positions'?'暂无持仓':'暂无委托'}</div>}</div>}
 </div>
 </>:null}
 {creating&&p&&!mandates.deployment&&<Modal message={message||state.error} title="新建账户" onClose={()=>setCreating(false)}><AccountForm onCreate={create} defaultMarket={p.market} disabled={!state.owner}/></Modal>}
 {mandates.deployment&&<Modal message={message||state.error} title={mandates.deployment.name} label="部署策略" onClose={()=>useMandates.setState({deployment:null,deploymentProfileId:undefined})}><label className="deployment-account">账户<select aria-label="部署账户" value={deployId} onChange={e=>setDeployAccount(e.target.value)}>{eligible.map(a=><option key={a.id} value={a.id}>{a.name} · {a.market==='CRYPTO'?'USDT':a.market==='CN'?'CNY':'USD'}</option>)}<option value="new">新建账户</option></select></label><label className="deployment-account">资金比例（%）<input aria-label="部署资金比例" type="number" min={1} max={100} value={allocation??mandates.deployment.maxSingle} onChange={e=>setAllocation(e.target.valueAsNumber)}/></label>{deployId==='new'?<AccountForm onCreate={create} defaultMarket={targetMarket??stock?.market??'CRYPTO'} disabled={!state.owner} submitLabel="创建并部署"/>:<button className="primary deployment-confirm" disabled={!state.owner} onClick={()=>{try{const target=eligible.find(a=>a.id===deployId);if(!target||!mandates.deployment)return;if(updatePortfolio(attach(target,mandates.deployment))){usePortfolioStore.setState({selected:target.id});useMandates.setState({deployment:null,deploymentProfileId:undefined});setDeployAccount('');setAllocation(null);setTab('strategies');setMessage('已绑定');}}catch(e){reportError(e);}}}>部署</button>}</Modal>}
 {p&&binding!==undefined&&<BindingDialog portfolio={p} watchlist={watchlist} binding={binding} onSettings={onSettings} onClose={()=>setBinding(undefined)} onSaved={()=>{setBinding(undefined);setTab('strategies');}}/>}
 </section>;
}
function Modal({title,label,message,onClose,children}:{title:string;label?:string;message?:string;onClose:()=>void;children:React.ReactNode}){
 const ref=useRef<HTMLDialogElement>(null);
 useEffect(()=>{
  const dialog=ref.current,opener=document.activeElement,overflow=document.body.style.overflow;
  dialog?.showModal();document.body.style.overflow='hidden';
  dialog?.querySelector<HTMLElement>('input,select,textarea')?.focus();
  return()=>{dialog?.close();document.body.style.overflow=overflow;if(opener instanceof HTMLElement&&opener.isConnected)opener.focus({preventScroll:true});};
 },[]);
 return <dialog ref={ref} className="portfolio-modal" aria-label={label??title} onKeyDown={e=>{
  if(e.key!=='Tab')return;
  const controls=Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button,input,select,textarea,a[href],[tabindex]')).filter(el=>!el.matches(':disabled,[tabindex="-1"],[type="hidden"]')&&el.getClientRects().length>0),first=controls[0],last=controls.at(-1);
  if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
 }} onCancel={onClose} onClick={e=>{if(e.target===e.currentTarget){const r=e.currentTarget.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)onClose();}}}><header><h2>{title}</h2><button aria-label="关闭弹窗" onClick={onClose}>×</button></header>{message&&<p className="strategy-error" role="alert">{message}</p>}{children}</dialog>;
}
function AccountForm({onCreate,disabled,defaultMarket,submitLabel='创建账户'}:{onCreate:(name:string,capital:number,market:'CN'|'US'|'CRYPTO')=>void;disabled:boolean;defaultMarket:'CN'|'US'|'CRYPTO';submitLabel?:string}){
 const [name,setName]=useState('模拟账户'),[capital,setCapital]=useState(100000),[market,setMarket]=useState(defaultMarket);
 return <form className="portfolio-account-form" onSubmit={e=>{e.preventDefault();onCreate(name,capital,market);}}><label>账户名称<input aria-label="账户名称" required maxLength={80} value={name} onChange={e=>setName(e.target.value)}/></label><label>初始资金<input aria-label="账户初始资金" type="number" required min={100} max={1e9} value={Number.isFinite(capital)?capital:''} onChange={e=>setCapital(e.target.valueAsNumber)}/></label><label>市场<select aria-label="账户市场与币种" value={market} onChange={e=>setMarket(e.target.value as 'CN'|'US'|'CRYPTO')}><option value="CRYPTO">虚拟币现货 · USDT</option></select></label><button className="primary" type="submit" disabled={disabled}>{submitLabel}</button></form>;
}
function BindingDialog({portfolio:p,watchlist,binding:b,onClose,onSaved,onSettings}:{portfolio:Portfolio;watchlist:WatchlistStock[];binding:StockBinding|null;onClose:()=>void;onSaved:()=>void;onSettings:()=>void}){
 const mandates=useMandates(),research=useStrategyWorkspace(),{profiles,activeId}=useAiProfiles();
 const candidates=[...portfolioUniverse(p,watchlist),...mandates.library.flatMap(m=>m.instrument?[m.instrument]:[]),...research.library.map(r=>r.snapshot.instrument)].filter(s=>s.market===p.market&&(!!b||!(p.bindings??[]).some(n=>n.ticker===s.ticker)));
 const [extra,setExtra]=useState<WatchlistStock|null>(null),[ticker,setTicker]=useState(b?.ticker??candidates[0]?.ticker??''),[source,setSource]=useState(b?'bound':'ai'),[profileId,setProfile]=useState(b?.profileId||activeId),[allocation,setAllocation]=useState(b?.allocationPct??Math.min(30,100-(p.bindings??[]).reduce((s,b)=>s+b.allocationPct,0))),[query,setQuery]=useState(''),[message,setMessage]=useState('');
 const search=useStockSearch(query,p.market),rows=[...candidates,...(extra?[extra]:[])].filter(s=>s.market===p.market&&(!!b||!(p.bindings??[]).some(n=>n.ticker===s.ticker))),stocks=rows.filter((s,i)=>rows.findIndex(n=>n.ticker===s.ticker)===i),instrument=stocks.find(s=>s.ticker===ticker);
 const ai=mandates.library.filter(m=>!m.instrument||m.instrument.ticker===ticker),rules=research.library.filter(r=>r.snapshot.instrument.ticker===ticker),report=rules.find(r=>source==='rule:'+r.snapshot.id),selectedMandate=ai.find(m=>source==='ai:'+m.id),mode=source.startsWith('rule:')||source==='current-rule'?'rules':source==='bound'?b!.mode:selectedMandate?.execution&&(selectedMandate.execution.plan||selectedMandate.execution.kind!=='custom')?'rules':'ai';
 const available=strategyAllocationAvailable(p,ticker);
 const save=()=>{try{
  if(!Number.isFinite(allocation)||allocation<1||allocation>available)throw new Error(available?'最多可分配 '+money(available)+'%':'策略额度已用完');
  if(!instrument)throw new Error('请选择标的');if(mode==='ai'&&!profiles.some(p=>p.id===(profileId||activeId)))throw new Error('请选择 AI 接口');const mandate={...(selectedMandate??(source==='bound'?b!.mandate:source==='current-rule'?mandates.draft:defaultMandate)),instrument};
  const config=report?.snapshot.config??(source==='current-rule'?mandates.draft.execution!:source==='bound'?b!.config:selectedMandate?.execution??{...strategyDefaults});
  const label=report?.snapshot.name??(source==='current-rule'?mandates.draft.name:source==='bound'?b!.label:selectedMandate?.name??'AI 币种策略');
  const next=bindStockStrategy(p,{ticker,name:instrument.name,label,mode,mandate,config,profileId:profileId||activeId,allocationPct:allocation,enabled:false});
  if(updatePortfolio(next))onSaved();
 }catch(e){setMessage(e instanceof Error?e.message:'绑定失败');}};
 return <Modal title="币种策略" onClose={onClose}><div className="stock-binding-form"><label>标的<select aria-label="绑定标的" disabled={!!b} value={ticker} onChange={e=>{setTicker(e.target.value);setSource('ai');}}><option value="" disabled>选择交易对</option>{stocks.map(s=><option key={s.ticker} value={s.ticker}>{s.ticker} · {s.name}</option>)}</select></label>{!b&&<><input aria-label="搜索绑定标的" placeholder="代码或名称" value={query} onChange={e=>setQuery(e.target.value)}/>{query.trim()&&<div className="manual-search-results">{search.results.map(s=><button key={s.ticker} disabled={(p.bindings??[]).some(n=>n.ticker===s.ticker)} onClick={()=>{setExtra({...s,market:p.market});setTicker(s.ticker);setSource('ai');setQuery('');}}>{s.ticker} · {s.name}</button>)}</div>}</>}<label>策略<select aria-label="绑定策略" value={source} onChange={e=>setSource(e.target.value)}>{b&&<option value="bound">{b.label}</option>}<option value="ai">AI 币种策略</option>{ai.map(m=><option key={m.id} value={'ai:'+m.id}>{m.name}</option>)}{mandates.draft.instrument?.ticker===ticker&&executableStrategy(mandates.draft)&&<option value="current-rule">当前策略 · {mandates.draft.name}</option>}{rules.map(r=><option key={r.snapshot.id} value={'rule:'+r.snapshot.id}>{r.snapshot.name}</option>)}</select></label>{mode==='ai'&&<label>AI 接口<select aria-label="绑定接口" value={profileId||activeId} onChange={e=>setProfile(e.target.value)}><option value="">选择接口</option>{profiles.map(a=><option key={a.id} value={a.id}>{a.name} · {a.model}</option>)}</select>{!profiles.length&&<button onClick={onSettings}>设置接口</button>}</label>}<label>资金比例（%）<small>可分配 {money(available)}%</small><input aria-label="绑定资金比例" type="number" min={1} max={available} value={Number.isFinite(allocation)?allocation:''} onChange={e=>setAllocation(e.target.valueAsNumber)}/></label>{(message||usePortfolioStore.getState().error)&&<p className="strategy-error" role="alert">{message||usePortfolioStore.getState().error}</p>}<button className="primary" onClick={save}>保存</button></div></Modal>;
}
function PortfolioChart({portfolio:p}:{portfolio:Portfolio}){
 const points=[{time:p.createdAt,equity:p.capital},...p.curve],values=points.map(x=>x.equity),padding=Math.max((Math.max(...values)-Math.min(...values))*.1,p.capital*.0005),low=Math.min(...values)-padding,high=Math.max(...values)+padding,span=high-low;
 return <div className="portfolio-equity-chart"><div className="portfolio-chart-labels"><span>{money(high)}</span><span>{money((high+low)/2)}</span><span>{money(low)}</span></div><svg viewBox="0 0 1000 250" preserveAspectRatio="none" role="img" aria-label="组合资产曲线">{[40,125,210].map(y=><line key={y} x1="0" x2="1000" y1={y} y2={y} stroke="currentColor" strokeOpacity=".09"/>)}<polyline fill="none" stroke="#ff9d2e" strokeWidth="2" vectorEffect="non-scaling-stroke" points={(points.length===1?[points[0],points[0]]:points).map((point,i,all)=>`${i/Math.max(1,all.length-1)*1000},${125-(point.equity-(high+low)/2)/span*200}`).join(' ')}/></svg><div className="portfolio-chart-times"><time>{new Date(p.createdAt).toLocaleDateString()}</time><time>{new Date(points.at(-1)!.time).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'})}</time></div></div>;
}
function InvestmentUniverse({portfolio:p,watchlist,disabled}:{portfolio:Portfolio;watchlist:WatchlistStock[];disabled:boolean}){
 const [query,setQuery]=useState(''),search=useStockSearch(query,p.market),universe=portfolioUniverse(p,watchlist);
 const save=(pool:WatchlistStock[])=>{if(pool.length<=40)updatePortfolio({...p,poolMode:'custom',pool});};
 return <div className="portfolio-universe"><header><div><strong>交易对池</strong><span>{p.market} · {universe.length}/40</span></div><div><button disabled={disabled} aria-pressed={p.poolMode==='watchlist'} onClick={()=>updatePortfolio({...p,poolMode:'watchlist'})}>同步自选</button><input aria-label="检索投资范围" type="search" disabled={disabled} placeholder="代码或名称" value={query} onChange={e=>setQuery(e.target.value)}/></div></header>{query.trim()&&<div className="portfolio-universe-search">{search.results.map(s=><button key={s.ticker} disabled={universe.some(n=>n.ticker===s.ticker)} onClick={()=>{save([...universe,{...s,market:p.market}]);setQuery('');}}>{s.ticker} · {s.name}</button>)}</div>}<div className="portfolio-universe-grid">{universe.map(s=><div key={s.ticker}><strong>{s.ticker}</strong><span>{s.name}</span><button aria-label={'移除候选 '+s.ticker} disabled={disabled||p.positions.some(h=>h.ticker===s.ticker)||(p.bindings??[]).some(b=>b.ticker===s.ticker)} onClick={()=>save(universe.filter(n=>n.ticker!==s.ticker))}>×</button></div>)}</div></div>;
}

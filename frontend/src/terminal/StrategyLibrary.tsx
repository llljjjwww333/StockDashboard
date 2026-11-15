import { useState } from 'react';
import { strategyDate as day, strategyPercent as pct } from './strategyPresentation';
import { commitStrategyLibrary, useStrategyWorkspace, type StrategyReport } from './strategyWorkspace';
import { downloadFile } from '../lib/downloadFile';

export function StrategyLibrary({strategyId,ticker,onOpen}:{strategyId:string;ticker:string;onOpen:(report:StrategyReport)=>void}){
 const {library}=useStrategyWorkspace(),[all,setAll]=useState(false),[selected,setSelected]=useState<string[]>([]),[message,setMessage]=useState(''),[removed,setRemoved]=useState<StrategyReport|null>(null);
 const belongs=(r:StrategyReport)=>r.snapshot.strategy?.id===strategyId&&r.snapshot.instrument.ticker===ticker,own=library.filter(belongs),rows=all?library:own,comparison=library.filter(r=>selected.includes(r.snapshot.id));
 const erase=(report:StrategyReport)=>{const current=useStrategyWorkspace.getState().library;if(commitStrategyLibrary(current.filter(r=>r.snapshot.id!==report.snapshot.id))){setRemoved(report);setSelected(s=>s.filter(id=>id!==report.snapshot.id));setMessage('');}else setMessage('删除失败');};
 const undo=()=>{if(!removed)return;const current=useStrategyWorkspace.getState().library;if(current.length>=12){setMessage('回测记录已满');return;}if(commitStrategyLibrary([removed,...current.filter(r=>r.snapshot.id!==removed.snapshot.id)])){setRemoved(null);setMessage('');}else setMessage('恢复失败');};
 const exportReport=(report:StrategyReport)=>{try{downloadFile(JSON.stringify({...report.snapshot,result:report.result},null,2),report.snapshot.instrument.ticker+'-backtest.json','application/json');setMessage('已导出');}catch{setMessage('导出失败');}};
 const metrics:[string,(r:StrategyReport)=>string][]=[
  ['标的',r=>r.snapshot.instrument.ticker],['版本',r=>'V'+(r.snapshot.strategy?.revision??1)],['实际区间',r=>day(r.result.start)+' — '+day(r.result.end)],
  ['初始资金',r=>r.snapshot.config.capital.toLocaleString()],['费率 / 滑点（基点）',r=>r.snapshot.config.feeBps+' / '+r.snapshot.config.slippageBps],
  ['策略收益',r=>pct(r.result.totalReturn)],['买入持有',r=>pct(r.result.benchmarkReturn)],['最大回撤',r=>pct(r.result.maxDrawdown)],['已平仓交易',r=>String(r.result.closedTrades)]];
 return <details className="backtest-history strategy-library"><summary>回测记录 <span>{own.length}</span></summary><div className="backtest-history-toolbar"><div><button aria-pressed={!all} onClick={()=>setAll(false)}>当前策略</button><button aria-pressed={all} onClick={()=>setAll(true)}>全部记录</button></div><span>{library.length} / 12</span></div>
  {message&&<p className="strategy-notice" role="status">{message}</p>}{removed&&<div className="portfolio-undo" role="status"><span>已删除 {removed.snapshot.name}</span><button onClick={undo}>撤销删除记录</button></div>}
  {!rows.length?<p className="strategy-note">暂无保存记录</p>:<div className="strategy-library-list">{rows.map(r=><div key={r.snapshot.id} data-backtest-record={r.snapshot.id}><label className="strategy-checkbox"><input type="checkbox" aria-label={'对比 '+r.snapshot.name} checked={selected.includes(r.snapshot.id)} disabled={!selected.includes(r.snapshot.id)&&comparison.length>=3} onChange={e=>setSelected(s=>e.target.checked?[...s,r.snapshot.id]:s.filter(id=>id!==r.snapshot.id))}/><span><strong>{r.snapshot.name}</strong><small>{r.snapshot.instrument.ticker} · V{r.snapshot.strategy?.revision??1} · {day(r.result.start)} — {day(r.result.end)} · {pct(r.result.totalReturn)}</small></span></label><div>{belongs(r)&&<button onClick={()=>onOpen(r)}>查看</button>}<button onClick={()=>exportReport(r)}>导出记录</button><button aria-label={'删除记录 '+r.snapshot.name} onClick={()=>erase(r)}>删除</button></div></div>)}</div>}
  {comparison.length>=2&&<div className="strategy-comparison"><h3>结果对比</h3><div className="strategy-table" role="region" aria-label="结果对比" tabIndex={0}><table><thead><tr><th>项目</th>{comparison.map(r=><th key={r.snapshot.id}>{r.snapshot.name}</th>)}</tr></thead><tbody>{metrics.map(([label,render])=><tr key={label}><td>{label}</td>{comparison.map(r=><td key={r.snapshot.id}>{render(r)}</td>)}</tr>)}</tbody></table></div></div>}
 </details>;
}

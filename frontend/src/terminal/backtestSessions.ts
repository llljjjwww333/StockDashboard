import { create } from 'zustand';
import { readBacktestPreferences, rememberBacktestPreference, type BacktestPreference } from './backtestPreferences.ts';
import type { StrategyReport } from './strategyWorkspace';
const key='marketdesk:crypto:backtest-preferences:v1';
const initial=()=>{try{return readBacktestPreferences(localStorage.getItem(key));}catch{return [];}};
export const useBacktestSessions=create<{preferences:BacktestPreference[];reports:Record<string,StrategyReport>;error:string}>(()=>({preferences:initial(),reports:{},error:''}));
export function saveBacktestPreference(value:BacktestPreference){
 let preferences:BacktestPreference[];try{preferences=rememberBacktestPreference(useBacktestSessions.getState().preferences,value);}catch{return;}
 useBacktestSessions.setState({preferences});try{localStorage.setItem(key,JSON.stringify(preferences));useBacktestSessions.setState({error:''});}catch{useBacktestSessions.setState({error:'回测设置未能保存'});}
}
export function rememberBacktestReport(report:StrategyReport){const id=report.snapshot.strategy?.id;if(id)useBacktestSessions.setState(s=>({reports:{...s.reports,[id]:report}}));}

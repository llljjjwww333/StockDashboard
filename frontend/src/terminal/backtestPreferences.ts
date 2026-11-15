import { strategyDefaults, validateStrategyConfig, type StrategyConfig } from './backtest.ts';
import type { BacktestEnvironment } from './strategyDefinition.ts';
export type BacktestPreference={id:string;ticker:string;period:'1y'|'3mo';environment:BacktestEnvironment};
export function backtestEnvironment(config:StrategyConfig):BacktestEnvironment{
 const c=validateStrategyConfig(config);return {capital:c.capital,feeBps:c.feeBps,slippageBps:c.slippageBps,startDate:c.startDate??'',endDate:c.endDate??'',lotSize:c.lotSize??0,liquidateEnd:c.liquidateEnd??false};
}
export function validBacktestPreference(value:BacktestPreference):BacktestPreference{
 if(!value||typeof value.id!=='string'||!value.id||typeof value.ticker!=='string'||!value.ticker||!['1y','3mo'].includes(value.period)||!value.environment)throw new Error('回测设置无效');
 return {id:value.id,ticker:value.ticker,period:value.period,environment:backtestEnvironment({...strategyDefaults,...value.environment})};
}
export function readBacktestPreferences(raw:string|null):BacktestPreference[]{
 try{const rows:unknown=JSON.parse(raw??'[]');if(!Array.isArray(rows))return [];const result:BacktestPreference[]=[];for(const row of rows.slice(0,20))try{const next=validBacktestPreference(row);if(!result.some(r=>r.id===next.id))result.push(next);}catch{/* Keep the other strategy settings. */}return result;}catch{return [];}
}
export function rememberBacktestPreference(rows:BacktestPreference[],value:BacktestPreference){const next=validBacktestPreference(value);return [next,...rows.filter(r=>r.id!==next.id)].slice(0,20);}

import type { StockBinding, Mandate } from './portfolio';
import type { MarketType } from '../store/stockStore';
import { validateStrategyConfig } from './backtest.ts';
import { bindingExecutionMode, strategyPositionLimit } from './portfolio.ts';
import { copyMandate } from './mandateLibrary.ts';
import { editStrategyExecution } from './strategyDefinition.ts';
export function copyBindingStrategy(binding: StockBinding, market: MarketType, id = crypto.randomUUID()): Mandate {
 const instrument={ticker:binding.ticker,name:binding.name,market};
 const source={...binding.mandate,name:binding.label.trim()||binding.ticker+' 策略',instrument};
 const copy=copyMandate(source,id,' · 模拟副本');
 if(bindingExecutionMode(binding)==='ai'&&!source.execution)return copy;
 const cap=strategyPositionLimit(binding);
 const config=validateStrategyConfig({...structuredClone(binding.config),positionPct:cap});
 return editStrategyExecution({...copy,maxSingle:cap,maxGross:cap,maxPositions:1,revision:0},instrument,config,true);
}

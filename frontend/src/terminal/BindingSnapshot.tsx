import { bindingExecutionMode, bindingPositionLimit, strategyPositionLimit, type StockBinding } from './portfolio';
import { StrategyDetails } from './StrategyDetails';
export function BindingSnapshot({binding:b,onCopy}:{binding:StockBinding;onCopy:()=>void}){
 const mode=bindingExecutionMode(b),schedule=mode==='ai'?`每${b.mandate.reviewMinutes}分钟` : b.config.allocation?'每日00:00 UTC':'每日一次，使用上一根完整日K';
 const executionTiming=b.config.allocation?'00:00 UTC首分钟的有效报价':'执行信号时的有效报价';
 const config=b.config.plan?b.config:{...b.config,positionPct:strategyPositionLimit(b)};
 return <div className="binding-snapshot">
  <header><strong>{b.label}</strong><span>{b.ticker}{b.mandate.revision?' · 参数版本 V'+b.mandate.revision:''}</span></header>
  <dl><div><dt>执行方式</dt><dd>{mode==='rules'?'按已保存规则执行':'AI动态决策'}</dd></div><div><dt>复核频率</dt><dd>{schedule}</dd></div><div><dt>模拟成交</dt><dd>{executionTiming}</dd></div>
   <div><dt>账户绑定额度</dt><dd>{b.allocationPct}%</dd></div><div><dt>策略仓位上限</dt><dd>{strategyPositionLimit(b)}%</dd></div><div><dt>实际执行上限</dt><dd>{bindingPositionLimit(b)}%</dd></div>
  </dl><details><summary>绑定时的策略目标</summary><p>{b.mandate.goal}</p></details>
  {mode==='rules'?<><h4>{b.config.plan?'原始分批计划':'执行规则参数'}</h4><StrategyDetails config={config} executionTiming={executionTiming}/></>:b.mandate.execution?<details><summary>AI参考指标</summary><StrategyDetails config={config} executionTiming={executionTiming}/></details>:null}
  <button type="button" onClick={onCopy}>复制为新策略</button>
 </div>;
}

import { stagedDescriptions, stagedFields, stagedGroups, type StagedPlan } from './stagedPlan';
const branches = [['initialEnabled','首次建仓'],['breakoutEnabled','突破加仓'],['pullbackEnabled','回踩买入'],['trimMaEnabled','长期均线滞涨减仓'],['trimRsiEnabled','RSI长上影减仓'],['clearEnabled','均线放量清仓']] as const;
export function StagedPlanEditor({value,onChange,market}:{value:StagedPlan;market?:string;onChange:(p:StagedPlan)=>void}){
 return <div className="staged-plan-editor" aria-label="分批策略参数"><p className="strategy-note">UTC日线收盘确认，次日开盘执行。</p>
 <div className="staged-branches">{branches.map(([key,label])=><label key={key}><input aria-label={label+'启用'} type="checkbox" checked={value[key]} onChange={e=>onChange({...value,[key]:e.target.checked})}/>{label}</label>)}</div>
 {stagedGroups.map(group=><section key={group}><h4>{group}</h4><div className="staged-fields">{stagedFields.filter(f=>f[0]===group).map(([,key,label,min,max,step])=><label key={key}>{label}<input aria-label={label} type="number" min={min} max={max} step={step} value={Number.isFinite(value[key])?value[key]:''} onChange={e=>onChange({...value,[key]:e.target.valueAsNumber})}/></label>)}</div></section>)}
 <label className="portfolio-check"><input aria-label="止损清仓一次退出" type="checkbox" checked={value.emergencyExitAll} onChange={e=>onChange({...value,emergencyExitAll:e.target.checked})}/>止损 / 清仓一次退出，优先于普通单次上限</label>
 <label className="portfolio-check"><input aria-label="分批策略新闻复核" type="checkbox" checked={value.includeNews} onChange={e=>onChange({...value,includeNews:e.target.checked})}/>新闻复核</label>
 <label className="portfolio-check"><input aria-label="分批策略换手率复核" type="checkbox" checked={value.reviewTurnover} onChange={e=>onChange({...value,reviewTurnover:e.target.checked})}/>换手率复核</label>
 <details className="staged-explanation"><summary>当前完整执行条件</summary>{stagedDescriptions(value).map(([title,text])=><p key={title}><strong>{title}：</strong>{text}</p>)}</details>
 <details className="staged-assumptions"><summary>参数说明</summary><ul>{value.assumptions.map((text,i)=><li key={i}>{market==='CRYPTO'&&text.startsWith('A股首仓')?'现货数量支持小数币量，首仓按选定比例计算。':text.replace('历史回测不编造历史新闻，不自动改写规则。','').replace('缺失标记缺失。','').replace('不扩大价格规则目标，不阻止止损/卖出。','价格退出信号独立执行。')}</li>)}</ul></details>
 </div>;
}

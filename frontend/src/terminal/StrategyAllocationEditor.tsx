import type { StrategyConfig } from './backtest';
import type { VolatilityAllocation } from './volatilityAllocation';

export function StrategyAllocationEditor({ config, onChange }: { config: StrategyConfig; onChange: (config: StrategyConfig) => void }) {
  const value = config.allocation;
  const update = (changes: Partial<VolatilityAllocation>) => value && onChange({ ...config, allocation: { ...value, ...changes } });
  return <section className="strategy-allocation" aria-label="动态仓位参数">
    <header><h3>仓位计算</h3><select aria-label="仓位计算方式" value={value ? 'volatility_target' : 'fixed'} onChange={e => onChange({ ...config,
      allocation: e.target.value === 'fixed' ? null : { method: 'volatility_target', period: 30, targetVolPct: 10,
        minPositionPct: 0, annualization: 365, ddof: 1, rebalanceThresholdPct: 0 } })}>
      <option value="fixed">固定仓位</option><option value="volatility_target">目标波动率动态仓位</option></select></header>
    {value && <>
      <p className="allocation-formula">信号成立：w = min({config.positionPct}%, max({value.minPositionPct}%, {value.targetVolPct}% / σ{value.period}))；信号失效：w = 0%</p>
      <div className="design-rule-parameters">
        {([['period','波动率回看（日）',2,200,1],['targetVolPct','目标年化波动率（%）',.01,100,.1],
          ['minPositionPct','最小仓位（%）',0,100,.1],['rebalanceThresholdPct','再平衡阈值（百分点）',0,100,.01]] as const).map(([key,label,min,max,step]) =>
          <label key={key}>{label}<input type="number" aria-label={label} min={min} max={max} step={step} value={Number.isFinite(value[key]) ? value[key] : ''} onChange={e => update({ [key]: e.target.valueAsNumber })}/></label>)}
        <label>年化日数<select aria-label="年化日数" value={value.annualization} onChange={e => update({ annualization: Number(e.target.value) as 252 | 365 })}><option value={365}>365（√365）</option><option value={252} disabled>252（证券市场）</option></select></label>
        <label>标准差口径<select aria-label="标准差口径" value={value.ddof} onChange={e => update({ ddof: Number(e.target.value) as 0 | 1 })}><option value={1}>样本标准差（n−1）</option><option value={0}>总体标准差（n）</option></select></label>
      </div>
      <dl className="allocation-schedule"><div><dt>波动率</dt><dd>ln(Closeₜ / Closeₜ₋₁) 的{value.period}日标准差 × √{value.annualization}</dd></div>
        <div><dt>市场与方向</dt><dd>现货 · 只做多 · 1× · 不借贷</dd></div><div><dt>信号与执行</dt><dd>1D · UTC · 每日00:00复核上一根完整日K，下一根开盘执行</dd></div>
        <div><dt>再平衡</dt><dd>每日 · 以账户总净资产计算目标仓位 · 空仓USDT收益0%</dd></div></dl>
      <p>回测按下一根日K开盘成交；模拟使用00:00 UTC后首分钟的有效报价。</p>
      <h4>成本与日期</h4><div className="design-rule-parameters">
        {(['feeBps','slippageBps'] as const).map(key => <label key={key}>{key === 'feeBps' ? '单边手续费（基点）' : '单边滑点（基点）'}<input type="number" aria-label={key === 'feeBps' ? '策略手续费（基点）' : '策略滑点（基点）'} min={0} max={100} step={.1} value={config[key]} onChange={e => onChange({ ...config, [key]: e.target.valueAsNumber })}/></label>)}
        {([['dataStartDate','数据开始日期'],['dataEndDate','数据结束日期'],['startDate','交易开始日期'],['endDate','交易结束日期']] as const).map(([key,label]) =>
          <label key={key}>{label}<input type="date" aria-label={label} value={config[key] ?? ''} onChange={e => onChange({ ...config, [key]: e.target.value })}/></label>)}
      </div>
      <table className="allocation-examples"><caption>年化波动率与目标仓位</caption><thead><tr><th>年化波动率</th><th>信号成立时目标仓位</th></tr></thead><tbody>{[20,30,40,50,60,70,80,100].map(vol => <tr key={vol}><td>{vol}%</td><td>{Math.min(config.positionPct ?? 100, Math.max(value.minPositionPct, value.targetVolPct / (vol / 100))).toFixed(2)}%</td></tr>)}</tbody></table>
    </>}
  </section>;
}

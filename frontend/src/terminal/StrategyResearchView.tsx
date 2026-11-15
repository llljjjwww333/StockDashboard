import { useMemo, useRef, useState } from 'react';
import { useLanguage } from '../lib/i18n';
import { isCryptoTicker, isChinaTicker } from '../lib/instrumentIdentity';
import { useStrategyHistory } from './useTerminalData';
import { ResourceError } from './ResourceError';
import { runBacktest, strategyDefaults } from './backtest';
import { strategyBacktestConfig, executableStrategy, type BacktestEnvironment } from './strategyDefinition';
import type { Mandate } from './portfolio';
import { StrategyResults } from './StrategyResults';
import { StrategyDetails } from './StrategyDetails';
import { useStrategyWorkspace, type StrategySnapshot } from './strategyWorkspace';
import { StrategyLibrary } from './StrategyLibrary';
import { backtestEnvironment } from './backtestPreferences';
import { useBacktestSessions, saveBacktestPreference, rememberBacktestReport } from './backtestSessions';
import { completedDailyBars, completedDailyCutoff } from './dailyHistory';
import { backtestWindow, sameBacktestConfig } from './backtestWindow';
import './strategy.css';

export function StrategyResearchView({ strategy, onEdit }: { strategy: Mandate; onEdit: () => void }) {
  useLanguage();
  const workspace = useStrategyWorkspace(), instrument = strategy.instrument, ticker = instrument?.ticker ?? '';
  const sessions = useBacktestSessions(), preference = sessions.preferences.find(p => p.id === strategy.id && p.ticker === ticker);
  const resultsRef = useRef<HTMLDivElement>(null);
  const [period, setPeriod] = useState<'1y' | '3mo'>(preference?.period ?? '1y');
  const [environment, setEnvironment] = useState<BacktestEnvironment>(() => preference?.environment ?? backtestEnvironment({
    ...strategyDefaults, capital: strategy.execution?.capital ?? strategyDefaults.capital,
    feeBps: strategy.execution?.feeBps ?? strategyDefaults.feeBps, slippageBps: strategy.execution?.slippageBps ?? strategyDefaults.slippageBps,
    startDate: strategy.execution?.startDate ?? '', endDate: strategy.execution?.endDate ?? '',
    lotSize: isCryptoTicker(ticker) ? 0 : isChinaTicker(ticker) ? 100 : 1, liquidateEnd: strategy.execution?.liquidateEnd ?? false,
  }));
  const [error, setError] = useState('');
  const changeEnvironment = (changes: Partial<BacktestEnvironment>) => {
    const next = { ...environment, ...changes };
    setEnvironment(next); setError('');
    saveBacktestPreference({ id: strategy.id, ticker, period, environment: next });
  };
  const changePeriod = (next: '1y' | '3mo') => {
    setPeriod(next); setError('');
    saveBacktestPreference({ id: strategy.id, ticker, period: next, environment });
  };
  const ready = executableStrategy(strategy), history = useStrategyHistory(ticker || null, period, ready);
  const cutoff = completedDailyCutoff(ticker, new Date(), history.data?.fetched_at);
  const bars = useMemo(() => history.data ? completedDailyBars(history.data.data, ticker, cutoff) : [], [history.data, ticker, cutoff]);
  const current = useMemo(() => {
    try {
      const config = strategyBacktestConfig(strategy, environment);
      return { config, window: backtestWindow(bars, config), error: '' };
    } catch (e) { return { config: null, window: null, error: e instanceof Error ? e.message : '回测设置无效' }; }
  }, [strategy, environment, bars]);
  const range = current.window;
  const matches = (r: typeof workspace.report) => r?.snapshot.strategy?.id === strategy.id && r.snapshot.instrument.ticker === ticker;
  const report = matches(workspace.report) ? workspace.report : matches(sessions.reports[strategy.id]) ? sessions.reports[strategy.id] : workspace.library.find(matches) ?? null;
  const changed = !!report && (!ready || !current.config || report.snapshot.period !== period ||
    report.snapshot.strategy?.revision !== (strategy.revision ?? 1) || !sameBacktestConfig(report.snapshot.config, current.config));
  const previous = !!report && (changed || !!error);
  const calculate = (settings = environment) => {
    try {
      if (!instrument) throw new Error('请选择标的');
      if (history.data?.price_type === 'snapshot' || history.data?.interval && history.data.interval !== '1d') throw new Error('需要日线历史数据');
      const config = strategyBacktestConfig(strategy, settings), result = runBacktest(bars, config);
      const snapshot: StrategySnapshot = {
        version: 2, id: crypto.randomUUID(), name: strategy.name + ' V' + (strategy.revision ?? 1), createdAt: new Date().toISOString(),
        instrument: { ...instrument }, config, period, source: history.data?.source ?? '—', adjustment: history.data?.adjustment ?? '—',
        stale: !!history.data?.stale, bars: structuredClone(bars),
        strategy: { id: strategy.id, revision: strategy.revision ?? 1, goal: strategy.goal, executionMode: 'rules' },
      };
      const next = { snapshot, result };
      rememberBacktestReport(next); saveBacktestPreference({ id: strategy.id, ticker, period, environment: settings });
      useStrategyWorkspace.setState({ instrument, config, period, report: next }); setError('');
    } catch (e) { setError(e instanceof Error ? e.message : '回测失败'); }
  };
  const useAvailableWindow = () => {
    if (!range?.earliestStart || !range.historyEnd) return;
    const next = { ...environment, startDate: range.earliestStart, endDate: range.historyEnd };
    changeEnvironment(next); calculate(next);
  };
  const numeric = (key: 'capital' | 'feeBps' | 'slippageBps', label: string, min: number, max: number, step: number) => <label>{label}<input aria-label={label} type="number" required min={min} max={max} step={step} value={Number.isFinite(environment[key]) ? environment[key] : ''} onChange={e => changeEnvironment({ [key]: e.target.valueAsNumber })} /></label>;

  return <section className="strategy-lab backtest-workspace">
    <header className="backtest-source"><div><strong>{strategy.name}</strong><span>{ticker || '未选标的'} · {strategy.execution ? 'V' + (strategy.revision ?? 1) : '待生成规则'}</span></div><button onClick={onEdit}>编辑策略</button></header>
    {strategy.execution && <details className="design-details design-details-fold"><summary>策略参数<span>V{strategy.revision ?? 1}</span></summary><StrategyDetails config={{ ...strategy.execution, positionPct: strategy.maxSingle }} /></details>}
    {!ready ? <div className="strategy-empty"><p>{strategy.execution ? '规则待更新' : '待生成规则'}</p><button onClick={onEdit}>完善策略规则</button></div> :
      <form className="strategy-settings backtest-settings" onSubmit={e => { e.preventDefault(); if (range?.status === 'ready') calculate(); }}>
        <div className="backtest-environment">
          <label>历史范围<select aria-label="历史范围" value={period} onChange={e => changePeriod(e.target.value as '1y' | '3mo')}><option value="1y">1年</option><option value="3mo">3月</option></select></label>
          <label>开始日期<input aria-label="开始日期" type="date" value={environment.startDate} onChange={e => changeEnvironment({ startDate: e.target.value })} /></label>
          <label>结束日期<input aria-label="结束日期" type="date" value={environment.endDate} onChange={e => changeEnvironment({ endDate: e.target.value })} /></label>
          {numeric('capital', '初始资金', 100, 1e9, .01)}{numeric('feeBps', '单边费率（基点）', 0, 100, .1)}{numeric('slippageBps', '单边滑点（基点）', 0, 100, .1)}
          <label>交易单位<select aria-label="交易单位" value={environment.lotSize} onChange={e => changeEnvironment({ lotSize: Number(e.target.value) })}><option value={0}>币数量（可分割）</option></select></label>
          <label className="strategy-checkbox"><input type="checkbox" checked={environment.liquidateEnd} onChange={e => changeEnvironment({ liquidateEnd: e.target.checked })} />期末清仓</label>
        </div>
        {range && range.totalBars > 0 && <div className="backtest-range" role="status" aria-label="回测数据范围">
          <p>实际取得 {range.historyStart} — {range.historyEnd} · {range.totalBars} 根日线{history.data?.stale && ' · 缓存行情'}</p>
          <p>指标预热需 {range.warmup} 根日线{range.earliestStart ? <> · 最早可回测 <strong>{range.earliestStart}</strong> · 预热后共 {range.availableBars} 个UTC日</> : <> · 至少还需 {range.warmup + 1 - range.totalBars} 根，才能开始回测</>}</p>
          {range.status === 'ready' && <p>本次将回测 {range.start} — {range.end} · {range.testedBars} 个UTC日；预热数据不计入收益。</p>}
          {range.status === 'short-warmup' && <p className="backtest-range-warning">所选开始日期前只有 {range.precedingBars} 根日线，不足以计算这份策略的指标。</p>}
          {range.status === 'outside' && <p className="backtest-range-warning">所选日期没有满足预热要求的可回测日线。</p>}
          {range.availableBars > 0 && range.status !== 'ready' && <p>点击“按可用区间回测”，将日期改为 {range.earliestStart} — {range.historyEnd} 并运行，策略参数保持不变。</p>}
        </div>}
        <div className="strategy-config-footer">
          <span className="strategy-data-summary">{history.loading ? '加载中' : !bars.length ? '暂无可用日线' : range?.status === 'ready' ? '已就绪' : '需调整回测区间'}</span>
          {range && range.availableBars > 0 && range.status !== 'ready' ?
            <button className="strategy-run" type="button" onClick={useAvailableWindow} disabled={history.loading}>按可用区间回测</button> :
            range?.status === 'short-history' ? <button className="strategy-run" type="button" onClick={() => period === '3mo' ? changePeriod('1y') : history.retry()} disabled={history.loading}>{period === '3mo' ? '加载1年历史' : '重新获取历史'}</button> :
              <button className="strategy-run" type="submit" disabled={history.loading || range?.status !== 'ready'}>运行回测</button>}
        </div>
        <ResourceError error={history.error} loading={history.loading} onRetry={history.retry} label="重试" hasData={!!bars.length} />
        {(error || current.error) && <p role="alert" className="strategy-error">{error || current.error}</p>}
        {sessions.error && <p role="status" className="strategy-notice">{sessions.error}</p>}
      </form>}
    <StrategyLibrary strategyId={strategy.id} ticker={ticker} onOpen={selected => {
      rememberBacktestReport(selected); useStrategyWorkspace.setState({ report: selected });
      requestAnimationFrame(() => {
        const details = resultsRef.current?.querySelector<HTMLDetailsElement>('.backtest-previous');
        if (details) details.open = true;
        resultsRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      });
    }} />
    <div ref={resultsRef} className="strategy-results" aria-label="回测结果">
      {report ? previous ? <details className="backtest-previous" key={'previous-' + report.snapshot.id}>
        <summary>上次结果 · {report.result.start.slice(0, 10)} — {report.result.end.slice(0, 10)}<span>{error ? '本次运行失败，尚未生成新结果' : '与当前设置不一致，待重新回测'}</span></summary>
        <StrategyResults key={report.snapshot.id} report={report} />
      </details> : <StrategyResults key={report.snapshot.id} report={report} /> : <div className="strategy-empty">暂无结果</div>}
    </div>
  </section>;
}

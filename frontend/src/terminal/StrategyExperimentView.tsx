import { useEffect, useRef, useState } from 'react';
import { t } from '../lib/i18n';
import { downloadFile } from '../lib/downloadFile';
import type { HistoryPoint } from './types';
import type { StrategyConfig } from './backtest';
import { experimentParameters, getStrategy, type StrategyParameter, type StrategyParameterKey } from './strategyCatalog';
import { evaluateCandidate, parameterRange, planExperiment, rankExperiment, type ExperimentRow, type ExperimentSpec } from './strategyExperiment';
import { strategyName, strategyParameters, strategyPercent as pct } from './strategyPresentation';
import { useStrategyWorkspace } from './strategyWorkspace';

type Axis = { key: StrategyParameterKey | ''; start: number; end: number; step: number };
function defaultAxis(p: StrategyParameter, config: StrategyConfig): Axis {
  const current = Number(config[p.key] ?? getStrategy(config.kind)!.defaults[p.key]);
  const step = p.step === 1 ? Math.max(1, Math.round(Math.abs(current) / 4)) : Math.max(p.step, Math.round(Math.abs(current) / 4 / p.step) * p.step);
  return { key: p.key, start: Number(Math.max(p.min, current - step).toFixed(4)), end: Number(Math.min(p.max, current + step).toFixed(4)), step };
}
export function StrategyExperiment({ ticker, config, bars, source, adjustment, stale, inputError, onApply }: {
  ticker: string; config: StrategyConfig; bars: HistoryPoint[]; source: string; adjustment: string; stale: boolean; inputError: string;
  onApply: (config: StrategyConfig) => void;
}) {
  const { experiment } = useStrategyWorkspace();
  const definition = getStrategy(config.kind)!;
  const parameters = experimentParameters(config.kind);
  const previous = experiment?.plan.base.kind === config.kind ? experiment.plan.spec : null;
  const axisFrom = (p: StrategyParameter, key?: StrategyParameterKey | '', values?: number[]): Axis => values?.length ? { key: key ?? p.key, start: values[0], end: values[values.length - 1], step: values.length > 1 ? Number((values[1] - values[0]).toFixed(8)) : p.step } : defaultAxis(p, config);
  const [x, setX] = useState(() => axisFrom(parameters[0], previous?.x, previous?.xValues));
  const [y, setY] = useState<Axis>(() => parameters[1] && previous?.y !== '' ? axisFrom(parameters[1], previous?.y, previous?.yValues) : { key: '', start: 0, end: 0, step: 1 });
  const [mode, setMode] = useState<ExperimentSpec['mode']>(previous?.mode ?? 'parameters');
  const [fraction, setFraction] = useState(previous?.trainingFraction ?? .7);
  const [objective, setObjective] = useState<ExperimentSpec['objective']>(previous?.objective ?? 'sharpe');
  const [sample, setSample] = useState<'train' | 'validation'>('train');
  const [running, setRunning] = useState(false), [done, setDone] = useState(0), [error, setError] = useState('');
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; }, []);
  const signature = JSON.stringify({ ticker, config, bars });
  const changed = experiment && experiment.signature !== signature;
  const ranked = rankExperiment(experiment?.rows ?? [], objective);
  const chooseObjective = (next: ExperimentSpec['objective']) => {
    setObjective(next);
    if (experiment) useStrategyWorkspace.setState({ experiment: { ...experiment, plan: { ...experiment.plan, spec: { ...experiment.plan.spec, objective: next } } } });
  };
  async function run() {
    try {
      if (inputError) throw new Error(inputError);
      const spec: ExperimentSpec = { mode, x: x.key as StrategyParameterKey, y: y.key, xValues: mode === 'parameters' ? parameterRange(x.start, x.end, x.step) : [], yValues: mode === 'parameters' && y.key ? parameterRange(y.start, y.end, y.step) : [], trainingFraction: fraction, objective };
      const plan = planExperiment(bars, config, spec), token = ++generation.current;
      const run = { signature, ticker, source, adjustment, stale, createdAt: new Date().toISOString(), plan, rows: [] as ExperimentRow[], complete: false };
      useStrategyWorkspace.setState({ experiment: run }); setRunning(true); setDone(0); setError('');
      for (let i = 0; i < plan.candidates.length; i++) {
        await new Promise(resolve => window.setTimeout(resolve, 0));
        if (generation.current !== token) return;
        run.rows = [...run.rows, evaluateCandidate(plan, plan.candidates[i])];
        run.complete = i === plan.candidates.length - 1;
        useStrategyWorkspace.setState({ experiment: { ...run } }); setDone(i + 1);
      }
      setRunning(false);
    } catch (e) { setError(e instanceof Error ? e.message : '实验失败'); setRunning(false); }
  }
  const axisControl = (axis: Axis, setAxis: (next: Axis) => void, label: string, optional: boolean) => <fieldset><legend>{t(label)}</legend><div className="strategy-axis-fields"><label>{t('参数')}<select aria-label={t(label + '参数')} value={axis.key} disabled={running} onChange={e => {
    const p = parameters.find(p => p.key === e.target.value);
    setAxis(p ? defaultAxis(p, config) : { ...axis, key: '' });
  }}>{optional && <option value="">{t('不启用')}</option>}{parameters.map(p => <option key={p.key} value={p.key}>{t(p.label)}</option>)}</select></label>{(['start', 'end', 'step'] as const).map((key, i) => <label key={key}>{t(['起始', '终止', '步长'][i])}<input type="number" aria-label={t(label + ['起始', '终止', '步长'][i])} step="any" disabled={running || !axis.key} value={Number.isFinite(axis[key]) ? axis[key] : ''} onChange={e => setAxis({ ...axis, [key]: e.target.valueAsNumber })} /></label>)}</div></fieldset>;
  const apply = (row: ExperimentRow) => { if (experiment) onApply({ ...row.config, startDate: experiment.plan.start, endDate: experiment.plan.end }); };
  const metric = (row: ExperimentRow) => {
    const result = row[sample];
    if (!result) return null;
    return objective === 'sharpe' ? result.sharpe : objective === 'return' ? result.totalReturn : -result.maxDrawdown;
  };
  const scores = ranked.map(metric).filter((n): n is number => n !== null), low = Math.min(...scores), high = Math.max(...scores);
  return <section className="strategy-experiment">
    <header><div><h2>{t('参数实验')}</h2><span>{ticker} · {t(definition.name)}</span></div><div className="strategy-tabs" role="group" aria-label={t('实验模式')}><button type="button" disabled={running} aria-pressed={mode === 'parameters'} onClick={() => setMode('parameters')}>{t('参数扫描')}</button><button type="button" disabled={running} aria-pressed={mode === 'strategies'} onClick={() => { setMode('strategies'); let count = 0; for (const next of [...new Set([fraction, .6, .7, .8])]) { try { const plan = planExperiment(bars, config, { mode: 'strategies', x: x.key as StrategyParameterKey, y: '', xValues: [], yValues: [], trainingFraction: next, objective }); const available = plan.candidates.filter(c => !c.error).length; if (available > count) { count = available; setFraction(next); } } catch { /* Keep splits with enough completed bars. */ } } }}>{t('全策略对比')}</button></div></header>
    <div className="strategy-experiment-controls">{mode === 'parameters' && <div className="strategy-experiment-axes">{axisControl(x, setX, 'X 轴', false)}{axisControl(y, setY, 'Y 轴', true)}</div>}
      <div className="strategy-experiment-run"><label>{t('样本划分')}<select aria-label={t('样本划分')} disabled={running} value={fraction} onChange={e => setFraction(Number(e.target.value))}><option value={.6}>60% / 40%</option><option value={.7}>70% / 30%</option><option value={.8}>80% / 20%</option></select></label><label>{t('样本内排序')}<select aria-label={t('样本内排序')} disabled={running} value={objective} onChange={e => chooseObjective(e.target.value as ExperimentSpec['objective'])}><option value="sharpe">{t('夏普比率')}</option><option value="return">{t('策略收益')}</option><option value="drawdown">{t('最大回撤')}</option></select></label><button type="button" className="strategy-run" disabled={running || !bars.length || !!inputError} onClick={() => void run()}>{t('运行实验')}</button>{running && <button type="button" onClick={() => { generation.current++; setRunning(false); }}>{t('取消')}</button>}{experiment && <button type="button" onClick={() => { try { downloadFile(JSON.stringify(experiment, null, 2), experiment.ticker + '-experiment.json', 'application/json'); } catch { setError('导出失败，请重试'); } }}>{t('导出实验')}</button>}</div>
    </div>
    {(error || inputError) && <p role="alert" className="strategy-error">{t(error || inputError)}</p>}
    {running && <div className="strategy-experiment-progress" role="status"><progress max={experiment?.plan.candidates.length ?? 1} value={done} />{done} / {experiment?.plan.candidates.length}</div>}
    {changed && <p className="strategy-notice" role="status">{t('数据或配置已变更，实验结果保留上次快照')}</p>}
    {!experiment ? <div className="strategy-empty"><p>{t('暂无实验')}</p></div> : <>
      <div className="strategy-experiment-summary"><strong>{experiment.ticker} · {t(strategyName(experiment.plan.base.kind))}</strong><span>{t('样本内')} {experiment.plan.start} — {experiment.plan.trainEnd}</span><span>{t('样本外')} {experiment.plan.validationStart} — {experiment.plan.end}</span><span>{experiment.rows.filter(r => !r.error).length} / {experiment.plan.candidates.length} {t('组完成')} · {t(experiment.complete ? '已完成' : running ? '运行中' : '已中止')}</span></div>
      {experiment.plan.spec.mode === 'parameters' && experiment.plan.spec.y && <div className="strategy-heatmap"><header><h3>{t('参数热力图')}</h3><select aria-label={t('热力图样本')} value={sample} onChange={e => setSample(e.target.value as 'train' | 'validation')}><option value="train">{t('样本内')}</option><option value="validation">{t('样本外')}</option></select></header><div className="strategy-table"><table style={{ minWidth: Math.max(280, (experiment.plan.spec.xValues.length + 1) * 62) }}><thead><tr><th>Y / X</th>{experiment.plan.spec.xValues.map(v => <th key={v}>{v}</th>)}</tr></thead><tbody>{experiment.plan.spec.yValues.map(y => <tr key={y}><th>{y}</th>{experiment.plan.spec.xValues.map(x => {
        const row = experiment.rows.find(r => r.x === x && r.y === y), value = row ? metric(row) : null;
        return <td key={x}><button type="button" disabled={!row?.train || !!changed || running} style={value === null ? undefined : { background: 'hsl(' + (high === low ? 60 : (value - low) / (high - low) * 130) + ' 55% 40% / .22)' }} onClick={() => row && apply(row)}>{value === null ? '—' : objective === 'sharpe' ? value.toFixed(2) : pct(objective === 'drawdown' ? -value : value)}</button></td>;
      })}</tr>)}</tbody></table></div></div>}
      <div className="strategy-table strategy-experiment-table" tabIndex={0} role="region" aria-label={t('实验结果')}><table><thead><tr>{['策略参数', '样本内收益', '样本外收益', '样本内夏普', '样本外夏普', '样本外回撤', '样本外交易', '操作'].map(label => <th key={label}>{t(label)}</th>)}</tr></thead><tbody>{ranked.map(row => <tr key={row.index}><td>{experiment.plan.spec.mode === 'strategies' ? <><strong>{t(strategyName(row.config.kind))}</strong><small>{strategyParameters(row.config)}</small></> : <strong>{strategyParameters(row.config)}</strong>}</td>{row.error ? <td colSpan={6}>{t(row.error)}</td> : <><td>{pct(row.train?.totalReturn ?? null)}</td><td>{pct(row.validation?.totalReturn ?? null)}</td><td>{row.train?.sharpe?.toFixed(2) ?? '—'}</td><td>{row.validation?.sharpe?.toFixed(2) ?? '—'}</td><td>{pct(row.validation?.maxDrawdown ?? null)}</td><td>{row.validation?.closedTrades ?? '—'}</td></>}<td><button type="button" disabled={!row.train || !!changed || running} onClick={() => apply(row)}>{t('载入参数')}</button></td></tr>)}</tbody></table></div>
    </>}
  </section>;
}

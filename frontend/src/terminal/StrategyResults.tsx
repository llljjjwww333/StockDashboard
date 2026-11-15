import { useEffect, useRef, useState } from 'react';
import { t, useLanguage } from '../lib/i18n';
import type { BacktestResult, ExitReason } from './backtest';
import { strategyDate as day, strategyName, strategyParameters, strategyPercent as pct } from './strategyPresentation';
import { saveStrategyReport, strategyTradeCsv, useStrategyWorkspace, type StrategyReport } from './strategyWorkspace';
import { getStrategy, regimeNames } from './strategyCatalog';
import { downloadFile } from '../lib/downloadFile';
import { StrategyDetails } from './StrategyDetails';

const reasonName = (s: ExitReason) => ({ signal: '策略信号', stop: '收盘止损', profit: '收盘止盈', end: '期末清仓' })[s];

export function StrategyResults({ report }: { report: StrategyReport }) {
  const { language } = useLanguage();
  const { snapshot: s, result: r } = report;
  const [tab, setTab] = useState<'closed' | 'fills' | 'monthly' | 'account'>('closed');
  const [name, setName] = useState(s.name);
  const [message, setMessage] = useState('');
  const money = (n: number) => n.toLocaleString(language === 'en' ? 'en-US' : 'zh-CN', { maximumFractionDigits: 2 });
  const factor = r.profitFactor !== null ? r.profitFactor.toFixed(2) : r.grossProfit > 0 ? '∞' : '—';
  const save = () => setMessage(saveStrategyReport(report, name) ? '已保存' : useStrategyWorkspace.getState().notice||'保存失败');
  const download = (csv: boolean) => {
    try {
      downloadFile(csv ? strategyTradeCsv(report) : JSON.stringify({ ...s, result: r }, null, 2), s.instrument.ticker + '-strategy-' + day(r.end) + (csv ? '.csv' : '.json'), csv ? 'text/csv;charset=utf-8' : 'application/json');
      setMessage('已开始下载。');
    } catch { setMessage('导出失败，请重试'); }
  };
  const metrics: [string, string, string][] = [
    ['策略收益', pct(r.totalReturn), '期末资产 / 初始资金 - 1'],
    ['买入持有', pct(r.benchmarkReturn), '同区间买入持有收益'],
    ['最大回撤', pct(r.maxDrawdown), '日收盘资产峰值回撤'],
    ['已平仓胜率', r.closedTrades ? pct(r.wins / r.closedTrades) : '—', '盈利交易 / 已平仓交易'],
    ['年化收益', pct(r.annualReturn), s.config.sessionsPerYear===365?'按365个UTC日折算':'按252个交易日折算'],
    ['年化波动', pct(r.volatility), s.config.sessionsPerYear===365?'日收益标准差 × √365':'日收益标准差 × √252'],
    ['夏普比率', r.sharpe?.toFixed(2) ?? '—', s.config.sessionsPerYear===365?'日均收益 / 标准差 × √365':'日均收益 / 标准差 × √252'],
    ['盈利因子', factor, '总盈利 / 总亏损绝对值'],
    ['累计手续费', money(r.totalFees), '买卖成交费用合计'],
    ['平均仓位', pct(r.averageExposure), '日收盘仓位均值'],
    ['平均持有日', r.averageHolding?.toFixed(1) ?? '—', '已平仓交易持有日均值'],
    ['期末资产', money(r.finalEquity), '现金 + 持仓市值'],
  ];
  const metric = (index: number) => {
    const [label, value, tip] = metrics[index];
    return <div key={label} data-strategy-metric><small title={t(tip)}>{t(label)}</small><strong>{value}</strong></div>;
  };
  return <>
    <header className="strategy-report-header">
      <div className="strategy-report-title"><input aria-label={t('报告名称')} maxLength={80} value={name} onChange={e => setName(e.target.value)} /><p>{day(r.start)} — {day(r.end)}<span>{r.testedBars} {t('交易日')}</span><span>{s.source} · {s.adjustment}{s.stale && ' · ' + t('缓存')}</span></p></div>
      <div className="strategy-report-actions"><button type="button" onClick={save}>{t('保存结果')}</button><details className="strategy-export"><summary>{t('导出')}</summary><div><button type="button" onClick={() => download(false)}>{t('导出完整报告')}</button><button type="button" onClick={() => download(true)}>{t('导出交易 CSV')}</button></div></details><details className="strategy-snapshot"><summary>{t('参数快照')}</summary><div className="strategy-snapshot-content"><dl>{([
        ['标的', s.instrument.ticker], ['策略参数', t(strategyName(s.config.kind)) + ' ' + strategyParameters(s.config)],
        ...getStrategy(s.config.kind)!.parameters.map(p => [p.label, s.config[p.key] ?? '—'] as [string, string | number]),
        ['初始资金', money(s.config.capital)], [s.config.plan?'单股仓位上限':'开仓比例', (s.config.positionPct ?? 100) + '%'],
        ['单边费率（基点）', s.config.feeBps], ['单边滑点（基点）', s.config.slippageBps],
        ['收盘止损', (s.config.stopLossPct ?? 0) + '%'], ['收盘止盈', (s.config.takeProfitPct ?? 0) + '%'],
        ['交易单位', s.config.lotSize || t('可分割份额')], ['期末处理', t(s.config.liquidateEnd ? '期末清仓' : '期末按市值保留')],
        ['预热', r.warmupBars], ['生成时间', new Date(s.createdAt).toLocaleString(language === 'en' ? 'en-US' : 'zh-CN')],
      ] as [string, string | number][]).map(([label, value]) => <div key={label}><dt>{t(label)}</dt><dd>{value}</dd></div>)}</dl><StrategyDetails config={s.config}/></div></details></div>
    </header>
    {report.snapshot.ai && <details className="strategy-ai-origin"><summary> {t('AI 生成依据')}</summary><div><p>{report.snapshot.ai.prompt}</p><p>{report.snapshot.ai.generation.proposal.summary}</p><small>{report.snapshot.ai.generation.provider} · {report.snapshot.ai.generation.model} · {report.snapshot.ai.generation.generated_at}</small></div></details>}
    {message && <p className="strategy-notice" role="status">{t(message)}</p>}
    <div className="strategy-metrics">{[0, 1, 2, 6, 3, 7].map(metric)}</div>
    {!r.trades.length && <p className="strategy-notice" role="status">{r.skippedEntries > 0 ? t('买入信号已触发，但资金或交易单位不足，未能开仓。') + ' ' + r.skippedEntries + ' / ' + r.testedBars : t('本区间未出现买入信号，账户保持现金。') + ' 0 / ' + r.testedBars} {r.entrySignals !== undefined && t('买入信号') + ' ' + r.entrySignals}</p>}
    <EquityChart result={r} capital={s.config.capital} />
    {r.regimes && <details className="strategy-regime-report"><summary>{t('市场状态与策略切换')} · {r.regimes.filter((p, i) => !i || p.regime !== r.regimes![i - 1].regime).length} {t('阶段')}</summary><div className="strategy-regime-strip">{Object.entries(regimeNames).map(([key, name]) => <span key={key}>{t(name)} <b>{r.regimes!.filter(p => p.regime === key).length} {t('交易日')}</b></span>)}</div><div className="strategy-table"><table><thead><tr>{['开始日期', '结束日期', '市场状态', '执行策略'].map(x => <th key={x}>{t(x)}</th>)}</tr></thead><tbody>{r.regimes.map((p, i, all) => !i || p.regime !== all[i - 1].regime ? <tr key={p.date}><td>{day(p.date)}</td><td>{day(all.slice(i + 1).findIndex(n => n.regime !== p.regime) < 0 ? all.at(-1)!.date : all[i + all.slice(i + 1).findIndex(n => n.regime !== p.regime)].date)}</td><td>{t(regimeNames[p.regime])}</td><td>{t(p.method === 'cash' ? '持有现金' : strategyName(p.method))}</td></tr> : null)}</tbody></table></div></details>}
    <div className="strategy-stats">{[4, 5, 8, 9, 10, 11].map(metric)}</div>
    <div className="strategy-tabs" role="group" aria-label={t('报告明细')}>{([['closed', '交易分析'], ['fills', '成交明细'], ['monthly', '月度收益'], ['account', '账户']] as const).map(([id, label]) => <button type="button" key={id} aria-pressed={tab === id} onClick={() => setTab(id)}>{t(label)}{id === 'closed' ? ' (' + r.closed.length + ')' : id === 'fills' ? ' (' + r.trades.length + ')' : ''}</button>)}</div>
    {tab === 'account' ? <div className="strategy-account"><span>{t('现金')} <b>{money(r.cash)}</b></span><span>{t('持仓数量')} <b>{money(r.shares)}</b></span><span>{t('未实现盈亏')} <b>{money(r.unrealizedPnl)}</b></span>{r.skippedEntries > 0 && <span>{t('跳过开仓')} <b>{r.skippedEntries}</b></span>}</div> : tab === 'monthly' ? <div className="strategy-table" tabIndex={0} role="region" aria-label={t('月度收益')}><table><thead><tr>{['月份', '策略收益', '买入持有', '收益差'].map(x => <th key={x}>{t(x)}</th>)}</tr></thead><tbody>{r.monthly.map(m => <tr key={m.month}><td>{m.month}</td><td>{pct(m.strategy)}</td><td>{pct(m.benchmark)}</td><td>{pct(m.strategy - m.benchmark)}</td></tr>)}</tbody></table></div>
    : tab === 'closed' ? <div className="strategy-table" tabIndex={0} role="region" aria-label={t('交易分析')}><table><thead><tr>{['开仓日期', '平仓日期', '持有日', '净盈亏', '净收益率', '费用', '退出原因'].map(x => <th key={x}>{t(x)}</th>)}</tr></thead><tbody>{r.closed.map((trade, i) => <tr key={i}><td>{day(trade.entryDate)}</td><td>{day(trade.exitDate)}</td><td>{trade.sessions}</td><td>{money(trade.pnl)}</td><td>{pct(trade.returnPct)}</td><td>{money(trade.fees)}</td><td>{t(reasonName(trade.reason))}</td></tr>)}</tbody></table>{!r.closed.length && <p role="status">{t('暂无已平仓交易')}</p>}</div>
    : <div className="strategy-table" tabIndex={0} role="region" aria-label={t('交易记录')}><table><thead><tr>{['信号日期', '成交日期', '方向', '成交价', '数量', '费用', '现金', '原因'].map(x => <th key={x}>{t(x)}</th>)}</tr></thead><tbody>{r.trades.map((trade, i) => <tr key={i}><td>{day(trade.signalDate)}</td><td>{day(trade.date)}</td><td>{t(trade.side === 'buy' ? '买入' : '卖出')}</td><td>{money(trade.price)}</td><td>{money(trade.shares)}</td><td>{money(trade.fee)}</td><td>{money(trade.cash)}</td><td>{trade.detail??t(reasonName(trade.reason))}</td></tr>)}</tbody></table>{!r.trades.length && <p role="status">{t('暂无成交')}</p>}</div>}
  </>;
}

function EquityChart({ result, capital }: { result: BacktestResult; capital: number }) {
  const container = useRef<SVGSVGElement>(null);
  const [{ width, height }, setSize] = useState({ width: 1000, height: 250 });
  useEffect(() => {
    const node = container.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: Math.max(300, entry.contentRect.width), height: entry.contentRect.height }));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const [mode, setMode] = useState<'equity' | 'drawdown'>('equity');
  const [index, setIndex] = useState(result.curve.length - 1);
  const at = Math.min(index, result.curve.length - 1), point = result.curve[at];
  const values = [capital, ...result.curve.flatMap(p => [p.equity, p.benchmark])];
  const min = mode === 'equity' ? Math.min(...values) : 0;
  const max = mode === 'equity' ? Math.max(...values) : Math.max(.01, result.maxDrawdown);
  const span = max - min || 1;
  const x = (i: number) => 60 + i / Math.max(1, result.curve.length - 1) * (width - 84);
  const y = (n: number) => mode === 'equity' ? height - 50 - (n - min) / span * (height - 80) : 30 + n / span * (height - 80);
  const line = (key: 'equity' | 'benchmark' | 'drawdown') => result.curve.map((p, i) => x(i) + ',' + y(p[key])).join(' ');
  return <div className="strategy-chart">
    <div className="strategy-chart-head">
    <div className="strategy-tabs"><button type="button" aria-pressed={mode === 'equity'} onClick={() => setMode('equity')}>{t('收益曲线')}</button><button type="button" aria-pressed={mode === 'drawdown'} onClick={() => setMode('drawdown')}>{t('回撤曲线')}</button></div>
    <p className="strategy-chart-readout">{day(point.date)} · {mode === 'equity' ? t('策略净值') + ' ' + (point.equity / capital).toFixed(4) + ' · ' + t('买入持有') + ' ' + (point.benchmark / capital).toFixed(4) : t('回撤') + ' ' + pct(point.drawdown)}</p>
    </div>
    <svg ref={container} viewBox={`0 0 ${width} ${height}`} tabIndex={0} onKeyDown={e => {
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
        e.preventDefault();
        setIndex(current => e.key === 'Home' ? 0 : e.key === 'End' ? result.curve.length - 1 : Math.max(0, Math.min(result.curve.length - 1, current + (e.key === 'ArrowRight' ? 1 : -1))));
      }
    }} role="img" aria-label={t(mode === 'equity' ? '策略与买入持有收益曲线' : '策略回撤曲线')} onPointerMove={e => {
      const rect = e.currentTarget.getBoundingClientRect();
      setIndex(Math.max(0, Math.min(result.curve.length - 1, Math.round(((e.clientX - rect.left) / rect.width * width - 60) / (width - 84) * (result.curve.length - 1)))));
    }}>
      {[min, (min + max) / 2, max].map((n, i) => <g key={i}><line x1="60" x2={width - 24} y1={y(n)} y2={y(n)} stroke="currentColor" opacity=".12" /><text x="54" y={y(n) + 4} textAnchor="end">{mode === 'equity' ? (n / capital).toFixed(2) : pct(n)}</text></g>)}
      {mode === 'equity' && <polyline points={line('benchmark')} fill="none" stroke="#8497ad" strokeWidth="2" />}
      <polyline points={line(mode)} fill="none" stroke="var(--orange)" strokeWidth="2.5" />
      <line x1={x(at)} x2={x(at)} y1="24" y2={height - 45} stroke="currentColor" opacity=".3" strokeDasharray="4 4" />
      <circle cx={x(at)} cy={y(point[mode])} r="4" fill="var(--orange)" />
      <text x="60" y={height - 15}>{day(result.start)}</text><text x={width - 24} y={height - 15} textAnchor="end">{day(result.end)}</text>
    </svg>

  </div>;
}


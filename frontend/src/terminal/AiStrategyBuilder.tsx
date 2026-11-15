import { useEffect, useMemo, useRef, useState } from 'react';
import { t, useLanguage } from '../lib/i18n';
import { useAiProfiles } from '../ai/profileStore';
import { useAiRequest } from '../ai/useAiRequest';
import { isGeneratedStrategy, parseGeneratedStrategy, type AiStrategyOrigin, type AiStrategyProposal, type GeneratedStrategy, type StrategyGenerationRequest } from '../ai/strategyPayload';
import type { WatchlistStock } from '../store/stockStore';
import type { HistoryResponse } from './types';
import { analysisIndicatorValues } from './indicators';
import type { StrategyConfig } from './backtest';
import { defaultCustomRules } from './strategyRules';
import { StrategyRuleEditor } from './StrategyRuleEditor';
import { useStrategyWorkspace } from './strategyWorkspace';

export function AiStrategyBuilder({ instrument, options, history, period, config, inputError, onChoose, onSettings, onApply }: {
  instrument: WatchlistStock; options: WatchlistStock[]; history: HistoryResponse; period: '1y' | '3mo'; config: StrategyConfig; inputError: string;
  onChoose: (instrument: WatchlistStock) => void; onSettings: () => void; onApply: (proposal: AiStrategyProposal, origin?: AiStrategyOrigin, adaptive?: boolean) => void;
}) {
  const { language } = useLanguage();
  const { profiles, activeId, select } = useAiProfiles();
  const profile = profiles.find(p => p.id === activeId);
  const workspace = useStrategyWorkspace();
  const origin = workspace.aiOrigin?.generation.ticker === instrument.ticker ? workspace.aiOrigin : null;
  const promptText = workspace.aiPrompt ?? origin?.prompt ?? '';
  const initial = workspace.aiDraft?.ticker === instrument.ticker ? workspace.aiDraft : origin?.generation ?? null;
  const [editor, setEditor] = useState(() => workspace.aiEditor?.ticker === instrument.ticker ? workspace.aiEditor : (config.kind === 'custom' || config.kind === 'adaptive') && config.rules ? { ticker: instrument.ticker, proposal: { name: workspace.aiName || initial?.proposal.name || t('自定义策略'), summary: origin?.generation.proposal.summary || '', rules: structuredClone(config.rules), risk: { position_pct: config.positionPct ?? 100, stop_loss_pct: config.stopLossPct ?? 0, take_profit_pct: config.takeProfitPct ?? 0 }, evidence: origin?.generation.proposal.evidence ?? [] }, generation: origin?.generation ?? null, prompt: origin?.prompt ?? '' } : initial ? { ticker: instrument.ticker, proposal: structuredClone(initial.proposal), generation: initial, prompt: workspace.aiPrompt ?? '' } : null);
  const draft = editor?.proposal ?? null, generation = editor?.generation ?? null;
  const commitEditor = (next: typeof editor) => { setEditor(next); useStrategyWorkspace.setState({ aiEditor: next }); };
  const setDraft = (proposal: AiStrategyProposal) => commitEditor({ ticker: instrument.ticker, proposal, generation, prompt: editor?.prompt ?? '' });
  const [sources, setSources] = useState({ news: true, quote: true, market: true });
  const [error, setError] = useState('');
  const nonce = useRef(0);
  const indicators = useMemo(() => analysisIndicatorValues(history.data, [], true), [history.data]);
  const contextKey = JSON.stringify({ ticker: instrument.ticker, period, data: history.data, sources });
  const ai = useAiRequest<StrategyGenerationRequest, GeneratedStrategy>(contextKey, profile, '/ai/strategies/generate', isGeneratedStrategy, '生成失败');
  useEffect(() => () => { nonce.current++; }, [contextKey, profile?.id, profile?.updatedAt, language]);
  const generate = async () => {
    const prompt = promptText.trim();
    if (!prompt) { setError('请输入策略目标'); return; }
    const token = ++nonce.current;
    setError('');
    const result = await ai.run({ ticker: instrument.ticker, prompt, period, chart_history: { data: history.data, source: history.source, adjustment: history.adjustment, price_type: 'ohlc', stale: history.stale, indicators }, include_news: sources.news, include_quote: sources.quote, include_market: sources.market });
    if (result && token === nonce.current) {
      const clean = parseGeneratedStrategy(result);
      commitEditor({ ticker: instrument.ticker, generation: clean, proposal: structuredClone(clean.proposal), prompt });
      useStrategyWorkspace.setState({ aiDraft: clean });
    }
  };
  const apply = (adaptive = false) => {
    if (!draft) return;
    try { onApply(draft, generation ? { prompt: editor?.prompt ?? '', generation } : undefined, adaptive); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : '策略规则格式无效。'); }
  };
  const presets = ['结合最新新闻，生成中期趋势跟随策略，控制仓位和回撤。', '寻找超跌后的反转机会，用成交量确认入场，设置明确退出条件。', '根据行情波动和市场环境设计保守策略，优先控制风险。'];
  return <section className="ai-strategy-builder">
    <form className="ai-strategy-input" onSubmit={e => { e.preventDefault(); void generate(); }}>
      <header><h2>{t('AI 策略生成')}</h2><button type="button" onClick={onSettings}>{t('接口设置')}</button></header>
      <label>{t('回测标的')}<select aria-label={t('AI 策略标的')} value={instrument.ticker} disabled={ai.loading} onChange={e => { const selected = options.find(s => s.ticker === e.target.value); if (selected) onChoose(selected); }}>{options.map(s => <option key={s.ticker} value={s.ticker}>{s.ticker} · {s.name}</option>)}</select></label>
      {profiles.length > 0 && <label>{t('分析接口')}<select aria-label={t('策略生成接口')} disabled={ai.loading} value={activeId} onChange={e => select(e.target.value)}>{profiles.map(p => <option key={p.id} value={p.id}>{p.name} · {p.model}</option>)}</select></label>}
      <label>{t('策略目标')}<textarea aria-label={t('策略目标')} rows={7} maxLength={2000} disabled={ai.loading} placeholder={t('描述交易目标、持有周期、风险偏好和关注事件')} value={promptText} onChange={e => useStrategyWorkspace.setState({ aiPrompt: e.target.value })} /></label>
      <div className="ai-strategy-presets">{presets.map((prompt, i) => <button key={prompt} type="button" disabled={ai.loading} onClick={() => useStrategyWorkspace.setState({ aiPrompt: t(prompt) })}>{t(['趋势跟随', '超跌反转', '稳健配置'][i])}</button>)}</div>
      <div className="ai-strategy-sources" role="group" aria-label={t('分析数据源')}>{([['news', '新闻'], ['quote', '实时行情'], ['market', '市场概览']] as const).map(([key, label]) => <label className="strategy-checkbox" key={key}><input type="checkbox" checked={sources[key]} disabled={ai.loading} onChange={e => setSources({ ...sources, [key]: e.target.checked })} />{t(label)}</label>)}</div>
      <small>{history.data.length} {t('条日线')} · {history.source ?? '—'} · {history.adjustment ?? '—'}{history.stale && ' · ' + t('缓存')}</small>
      {(error || ai.error || inputError) && <p role="alert" className="strategy-error">{t(error || ai.error || inputError)}</p>}
      <div className="ai-strategy-generate">{profile ? <button className="strategy-run" type="submit" disabled={ai.loading || !promptText.trim() || history.data.length < 20 || !!inputError}>{t(ai.loading ? '生成中…' : '生成策略')}</button> : <button className="strategy-run" type="button" onClick={onSettings}>{t('配置 AI 接口')}</button>}{ai.loading && <button type="button" onClick={() => { nonce.current++; ai.cancel(); }}>{t('取消生成')}</button>}<button type="button" disabled={ai.loading} onClick={() => { commitEditor({ ticker: instrument.ticker, proposal: { name: t('自定义策略'), summary: '', rules: defaultCustomRules(), risk: { position_pct: config.positionPct ?? 100, stop_loss_pct: config.stopLossPct ?? 0, take_profit_pct: config.takeProfitPct ?? 0 }, evidence: [] }, generation: null, prompt: '' }); }}>{t('手动建规则')}</button></div>
    </form>
    <div className="ai-strategy-output">{!draft ? <div className="strategy-empty"><p>{t('暂无策略')}</p></div> : <>
      <header><input aria-label={t('生成策略名称')} maxLength={80} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /><button type="button" className="strategy-run" disabled={ai.loading || !!inputError} onClick={() => apply()}>{t('载入并回测')}</button><button type="button" disabled={ai.loading || !!inputError} onClick={() => apply(true)}>{t('自适应运行')}</button></header>
      {draft.summary && <p className="ai-strategy-summary">{draft.summary}</p>}
      <StrategyRuleEditor value={draft.rules} onChange={rules => setDraft({ ...draft, rules })} />
      <div className="ai-strategy-risk">{([['position_pct', '开仓资金比例（%）', 1, 100], ['stop_loss_pct', '收盘止损（%）', 0, 100], ['take_profit_pct', '收盘止盈（%）', 0, 1000]] as const).map(([key, label, min, max]) => <label key={key}>{t(label)}<input aria-label={t('AI ') + t(label)} type="number" min={min} max={max} step={.1} value={Number.isFinite(draft.risk[key]) ? draft.risk[key] : ''} onChange={e => setDraft({ ...draft, risk: { ...draft.risk, [key]: e.target.valueAsNumber } })} /></label>)}</div>
      {generation && <section className="ai-strategy-evidence"><header><h3>{t('生成依据')}</h3><small>{generation.provider} · {generation.model} · {new Date(generation.generated_at).toLocaleString(language === 'en' ? 'en-US' : 'zh-CN')}</small></header>{generation.proposal.evidence.map(use => { const item = generation.evidence.find(e => e.id === use.id)!; return <details key={use.id}><summary><span>{item.id}</span>{item.title}<small>{item.source}</small></summary><p>{use.reason}</p><p>{item.detail}</p><time>{item.timestamp}</time></details>; })}</section>}
    </>}</div>
  </section>;
}

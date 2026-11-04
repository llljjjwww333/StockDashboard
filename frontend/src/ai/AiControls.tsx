import { t, getLocale } from '../lib/i18n';
import type { AiProfile, AnalysisResult } from './types';
import { useAiProfiles } from './profileStore';

export function AiControls({ profile, loading, onRun, onSettings, onClear, hasResult }: {
  profile?: AiProfile; loading: boolean; onRun: () => void; onSettings: () => void;
  onClear: () => void; hasResult: boolean;
}) {
  const { profiles, select } = useAiProfiles();
  return <div className="ai-controls">
    {profiles.length > 1 && <select aria-label={t("分析接口")} value={profile?.id ?? ''} onChange={e => select(e.target.value)}>
      {profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select>}
    <button className="ai-run" type="button" disabled={loading} onClick={profile ? onRun : onSettings}>{loading ? t("分析中…") : t("AI 分析")}</button>
    {(hasResult || loading) && <button type="button" onClick={onClear}>{loading ? t("取消") : t("清除")}</button>}
  </div>;
}

export function AnalysisSummary({ result, onAnnotation }: { result: AnalysisResult; onAnnotation?: (id: string) => void }) {
  return <section className="analysis-summary" aria-label={t("AI 分析结果")}>
    <header><strong>{result.outlook || t("分析结果")}</strong><small>{result.provider} · {result.model}</small></header>
    <p>{result.summary}</p>
    {result.drivers.length > 0 && <ul>{result.drivers.map((text, i) => <li key={i}>{text}</li>)}</ul>}
    {result.watch.length > 0 && <div className="analysis-watch"><strong>{t("关注")}</strong>{result.watch.map((text, i) => <p key={i}>{text}</p>)}</div>}
    {result.annotations.length > 0 && <div className="analysis-points">{result.annotations.map((point, index) => <button type="button" key={point.id} onClick={() => onAnnotation?.(point.id)} title={point.detail}><b>{index + 1}</b><span>{point.label}</span><small>{point.price.toFixed(2)}</small></button>)}</div>}
    <footer>{result.context.bar_count > 0 && <span>{t("{count} 根K线", { count: result.context.bar_count })}</span>}<span>{t("{count} 条资讯", { count: result.context.news_count })}</span><time>{new Date(result.analyzed_at).toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit' })}</time></footer>
  </section>;
}

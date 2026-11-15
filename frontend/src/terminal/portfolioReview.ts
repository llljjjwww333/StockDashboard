import type { PortfolioReview } from './portfolio';
export function parsePortfolioReview(value: unknown): PortfolioReview {
  const r = value as PortfolioReview;
  const text = (v: unknown, max: number) => typeof v === 'string' && v.length > 0 && v.length <= max;
  if (!r || !text(r.id, 100) || !Number.isFinite(Date.parse(r.reviewed_at)) || !text(r.provider, 80) || !text(r.model, 150) || !r.decision || !Array.isArray(r.evidence) || r.evidence.length > 100) throw new Error('AI 组合响应无效');
  const d = r.decision;
  if (!text(d.regime, 120) || !text(d.method, 120) || !text(d.summary, 800) || !text(d.reconsider_when, 400) || !Array.isArray(d.targets) || d.targets.length > 40 || d.targets.some(t => !t || !text(t.ticker, 20) || !Number.isFinite(t.weight_pct) || t.weight_pct < 0 || t.weight_pct > 100 || !text(t.reason, 300)) || !Array.isArray(d.evidence_ids) || d.evidence_ids.length < 1 || d.evidence_ids.length > 12) throw new Error('AI 目标组合无效');
  if (r.evidence.some(e => !e || !text(e.id, 100) || !text(e.title, 512) || !(e.source === null || typeof e.source === 'string') || typeof e.timestamp !== 'string') || new Set(r.evidence.map(e => e.id)).size !== r.evidence.length || d.evidence_ids.some(id => !r.evidence.some(e => e.id === id))) throw new Error('AI 组合证据无效');
  return { ...(typeof r.ruleKey === 'string' && r.ruleKey.length < 15000 ? { ruleKey: r.ruleKey } : {}), ...(typeof r.ticker === 'string' ? { ticker: r.ticker } : {}), ...(typeof r.strategy === 'string' ? { strategy: r.strategy } : {}), id: r.id, reviewed_at: r.reviewed_at, provider: r.provider, model: r.model, decision: structuredClone(d), evidence: structuredClone(r.evidence), ...(typeof r.execution === 'string' ? { execution: r.execution.slice(0, 500) } : {}) };
}

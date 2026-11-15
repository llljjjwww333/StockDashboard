import { isInstrumentTicker } from '../lib/instrumentIdentity.ts';
import { parseStrategyRules, type CustomStrategyRules } from '../terminal/strategyRules.ts';
import type { HistoryResponse } from '../terminal/types';

export type StrategyEvidence = { id: string; kind: 'history' | 'indicators' | 'quote' | 'market' | 'news'; title: string; detail: string; source: string; timestamp: string };
export type AiStrategyProposal = { name: string; summary: string; rules: CustomStrategyRules; risk: { position_pct: number; stop_loss_pct: number; take_profit_pct: number }; evidence: { id: string; reason: string }[] };
export type GeneratedStrategy = { ticker: string; provider: string; model: string; generated_at: string; proposal: AiStrategyProposal; evidence: StrategyEvidence[] };
export type StrategyGenerationRequest = { ticker: string; prompt: string; period: '1y' | '3mo'; chart_history: Pick<HistoryResponse, 'data' | 'source' | 'adjustment' | 'stale' | 'price_type'> & { indicators: Record<string, number | null> }; include_news: boolean; include_quote: boolean; include_market: boolean };
export type AiStrategyOrigin = { prompt: string; generation: GeneratedStrategy };
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const string = (v: unknown, max: number) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const finite = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

export function parseGeneratedStrategy(value: unknown): GeneratedStrategy {
  if (!record(value) || !isInstrumentTicker(value.ticker) || !string(value.provider, 80) || !string(value.model, 150) || !string(value.generated_at, 50) || !Number.isFinite(Date.parse(String(value.generated_at))) || !record(value.proposal) || !Array.isArray(value.evidence) || value.evidence.length < 1 || value.evidence.length > 20) throw new Error('AI 策略数据无效');
  const evidence = value.evidence.map((e): StrategyEvidence => {
    if (!record(e) || !string(e.id, 20) || !['history', 'indicators', 'quote', 'market', 'news'].includes(String(e.kind)) || !string(e.title, 512) || typeof e.detail !== 'string' || e.detail.length > 3000 || !string(e.source, 200) || typeof e.timestamp !== 'string' || e.timestamp.length > 50) throw new Error('AI 策略数据无效');
    return { id: e.id as string, kind: e.kind as StrategyEvidence['kind'], title: e.title as string, detail: e.detail as string, source: e.source as string, timestamp: e.timestamp };
  });
  const ids = new Set(evidence.map(e => e.id));
  if (ids.size !== evidence.length) throw new Error('AI 策略数据无效');
  const p = value.proposal, r = p.risk;
  if (!string(p.name, 80) || !string(p.summary, 800) || !record(r) || !finite(r.position_pct, 1, 100) || !finite(r.stop_loss_pct, 0, 100) || !finite(r.take_profit_pct, 0, 1000) || !Array.isArray(p.evidence) || !p.evidence.length || p.evidence.length > 8) throw new Error('AI 策略数据无效');
  const uses = p.evidence.map(e => {
    if (!record(e) || !string(e.id, 20) || !ids.has(e.id as string) || !string(e.reason, 240)) throw new Error('AI 策略数据无效');
    return { id: e.id as string, reason: e.reason as string };
  });
  if (new Set(uses.map(e => e.id)).size !== uses.length) throw new Error('AI 策略数据无效');
  return { ticker: value.ticker, provider: value.provider as string, model: value.model as string, generated_at: value.generated_at as string,
    proposal: { name: p.name as string, summary: p.summary as string, rules: parseStrategyRules(p.rules), risk: { position_pct: r.position_pct, stop_loss_pct: r.stop_loss_pct, take_profit_pct: r.take_profit_pct }, evidence: uses }, evidence };
}
export function isGeneratedStrategy(value: unknown, request: StrategyGenerationRequest): value is GeneratedStrategy {
  try { return parseGeneratedStrategy(value).ticker === request.ticker; } catch { return false; }
}
export function parseAiStrategyOrigin(value: unknown): AiStrategyOrigin {
  if (!record(value) || !string(value.prompt, 2000)) throw new Error('AI 策略来源无效');
  return { prompt: value.prompt as string, generation: parseGeneratedStrategy(value.generation) };
}

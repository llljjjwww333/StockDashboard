import { create } from 'zustand';
import { instrumentMarket, isInstrumentTicker } from '../lib/instrumentIdentity.ts';
import type { WatchlistStock } from '../store/stockStore';
import type { HistoryPoint } from './types';
import { runBacktest, strategyDefaults, validateStrategyConfig, type BacktestResult, type StrategyConfig } from './backtest.ts';
import type { ExperimentRun } from './strategyExperiment';
import { parseAiStrategyOrigin, type AiStrategyOrigin, type AiStrategyProposal, type GeneratedStrategy } from '../ai/strategyPayload.ts';
import { rememberBacktestReport } from './backtestSessions.ts';

export type StrategySnapshot = {
  version: 2; id: string; name: string; createdAt: string;
  instrument: WatchlistStock; config: StrategyConfig; period: '1y' | '3mo';
  source: string; adjustment: string; stale: boolean; bars: HistoryPoint[];
  ai?: AiStrategyOrigin;
  strategy?: { id: string; revision: number; goal: string; executionMode?: 'rules' };
};
export type StrategyReport = { snapshot: StrategySnapshot; result: BacktestResult };
type StoragePort = Pick<Storage, 'getItem' | 'setItem'>;
export const strategyLibraryKey = 'marketdesk:crypto:strategy-library:v2';
const draftKey = 'marketdesk:crypto:strategy-draft:v2';
const identity = (value: unknown): value is WatchlistStock => {
  if (!value || typeof value !== 'object') return false;
  const s = value as WatchlistStock;
  return isInstrumentTicker(s.ticker) && s.ticker.length <= 20 && typeof s.name === 'string' && s.name.length <= 200 &&
    s.market === instrumentMarket(s.ticker);
};

// Persist input snapshots and recompute, instead of trusting saved performance figures.
export function parseStrategyLibrary(raw: string | null): { reports: StrategyReport[]; damaged: boolean } {
  if (!raw) return { reports: [], damaged: false };
  const reports: StrategyReport[] = [];
  let damaged = false;
  try {
    if (raw.length > 4_000_000) throw new Error();
    const rows: unknown = JSON.parse(raw);
    if (!Array.isArray(rows) || rows.length > 12) throw new Error();
    const ids = new Set<string>();
    for (const value of rows) {
      try {
        const s = value as StrategySnapshot;
        if (!s || s.version !== 2 || typeof s.id !== 'string' || !s.id || s.id.length > 100 || ids.has(s.id) ||
            typeof s.name !== 'string' || s.name.length > 80 || !identity(s.instrument) ||
            typeof s.createdAt !== 'string' || !Number.isFinite(Date.parse(s.createdAt)) ||
            !['1y', '3mo'].includes(s.period) || typeof s.source !== 'string' || s.source.length > 200 ||
            typeof s.adjustment !== 'string' || s.adjustment.length > 100 || typeof s.stale !== 'boolean' ||
            !Array.isArray(s.bars) || s.bars.length > 1500) throw new Error();
        const config = validateStrategyConfig(s.config);
        if (s.ai && parseAiStrategyOrigin(s.ai).generation.ticker !== s.instrument.ticker) throw new Error();
        const result = runBacktest(s.bars, config);
        const snapshot: StrategySnapshot = { version: 2, id: s.id, name: s.name, createdAt: s.createdAt,
          instrument: { ticker: s.instrument.ticker, name: s.instrument.name, market: s.instrument.market }, config,
          period: s.period, source: s.source, adjustment: s.adjustment, stale: s.stale,
          bars: s.bars.map(p => ({ timestamp: p.timestamp, open: p.open, high: p.high, low: p.low, close: p.close, volume: Number.isFinite(p.volume) ? p.volume : 0 })),
          ...(s.ai ? { ai: parseAiStrategyOrigin(s.ai) } : {}),
          ...(s.strategy && typeof s.strategy.id === 'string' && Number.isSafeInteger(s.strategy.revision) && s.strategy.revision > 0 && typeof s.strategy.goal === 'string' && s.strategy.goal.length <= 2000 ? { strategy: { id: s.strategy.id, revision: s.strategy.revision, goal: s.strategy.goal, executionMode: 'rules' } } : {}) };
        reports.push({ snapshot, result }); ids.add(s.id);
      } catch { damaged = true; }
    }
  } catch { damaged = true; }
  return { reports, damaged };
}

export function writeStrategyLibrary(storage: StoragePort, reports: StrategyReport[]) {
  // Do not overwrite an existing library when the browser cannot read it.
  storage.getItem(strategyLibraryKey);
  if(reports.length>12)throw new Error('回测记录已满');
  storage.setItem(strategyLibraryKey, JSON.stringify(reports.map(r => r.snapshot)));
}

type Workspace = {
  instrument: WatchlistStock | null; config: StrategyConfig; period: '1y' | '3mo';
  report: StrategyReport | null; library: StrategyReport[]; notice: string; experiment?: ExperimentRun | null;
  aiPrompt?: string; aiDraft?: GeneratedStrategy | null; aiOrigin?: AiStrategyOrigin | null; aiName?: string;
  aiEditor?: { ticker: string; proposal: AiStrategyProposal; generation: GeneratedStrategy | null; prompt: string } | null;
};
function initialState(): Workspace {
  const result: Workspace = { instrument: null, config: { ...strategyDefaults }, period: '1y', report: null, library: [], notice: '' };
  try {
    const saved = parseStrategyLibrary(localStorage.getItem(strategyLibraryKey));
    result.library = saved.reports;
    if (saved.damaged) result.notice = '部分保存记录损坏，已跳过；可用记录仍保留。';
    const draft = JSON.parse(localStorage.getItem(draftKey) ?? 'null');
    if (draft && identity(draft.instrument) && ['1y', '3mo'].includes(draft.period)) {
      result.instrument = { ticker: draft.instrument.ticker, name: draft.instrument.name, market: draft.instrument.market };
      result.config = validateStrategyConfig(draft.config); result.period = draft.period;
    }
  } catch { result.notice = '无法读取策略偏好，本页仍可使用。'; }
  return result;
}
export const useStrategyWorkspace = create<Workspace>(initialState);

export function commitStrategyLibrary(library: StrategyReport[]): boolean {
  try { writeStrategyLibrary(localStorage, library);useStrategyWorkspace.setState({ library,notice:'' }); return true; }
  catch {useStrategyWorkspace.setState({notice:'回测记录未能保存'});return false;}
}

export function saveStrategyReport(report: StrategyReport, name: string): boolean {
  const next = { ...report, snapshot: { ...report.snapshot, name: name.trim().slice(0, 80) || report.snapshot.name } };
  const rows = [next, ...useStrategyWorkspace.getState().library.filter(r => r.snapshot.id !== next.snapshot.id)];
  if(rows.length>12){useStrategyWorkspace.setState({notice:'回测记录已满，请先整理记录'});return false;}
  if(!commitStrategyLibrary(rows))return false;
  useStrategyWorkspace.setState({ report: next });rememberBacktestReport(next);return true;
}

// Valid drafts survive reloads; the report also stays in memory while navigating the app.
useStrategyWorkspace.subscribe((state, previous) => {
  if (state.instrument === previous.instrument && state.config === previous.config && state.period === previous.period) return;
  if (!previous.instrument && state.config === previous.config && state.period === previous.period) return;
  if (!state.instrument) return;
  let config: StrategyConfig;
  try { config = validateStrategyConfig(state.config); } catch { return; }
  try { localStorage.setItem(draftKey, JSON.stringify({ instrument: state.instrument, config, period: state.period })); }
  catch { if (state.notice !== '配置未能保存，刷新前请导出报告。') useStrategyWorkspace.setState({ notice: '配置未能保存，刷新前请导出报告。' }); }
});

export function strategyTradeCsv(report: StrategyReport) {
  const cell = (v: string | number) => {
    let text = String(v);
    if (typeof v === 'string' && /^\s*[=+@-]/.test(text)) text = `'${text}`;
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  const s = report.snapshot;
  const rows = report.result.trades.map(t => [s.instrument.ticker, t.signalDate, t.date, t.side, t.reason,
    t.price, t.shares, t.fee, t.cash, t.equity, s.source, s.adjustment, String(s.stale)].map(cell).join(','));
  return '\uFEFFticker,signal_date,fill_date,side,reason,price,quantity,fee,cash,equity_at_fill,source,adjustment,cached\r\n' + rows.join('\r\n') + '\r\n';
}

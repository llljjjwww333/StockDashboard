import { create } from 'zustand';
import { validateStrategyConfig } from './backtest';
import { isInstrumentTicker } from '../lib/instrumentIdentity';
import type { PaperAccount } from './paperTrading';
import type { Quote } from './types';

const key = 'marketdesk:crypto:paper-accounts:v1';
type PaperState = { owner: boolean; accounts: PaperAccount[]; running: string[]; quotes: Record<string, Quote>; status: Record<string, string>; error: string };
export function restorePaperAccounts(): Pick<PaperState, 'accounts' | 'error'> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { accounts: [], error: '' };
    const rows = JSON.parse(raw);
    if (!Array.isArray(rows) || rows.length > 8) throw new Error();
    for (const a of rows) {
      if (!a || typeof a.id !== 'string' || !isInstrumentTicker(a.ticker) || typeof a.name !== 'string' || !Array.isArray(a.fills) || !Array.isArray(a.lots) || !Array.isArray(a.curve) || ![a.cash, a.shares, a.cost, a.fees].every(n => Number.isFinite(n) && n >= 0) || !Number.isFinite(a.realized) || typeof a.lastSignal !== 'string') throw new Error();
      if (a.strategyLabel !== undefined && (typeof a.strategyLabel !== 'string' || a.strategyLabel.length > 200)) throw new Error();
      a.config = validateStrategyConfig(a.config);
      if (a.fills.some((f: PaperAccount['fills'][number]) => !f || typeof f.id !== 'string' || !Number.isFinite(Date.parse(f.time)) || !['buy', 'sell'].includes(f.side) || ![f.quantity, f.price, f.fee, f.cash, f.realized].every(Number.isFinite) || f.quantity <= 0 || f.price <= 0 || f.fee < 0 || f.cash < 0 || typeof f.reason !== 'string' || typeof f.source !== 'string' || !Number.isFinite(Date.parse(f.quoteTime)))) throw new Error();
      if (a.curve.some((p: PaperAccount['curve'][number]) => !p || !Number.isFinite(Date.parse(p.time)) || !Number.isFinite(p.equity) || p.equity < 0)) throw new Error();
      if (a.fills.length > 10000 || a.curve.length > 2000 || a.lots.some((l: PaperAccount['lots'][number]) => !Number.isSafeInteger(l.quantity) || l.quantity <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(l.date))) throw new Error();
      if (Math.abs(a.lots.reduce((s: number, l: PaperAccount['lots'][number]) => s + l.quantity, 0) - a.shares) > 1e-6) throw new Error();
    }
    return { accounts: rows, error: '' };
  } catch { return { accounts: [], error: '模拟账户读取失败，请导出浏览器备份后重试。' }; }
}
export const usePaperStore = create<PaperState>(() => ({ ...restorePaperAccounts(), owner: false, running: [], quotes: {}, status: {}, }));
export function savePaperAccounts(accounts: PaperAccount[]) {
  try { localStorage.setItem(key, JSON.stringify(accounts)); }
  catch { usePaperStore.setState({ error: '账户未能保存，自动交易已暂停。请导出账户。', running: [] }); return false; }
  usePaperStore.setState({ accounts, error: '' }); return true;
}

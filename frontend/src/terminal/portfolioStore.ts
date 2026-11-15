import { create } from 'zustand';
import { validMandate, migratePaperAccount, bindStockStrategy, type Portfolio } from './portfolio';
import { restorePaperAccounts } from './paperStore';
import { parsePortfolioReview } from './portfolioReview';
import { validateStrategyConfig } from './backtest';
import { isCryptoTicker, isInstrumentTicker } from '../lib/instrumentIdentity';
import type { Quote } from './types';
const key = 'marketdesk:crypto:portfolios:v2';
const selectedKey = 'marketdesk:crypto:selected-portfolio:v2';
export function parsePortfolios(raw: string): Portfolio[] {
  const rows = JSON.parse(raw);
  if (!Array.isArray(rows) || rows.length > 8 || raw.length > 8_000_000) throw new Error('账户数据无效');
  const ids = new Set<string>();
  for (const p of rows) {
    if (!p || p.version !== 2 || typeof p.id !== 'string' || ids.has(p.id) || typeof p.name !== 'string' || !['CN', 'US', 'CRYPTO'].includes(p.market) || ![p.capital, p.cash, p.fees].every(n => Number.isFinite(n) && n >= 0) || p.capital < 100 || !Number.isFinite(p.realized) || !Array.isArray(p.positions) || !Array.isArray(p.orders) || !Array.isArray(p.reviews) || !Array.isArray(p.curve) || !Array.isArray(p.pool) || !['ai', 'rules'].includes(p.mode) || !['watchlist', 'custom'].includes(p.poolMode) || typeof p.profileId !== 'string' || typeof p.strategyLabel !== 'string') throw new Error('账户数据无效');
    if (!Number.isFinite(Date.parse(p.createdAt))) throw new Error('账户时间无效');
    ids.add(p.id); p.mandate = validMandate(p.mandate); p.config = validateStrategyConfig(p.config);
    if (p.positions.length > 40 || p.pool.length > 40 || p.orders.length > 10000 || p.reviews.length > 200 || p.curve.length > 2000 || p.positions.some((h: Portfolio['positions'][number]) => !isInstrumentTicker(h.ticker) || ![h.shares, h.cost, h.lastPrice].every(n => Number.isFinite(n) && n > 0) || !Array.isArray(h.lots) || h.lots.some(l => !(isCryptoTicker(h.ticker)?Number.isFinite(l.quantity):Number.isSafeInteger(l.quantity)) || l.quantity <= 0 || typeof l.date !== 'string') || Math.abs(h.lots.reduce((s, l) => s + l.quantity, 0) - h.shares) > 1e-6) || p.pool.some((s: Portfolio['pool'][number]) => !isInstrumentTicker(s.ticker) || typeof s.name !== 'string')) throw new Error('账户数据无效');
    if (p.bindings === undefined) p.bindings = p.mode === 'rules' ? p.pool.map((s: Portfolio['pool'][number]) => ({ ticker: s.ticker, name: s.name, label: p.strategyLabel, mode: 'rules', mandate: { ...p.mandate, instrument: s }, config: p.config, profileId: p.profileId, allocationPct: Math.min(p.mandate.maxSingle, 100 / Math.max(1, p.pool.length)), enabled: true })) : [];
    if (!Array.isArray(p.bindings) || p.bindings.length > 40) throw new Error('个股策略无效');
    const bindings = p.bindings; p.bindings = [];
    for (const b of bindings) { if (!['ai','rules'].includes(b.mode) || typeof b.enabled !== 'boolean' || typeof b.profileId !== 'string' || typeof b.label !== 'string' || typeof b.name !== 'string') throw new Error('个股策略无效'); p.bindings = bindStockStrategy(p, b).bindings; }
    p.reviews = p.reviews.map(parsePortfolioReview);
    if (p.orders.some((o: Portfolio['orders'][number]) => !o || !isInstrumentTicker(o.ticker) || !['filled', 'rejected'].includes(o.status) || !['buy', 'sell'].includes(o.side) || !Number.isFinite(o.quantity) || o.quantity <= 0 || typeof o.id !== 'string' || !Number.isFinite(Date.parse(o.time)) || typeof o.reason !== 'string' || o.status === 'filled' && (!o.fill || ![o.fill.price, o.fill.fee, o.fill.cash, o.fill.realized].every(Number.isFinite)))) throw new Error('委托记录无效');
    if (new Set(p.positions.map((h: Portfolio['positions'][number]) => h.ticker)).size !== p.positions.length) throw new Error('账户重复持仓');
    if (p.curve.some((c: Portfolio['curve'][number]) => !Number.isFinite(Date.parse(c.time)) || !Number.isFinite(c.equity) || c.equity < 0)) throw new Error('账户净值无效');
  }
  return rows;
}
export function loadPortfolios(): { portfolios: Portfolio[]; error: string } {
  try { const raw = localStorage.getItem(key); return { portfolios: raw ? parsePortfolios(raw) : restorePaperAccounts().accounts.map(migratePaperAccount), error: '' }; }
  catch { return { portfolios: [], error: '账户读取失败，请先导出浏览器中的账户备份。' }; }
}
type State = { portfolios: Portfolio[]; selected: string; running: string[]; owner: boolean; quotes: Record<string, Quote>; status: Record<string, string>; pending: string[]; error: string };
export const usePortfolioStore = create<State>(() => {
 const loaded=loadPortfolios();let selected='';try{selected=localStorage.getItem(selectedKey)??'';}catch{/* The first account remains usable. */}
 return {...loaded,selected:loaded.portfolios.some(p=>p.id===selected)?selected:loaded.portfolios[0]?.id??'',running:[],owner:false,quotes:{},status:{},pending:[],error:loaded.error};
});
usePortfolioStore.subscribe((state,previous)=>{if(state.selected!==previous.selected)try{localStorage.setItem(selectedKey,state.selected);}catch{/* Account contents are saved separately. */}});
export function savePortfolios(portfolios: Portfolio[]) {
  try { localStorage.setItem(key, JSON.stringify(portfolios)); usePortfolioStore.setState({ portfolios, error: '' }); return true; }
  catch { usePortfolioStore.setState({ running: [], error: '账户保存失败，运行已暂停。请导出账户。' }); return false; }
}
export function updatePortfolio(next: Portfolio) { return savePortfolios(usePortfolioStore.getState().portfolios.map(p => p.id === next.id ? next : p)); }
export function togglePortfolio(id: string) {
  usePortfolioStore.setState(s => ({ running: s.running.includes(id) ? s.running.filter(n => n !== id) : [...s.running, id] }));
}

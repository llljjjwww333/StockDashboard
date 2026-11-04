import { t } from '../lib/i18n';
import { pricePrecision } from '../lib/pricePrecision';
import type { Quote } from './types';

export function OrderBook({ ticker, quote }: { ticker: string; quote: Quote | null }) {
  if (!/^\d{6}$/.test(ticker)) return null;
  const book = quote?.order_book;
  const bids = book?.bids ?? [], asks = book?.asks ?? [];
  const digits = pricePrecision(ticker, quote?.price ?? 0);
  const volumes = [...bids, ...asks].map(level => level.volume);
  const max = Math.max(...volumes, 1);
  const bidTotal = bids.reduce((sum, row) => sum + row.volume, 0), askTotal = asks.reduce((sum, row) => sum + row.volume, 0);
  const spread = bids.length && asks.length ? asks[0].price - bids[0].price : null;
  return <section className="order-book surface" aria-label={t('五档盘口')}>
    <header><h2>{t('五档盘口')}</h2><small>{t('手')}</small></header>
    {volumes.length ? <>
      <div className="book-rows">{['ask', 'bid'].map(side => <div key={side} className={`book-side ${side}`}>{(side === 'ask' ? [5, 4, 3, 2, 1] : [1, 2, 3, 4, 5]).map(level => {
        const row = (side === 'ask' ? asks : bids).find(item => item.level === level);
        return <div className="book-row" key={level}>
          <i style={{ width: `${row ? row.volume / max * 100 : 0}%` }} />
          <span>{t(side === 'ask' ? '卖{level}' : '买{level}', { level })}</span>
          <strong>{row?.price.toFixed(digits) ?? '--'}</strong><small>{row ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(row.volume / 100) : '--'}</small>
        </div>;
      })}</div>)}</div>
      <footer><span>{t('价差')} <b>{spread !== null && spread >= 0 ? spread.toFixed(digits) : '--'}</b></span><span>{t('委买占比')} <b>{(bidTotal / Math.max(bidTotal + askTotal, 1) * 100).toFixed(1)}%</b></span></footer>
    </> : <p className="book-empty">{t('暂无盘口')}</p>}
  </section>;
}

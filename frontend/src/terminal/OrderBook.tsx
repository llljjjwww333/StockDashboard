import { getLocale, t } from '../lib/i18n';
import { pricePrecision } from '../lib/pricePrecision';
import { isCryptoTicker } from '../lib/instrumentIdentity';
import { useCryptoDepth } from './useTerminalData';
import type { StockQuote } from '../store/stockStore';
import { QuoteFreshnessBadge, QuoteTime } from './MarketClock';

export function OrderBook({ ticker, quote }: { ticker: string; quote?: StockQuote }) {
  const crypto = isCryptoTicker(ticker), depth = useCryptoDepth(ticker, crypto);
  if (!crypto && !/^\d{6}$/.test(ticker)) return null;
  const book = crypto ? depth.data : quote?.snapshot?.order_book;
  const bids = book?.bids ?? [], asks = book?.asks ?? [];
  const digits = pricePrecision(ticker, quote?.price ?? 0);
  const volumes = [...bids, ...asks].map(level => level.volume);
  const max = Math.max(...volumes, 1);
  const bidTotal = bids.reduce((sum, row) => sum + row.volume, 0), askTotal = asks.reduce((sum, row) => sum + row.volume, 0);
  const bestBid = bids.find(row => row.level === 1), bestAsk = asks.find(row => row.level === 1);
  const spread = bestBid && bestAsk ? bestAsk.price - bestBid.price : null;
  const lots = new Intl.NumberFormat(getLocale(), { maximumFractionDigits: crypto ? 8 : 2 });
  return <section className="order-book surface" aria-label={crypto ? '十档盘口' : t('五档盘口')}>
    <header><h2>{crypto ? '十档盘口' : t('五档盘口')}</h2><div className="book-meta">
      {volumes.length > 0 && <>
        {quote?.asOf && <QuoteTime ticker={ticker} asOf={quote.asOf} source={quote.source ?? null} />}
        <QuoteFreshnessBadge ticker={ticker} quote={quote} />
      </>}
      <small>{crypto ? ticker.slice(0,-4) : t('手')}</small>
    </div></header>
    <>
      <div className="book-rows">{['bid', 'ask'].map(side => <div key={side} className={`book-side ${side}`}>{Array.from({length:crypto?10:5},(_,i)=>i+1).map(level => {
        const row = (side === 'ask' ? asks : bids).find(item => item.level === level);
        return <div className="book-row" key={level} data-level={level}>
          <i style={{ width: `${row ? row.volume / max * 100 : 0}%` }} />
          <span>{t(side === 'ask' ? '卖{level}' : '买{level}', { level })}</span>
          <strong>{row?.price.toFixed(digits) ?? '--'}</strong><small>{row ? lots.format(row.volume / (crypto ? 1 : 100)) : '--'}</small>
        </div>;
      })}</div>)}</div>
      <footer><span>{t('价差')} <b>{spread !== null && spread >= 0 ? spread.toFixed(digits) : '--'}</b></span><span>{t('委买占比')} <b>{(bidTotal / Math.max(bidTotal + askTotal, 1) * 100).toFixed(1)}%</b></span></footer>
    </>
  </section>;
}

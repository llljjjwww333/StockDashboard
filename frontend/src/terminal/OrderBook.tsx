import { getLocale, t, useLanguage } from '../lib/i18n';
import { memo, useMemo } from 'react';
import { pricePrecision } from '../lib/pricePrecision';
import { isCryptoTicker } from '../lib/instrumentIdentity';
import { useCryptoDepth } from './useTerminalData';
import type { StockQuote } from '../store/stockStore';
import { QuoteFreshnessBadge, QuoteTime } from './MarketClock';
import { bookStatistics } from '../lib/orderBook';

type Props = { ticker: string; quote?: StockQuote };
export const OrderBook = memo(function OrderBook({ ticker, quote }: Props) {
  useLanguage();
  const crypto = isCryptoTicker(ticker), depth = useCryptoDepth(ticker, crypto);
  const book = crypto ? depth.data : quote?.snapshot?.order_book;
  const bids = book?.bids ?? [], asks = book?.asks ?? [];
  const digits = pricePrecision(ticker, crypto ? bids[0]?.price ?? asks[0]?.price ?? 0 : quote?.price ?? 0);
  const volumes = [...bids, ...asks].map(level => level.volume);
  const { peak, bidShare, spread } = bookStatistics(bids, asks);
  const locale = getLocale();
  const lots = useMemo(() => new Intl.NumberFormat(locale, { maximumFractionDigits: crypto ? 8 : 2 }), [locale, crypto]);
  const clock = useMemo(() => new Intl.DateTimeFormat(locale, { timeZone: 'UTC', hour: '2-digit', minute: '2-digit',
    second: '2-digit', fractionalSecondDigits: 1, hour12: false }), [locale]);
  if (!crypto && !/^\d{6}$/.test(ticker)) return null;
  return <section className="order-book surface" aria-label={crypto ? '十档盘口' : t('五档盘口')}
    data-depth-sequence={crypto ? depth.sequence ?? undefined : undefined}>
    <header><h2>{crypto ? '十档盘口' : t('五档盘口')}</h2><div className="book-meta">
      {volumes.length > 0 && <>
        {crypto ? depth.asOf && <small title="盘口接收时间 · UTC"><time dateTime={depth.asOf}>{clock.format(new Date(depth.asOf))}</time></small>
          : <>{quote?.asOf && <QuoteTime ticker={ticker} asOf={quote.asOf} source={quote.source ?? null} />}
            <QuoteFreshnessBadge ticker={ticker} quote={quote} /></>}
      </>}
      <small>{crypto ? ticker.slice(0,-4) : t('手')}</small>
    </div></header>
    <>
      <div className="book-rows">{['bid', 'ask'].map(side => <div key={side} className={`book-side ${side}`}>{Array.from({length:crypto?10:5},(_,i)=>i+1).map(level => {
        const row = (side === 'ask' ? asks : bids).find(item => item.level === level);
        return <div className="book-row" key={level} data-level={level}>
          <i style={{ width: `${row && peak > 0 ? row.volume / peak * 100 : 0}%` }} />
          <span>{t(side === 'ask' ? '卖{level}' : '买{level}', { level })}</span>
          <strong>{row?.price.toFixed(digits) ?? '--'}</strong><small>{row ? lots.format(row.volume / (crypto ? 1 : 100)) : '--'}</small>
        </div>;
      })}</div>)}</div>
      <footer><span>{t('价差')} <b>{spread !== null && spread >= 0 ? spread.toFixed(digits) : '--'}</b></span><span>{t('委买占比')} <b>{bidShare.toFixed(1)}%</b></span></footer>
    </>
  </section>;
}, (previous, next) => previous.ticker === next.ticker && (isCryptoTicker(next.ticker) || previous.quote === next.quote));

import { isCryptoTicker, isChinaTicker } from '../lib/instrumentIdentity.ts';
import { getLocale, t, useLanguage } from '../lib/i18n';
import { useMarketPhase, useQuoteFreshness } from './useMarketPhase';
import type { StockQuote } from '../store/stockStore';

type QuoteTimeProps = { ticker: string; asOf: string | null; source: string | null };

export function QuoteTime({ ticker, asOf, source }: QuoteTimeProps) {
  return <small title={source ?? undefined}>{asOf ? <time dateTime={asOf}>{new Intl.DateTimeFormat(getLocale(), {
    timeZone: isCryptoTicker(ticker) ? 'UTC' : isChinaTicker(ticker) ? 'Asia/Shanghai' : 'America/New_York',
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(new Date(asOf))}</time> : '--'}</small>;
}

export function QuoteFreshnessBadge({ ticker, quote }: { ticker: string; quote?: StockQuote }) {
  const freshness = useQuoteFreshness(ticker, quote);
  if (!freshness) return null;
  return <small className="quote-tag" data-quote-freshness={freshness}>{t(freshness === 'cached' ? '缓存' : '报价较旧')}</small>;
}

export function MarketClock({ ticker, asOf, source }: QuoteTimeProps) {
  useLanguage();
  const phase = useMarketPhase(ticker);
  return <><QuoteTime ticker={ticker} asOf={asOf} source={source} />
    <small className={`market-session${phase === '交易时段' ? ' is-open' : ''}`} data-session={phase}><i />{isCryptoTicker(ticker) ? '24/7 · UTC' : t(phase)}</small></>;
}

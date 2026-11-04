import { isChinaTicker } from '../lib/instrumentIdentity.ts';
import { useEffect, useState } from 'react';
import { getLocale, t, useLanguage } from '../lib/i18n';
import { marketPhase } from './marketSession';

export function MarketClock({ ticker, asOf, source }: { ticker: string; asOf: string | null; source: string | null }) {
  useLanguage();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const timer = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(timer); }, []);
  const phase = marketPhase(ticker, now);
  return <><small title={source ?? undefined}>{asOf ? new Intl.DateTimeFormat(getLocale(), { timeZone: isChinaTicker(ticker) ? 'Asia/Shanghai' : 'America/New_York', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(asOf)) : '--'}</small>
    <small className={`market-session${phase === '交易时段' ? ' is-open' : ''}`} data-session={phase}><i />{t(phase)}</small></>;
}

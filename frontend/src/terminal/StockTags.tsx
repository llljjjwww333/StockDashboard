import { useState } from 'react';
import { t } from '../lib/i18n';
import { chinaInstrumentTags } from '../lib/instrumentIdentity';
import { useStockMemberships } from './useTerminalData';

export function StockTags({ ticker, name, variant = 'basic' }: { ticker: string; name: string; variant?: 'basic' | 'watch' | 'detail' }) {
  const { data } = useStockMemberships(variant === 'basic' ? null : ticker);
  const [expanded, setExpanded] = useState(false);
  const tags = chinaInstrumentTags(ticker, name, data);
  if (!tags.length) return null;
  const limit = variant === 'watch' ? 2 : variant === 'detail' ? 4 : tags.length;
  const hidden = tags.slice(limit);
  const visible = expanded ? tags : tags.slice(0, limit);
  const allLabels = tags.map(tag => t(tag.label)).join(' · ');
  return <span className={`stock-tags ${variant}`} title={variant === 'watch' ? allLabels : undefined}>
    {visible.map(tag => <span key={tag.label} className={`stock-tag ${tag.tone}`}
      title={tag.tone === 'industry' ? t('所属行业') : tag.tone === 'membership' ? t('关联板块') : undefined}>{t(tag.label)}</span>)}
    {hidden.length > 0 && (variant === 'detail'
      ? <button type="button" className="stock-tag-toggle" aria-expanded={expanded} aria-label={t(expanded ? '收起股票标签' : '展开股票标签')} onClick={() => setExpanded(!expanded)}>
        {expanded ? t('收起') : `+${hidden.length}`}
      </button>
      : <span className="stock-tag membership-count">+{hidden.length}</span>)}
  </span>;
}

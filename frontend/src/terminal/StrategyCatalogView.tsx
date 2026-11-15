import { useState } from 'react';
import { t } from '../lib/i18n';
import { strategyCatalog, strategyGroups, type StrategyKind } from './strategyCatalog';

export function StrategyCatalog({ onChoose }: { onChoose: (kind: StrategyKind) => void }) {
  const [group, setGroup] = useState('ALL'), [query, setQuery] = useState('');
  const rows = strategyCatalog.filter(s => (group === 'ALL' || s.group === group) && `${s.name} ${s.id} ${s.entry} ${s.exit}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <section className="strategy-directory"><header><div className="strategy-tabs" role="group" aria-label={t('策略分类')}>{['ALL', ...strategyGroups].map(g => <button type="button" key={g} aria-pressed={group === g} onClick={() => setGroup(g)}>{t(g === 'ALL' ? '全部策略' : g)}</button>)}</div><input aria-label={t('搜索策略')} placeholder={t('搜索策略')} value={query} onChange={e => setQuery(e.target.value)} /></header>
    <div className="strategy-directory-grid">{rows.map(s => <article key={s.id}><header><small>{t(s.group)}</small><span>{s.id.toUpperCase()}</span></header><h2>{t(s.name)}</h2><dl><dt>{t('买入')}</dt><dd>{t(s.entry)}</dd><dt>{t('卖出')}</dt><dd>{t(s.exit)}</dd></dl><footer><span>{s.parameters.length} {t('个参数')}</span><button type="button" onClick={() => onChoose(s.id)}>{t('载入策略')} </button></footer></article>)}</div>{!rows.length && <p className="strategy-note" role="status">{t('没有匹配结果')}</p>}
  </section>;
}

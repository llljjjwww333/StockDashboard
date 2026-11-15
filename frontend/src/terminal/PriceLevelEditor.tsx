import { useState } from 'react';
import { t } from '../lib/i18n';

export function PriceLevelEditor({ value, precision, onApply, onDelete, onClose }: {
  value: number; precision: number; onApply: (value: number) => void; onDelete: () => void; onClose: () => void;
}) {
  const [draft, setDraft] = useState(value.toFixed(precision));
  const price = draft.trim() ? +Number(draft).toFixed(precision) : NaN;
  const valid = Number.isFinite(price) && price > 0 && price < 1e12;
  return <form className="professional-level-editor" aria-label={t('编辑水平线')}
    onSubmit={event => { event.preventDefault(); if (valid) onApply(price); }}
    onKeyDown={event => {
      if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); onClose(); }
    }}>
    <input type="number" inputMode="decimal" aria-label={t('水平线价格')} value={draft} step="any" min={10 ** -precision}
      max="999999999999" required onChange={event => setDraft(event.target.value)} />
    <button type="submit" title={t('应用价格')} aria-label={t('应用价格')} disabled={!valid}>
      <svg viewBox="0 0 18 18" aria-hidden="true"><path d="m3 9 4 4 8-9" /></svg>
    </button>
    <button type="button" title={t('删除水平线')} aria-label={t('删除水平线')} onClick={onDelete}>
      <svg viewBox="0 0 18 18" aria-hidden="true"><path d="M4 5h10M7 2h4M5 5l1 11h6l1-11M8 8v5m2-5v5" /></svg>
    </button>
    <button type="button" title={t('取消编辑')} aria-label={t('取消编辑')} onClick={onClose}>
      <svg viewBox="0 0 18 18" aria-hidden="true"><path d="m5 5 8 8m0-8-8 8" /></svg>
    </button>
  </form>;
}

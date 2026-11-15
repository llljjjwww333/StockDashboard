import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { t } from '../lib/i18n';

export function PriceLevelList({ levels, precision, onSelect, onClear, onClose, onDismiss }: {
  levels: readonly number[]; precision: number; onSelect: (index: number) => void; onClear: () => void;
  onClose: () => void; onDismiss: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null), rows = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 8, maxHeight: 300 });
  useLayoutEffect(() => {
    const place = () => {
      if (!ref.current || !rows.current) return;
      const top = ref.current.parentElement!.getBoundingClientRect().top;
      const below = innerHeight - top - 20, above = top - 16;
      const desired = Math.min(300, rows.current.scrollHeight + ref.current.firstElementChild!.getBoundingClientRect().height + 2);
      const upwards = below < desired && above > below;
      const maxHeight = Math.max(60, Math.min(desired, innerHeight - 24));
      const preferred = upwards ? top - maxHeight - 6 : top + 8;
      const visibleTop = Math.max(12, Math.min(preferred, innerHeight - maxHeight - 12));
      setPosition({ top: visibleTop - top, maxHeight });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, { passive: true });
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place); };
  }, [levels.length]);
  useEffect(() => {
    (rows.current?.querySelector<HTMLButtonElement>('button') ?? ref.current)?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    const outside = (event: PointerEvent | WheelEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || ref.current?.contains(target) || target.closest('[data-chart-tool="drawings"]')) return;
      onDismiss();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('wheel', outside, { passive: true });
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing || event.defaultPrevented || document.querySelector('dialog[open]')) return;
      event.preventDefault(); event.stopPropagation(); onClose();
    };
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside); document.removeEventListener('wheel', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [onDismiss, onClose]);
  return <div className="professional-level-list" ref={ref} role="dialog" aria-label={t('画线列表')} tabIndex={-1}
    style={position}
    onKeyDown={event => {
      if (event.nativeEvent.isComposing) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); return; }
      const buttons = [...rows.current!.querySelectorAll<HTMLButtonElement>('button')];
      if (!buttons.length) return;
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'ArrowDown' ? (current + 1) % buttons.length
        : event.key === 'ArrowUp' ? (current - 1 + buttons.length) % buttons.length
        : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : null;
      if (next !== null) { event.preventDefault(); event.stopPropagation(); buttons[next]?.focus(); }
    }}>
    <header><strong>{t('画线')} <span>{levels.length}</span></strong>
      <button type="button" title={t('清除画线')} aria-label={t('清除画线')}
        onClick={() => { onClear(); ref.current?.focus({ preventScroll: true }); }} disabled={!levels.length}>
        <svg viewBox="0 0 18 18" aria-hidden="true"><path d="M4 5h10M7 2h4M5 5l1 11h6l1-11M8 8v5m2-5v5" /></svg>
      </button>
      <button type="button" title={t('关闭画线列表')} aria-label={t('关闭画线列表')} onClick={onClose}>
        <svg viewBox="0 0 18 18" aria-hidden="true"><path d="m5 5 8 8m0-8-8 8" /></svg>
      </button>
    </header>
    <div className="professional-level-rows" ref={rows}>
      {levels.map((price, index) => <button type="button" key={index} aria-label={t('编辑水平线 {number}', { number: index + 1 })}
        onClick={() => onSelect(index)}><span>{t('水平线')} {index + 1}</span><strong>{price.toFixed(precision)}</strong></button>)}
    </div>
  </div>;
}

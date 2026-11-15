import { t } from '../lib/i18n';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { overlayOptions, panelOptions, type PanelKey } from './indicators';
import { useIndicators, useIndicatorStorage } from './indicatorStore';
import './indicators.css';

const candlePanels = new Set<PanelKey>(['atr', 'kdj', 'cci']);

export function IndicatorPicker({ intraday = false }: { intraday?: boolean }) {
  const storageIssue = useIndicatorStorage(state => state.issue);
  const [open, setOpen] = useState(false);
  const [group, setGroup] = useState<'overlays' | 'panels'>('overlays');
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const { overlays, panels, toggleOverlay, togglePanel, reset } = useIndicators();
  const count = overlays.length + panels.filter(key => !intraday || !candlePanels.has(key)).length;
  useLayoutEffect(() => {
    if (!open || !matchMedia('(max-width: 760px)').matches || !menu.current) return;
    const plot = ref.current?.closest('.chart-card')?.querySelector('.price-svg, .professional-canvas');
    if (!plot) return;
    const panelTop = menu.current.getBoundingClientRect().top;
    const plotTop = plot.getBoundingClientRect().top;
    const visibleTop = Math.max(12, panelTop - 140);
    if (plotTop > visibleTop) window.scrollBy(0, plotTop - visibleTop);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        trigger.current?.focus({ preventScroll: true });
      }
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape); };
  }, [open]);
  return <div className="indicator-picker" ref={ref}>
    <button type="button" className="indicator-trigger" ref={trigger} aria-expanded={open} aria-controls="indicator-options" onClick={() => setOpen(!open)}>{t("指标")}{count > 0 ? ` ${count}` : ''}</button>
    {open && <div className="indicator-menu" ref={menu} id="indicator-options" data-active-group={group} role="group" aria-label={t("指标选择")}>
      <header>
        <strong>{t("指标")}</strong>
        <div className="indicator-groups">
          <button type="button" data-indicator-group="overlays" aria-pressed={group === 'overlays'} onClick={() => setGroup('overlays')}>{t("主图")}</button>
          <button type="button" data-indicator-group="panels" aria-pressed={group === 'panels'} onClick={() => setGroup('panels')}>{t("副图")}</button>
        </div>
        <div className="indicator-menu-actions">
          <button type="button" onClick={reset}>{t("重置")}</button>
          <button type="button" className="indicator-done" onClick={() => { setOpen(false); trigger.current?.focus({ preventScroll: true }); }}>{t("完成")}</button>
        </div>
      </header>
      <div className="indicator-fields">
        <fieldset className="indicator-overlays"><legend>{t("主图")}</legend>{overlayOptions.map(o => <label key={o.id}><input type="checkbox" checked={overlays.includes(o.id)} onChange={() => toggleOverlay(o.id)} /><i style={{ background: o.color }} />{t(o.label)}</label>)}</fieldset>
        <fieldset className="indicator-panels"><legend>{t("副图")}</legend>{panelOptions.map(o => {
          const disabled = intraday && candlePanels.has(o.id);
          return <label key={o.id} title={disabled ? t('仅K线可用') : undefined}><input type="checkbox" disabled={disabled} checked={panels.includes(o.id)} onChange={() => togglePanel(o.id)} />{t(o.label)}</label>;
        })}</fieldset>
      </div>
      {storageIssue && <p className="indicator-storage-notice" role="status">{t(storageIssue === 'write'
        ? '指标更改暂未保存，本页仍可使用。' : '无法读取指标偏好，已使用默认指标。')}</p>}
    </div>}
  </div>;
}

import { t } from '../lib/i18n';
import { useEffect, useRef, useState } from 'react';
import { overlayOptions, panelOptions } from './indicators';
import { useIndicators } from './indicatorStore';
import './indicators.css';

export function IndicatorPicker({ intraday = false }: { intraday?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { overlays, panels, toggleOverlay, togglePanel, reset } = useIndicators();
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape); };
  }, [open]);
  return <div className="indicator-picker" ref={ref}>
    <button type="button" className="indicator-trigger" aria-expanded={open} aria-controls="indicator-options" onClick={() => setOpen(!open)}>{t("指标")}{overlays.length + panels.length > 0 ? ` ${overlays.length + panels.length}` : ''}</button>
    {open && <div className="indicator-menu" id="indicator-options" role="group" aria-label={t("指标选择")}>
      <header><strong>{t("指标")}</strong><button type="button" onClick={reset}>{t("重置")}</button></header>
      <fieldset><legend>{t("主图")}</legend>{overlayOptions.map(o => <label key={o.id}><input type="checkbox" checked={overlays.includes(o.id)} onChange={() => toggleOverlay(o.id)} /><i style={{ background: o.color }} />{t(o.label)}</label>)}</fieldset>
      <fieldset><legend>{t("副图")}</legend>{panelOptions.map(o => <label key={o.id} title={intraday && ['atr', 'kdj', 'cci'].includes(o.id) ? t('仅K线可用') : undefined}><input type="checkbox" disabled={intraday && ['atr', 'kdj', 'cci'].includes(o.id)} checked={panels.includes(o.id)} onChange={() => togglePanel(o.id)} />{t(o.label)}</label>)}</fieldset>
    </div>}
  </div>;
}

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { t } from '../lib/i18n';
import type { PriceScale } from '../store/chartPreferenceStore';

type ToolName = 'reset' | 'latest' | 'level' | 'undo' | 'redo' | 'drawings' | 'camera' | 'expand' | 'more';
export type ChartTool = { name: Exclude<ToolName, 'more'>; label: string; onClick: () => void; active?: boolean;
  disabled?: boolean; overflow?: boolean; shortcut?: string };

function ToolIcon({ name }: { name: ToolName }) {
  const paths: Record<Exclude<ToolName, 'more'>, string> = {
    reset: 'M3 7a6 6 0 1 1 0 4M3 3v4h4', latest: 'M3 4v10M6 9h10m-4-4 4 4-4 4',
    level: 'M2 9h14M5 5v8', drawings: 'M7 4h9M7 9h9M7 14h9M2 4h1M2 9h1M2 14h1',
    undo: 'M6 3 2 7l4 4M2 7h8a4 4 0 0 1 0 8', redo: 'm12 3 4 4-4 4m4-4H8a4 4 0 0 0 0 8',
    camera: 'M2 5h4l1-2h4l1 2h4v10H2ZM12 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
    expand: 'M2 7V2h5m4 0h5v5m0 4v5h-5m-4 0H2v-5',
  };
  return <svg width="17" height="17" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
    {name === 'more' ? <><circle cx="3" cy="9" r="1" /><circle cx="9" cy="9" r="1" /><circle cx="15" cy="9" r="1" /></>
      : <path d={paths[name]} />}
  </svg>;
}

export function ProfessionalChartTools({ scale, setScale, tools, count, onOpenMenu }: {
  scale: PriceScale; setScale: (scale: PriceScale) => void; tools: ChartTool[]; count: number; onOpenMenu: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ above: false, maxHeight: 240 });
  const ref = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const positionMenu = () => {
      if (!trigger.current || !menu.current) return;
      const rect = trigger.current.getBoundingClientRect();
      const below = innerHeight - rect.bottom - 12, above = rect.top - 12;
      const upwards = below < menu.current.scrollHeight && above > below;
      setPosition({ above: upwards, maxHeight: Math.max(60, upwards ? above : below) });
    };
    positionMenu();
    window.addEventListener('resize', positionMenu);
    return () => window.removeEventListener('resize', positionMenu);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
    const close = (event: PointerEvent | WheelEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus({ preventScroll: true });
    };
    const media = matchMedia('(max-width: 600px)');
    const resize = () => { if (!media.matches) setOpen(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('wheel', close, { passive: true });
    document.addEventListener('keydown', escape);
    media.addEventListener('change', resize);
    return () => {
      document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape);
      document.removeEventListener('wheel', close);
      media.removeEventListener('change', resize);
    };
  }, [open]);
  return <div className="professional-tools" role="group" aria-label={t('图表工具')}>
    <select aria-label={t('价格刻度')} value={scale} onChange={event => setScale(event.target.value as PriceScale)}>
      <option value="normal">{t('普通')}</option><option value="log">{t('对数')}</option><option value="percent">%</option>
    </select>
    <div>{tools.map(tool => <button key={tool.name} className={tool.overflow ? 'professional-tool-secondary' : undefined}
      type="button" data-chart-tool={tool.name} title={t(tool.label)} aria-label={t(tool.label)} aria-keyshortcuts={tool.shortcut}
      aria-pressed={tool.active} disabled={tool.disabled} onClick={tool.onClick}><ToolIcon name={tool.name} /></button>)}
      <div className="professional-overflow" ref={ref} onBlur={event => {
        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}>
        <button type="button" ref={trigger} aria-label={t('更多图表工具')} title={t('更多图表工具')}
          aria-expanded={open} aria-haspopup="menu" onClick={() => { if (!open) onOpenMenu(); setOpen(!open); }}><ToolIcon name="more" /></button>
        {open && <div className="professional-overflow-menu" ref={menu} role="menu" aria-label={t('图表工具')}
          data-side={position.above ? 'above' : 'below'} style={{ maxHeight: position.maxHeight }}
          onKeyDown={event => {
            const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
            const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
            const next = event.key === 'ArrowDown' ? (current + 1) % buttons.length
              : event.key === 'ArrowUp' ? (current - 1 + buttons.length) % buttons.length
              : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : null;
            if (next !== null) { event.preventDefault(); event.stopPropagation(); buttons[next]?.focus(); }
          }}>
          {tools.filter(tool => tool.overflow).map(tool => <button key={tool.name} type="button" data-chart-tool={tool.name} role="menuitem" disabled={tool.disabled}
            onClick={() => { setOpen(false); tool.onClick(); trigger.current?.focus({ preventScroll: true }); }}>
            <ToolIcon name={tool.name} /><span>{t(tool.label)}</span>
          </button>)}
        </div>}
      </div>
    </div>
    <small>{t('{count} 根K线', { count })}</small>
  </div>;
}

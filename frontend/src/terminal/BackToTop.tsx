import { useEffect, useState } from 'react';
import { t } from '../lib/i18n';

export function BackToTop() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      setVisible(window.scrollY > Math.max(600, window.innerHeight * .75));
    };
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(update); };
    update();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      window.cancelAnimationFrame(frame);
    };
  }, []);
  if (!visible) return null;
  return <button type="button" className="back-to-top" aria-label={t('返回顶部')} title={t('返回顶部')} onClick={() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
    document.querySelector<HTMLElement>('.content-canvas')?.focus({ preventScroll: true });
  }}><span aria-hidden="true">↑</span><small>{t('顶部')}</small></button>;
}

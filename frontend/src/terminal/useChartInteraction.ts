import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { nearestPoint } from './chartLayout';

export function useChartInteraction(positions: number[], width: number, activeIndex: number, onChange: (index: number | null) => void) {
  const frame = useRef<number | null>(null);
  const cancel = () => { if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null; } };
  useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current); }, []);
  const select = (event: PointerEvent<SVGSVGElement>) => {
    if (!positions.length) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const index = nearestPoint(positions, (event.clientX - bounds.left) / bounds.width * width);
    cancel();
    frame.current = requestAnimationFrame(() => { frame.current = null; onChange(index); });
  };
  return {
    tabIndex: 0,
    style: { touchAction: 'pan-y' as const },
    onPointerDown(event: PointerEvent<SVGSVGElement>) {
      select(event);
      if (event.pointerType !== 'mouse' && !(event.target instanceof Element && event.target.closest('[role="button"]'))) {
        event.currentTarget.setPointerCapture(event.pointerId);
      }
    },
    onPointerMove: select,
    onPointerLeave(event: PointerEvent<SVGSVGElement>) {
      if (event.pointerType === 'mouse') { cancel(); onChange(null); }
    },
    onPointerCancel() { cancel(); onChange(null); },
    onKeyDown(event: KeyboardEvent<SVGSVGElement>) {
      const index = event.key === 'ArrowLeft' ? Math.max(0, activeIndex - 1)
        : event.key === 'ArrowRight' ? Math.min(positions.length - 1, activeIndex + 1)
        : event.key === 'Home' ? 0 : event.key === 'End' ? positions.length - 1 : null;
      if (index !== null || event.key === 'Escape') { event.preventDefault(); cancel(); onChange(index); }
    },
  };
}

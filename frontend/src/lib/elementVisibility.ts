type Listener = (visible: boolean) => void;
const targets = new Map<Element, { listeners: Set<Listener>; visible?: boolean }>();
let observer: IntersectionObserver | null = null;

export function observeElementVisibility(element: Element, listener: Listener) {
  if (typeof IntersectionObserver === 'undefined') {
    listener(true);
    return () => {};
  }
  observer ??= new IntersectionObserver(entries => {
    for (const entry of entries) {
      const target = targets.get(entry.target);
      if (!target) continue;
      target.visible = entry.isIntersecting;
      for (const notify of target.listeners) notify(entry.isIntersecting);
    }
  }, { rootMargin: '100px' });
  let target = targets.get(element);
  if (!target) {
    target = { listeners: new Set() };
    targets.set(element, target);
    observer.observe(element);
  }
  target.listeners.add(listener);
  if (target.visible !== undefined) listener(target.visible);
  return () => {
    const current = targets.get(element);
    current?.listeners.delete(listener);
    if (!current?.listeners.size) {
      targets.delete(element);
      observer?.unobserve(element);
    }
    if (!targets.size) { observer?.disconnect(); observer = null; }
  };
}

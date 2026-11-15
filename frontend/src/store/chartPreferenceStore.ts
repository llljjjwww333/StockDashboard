import { create } from 'zustand';

export type PriceScale = 'normal' | 'log' | 'percent';
const storageKey = 'marketdesk:chart-preferences:v1';

function readPriceScale(): PriceScale {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? '{}');
    return saved?.priceScale === 'log' || saved?.priceScale === 'percent' ? saved.priceScale : 'normal';
  } catch { return 'normal'; }
}

export const useChartPreferences = create<{ priceScale: PriceScale; setPriceScale: (scale: PriceScale) => void }>(set => ({
  priceScale: readPriceScale(),
  setPriceScale: priceScale => set({ priceScale }),
}));

useChartPreferences.subscribe(({ priceScale }) => {
  try { localStorage.setItem(storageKey, JSON.stringify({ priceScale })); } catch { /* The active tab retains the choice in memory. */ }
});

if (typeof window !== 'undefined') window.addEventListener('storage', event => {
  if (event.key === storageKey || event.key === null) useChartPreferences.setState({ priceScale: readPriceScale() });
});

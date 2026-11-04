import { create } from 'zustand';

type Theme = 'dark' | 'light';
type PriceColors = 'green-up' | 'red-up';
type Appearance = { theme: Theme; priceColors: PriceColors };
const storageKey = 'marketdesk:appearance:v1';

function readAppearance(): Appearance {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? '{}');
    return { theme: saved?.theme === 'light' ? 'light' : 'dark', priceColors: saved?.priceColors === 'red-up' ? 'red-up' : 'green-up' };
  } catch { return { theme: 'dark', priceColors: 'green-up' }; }
}

export const useAppearance = create<Appearance & {
  setTheme: (theme: Theme) => void;
  setPriceColors: (priceColors: PriceColors) => void;
}>(set => ({
  ...readAppearance(),
  setTheme: theme => set({ theme }),
  setPriceColors: priceColors => set({ priceColors }),
}));

function applyAppearance({ theme, priceColors }: Appearance) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.priceColors = priceColors;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#f6f7f9' : '#090b0d');
}

// Apply saved preferences before React paints the first frame.
applyAppearance(useAppearance.getState());
useAppearance.subscribe(state => {
  applyAppearance(state);
  try { localStorage.setItem(storageKey, JSON.stringify({ theme: state.theme, priceColors: state.priceColors })); } catch { /* Settings still work when storage is unavailable. */ }
});
window.addEventListener('storage', event => {
  if (event.key === storageKey || event.key === null) useAppearance.setState(readAppearance());
});

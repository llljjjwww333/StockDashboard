import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { createBrowserStorage, type StorageIssue } from '../lib/browserStorage';
import { overlayOptions, panelOptions, type OverlayKey, type PanelKey } from './indicators';

type IndicatorStore = {
  overlays: OverlayKey[]; panels: PanelKey[];
  toggleOverlay: (key: OverlayKey) => void; togglePanel: (key: PanelKey) => void; reset: () => void;
};
export const useIndicatorStorage = create<{ issue: StorageIssue }>(() => ({ issue: null }));
const onIssue = (issue: StorageIssue) => useIndicatorStorage.setState({ issue });
export const useIndicators = create<IndicatorStore>()(persist((set) => ({
  overlays: ['ma20'], panels: ['volume'],
  toggleOverlay: key => set(s => ({ overlays: s.overlays.includes(key) ? s.overlays.filter(k => k !== key) : [...s.overlays, key] })),
  togglePanel: key => set(s => ({ panels: s.panels.includes(key) ? s.panels.filter(k => k !== key) : [...s.panels, key] })),
  reset: () => set({ overlays: ['ma20'], panels: ['volume'] }),
}), { name: 'marketdesk:indicators:v1',
  storage: createJSONStorage(() => createBrowserStorage(() => localStorage, onIssue)),
  partialize: state => ({ overlays: state.overlays, panels: state.panels }),
  onRehydrateStorage: () => (_state, error) => { if (error) onIssue('read'); },
  merge: (saved, current) => {
    const state = saved as Partial<IndicatorStore> | undefined;
    return { ...current,
      overlays: Array.isArray(state?.overlays) ? [...new Set(state.overlays.filter(k => overlayOptions.some(o => o.id === k)))] : current.overlays,
      panels: Array.isArray(state?.panels) ? [...new Set(state.panels.filter(k => panelOptions.some(o => o.id === k)))] : current.panels,
    };
  },
}));

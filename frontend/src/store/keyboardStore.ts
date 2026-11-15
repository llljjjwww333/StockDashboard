import { create } from 'zustand';

const storageKey = 'marketdesk:keyboard:v1';
function readEnabled() {
  try { return localStorage.getItem(storageKey) !== 'off'; } catch { return true; }
}
export const useKeyboard = create<{ enabled: boolean; setEnabled: (enabled: boolean) => void }>(set => ({
  enabled: readEnabled(),
  setEnabled: enabled => {
    try { localStorage.setItem(storageKey, enabled ? 'on' : 'off'); } catch { /* Keep the current session usable. */ }
    set({ enabled });
  },
}));
window.addEventListener('storage', event => {
  if (event.key === storageKey || event.key === null) useKeyboard.setState({ enabled: readEnabled() });
});

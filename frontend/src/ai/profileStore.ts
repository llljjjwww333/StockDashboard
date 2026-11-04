import { create } from 'zustand';
import type { AiProfile } from './types';

const PROFILES = 'marketdesk:ai-profiles:v1';
const KEYS = 'marketdesk:ai-keys:v1';

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(PROFILES) ?? '{}');
    const keys = JSON.parse(sessionStorage.getItem(KEYS) ?? '{}');
    const profiles: AiProfile[] = (Array.isArray(saved.profiles) ? saved.profiles : [])
      .filter((p: AiProfile) => typeof p.id === 'string' && typeof p.name === 'string' && typeof p.baseUrl === 'string' && typeof p.model === 'string')
      .map((p: AiProfile) => ({ ...p, apiKey: keys[p.id] ?? p.apiKey ?? '' }));
    return { profiles, activeId: profiles.some(p => p.id === saved.activeId) ? saved.activeId as string : profiles[0]?.id ?? '' };
  } catch {
    return { profiles: [] as AiProfile[], activeId: '' };
  }
}

function persist(profiles: AiProfile[], activeId: string) {
  try {
    localStorage.setItem(PROFILES, JSON.stringify({ activeId, profiles: profiles.map(p => ({ ...p, apiKey: p.rememberKey ? p.apiKey : '' })) }));
    sessionStorage.setItem(KEYS, JSON.stringify(Object.fromEntries(profiles.map(p => [p.id, p.apiKey]))));
  } catch { /* In-memory profiles remain usable if browser storage is unavailable. */ }
}

type ProfileStore = {
  profiles: AiProfile[];
  activeId: string;
  save: (profile: AiProfile) => void;
  select: (id: string) => void;
  remove: (id: string) => void;
};

export const useAiProfiles = create<ProfileStore>((set) => ({
  ...load(),
  save: (profile) => set(state => {
    const profiles = state.profiles.some(p => p.id === profile.id)
      ? state.profiles.map(p => p.id === profile.id ? profile : p) : [...state.profiles, profile];
    const activeId = state.activeId || profile.id;
    persist(profiles, activeId);
    return { profiles, activeId };
  }),
  select: (activeId) => set(state => {
    if (!state.profiles.some(p => p.id === activeId)) return state;
    persist(state.profiles, activeId);
    return { activeId };
  }),
  remove: (id) => set(state => {
    const profiles = state.profiles.filter(p => p.id !== id);
    const activeId = state.activeId === id ? profiles[0]?.id ?? '' : state.activeId;
    persist(profiles, activeId);
    return { profiles, activeId };
  }),
}));

export const providerSettings = (p: AiProfile) => ({
  provider: p.name, base_url: p.baseUrl.trim(), model: p.model.trim(), api_key: p.apiKey.trim(), protocol: p.protocol,
});

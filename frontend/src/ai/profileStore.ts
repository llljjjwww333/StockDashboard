import { create } from 'zustand';
import type { AiProfile } from './types';
import { loadProfileState, persistProfileState, type ProfileStorageWarning } from './profilePersistence';

const local = () => localStorage;
const session = () => sessionStorage;
const persist = (profiles: AiProfile[], activeId: string) => persistProfileState(profiles, activeId, local, session);

type ProfileStore = {
  profiles: AiProfile[];
  activeId: string;
  storageWarning: ProfileStorageWarning;
  save: (profile: AiProfile) => void;
  select: (id: string) => void;
  remove: (id: string) => void;
};

export const useAiProfiles = create<ProfileStore>((set) => ({
  ...loadProfileState(local, session),
  storageWarning: null,
  save: (profile) => set(state => {
    const profiles = state.profiles.some(p => p.id === profile.id)
      ? state.profiles.map(p => p.id === profile.id ? profile : p) : [...state.profiles, profile];
    const activeId = state.activeId || profile.id;
    const storageWarning = persist(profiles, activeId);
    return { profiles, activeId, storageWarning };
  }),
  select: (activeId) => set(state => {
    if (!state.profiles.some(p => p.id === activeId)) return state;
    const storageWarning = persist(state.profiles, activeId);
    return { activeId, storageWarning };
  }),
  remove: (id) => set(state => {
    const profiles = state.profiles.filter(p => p.id !== id);
    const activeId = state.activeId === id ? profiles[0]?.id ?? '' : state.activeId;
    const storageWarning = persist(profiles, activeId);
    return { profiles, activeId, storageWarning };
  }),
}));

export const providerSettings = (p: AiProfile) => ({
  provider: p.name, base_url: p.baseUrl.trim(), model: p.model.trim(), api_key: p.apiKey.trim(), protocol: p.protocol,
});

import type { AiProfile } from './types';

const PROFILES = 'marketdesk:ai-profiles:v1';
const KEYS = 'marketdesk:ai-keys:v1';
type StoragePort = Pick<Storage, 'getItem' | 'setItem'>;
type StorageSource = () => StoragePort;
export type ProfileStorageWarning = 'profiles' | 'keys' | null;
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown, max: number) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const keyText = (value: unknown): value is string => typeof value === 'string' && value.length <= 4096;

function read(storage: StorageSource, key: string) {
  try { return JSON.parse(storage().getItem(key) ?? '{}') as unknown; } catch { return {}; }
}

export function loadProfileState(local: StorageSource, session: StorageSource) {
  const saved = record(read(local, PROFILES));
  const keys = record(read(session, KEYS));
  const profiles: AiProfile[] = [];
  const seen = new Set<string>();
  for (const value of Array.isArray(saved.profiles) ? saved.profiles : []) {
    const item = record(value);
    if (!text(item.id, 128) || !text(item.name, 80) || !text(item.baseUrl, 500) || !text(item.model, 150)
      || (item.protocol !== undefined && item.protocol !== 'chat' && item.protocol !== 'anthropic')) continue;
    const id = item.id as string;
    if (seen.has(id)) continue;
    seen.add(id);
    const rememberKey = item.rememberKey === true;
    const storedKey = rememberKey && keyText(item.apiKey) ? item.apiKey : '';
    profiles.push({ id, name: item.name as string, baseUrl: item.baseUrl as string, model: item.model as string,
      protocol: item.protocol === 'anthropic' ? 'anthropic' : 'chat', rememberKey,
      apiKey: keyText(keys[id]) ? keys[id] : storedKey,
      updatedAt: typeof item.updatedAt === 'number' && Number.isFinite(item.updatedAt) ? item.updatedAt : 0 });
  }
  return { profiles, activeId: profiles.some(profile => profile.id === saved.activeId) ? saved.activeId as string : profiles[0]?.id ?? '' };
}

export function persistProfileState(profiles: AiProfile[], activeId: string, local: StorageSource, session: StorageSource): ProfileStorageWarning {
  let profilesSaved = true, keysSaved = true;
  try {
    local().setItem(PROFILES, JSON.stringify({ activeId, profiles: profiles.map(profile => ({
      id: profile.id, name: profile.name, baseUrl: profile.baseUrl, model: profile.model,
      protocol: profile.protocol, rememberKey: profile.rememberKey, updatedAt: profile.updatedAt,
      apiKey: profile.rememberKey ? profile.apiKey : '',
    })) }));
  } catch { profilesSaved = false; }
  try { session().setItem(KEYS, JSON.stringify(Object.fromEntries(profiles.map(profile => [profile.id, profile.apiKey])))); }
  catch { keysSaved = false; }
  return !profilesSaved ? 'profiles' : !keysSaved && profiles.some(profile => profile.apiKey && !profile.rememberKey) ? 'keys' : null;
}

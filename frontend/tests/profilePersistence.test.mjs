import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadProfileState, persistProfileState } from '../src/ai/profilePersistence.ts';

const profileKey = 'marketdesk:ai-profiles:v1', keyKey = 'marketdesk:ai-keys:v1';
const profile = { id: 'one', name: 'Fixture', baseUrl: 'https://fixture.example/v1', model: 'fixture', protocol: 'chat', rememberKey: false, apiKey: 'fixture-key', updatedAt: 1 };
const storage = entries => {
  const data = new Map(Object.entries(entries ?? {}));
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), data };
};
const blocked = () => { throw new Error('Storage unavailable'); };

test('corrupt rows cannot hide valid profiles, and duplicate or invalid fields are skipped', () => {
  const local = storage({ [profileKey]: JSON.stringify({ activeId: 'one', profiles: [null, { id: 'bad' }, profile,
    { ...profile, name: 'Duplicate' }, { ...profile, id: 'bad-protocol', protocol: 'invalid' }] }) });
  const session = storage({ [keyKey]: JSON.stringify({ one: 'session-key' }) });
  assert.deepEqual(loadProfileState(() => local, () => session), { profiles: [{ ...profile, apiKey: 'session-key' }], activeId: 'one' });
});

test('blocked or corrupt session storage cannot erase remembered profiles and keys', () => {
  const remembered = { ...profile, rememberKey: true };
  const local = storage({ [profileKey]: JSON.stringify({ profiles: [remembered] }) });
  assert.deepEqual(loadProfileState(() => local, blocked).profiles, [remembered]);
  const broken = storage({ [keyKey]: '{broken' });
  assert.deepEqual(loadProfileState(() => local, () => broken).profiles, [remembered]);
  assert.deepEqual(loadProfileState(blocked, blocked), { profiles: [], activeId: '' });
});

test('legacy profiles normalize protocol and bad keys never reach the form as non-strings', () => {
  const { protocol, ...legacy } = profile;
  const local = storage({ [profileKey]: JSON.stringify({ profiles: [legacy] }) });
  const session = storage({ [keyKey]: JSON.stringify({ one: { unexpected: true } }) });
  const loaded = loadProfileState(() => local, () => session).profiles[0];
  assert.equal(loaded.protocol, protocol);
  assert.equal(loaded.apiKey, '');
  assert.equal(loaded.rememberKey, false);
});

test('session-only keys stay out of persistent storage, with a whitelist of profile fields', () => {
  const local = storage(), session = storage();
  assert.equal(persistProfileState([{ ...profile, extra: 'do-not-persist' }], 'one', () => local, () => session), null);
  const serialized = local.getItem(profileKey);
  assert(!serialized.includes('fixture-key') && !serialized.includes('do-not-persist'));
  assert.equal(JSON.parse(session.getItem(keyKey)).one, 'fixture-key');
  assert.equal(loadProfileState(() => local, () => session).profiles[0].apiKey, 'fixture-key');
});

test('each storage write is attempted independently and warnings describe actual durability', () => {
  const session = storage();
  assert.equal(persistProfileState([profile], 'one', blocked, () => session), 'profiles');
  assert.equal(JSON.parse(session.getItem(keyKey)).one, 'fixture-key');
  const local = storage();
  assert.equal(persistProfileState([profile], 'one', () => local, blocked), 'keys');
  assert.equal(persistProfileState([{ ...profile, rememberKey: true }], 'one', () => local, blocked), null);
  assert.equal(persistProfileState([{ ...profile, apiKey: '' }], 'one', () => local, blocked), null);
  assert.equal(persistProfileState([profile], 'one', blocked, blocked), 'profiles');
});

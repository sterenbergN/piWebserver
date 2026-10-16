import test from 'node:test';
import assert from 'node:assert/strict';
import { clearWorkoutCache, fetchWorkoutJson } from './offline-cache';

// Minimal browser storage for node.
const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
};

const respond = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status });

test('a good response is returned and remembered; a network failure falls back to it', async () => {
  globalThis.fetch = respond(200, { success: true, gyms: [{ id: 'g' }] }) as any;
  const online = await fetchWorkoutJson('/api/workout/gyms');
  assert.equal(online.offline, false);
  assert.deepEqual(online.data, { success: true, gyms: [{ id: 'g' }] });

  globalThis.fetch = (async () => { throw new TypeError('Failed to fetch'); }) as any;
  const offline = await fetchWorkoutJson('/api/workout/gyms');
  assert.equal(offline.offline, true);
  assert.deepEqual(offline.data, { success: true, gyms: [{ id: 'g' }] });
});

test('server errors use the cache; a reachable "logged out" answer does not', async () => {
  globalThis.fetch = respond(200, { success: true, authenticated: true, user: { id: 'u' } }) as any;
  await fetchWorkoutJson('/api/workout/auth');
  globalThis.fetch = respond(502, { success: false }) as any;
  assert.equal((await fetchWorkoutJson('/api/workout/auth')).data.user.id, 'u');
  globalThis.fetch = respond(200, { success: false, authenticated: false }) as any;
  const loggedOut = await fetchWorkoutJson('/api/workout/auth');
  assert.equal(loggedOut.offline, false);
  assert.equal(loggedOut.data.authenticated, false);
});

test('logging out clears the cache', async () => {
  globalThis.fetch = respond(200, { success: true, history: [] }) as any;
  await fetchWorkoutJson('/api/workout/history');
  clearWorkoutCache();
  globalThis.fetch = (async () => { throw new TypeError('offline'); }) as any;
  assert.equal((await fetchWorkoutJson('/api/workout/history')).data, null);
});

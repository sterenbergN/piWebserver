import test from 'node:test';
import { strict as assert } from 'node:assert';

// Minimal localStorage for node.
const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
};

const respond = (status: number, body: object) =>
  ({ status, ok: status >= 200 && status < 300, json: async () => body }) as unknown as Response;

test('flushWorkoutQueue keeps retryable failures and drops permanent ones', async () => {
  const { enqueueWorkout, flushWorkoutQueue, getQueuedWorkouts } = await import('./offline-queue');
  store.clear();
  enqueueWorkout('u1', { clientId: 'a' });
  enqueueWorkout('u1', { clientId: 'b' });
  enqueueWorkout('u1', { clientId: 'c' });
  enqueueWorkout('u2', { clientId: 'other-user' });
  enqueueWorkout('u1', { clientId: 'a' }); // re-queue replaces, no duplicate

  const outcomes: Record<string, () => Promise<Response>> = {
    a: async () => respond(200, { success: true }),
    b: async () => { throw new Error('offline'); },
    c: async () => respond(400, { success: false, message: 'bad' }),
  };
  const fakeFetch = (async (_url: string, init: RequestInit) => outcomes[JSON.parse(String(init.body)).clientId]()) as typeof fetch;

  const result = await flushWorkoutQueue('u1', fakeFetch);
  assert.deepEqual(result, { synced: 1, dropped: 1, remaining: 1 });
  assert.deepEqual(getQueuedWorkouts('u1').map((e) => e.payload.clientId), ['b']);
  assert.equal(getQueuedWorkouts('u1')[0].attempts, 1);
  assert.equal(getQueuedWorkouts('u2').length, 1);
});

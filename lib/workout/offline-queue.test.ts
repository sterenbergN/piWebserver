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

test('queued edits merge, a delete replaces them, and flushing keeps only retryable failures', async () => {
  const { enqueueChange, getQueuedChanges, applyQueuedChanges, flushChangeQueue } = await import('./offline-queue');
  store.clear();
  enqueueChange('u1', { id: 'w1', kind: 'edit', body: { notes: 'a' }, preview: { id: 'w1', notes: 'a' } });
  enqueueChange('u1', { id: 'w1', kind: 'edit', body: { durationSecs: 600 }, preview: { id: 'w1', notes: 'a', durationSecs: 600 } });
  enqueueChange('u1', { id: 'w2', kind: 'edit', body: { notes: 'b' } });
  enqueueChange('u1', { id: 'w2', kind: 'delete' });
  enqueueChange('u1', { id: 'w3', kind: 'delete' });
  const changes = getQueuedChanges('u1');
  assert.deepEqual(changes.map((c) => [c.id, c.kind]), [['w1', 'edit'], ['w2', 'delete'], ['w3', 'delete']]);
  assert.deepEqual(changes[0].body, { notes: 'a', durationSecs: 600 });

  const shown = applyQueuedChanges([{ id: 'w1' }, { id: 'w2' }, { id: 'w4' }], changes);
  assert.deepEqual(shown, [{ id: 'w1', notes: 'a', durationSecs: 600 }, { id: 'w4' }]);

  const fakeFetch = (async (url: string) => {
    if (url.includes('w1')) throw new Error('offline');
    if (url.includes('w2')) return respond(404, {});
    return respond(200, { success: true });
  }) as typeof fetch;
  const result = await flushChangeQueue('u1', fakeFetch);
  assert.deepEqual(result, { synced: 2, remaining: 1 });
  assert.equal(getQueuedChanges('u1')[0].attempts, 1);
});

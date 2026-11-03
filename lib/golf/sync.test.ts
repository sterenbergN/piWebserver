import test from 'node:test';
import assert from 'node:assert/strict';
import { applyChange, emptySnapshot, enqueue, flush, readQueue, readSnapshot, rebase, writeSnapshot, type KeyValue } from './sync';
import { createRound } from './round';
import type { Course } from './types';

function memory(): KeyValue & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, get: (k) => data.get(k) ?? null, set: (k, v) => { data.set(k, v); }, remove: (k) => { data.delete(k); } };
}
const round = () => createRound({ sport: 'golf', holes: 3, players: [{ id: 'a', name: 'A', userId: 'u1' }], scorerId: 'u1' });
const at = (s: number) => `2026-11-03T12:00:0${s}.000Z`;
const score = (hole: number, strokes: number, s: number) => ({ type: 'score' as const, playerId: 'a', hole, score: { strokes, at: at(s) }, at: at(s) });

test('score changes to the same round go out together', () => {
  const store = memory();
  const r = round();
  enqueue(store, 'u1', { kind: 'round', round: r });
  enqueue(store, 'u1', { kind: 'ops', roundId: r.id, ops: [score(0, 4, 1)] });
  enqueue(store, 'u1', { kind: 'ops', roundId: r.id, ops: [score(1, 5, 2)] });
  const queue = readQueue(store, 'u1');
  assert.equal(queue.length, 2);
  assert.equal(queue[1].kind === 'ops' && queue[1].ops.length, 2);
});

test('rebase puts unsent changes on top of fresh data from the Pi', () => {
  const r = round();
  const server = { ...emptySnapshot(), rounds: [r] };
  const local = rebase(server, [{ kind: 'ops', roundId: r.id, ops: [score(0, 4, 1)] }]);
  assert.equal(local.rounds[0].scores.a[0]?.strokes, 4);
  assert.equal(server.rounds[0].scores.a[0], null, 'the server copy is left alone');
});

test('applyChange: deleting, courses and holes', () => {
  const r = round();
  let snap = applyChange(emptySnapshot(), { kind: 'round', round: r });
  snap = applyChange(snap, { kind: 'round', round: r });
  assert.equal(snap.rounds.length, 1, 'adding twice is once');
  const course: Course = { id: 'c', sport: 'golf', name: 'C', createdBy: null, createdAt: at(0), updatedAt: at(0), layouts: [{ id: 'l', name: 'T', holes: [{ n: 1, par: 4 }] }] };
  snap = applyChange(snap, { kind: 'course', course });
  snap = applyChange(snap, { kind: 'course-hole', courseId: 'c', hole: { layoutId: 'l', n: 1, tee: { lat: 1, lon: 2 } } });
  assert.deepEqual(snap.courses[0].layouts[0].holes[0].tee, { lat: 1, lon: 2 });
  assert.equal(course.layouts[0].holes[0].tee, undefined, 'the original is not touched');
  snap = applyChange(snap, { kind: 'delete', roundId: r.id });
  assert.equal(snap.rounds.length, 0);
});

test('flush sends in order, stops when offline, and keeps what is left', async () => {
  const store = memory();
  const r = round();
  enqueue(store, 'u1', { kind: 'round', round: r });
  enqueue(store, 'u1', { kind: 'ops', roundId: r.id, ops: [score(0, 4, 1)] });
  const calls: string[] = [];
  let online = true;
  const send = (async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method} ${url}`);
    if (!online) throw new Error('offline');
    online = false;
    return new Response('{"success":true}', { status: 200 });
  }) as typeof fetch;
  const first = await flush(store, 'u1', send);
  assert.deepEqual([first.sent, first.waiting, first.offline], [1, 1, true]);
  assert.deepEqual(calls, ['POST /api/golf/rounds', `PATCH /api/golf/rounds/${r.id}`]);
  online = true;
  const second = await flush(store, 'u1', send);
  assert.deepEqual([second.sent, second.waiting], [1, 0]);
});

test('a change made while a send is on its way is kept and sent next', async () => {
  const store = memory();
  const r = round();
  enqueue(store, 'u1', { kind: 'ops', roundId: r.id, ops: [score(0, 4, 1)] });
  const bodies: unknown[] = [];
  const send = (async (_url: string, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)).ops.map((o: { score: { strokes: number } }) => o.score.strokes));
    // The player taps again while the first request is out.
    if (bodies.length === 1) enqueue(store, 'u1', { kind: 'ops', roundId: r.id, ops: [score(0, 5, 2)] });
    return new Response('{"success":true}', { status: 200 });
  }) as typeof fetch;
  const result = await flush(store, 'u1', send);
  assert.deepEqual(bodies, [[4], [5]]);
  assert.equal(result.waiting, 0);
});

test('flush drops a change the Pi refuses for good, and counts a missing round as deleted', async () => {
  const store = memory();
  enqueue(store, 'u1', { kind: 'ops', roundId: 'gone', ops: [] });
  enqueue(store, 'u1', { kind: 'delete', roundId: 'gone' });
  const send = (async () => new Response('{"message":"Round not found"}', { status: 404 })) as typeof fetch;
  const result = await flush(store, 'u1', send);
  assert.deepEqual(result, { sent: 1, dropped: ['Round not found'], waiting: 0, offline: false });
});

test('snapshots survive a round trip through storage and junk reads as empty', () => {
  const store = memory();
  const snap = { ...emptySnapshot(), rounds: [round()] };
  writeSnapshot(store, 'device', snap);
  assert.equal(readSnapshot(store, 'device').rounds.length, 1);
  store.set('golf:data:x', '{nope');
  assert.deepEqual(readSnapshot(store, 'x'), emptySnapshot());
});

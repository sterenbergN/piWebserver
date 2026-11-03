// The phone's copy of your golf data and the changes waiting to reach the Pi.
// Every change is applied to the local copy at once and queued; the queue goes out
// in order whenever there's a connection. When fresh data comes back from the Pi,
// anything still queued is applied on top, so the screen never jumps back.
// Signed out, the local copy is all there is and nothing is queued.

import { emptyGolfUser, normalizeCourse, normalizeGolfUser } from './course';
import { applyOps, normalizeRound } from './round';
import type { Course, CourseHole, GolfUser, Round, RoundOp } from './types';

export type KeyValue = { get(key: string): string | null; set(key: string, value: string): void; remove(key: string): void };

export type HoleChange = { layoutId: string; n: number } & Partial<Pick<CourseHole, 'tee' | 'target' | 'par'>>;

export type Change =
  | { kind: 'round'; round: Round }
  | { kind: 'ops'; roundId: string; ops: RoundOp[] }
  | { kind: 'delete'; roundId: string }
  | { kind: 'course'; course: Course }
  | { kind: 'course-hole'; courseId: string; hole: HoleChange }
  | { kind: 'course-edit'; course: Course }
  | { kind: 'user'; user: GolfUser };

export type Snapshot = { rounds: Round[]; courses: Course[]; user: GolfUser };

export const emptySnapshot = (): Snapshot => ({ rounds: [], courses: [], user: emptyGolfUser() });

const snapshotKey = (scope: string) => `golf:data:${scope}`;
const queueKey = (scope: string) => `golf:queue:${scope}`;

export function readSnapshot(store: KeyValue, scope: string): Snapshot {
  try {
    const raw = JSON.parse(store.get(snapshotKey(scope)) || 'null');
    if (!raw) return emptySnapshot();
    return {
      rounds: (Array.isArray(raw.rounds) ? raw.rounds : []).map(normalizeRound).filter(Boolean) as Round[],
      courses: (Array.isArray(raw.courses) ? raw.courses : []).map(normalizeCourse).filter(Boolean) as Course[],
      user: normalizeGolfUser(raw.user),
    };
  } catch {
    return emptySnapshot();
  }
}

export function writeSnapshot(store: KeyValue, scope: string, snapshot: Snapshot) {
  try {
    store.set(snapshotKey(scope), JSON.stringify(snapshot));
  } catch { /* Storage full or blocked: the copy in memory still works until the page closes. */ }
}

export function readQueue(store: KeyValue, scope: string): Change[] {
  try {
    const raw = JSON.parse(store.get(queueKey(scope)) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function writeQueue(store: KeyValue, scope: string, queue: Change[]) {
  try {
    if (queue.length) store.set(queueKey(scope), JSON.stringify(queue));
    else store.remove(queueKey(scope));
  } catch { /* As above. */ }
}

/** Add a change to the queue. Score changes to the same round ride together in one request. */
export function enqueue(store: KeyValue, scope: string, change: Change) {
  const queue = readQueue(store, scope);
  const last = queue[queue.length - 1];
  if (change.kind === 'ops' && last?.kind === 'ops' && last.roundId === change.roundId && last.ops.length + change.ops.length <= 400) {
    last.ops.push(...change.ops);
  } else {
    queue.push(change);
  }
  writeQueue(store, scope, queue);
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/** Apply one change to a snapshot (returns a new one). */
export function applyChange(snapshot: Snapshot, change: Change): Snapshot {
  const next: Snapshot = { rounds: snapshot.rounds, courses: snapshot.courses, user: snapshot.user };
  switch (change.kind) {
    case 'round':
      if (!next.rounds.some((r) => r.id === change.round.id)) next.rounds = [clone(change.round), ...next.rounds];
      break;
    case 'ops':
      next.rounds = next.rounds.map((r) => (r.id === change.roundId ? applyOps(clone(r), clone(change.ops)) : r));
      break;
    case 'delete':
      next.rounds = next.rounds.filter((r) => r.id !== change.roundId);
      break;
    case 'course':
      if (!next.courses.some((c) => c.id === change.course.id)) next.courses = [...next.courses, clone(change.course)];
      break;
    case 'course-edit':
      next.courses = next.courses.map((c) => (c.id === change.course.id ? { ...c, name: change.course.name, layouts: clone(change.course.layouts) } : c));
      break;
    case 'course-hole':
      next.courses = next.courses.map((c) => {
        if (c.id !== change.courseId) return c;
        const copy = clone(c);
        const hole = copy.layouts.find((l) => l.id === change.hole.layoutId)?.holes[change.hole.n - 1];
        if (hole) {
          if (change.hole.tee) hole.tee = change.hole.tee;
          if (change.hole.target) hole.target = change.hole.target;
          if (change.hole.par) hole.par = change.hole.par;
        }
        return copy;
      });
      break;
    case 'user':
      next.user = clone(change.user);
      break;
  }
  return next;
}

/** Fresh data from the Pi, with whatever hasn't been sent yet applied on top. */
export function rebase(server: Snapshot, queue: Change[]): Snapshot {
  return queue.reduce(applyChange, server);
}

function request(change: Change): { url: string; init: RequestInit } {
  const json = (method: string, body: unknown) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  switch (change.kind) {
    case 'round': return { url: '/api/golf/rounds', init: json('POST', { round: change.round }) };
    case 'ops': return { url: `/api/golf/rounds/${change.roundId}`, init: json('PATCH', { ops: change.ops }) };
    case 'delete': return { url: `/api/golf/rounds/${change.roundId}`, init: { method: 'DELETE' } };
    case 'course': return { url: '/api/golf/courses', init: json('POST', { course: change.course }) };
    case 'course-hole': return { url: `/api/golf/courses/${change.courseId}`, init: json('PATCH', { hole: change.hole }) };
    case 'course-edit': return { url: `/api/golf/courses/${change.course.id}`, init: json('PATCH', { course: change.course }) };
    case 'user': return { url: '/api/golf/me', init: json('PUT', { user: change.user }) };
  }
}

/** Worth trying again later: no connection, signed out for now, or the Pi having trouble. */
export const isRetryable = (status: number | null) => status === null || status === 401 || status === 408 || status === 429 || status >= 500;

export type FlushResult = { sent: number; dropped: string[]; waiting: number; offline: boolean };

let flushing: Promise<FlushResult> | null = null;

/**
 * Send queued changes in order. Stops at the first one that should be retried (so
 * nothing goes out of order); drops one the Pi refuses outright (a deleted round, say).
 * Only one flush runs at a time.
 */
export function flush(store: KeyValue, scope: string, send: typeof fetch = fetch): Promise<FlushResult> {
  if (flushing) return flushing;
  flushing = (async () => {
    const dropped: string[] = [];
    let sent = 0;
    let offline = false;
    for (;;) {
      const queue = readQueue(store, scope);
      const change = queue[0];
      if (!change) break;
      const { url, init } = request(change);
      let status: number | null = null;
      let message = '';
      try {
        const res = await send(url, init);
        status = res.status;
        if (!res.ok) message = (await res.json().catch(() => null))?.message || `HTTP ${res.status}`;
      } catch {
        status = null;
      }
      const done = status !== null && (status < 400 || (change.kind === 'delete' && status === 404));
      if (!done && isRetryable(status)) { offline = true; break; }
      // Sent, or refused for good: either way it leaves the queue. Re-read in case more was added
      // meanwhile: changes made while this was on its way were added to the same entry, and stay.
      const now = readQueue(store, scope);
      const head = now[0];
      if (change.kind === 'ops' && head?.kind === 'ops' && head.roundId === change.roundId && head.ops.length > change.ops.length) {
        writeQueue(store, scope, [{ ...head, ops: head.ops.slice(change.ops.length) }, ...now.slice(1)]);
      } else {
        writeQueue(store, scope, now.slice(1));
      }
      if (done) sent++;
      else dropped.push(message);
    }
    return { sent, dropped, waiting: readQueue(store, scope).length, offline };
  })().finally(() => { flushing = null; });
  return flushing;
}

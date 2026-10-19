// Client-side queue for finished workouts that couldn't reach the server (gym
// Wi-Fi is unreliable). Entries are retried later; the history API ignores
// duplicates by clientId, so a retry after an ambiguous failure is safe.

const QUEUE_KEY = 'workoutSaveQueue';

export type QueuedWorkout = {
  ownerId: string;
  queuedAt: number;
  attempts: number;
  lastError?: string;
  payload: Record<string, any> & { clientId?: string; name?: string };
};

function readQueue(): QueuedWorkout[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeQueue(queue: QueuedWorkout[]) {
  try {
    if (queue.length === 0) localStorage.removeItem(QUEUE_KEY);
    else localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    // Storage unavailable — nothing more we can do on this device.
  }
}

export function getQueuedWorkouts(ownerId?: string): QueuedWorkout[] {
  const queue = readQueue();
  return ownerId ? queue.filter((entry) => entry.ownerId === ownerId) : queue;
}

export function enqueueWorkout(ownerId: string, payload: QueuedWorkout['payload'], error?: string) {
  const queue = readQueue().filter((entry) => !payload.clientId || entry.payload.clientId !== payload.clientId);
  queue.push({ ownerId, queuedAt: Date.now(), attempts: 0, lastError: error, payload });
  writeQueue(queue);
}

/** True when a failed save is worth retrying later (network / server trouble). */
export function isRetryableSaveFailure(status: number | null) {
  return status === null || status === 401 || status === 408 || status === 429 || status >= 500;
}

/**
 * Try to upload every queued workout for this user. Entries that succeed — or
 * fail permanently (e.g. validation errors) — are removed; the rest stay.
 */
export async function flushWorkoutQueue(ownerId: string, post: typeof fetch = fetch) {
  const queue = readQueue();
  const remaining: QueuedWorkout[] = [];
  let synced = 0;
  let dropped = 0;

  for (const entry of queue) {
    if (entry.ownerId !== ownerId) {
      remaining.push(entry);
      continue;
    }
    let status: number | null = null;
    let message = '';
    try {
      const response = await post('/api/workout/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry.payload),
      });
      status = response.status;
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.success) {
        synced++;
        continue;
      }
      message = data.message || `HTTP ${response.status}`;
    } catch {
      message = 'Network error';
    }

    if (isRetryableSaveFailure(status)) {
      remaining.push({ ...entry, attempts: entry.attempts + 1, lastError: message });
    } else {
      dropped++;
    }
  }

  writeQueue(remaining);
  return { synced, dropped, remaining: remaining.filter((entry) => entry.ownerId === ownerId).length };
}

// ─── Edits and deletes of saved workouts ──────────────────────────────────────
// Same idea for changes to workouts already in history: kept on the phone
// when there's no signal and sent later. Several edits to one workout merge;
// deleting it drops its pending edits.

const CHANGE_KEY = 'workoutChangeQueue';

export type QueuedChange = {
  ownerId: string;
  id: string;
  kind: 'edit' | 'delete';
  queuedAt: number;
  attempts: number;
  /** PATCH body for an edit. */
  body?: Record<string, unknown>;
  /** The workout as it looks after the edit, to show until it syncs. */
  preview?: Record<string, any>;
};

function readChanges(): QueuedChange[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(CHANGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeChanges(queue: QueuedChange[]) {
  try {
    if (queue.length === 0) localStorage.removeItem(CHANGE_KEY);
    else localStorage.setItem(CHANGE_KEY, JSON.stringify(queue));
  } catch {
    // Storage unavailable — nothing more we can do on this device.
  }
}

export function getQueuedChanges(ownerId: string) {
  return readChanges().filter((c) => c.ownerId === ownerId);
}

export function enqueueChange(ownerId: string, change: { id: string; kind: 'edit' | 'delete'; body?: Record<string, unknown>; preview?: Record<string, any> }) {
  const queue = readChanges();
  const same = (c: QueuedChange) => c.ownerId === ownerId && c.id === change.id;
  const previous = queue.find((c) => same(c) && c.kind === 'edit');
  const rest = queue.filter((c) => !same(c));
  rest.push(change.kind === 'delete'
    ? { ownerId, id: change.id, kind: 'delete', queuedAt: Date.now(), attempts: 0 }
    : { ownerId, id: change.id, kind: 'edit', queuedAt: Date.now(), attempts: 0, body: { ...previous?.body, ...change.body }, preview: change.preview });
  writeChanges(rest);
}

/** History as it will be once the queued changes reach the server. */
export function applyQueuedChanges<T extends { id?: string }>(history: T[], changes: QueuedChange[]): T[] {
  if (changes.length === 0) return history;
  const deleted = new Set(changes.filter((c) => c.kind === 'delete').map((c) => c.id));
  const edited = new Map(changes.filter((c) => c.kind === 'edit' && c.preview).map((c) => [c.id, c.preview as T]));
  return history.filter((w) => !w.id || !deleted.has(w.id)).map((w) => (w.id && edited.get(w.id)) || w);
}

/** Send queued edits and deletes; retryable failures stay queued. */
export async function flushChangeQueue(ownerId: string, send: typeof fetch = fetch) {
  const queue = readChanges();
  const remaining: QueuedChange[] = [];
  let synced = 0;
  for (const change of queue) {
    if (change.ownerId !== ownerId) {
      remaining.push(change);
      continue;
    }
    let status: number | null = null;
    try {
      const response = await send(`/api/workout/history?id=${encodeURIComponent(change.id)}`, change.kind === 'delete'
        ? { method: 'DELETE' }
        : { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(change.body || {}) });
      status = response.status;
      // A delete of something already gone has done its job.
      if (response.ok || (change.kind === 'delete' && status === 404)) {
        synced++;
        continue;
      }
    } catch {
      status = null;
    }
    if (isRetryableSaveFailure(status)) remaining.push({ ...change, attempts: change.attempts + 1 });
  }
  writeChanges(remaining);
  return { synced, remaining: remaining.filter((c) => c.ownerId === ownerId).length };
}

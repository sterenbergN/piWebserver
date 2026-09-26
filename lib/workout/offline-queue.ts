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

// Links printed on gym equipment (as QR codes) and the hand-off that lets a
// scanned station add its lifts to the workout in progress.

export function stationPath(gymId: string, stationId: string) {
  return `/workout/station?gym=${encodeURIComponent(gymId)}&station=${encodeURIComponent(stationId)}`;
}

const QUEUE_KEY = 'workoutQueuedLifts';

export type QueuedLift = { lift: Record<string, unknown>; station: Record<string, unknown>; gymId: string; gymName: string };

/** Queue lifts for the active workout; the tracker picks them up when it opens. */
export function queueLiftsForWorkout(entries: QueuedLift[]) {
  try {
    const existing: QueuedLift[] = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
    localStorage.setItem(QUEUE_KEY, JSON.stringify([...existing, ...entries]));
  } catch {
    // Storage unavailable: nothing to hand off.
  }
}

/** Take (and clear) any lifts queued from a station page. */
export function takeQueuedLifts(): QueuedLift[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    localStorage.removeItem(QUEUE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((e) => e && e.lift && e.station) : [];
  } catch {
    return [];
  }
}

/** Whether a resumable workout for this user is saved on this device. */
export function hasPendingWorkout(ownerId: string | undefined) {
  try {
    const saved = JSON.parse(localStorage.getItem('pendingWorkout') || 'null');
    return !!saved && (!ownerId || !saved.ownerId || saved.ownerId === ownerId);
  } catch {
    return false;
  }
}

import { calcAverage1RM } from './analytics';

/**
 * Suggested rest between sets for a rep target: heavy, low-rep work needs
 * longer recovery than light, high-rep work.
 */
export function restTargetSeconds(reps: number): number {
  if (reps <= 5) return 180;
  if (reps <= 8) return 120;
  if (reps <= 12) return 90;
  return 60;
}

type HistoryWorkout = {
  id?: string;
  timestamp?: string;
  type?: { id?: string; name?: string };
  logs?: Record<string, { weight: number; reps: number }[]>;
  volume?: number;
};

/** Best estimated 1RM ever logged for each lift id. */
export function bestE1RMByLift(history: HistoryWorkout[] | undefined): Record<string, number> {
  const best: Record<string, number> = {};
  for (const workout of history || []) {
    for (const [liftId, sets] of Object.entries(workout.logs || {})) {
      for (const set of sets || []) {
        const e1rm = calcAverage1RM(Number(set.weight), Number(set.reps));
        if (e1rm > (best[liftId] || 0)) best[liftId] = e1rm;
      }
    }
  }
  return best;
}

export function workoutVolume(logs: Record<string, { weight: number; reps: number }[]> | undefined): number {
  return Object.values(logs || {}).reduce(
    (sum, sets) => sum + (sets || []).reduce((acc, set) => acc + (Number(set.weight) || 0) * (Number(set.reps) || 0), 0),
    0,
  );
}

/** Most recent previous workout of the same workout type (by id, else name). */
export function findPreviousSameType(history: HistoryWorkout[] | undefined, type: { id?: string; name?: string } | undefined) {
  if (!type) return null;
  const matches = (history || []).filter((workout) =>
    (type.id && workout.type?.id === type.id) || (!type.id && type.name && workout.type?.name === type.name)
  );
  matches.sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime());
  return matches[0] || null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Monday 00:00 (local time) of the week containing `date`. */
function startOfWeek(date: Date) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const daysSinceMonday = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - daysSinceMonday);
  return start;
}

/**
 * Training-habit stats for the dashboard: workouts this week, consecutive
 * weeks with at least one workout (the current week counts once it has one,
 * and an empty current week doesn't break the streak yet), and days since
 * the last workout.
 */
export function trainingStreak(history: { timestamp?: string }[] | undefined, now = new Date()) {
  const times = (history || [])
    .map((workout) => new Date(workout.timestamp || '').getTime())
    .filter((time) => Number.isFinite(time) && time <= now.getTime())
    .sort((a, b) => b - a);

  const thisWeekStart = startOfWeek(now).getTime();
  const workoutsThisWeek = times.filter((time) => time >= thisWeekStart).length;

  const weeksWithWorkouts = new Set(times.map((time) => startOfWeek(new Date(time)).getTime()));
  let weekStreak = 0;
  const cursor = new Date(thisWeekStart);
  if (!weeksWithWorkouts.has(cursor.getTime())) cursor.setDate(cursor.getDate() - 7);
  while (weeksWithWorkouts.has(cursor.getTime())) {
    weekStreak++;
    cursor.setDate(cursor.getDate() - 7);
  }

  const daysSinceLast = times.length > 0 ? Math.floor((now.getTime() - times[0]) / DAY_MS) : null;
  return { workoutsThisWeek, weekStreak, daysSinceLast };
}

export function formatRelativeDay(timestamp: string | undefined, now = new Date()) {
  const time = new Date(timestamp || '').getTime();
  if (!Number.isFinite(time)) return '';
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const day = new Date(time); day.setHours(0, 0, 0, 0);
  const diffDays = Math.round((today.getTime() - day.getTime()) / DAY_MS);
  if (diffDays <= 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  return new Date(time).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * A short warm-up ramp toward a working weight (~40%×8, 60%×5, 80%×3), snapped
 * down to weights the equipment supports. Skipped for light working weights.
 */
export function warmupSets(workingWeight: number, possibleWeights: number[]): { weight: number; reps: number }[] {
  const ladder = [...possibleWeights].filter((w) => w > 0).sort((a, b) => a - b);
  if (ladder.length === 0 || workingWeight < 65) return [];
  const lightest = ladder[0];

  const ramp: { weight: number; reps: number }[] = [];
  for (const [fraction, reps] of [[0.4, 8], [0.6, 5], [0.8, 3]] as const) {
    const target = workingWeight * fraction;
    const weight = [...ladder].reverse().find((w) => w <= target) ?? lightest;
    const last = ramp[ramp.length - 1];
    if (weight >= workingWeight || (last && weight <= last.weight)) continue;
    ramp.push({ weight, reps });
  }
  return ramp;
}

export type LiftSession = {
  workoutId?: string;
  timestamp: string;
  sets: { weight: number; reps: number; rir?: number }[];
  topSet: { weight: number; reps: number };
  e1rm: number;
  volume: number;
};

/**
 * Every past session of a lift, oldest first. Matches by lift id, or by name
 * via liftMeta so the same exercise at another gym is included.
 */
export function liftSessions(
  history: (HistoryWorkout & { liftMeta?: Record<string, { name?: string }> })[] | undefined,
  liftId: string,
  liftName?: string,
): LiftSession[] {
  const name = (liftName || '').trim().toLowerCase();
  const sessions: LiftSession[] = [];
  for (const workout of history || []) {
    const ids = Object.keys(workout.logs || {}).filter((id) =>
      id === liftId || (!!name && (workout.liftMeta?.[id]?.name || '').trim().toLowerCase() === name)
    );
    const sets = ids.flatMap((id) => workout.logs?.[id] || []).filter((set) => Number(set.reps) > 0);
    if (sets.length === 0) continue;
    let topSet = sets[0];
    let e1rm = 0;
    for (const set of sets) {
      const estimate = calcAverage1RM(Number(set.weight), Number(set.reps));
      if (estimate > e1rm || (estimate === e1rm && set.weight > topSet.weight)) {
        e1rm = estimate;
        topSet = set;
      }
    }
    sessions.push({
      workoutId: workout.id,
      timestamp: workout.timestamp || '',
      sets,
      topSet: { weight: Number(topSet.weight), reps: Number(topSet.reps) },
      e1rm,
      volume: workoutVolume({ x: sets }),
    });
  }
  return sessions.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

type MuscleLookup = Record<string, { primaryMuscle?: string; secondaryMuscle?: string }>;

/**
 * Working sets per muscle group over the last `days` (default: this week, Monday
 * onward). A set counts fully toward the lift's primary muscle and half toward
 * its secondary muscle. Muscles come from the workout's saved liftMeta, falling
 * back to the current gym configuration.
 */
export function muscleSetCounts(
  history: (HistoryWorkout & { isDeload?: boolean; liftMeta?: MuscleLookup })[] | undefined,
  liftLookup: MuscleLookup,
  since: Date,
): Record<string, number> {
  const counts: Record<string, number> = {};
  const add = (muscle: string | undefined, amount: number) => {
    if (!muscle || muscle === 'None') return;
    counts[muscle] = (counts[muscle] || 0) + amount;
  };
  for (const workout of history || []) {
    if (new Date(workout.timestamp || 0).getTime() < since.getTime()) continue;
    for (const [liftId, sets] of Object.entries(workout.logs || {})) {
      const meta = { ...liftLookup[liftId], ...workout.liftMeta?.[liftId] };
      const setCount = (sets || []).length;
      add(meta.primaryMuscle, setCount);
      if (meta.secondaryMuscle !== meta.primaryMuscle) add(meta.secondaryMuscle, setCount * 0.5);
    }
  }
  return counts;
}

export function startOfCurrentWeek(now = new Date()) {
  return startOfWeek(now);
}

export type StalledLift = { liftId: string; name: string; sessions: number; bestE1RM: number };

const STALL_WINDOW = 3;

/**
 * Lifts whose best estimated 1RM over the last three sessions hasn't beaten
 * their best from before that window (within 1%). Needs at least five
 * non-deload sessions so a new lift isn't flagged.
 */
export function detectStalledLifts(
  history: (HistoryWorkout & { isDeload?: boolean; liftMeta?: Record<string, { name?: string }> })[] | undefined,
): StalledLift[] {
  const training = (history || []).filter((workout) => !workout.isDeload);
  const names = new Map<string, string>();
  for (const workout of training) {
    for (const liftId of Object.keys(workout.logs || {})) {
      const name = workout.liftMeta?.[liftId]?.name;
      if (name) names.set(liftId, name);
      else if (!names.has(liftId)) names.set(liftId, liftId);
    }
  }

  const stalled: StalledLift[] = [];
  for (const [liftId, name] of names) {
    const sessions = liftSessions(training, liftId);
    if (sessions.length < STALL_WINDOW + 2) continue;
    const recent = sessions.slice(-STALL_WINDOW);
    const before = sessions.slice(0, -STALL_WINDOW);
    const recentBest = Math.max(...recent.map((s) => s.e1rm));
    const priorBest = Math.max(...before.map((s) => s.e1rm));
    if (recentBest <= priorBest * 1.01) {
      stalled.push({ liftId, name, sessions: sessions.length, bestE1RM: Math.round(priorBest) });
    }
  }
  return stalled;
}

/**
 * Smoothed bodyweight trend: a 7-entry moving average per point, plus the
 * change in that average over roughly the last 30 days.
 */
export function bodyweightTrend(entries: { weight: number; date: string }[]) {
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  const points = sorted.map((entry, index) => {
    const window = sorted.slice(Math.max(0, index - 6), index + 1);
    const average = window.reduce((sum, e) => sum + e.weight, 0) / window.length;
    return { date: entry.date, weight: entry.weight, average: Math.round(average * 10) / 10 };
  });
  const last = points[points.length - 1];
  const cutoff = last ? new Date(new Date(last.date).getTime() - 30 * DAY_MS).toISOString().slice(0, 10) : '';
  const monthAgo = [...points].reverse().find((p) => p.date <= cutoff) || points[0];
  const change30 = last && monthAgo && monthAgo !== last ? Math.round((last.average - monthAgo.average) * 10) / 10 : null;
  return { points, latest: last || null, change30 };
}

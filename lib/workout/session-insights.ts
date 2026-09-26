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

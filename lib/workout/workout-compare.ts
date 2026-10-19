import { calcAverage1RM } from './analytics';
import { exerciseKey, exerciseName } from './exercises';
import type { Workout } from './insights';

// Two saved workouts side by side, lift by lift — "this Push day vs the one a
// month ago". Lifts are matched by exercise, so the same exercise on another
// machine or at another gym still lines up.

type Side = { top: { weight: number; reps: number }; sets: number; e1rm: number } | null;
export type CompareRow = { key: string; name: string; a: Side; b: Side; /** e1RM change from b (older) to a. */ change: number | null };
export type WorkoutComparison = {
  totals: { label: string; a: number; b: number }[];
  lifts: CompareRow[];
};

function byExercise(w: Workout, lifts: Record<string, { name?: string; exercise?: string }>) {
  const map = new Map<string, { name: string; sets: { weight: number; reps: number }[] }>();
  for (const [liftId, raw] of Object.entries(w.logs || {})) {
    const sets = (raw || []).filter((s) => Number(s.reps) > 0).map((s) => ({ weight: Number(s.weight) || 0, reps: Number(s.reps) }));
    if (!sets.length) continue;
    const meta = { ...lifts[liftId], ...w.liftMeta?.[liftId] };
    const key = exerciseKey(meta) || liftId;
    const entry = map.get(key) || { name: exerciseName(meta) || 'Lift', sets: [] };
    entry.sets.push(...sets);
    map.set(key, entry);
  }
  return map;
}

function side(entry?: { sets: { weight: number; reps: number }[] }): Side {
  if (!entry) return null;
  let top = entry.sets[0];
  let e1rm = 0;
  for (const s of entry.sets) {
    const est = calcAverage1RM(s.weight, s.reps);
    if (est > e1rm) { e1rm = est; top = s; }
  }
  return { top, sets: entry.sets.length, e1rm: Math.round(e1rm) };
}

/** `a` is usually the newer workout; changes read as "a vs b". */
export function compareWorkouts(a: Workout, b: Workout, lifts: Record<string, { name?: string; exercise?: string }> = {}): WorkoutComparison {
  const ea = byExercise(a, lifts);
  const eb = byExercise(b, lifts);
  const keys = [...ea.keys(), ...[...eb.keys()].filter((k) => !ea.has(k))];
  const rows = keys.map((key) => {
    const sa = side(ea.get(key));
    const sb = side(eb.get(key));
    return { key, name: (ea.get(key) || eb.get(key))!.name, a: sa, b: sb, change: sa && sb ? sa.e1rm - sb.e1rm : null };
  });
  const total = (m: Map<string, { sets: { weight: number; reps: number }[] }>) => {
    let sets = 0;
    let volume = 0;
    for (const e of m.values()) for (const s of e.sets) { sets++; volume += s.weight * s.reps; }
    return { sets, volume: Math.round(volume) };
  };
  const ta = total(ea);
  const tb = total(eb);
  return {
    totals: [
      { label: 'Sets', a: ta.sets, b: tb.sets },
      { label: 'Volume (lb)', a: ta.volume, b: tb.volume },
      { label: 'Minutes', a: Math.round((a.durationSecs || 0) / 60), b: Math.round((b.durationSecs || 0) / 60) },
    ],
    lifts: rows,
  };
}

/** The workout to compare with by default: the last one of the same type before it, else just the one before. */
export function defaultComparison(workout: Workout, history: Workout[]): Workout | null {
  const at = new Date(workout.timestamp).getTime();
  const earlier = history
    .filter((w) => w !== workout && w.id !== workout.id && new Date(w.timestamp).getTime() < at)
    .sort((x, y) => new Date(y.timestamp).getTime() - new Date(x.timestamp).getTime());
  const type = workout.type?.name || workout.name;
  return earlier.find((w) => (w.type?.name || w.name) === type) || earlier[0] || null;
}

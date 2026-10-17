import { normalizeLiftKey } from './calibration-utils';
import { exerciseKey, exerciseKeyFromName, type Exercise } from './exercises';

// Renaming an exercise everywhere, and merging duplicates into one. Pure data
// transforms used by app/api/workout/exercises; they rewrite your gyms, your
// saved workouts, goals and calibrations together so no history is lost.

type LiftLike = { name: string; exercise?: string };

/**
 * Point every lift that is one of `fromKeys` at `to`: lifts named after the
 * exercise are renamed, lifts with their own name (e.g. "Flat Bench" counting
 * as "Bench Press") keep it and now count as `to`. Returns how many changed.
 */
export function renameInGyms(gyms: { stations?: { lifts?: LiftLike[] }[] }[], fromKeys: Set<string>, to: string) {
  const toKey = exerciseKeyFromName(to);
  let changed = 0;
  for (const gym of gyms) {
    for (const station of gym.stations || []) {
      for (const lift of station.lifts || []) {
        if (!fromKeys.has(exerciseKey(lift))) continue;
        if (fromKeys.has(exerciseKeyFromName(lift.name))) lift.name = to;
        if (exerciseKeyFromName(lift.name) === toKey) delete lift.exercise;
        else lift.exercise = to;
        changed++;
      }
    }
  }
  return changed;
}

/** Saved workouts keep each lift's name as it was, but now count as `to`. */
export function renameInHistory(history: { liftMeta?: Record<string, { name?: string; exercise?: string }> }[], fromKeys: Set<string>, to: string) {
  let changed = 0;
  for (const workout of history) {
    for (const meta of Object.values(workout.liftMeta || {})) {
      if (meta && fromKeys.has(exerciseKey(meta))) {
        meta.exercise = to;
        changed++;
      }
    }
  }
  return changed;
}

export function renameInGoals(goals: { exercise: string }[], fromKeys: Set<string>, to: string) {
  let changed = 0;
  for (const goal of goals) {
    if (fromKeys.has(exerciseKeyFromName(goal.exercise))) {
      goal.exercise = to;
      changed++;
    }
  }
  return changed;
}

/**
 * Machine calibrations are keyed by a loose form of the exercise name; move
 * them to the new name, keeping the most confident one where two collide.
 */
export function renameInCalibrations<T extends { gymId: string; liftKey: string; confidence?: number }>(entries: T[], fromNames: string[], to: string): T[] {
  const from = new Set(fromNames.map(normalizeLiftKey));
  const toKey = normalizeLiftKey(to);
  const result: T[] = [];
  for (const entry of entries) {
    const moved = from.has(entry.liftKey) ? { ...entry, liftKey: toKey } : entry;
    const clash = result.findIndex((e) => e.gymId === moved.gymId && e.liftKey === moved.liftKey);
    if (clash === -1) result.push(moved);
    else if ((moved.confidence ?? 0) > (result[clash].confidence ?? 0)) result[clash] = moved;
  }
  return result;
}

// ─── Likely duplicates ────────────────────────────────────────────────────────

/** Words that don't change which exercise it is ("Barbell Bench Press" = "Bench Press"). */
const FILLER = new Set(['barbell', 'bb', 'flat', 'standard', 'regular', 'normal', 'straight', 'the', 'a', 'with', 'exercise']);

/**
 * A name with case, word order, plurals and filler words ignored. `extraFiller`
 * adds words that don't matter in that context (e.g. "machine" for equipment).
 */
export function looseNameKey(name: string, extraFiller?: Set<string>) {
  return exerciseKeyFromName(name)
    .split(' ')
    .filter((w) => w && !FILLER.has(w) && !extraFiller?.has(w))
    // Plurals and hyphen splits: "curls" = "curl", "pull ups" = "pullup".
    .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w))
    .sort()
    .join('')
    .replace(/s$/, '');
}

/** Groups of your exercises that are probably the same thing under different names. */
export function likelyDuplicates(library: Exercise[]): Exercise[][] {
  const groups = new Map<string, Exercise[]>();
  for (const exercise of library) {
    const key = looseNameKey(exercise.name);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) || []), exercise]);
  }
  return [...groups.values()].filter((group) => group.length > 1);
}

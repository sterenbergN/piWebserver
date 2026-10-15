import { liftFromName } from './catalog';
import { newRecordId } from './stations';
import type { Gym, Lift, ProgressionProfile, StationType } from './types';

// Your exercise library. A lift lives on one piece of equipment in one gym;
// the *exercise* is what it is ("Bench Press"), wherever you do it. Lifts are
// the same exercise when their exercise names match, so history, PRs and
// plateaus follow the exercise from gym to gym. By default a lift's exercise is
// its own name; `lift.exercise` overrides that, which keeps history linked
// after a rename and lets "Bench" at home count as "Bench Press" elsewhere.

type ExerciseNamed = { name?: string; exercise?: string } | null | undefined;

/** The exercise a lift (or a saved liftMeta entry) counts as. */
export function exerciseName(lift: ExerciseNamed): string {
  return (lift?.exercise || '').trim() || (lift?.name || '').trim();
}

/** Comparison key for an exercise name: case, spacing and punctuation don't matter. */
export function exerciseKeyFromName(name: string): string {
  return (name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function exerciseKey(lift: ExerciseNamed): string {
  return exerciseKeyFromName(exerciseName(lift));
}

/** Where an exercise is set up: one lift on one piece of equipment. */
export type ExerciseUse = { gymId: string; gymName: string; stationId: string; stationName: string; stationType: StationType; liftId: string; liftName: string };

export type Exercise = {
  key: string;
  name: string;
  primaryMuscle: string;
  secondaryMuscle: string;
  singleArmLeg: boolean;
  progressionProfile: ProgressionProfile;
  uses: ExerciseUse[];
};

/** Every exercise across the given gyms (pass only your own), A–Z. */
export function exerciseLibrary(gyms: Gym[]): Exercise[] {
  const byKey = new Map<string, Exercise>();
  for (const gym of gyms) {
    for (const station of gym.stations || []) {
      for (const lift of station.lifts || []) {
        const key = exerciseKey(lift);
        if (!key) continue;
        let entry = byKey.get(key);
        if (!entry) {
          entry = {
            key,
            name: exerciseName(lift),
            primaryMuscle: lift.primaryMuscle,
            secondaryMuscle: lift.secondaryMuscle || 'None',
            singleArmLeg: lift.singleArmLeg === true,
            progressionProfile: lift.progressionProfile || 'standard',
            uses: [],
          };
          byKey.set(key, entry);
        }
        entry.uses.push({ gymId: gym.id, gymName: gym.name, stationId: station.id, stationName: station.name, stationType: station.type, liftId: lift.id, liftName: lift.name });
      }
    }
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** A new lift for an exercise you already do, with your muscles/profile for it. */
export function liftFromExercise(exercise: Exercise, extra: Partial<Lift> = {}): Lift {
  return {
    id: newRecordId(),
    name: exercise.name,
    primaryMuscle: exercise.primaryMuscle,
    secondaryMuscle: exercise.secondaryMuscle,
    singleArmLeg: exercise.singleArmLeg,
    progressionProfile: exercise.progressionProfile,
    ...extra,
  };
}

/** A lift for a typed name: your own exercise of that name if you have one, else the catalog's best guess. */
export function liftFromNameOrLibrary(name: string, library: Exercise[], extra: Partial<Lift> = {}): Lift {
  const key = exerciseKeyFromName(name);
  const known = library.find((e) => e.key === key);
  return known ? liftFromExercise(known, extra) : liftFromName(name, extra);
}

/**
 * Your exercises worth offering for a piece of equipment: ones you do on the
 * same kind of equipment elsewhere, minus what it already has.
 */
export function libraryExercisesFor(station: { type: StationType; lifts?: Lift[] }, library: Exercise[]): Exercise[] {
  const have = new Set((station.lifts || []).map(exerciseKey));
  return library.filter((e) => !have.has(e.key) && e.uses.some((u) => u.stationType === station.type));
}

type HistoryLike = { timestamp?: string; gymId?: string; gymName?: string; isDeload?: boolean; logs?: Record<string, any[] | undefined>; liftMeta?: Record<string, ExerciseNamed> };

/** Lift ids in a saved workout that are this exercise. */
export function liftIdsForExercise(workout: HistoryLike, key: string, liftId?: string): string[] {
  return Object.keys(workout.logs || {}).filter((id) => id === liftId || (!!key && exerciseKey(workout.liftMeta?.[id]) === key));
}

/**
 * The most recent workout with this lift — the same lift first (same gym and
 * machine, so its weights compare directly), else the same exercise anywhere.
 * Non-deload sessions are preferred so a light week isn't the baseline.
 */
export function lastSessionForLift<T extends HistoryLike>(history: T[] | undefined, lift: { id: string } & ExerciseNamed) {
  const newestFirst = [...(history || [])].sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime());
  const pick = (ids: (w: T) => string[]) => {
    const withLift = newestFirst.filter((w) => ids(w).some((id) => (w.logs?.[id] || []).length > 0));
    const workout = withLift.find((w) => !w.isDeload) || withLift[0];
    return workout ? { workout, sets: ids(workout).flatMap((id) => workout.logs?.[id] || []), sameLift: false } : null;
  };
  const same = pick((w) => (w.logs?.[lift.id] ? [lift.id] : []));
  if (same) return { ...same, sameLift: true };
  const key = exerciseKey(lift);
  return key ? pick((w) => liftIdsForExercise(w, key).filter((id) => id !== lift.id)) : null;
}

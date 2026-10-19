import { getWorkoutData, updateWorkoutData } from './data';
import { clamp, normalizeLiftKey, areLiftKeysSimilar } from './calibration-utils';
import { exerciseKey, exerciseName } from './exercises';


export type CalibrationReference = {
  fromGymId: string;
  fromGymName?: string;
  fromLiftId?: string;
  fromWeight?: number;
  fromReps?: number;
  fromE1RM?: number;
  currentWeight?: number;
  currentReps?: number;
  currentE1RM?: number;
};

export type CalibrationEntry = {
  userId: string;
  gymId: string;
  liftKey: string;
  stationType: string;
  scaleFactor: number;
  confidence: number;
  updatedAt: string;
  reference?: CalibrationReference;
};

export type CalibrationStore = { calibrations: CalibrationEntry[] };

const CALIBRATION_FILE = 'calibration.json';
export const MIN_SCALE_FACTOR = 0.6;
export const MAX_SCALE_FACTOR = 1.6;

export async function getCalibrationStore(): Promise<CalibrationStore> {
  const store = await getWorkoutData<CalibrationStore>(CALIBRATION_FILE, { calibrations: [] });
  if (!Array.isArray(store.calibrations)) store.calibrations = [];
  return store;
}

export function inferScaleFactor(prevE1RMNormalized: number, currE1RMRaw: number): number | null {
  if (!prevE1RMNormalized || !currE1RMRaw) return null;
  const raw = prevE1RMNormalized / currE1RMRaw;
  if (!Number.isFinite(raw) || raw <= 0) return null;
  return clamp(raw, MIN_SCALE_FACTOR, MAX_SCALE_FACTOR);
}

/**
 * Find the calibration for a lift at a gym. Exact lift-key match first, then a
 * fuzzy fallback so "Machine Chest Press" ↔ "Chest Press" share a calibration.
 * This is the single lookup used everywhere so all callers agree.
 */
export function findCalibration(
  store: CalibrationStore,
  userId: string,
  gymId: string,
  liftNameOrKey: string,
): CalibrationEntry | null {
  const liftKey = normalizeLiftKey(liftNameOrKey);
  if (!liftKey) return null;
  const candidates = store.calibrations.filter(c => c.userId === userId && c.gymId === gymId);
  return candidates.find(c => c.liftKey === liftKey)
    || candidates.find(c => areLiftKeysSimilar(c.liftKey, liftKey))
    || null;
}

export async function getCalibrationEntry(userId: string, gymId: string, liftName: string): Promise<CalibrationEntry | null> {
  return findCalibration(await getCalibrationStore(), userId, gymId, liftName);
}

function sanitizeEntry(entry: CalibrationEntry): CalibrationEntry {
  const scaleFactor = Number.isFinite(entry.scaleFactor) ? entry.scaleFactor : 1;
  const confidence = Number.isFinite(entry.confidence) ? entry.confidence : 0.5;
  return {
    ...entry,
    liftKey: normalizeLiftKey(entry.liftKey),
    scaleFactor: clamp(scaleFactor, MIN_SCALE_FACTOR, MAX_SCALE_FACTOR),
    confidence: clamp(confidence, 0, 1),
  };
}

export async function upsertCalibrationEntries(entries: CalibrationEntry[]): Promise<CalibrationEntry[]> {
  if (entries.length === 0) return [];
  const sanitized = entries.map(sanitizeEntry);
  await updateWorkoutData<CalibrationStore>(CALIBRATION_FILE, { calibrations: [] }, (store) => {
    if (!Array.isArray(store.calibrations)) store.calibrations = [];
    for (const entry of sanitized) {
      const idx = store.calibrations.findIndex(c => c.userId === entry.userId && c.gymId === entry.gymId && c.liftKey === entry.liftKey);
      if (idx >= 0) store.calibrations[idx] = entry;
      else store.calibrations.push(entry);
    }
  });
  return sanitized;
}

export async function upsertCalibrationEntry(entry: CalibrationEntry): Promise<CalibrationEntry> {
  const [saved] = await upsertCalibrationEntries([entry]);
  return saved;
}

type HistoryWorkout = {
  userId?: string;
  gymId?: string;
  gymName?: string;
  timestamp?: string;
  logs?: Record<string, { weight: number; reps: number }[]>;
  liftMeta?: Record<string, { name?: string; exercise?: string; stationType?: string; stationId?: string }>;
};

/** The lift to find at another gym: its calibration key, and its exercise and machine kind when known. */
export type ReferenceTarget = { liftKey: string; exerciseKey?: string; kindKey?: string };

/**
 * The most recent session of a lift at another gym (pass the history newest
 * first), with its last set. When the machine kinds are known (`stationKinds`:
 * station id → kind key, see stationKindIndex), the same exercise on the same
 * kind of machine wins — "Row" on the Row Machine, not on the cable row —
 * falling back to any lift with the same name.
 */
export function findReferenceLift<T extends HistoryWorkout>(
  otherGymHistory: T[],
  target: ReferenceTarget,
  stationKinds?: Map<string, string>,
): { workout: T; liftId: string; lastSet: { weight: number; reps: number } } | null {
  type Meta = NonNullable<HistoryWorkout['liftMeta']>[string];
  const sameName = (meta: Meta) => normalizeLiftKey(exerciseName(meta)) === target.liftKey;
  const sameKind = (meta: Meta) => {
    const kind = meta?.stationId ? stationKinds?.get(meta.stationId) : undefined;
    return !!kind && kind === target.kindKey && (sameName(meta) || (!!target.exerciseKey && exerciseKey(meta) === target.exerciseKey));
  };
  const passes = target.kindKey && stationKinds?.size ? [sameKind, sameName] : [sameName];
  for (const matches of passes) {
    for (const workout of otherGymHistory) {
      const metaMap = workout.liftMeta || {};
      for (const liftId of Object.keys(metaMap)) {
        if (!matches(metaMap[liftId])) continue;
        const sets = workout.logs?.[liftId] || [];
        const lastSet = sets[sets.length - 1];
        if (lastSet) return { workout, liftId, lastSet };
      }
    }
  }
  return null;
}

/**
 * For stack/cable lifts done at a gym for the first time, infer a scale factor
 * from the most recent session of the same lift at another gym (pin-loaded
 * stacks rarely weigh the same between brands). `stationKinds` (see
 * stationKindIndex) prefers that lift on the same kind of machine.
 */
export function inferCalibrationsForWorkout(
  userId: string,
  workout: HistoryWorkout,
  previousUserHistory: HistoryWorkout[],
  store: CalibrationStore,
  calcE1RM: (weight: number, reps: number) => number,
  stationKinds?: Map<string, string>,
): CalibrationEntry[] {
  const gymId = workout.gymId;
  if (!gymId || !workout.logs) return [];

  const liftMeta = workout.liftMeta || {};
  const otherGymHistory = previousUserHistory
    .filter(h => h.gymId && h.gymId !== gymId && h.liftMeta && h.logs)
    .sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime());

  const entries: CalibrationEntry[] = [];
  const handledKeys = new Set<string>();

  for (const liftId of Object.keys(workout.logs)) {
    const meta = liftMeta[liftId];
    const liftName = exerciseName(meta);
    const stationType = meta?.stationType;
    if (!liftName || (stationType !== 'stack' && stationType !== 'cable')) continue;

    const liftKey = normalizeLiftKey(liftName);
    if (!liftKey || handledKeys.has(liftKey)) continue;
    handledKeys.add(liftKey);
    if (findCalibration(store, userId, gymId, liftKey)) continue;

    const currentSets = workout.logs[liftId] || [];
    const currentLastSet = currentSets[currentSets.length - 1];
    if (!currentLastSet) continue;
    const currentE1RM = calcE1RM(currentLastSet.weight, currentLastSet.reps);

    const found = findReferenceLift(otherGymHistory, {
      liftKey,
      exerciseKey: exerciseKey(meta),
      kindKey: meta?.stationId ? stationKinds?.get(meta.stationId) : undefined,
    }, stationKinds);
    const reference = found && {
      gymId: found.workout.gymId as string,
      gymName: found.workout.gymName,
      liftId: found.liftId,
      weight: found.lastSet.weight,
      reps: found.lastSet.reps,
      e1rm: calcE1RM(found.lastSet.weight, found.lastSet.reps),
    };
    if (!reference) continue;

    const prevScale = findCalibration(store, userId, reference.gymId, liftKey)?.scaleFactor || 1;
    const scaleFactor = inferScaleFactor(reference.e1rm * prevScale, currentE1RM);
    if (!scaleFactor) continue;

    entries.push({
      userId,
      gymId,
      liftKey,
      stationType,
      scaleFactor,
      confidence: 0.35,
      updatedAt: new Date().toISOString(),
      reference: {
        fromGymId: reference.gymId,
        fromGymName: reference.gymName,
        fromLiftId: reference.liftId,
        fromWeight: reference.weight,
        fromReps: reference.reps,
        fromE1RM: reference.e1rm,
        currentWeight: currentLastSet.weight,
        currentReps: currentLastSet.reps,
        currentE1RM,
      },
    });
  }

  return entries;
}

/**
 * After a saved workout's sets are edited: redo the machine calibrations that
 * were inferred from it (the first visit to a gym's machine), so a corrected
 * set doesn't leave a wrong scale behind. Hand-set calibrations are kept.
 */
export function recalibrateAfterEdit(
  userId: string,
  before: HistoryWorkout,
  after: HistoryWorkout,
  previousUserHistory: HistoryWorkout[],
  store: CalibrationStore,
  calcE1RM: (weight: number, reps: number) => number,
  stationKinds?: Map<string, string>,
): CalibrationEntry[] {
  if (!before.gymId) return [];
  const lastSetByKey = new Map<string, { weight: number; reps: number }>();
  for (const [liftId, sets] of Object.entries(before.logs || {})) {
    const key = normalizeLiftKey(exerciseName(before.liftMeta?.[liftId]));
    const last = sets?.[sets.length - 1];
    if (key && last) lastSetByKey.set(key, last);
  }
  const derived = (c: CalibrationEntry) => {
    const last = lastSetByKey.get(c.liftKey);
    return c.userId === userId && c.gymId === before.gymId && c.confidence === 0.35 && !!last && !!c.reference
      && c.reference.currentWeight === last.weight && c.reference.currentReps === last.reps;
  };
  const stale = store.calibrations.filter(derived);
  if (stale.length === 0) return [];
  const staleKeys = new Set(stale.map((c) => c.liftKey));
  const without = { ...store, calibrations: store.calibrations.filter((c) => !derived(c)) };
  return inferCalibrationsForWorkout(userId, after, previousUserHistory, without, calcE1RM, stationKinds)
    .filter((entry) => staleKeys.has(entry.liftKey));
}

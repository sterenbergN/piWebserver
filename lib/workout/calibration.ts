import { getWorkoutData, updateWorkoutData } from './data';
import { clamp, normalizeLiftKey, areLiftKeysSimilar } from './calibration-utils';


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
  liftMeta?: Record<string, { name?: string; stationType?: string }>;
};

/**
 * For stack/cable lifts done at a gym for the first time, infer a scale factor
 * from the most recent session of the same lift at another gym (pin-loaded
 * stacks rarely weigh the same between brands).
 */
export function inferCalibrationsForWorkout(
  userId: string,
  workout: HistoryWorkout,
  previousUserHistory: HistoryWorkout[],
  store: CalibrationStore,
  calcE1RM: (weight: number, reps: number) => number,
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
    const liftName = meta?.name;
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

    let reference: { gymId: string; gymName?: string; liftId: string; weight: number; reps: number; e1rm: number } | null = null;
    for (const entry of otherGymHistory) {
      const metaMap = entry.liftMeta || {};
      const matchedLiftId = Object.keys(metaMap).find(key => normalizeLiftKey(metaMap[key]?.name || '') === liftKey);
      if (!matchedLiftId) continue;
      const sets = entry.logs?.[matchedLiftId] || [];
      const lastSet = sets[sets.length - 1];
      if (!lastSet) continue;
      reference = {
        gymId: entry.gymId as string,
        gymName: entry.gymName,
        liftId: matchedLiftId,
        weight: lastSet.weight,
        reps: lastSet.reps,
        e1rm: calcE1RM(lastSet.weight, lastSet.reps),
      };
      break;
    }
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

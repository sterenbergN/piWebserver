import { getWorkoutData, saveWorkoutData } from './data';
import { clamp, normalizeLiftKey } from './calibration-utils';

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

type CalibrationStore = { calibrations: CalibrationEntry[] };

export async function getCalibrationStore(): Promise<CalibrationStore> {
  return getWorkoutData('calibration.json', { calibrations: [] as CalibrationEntry[] });
}

export async function saveCalibrationStore(store: CalibrationStore): Promise<boolean> {
  return saveWorkoutData('calibration.json', store);
}

export function inferScaleFactor(prevE1RMNormalized: number, currE1RMRaw: number): number | null {
  if (!prevE1RMNormalized || !currE1RMRaw) return null;
  const raw = prevE1RMNormalized / currE1RMRaw;
  if (!Number.isFinite(raw) || raw <= 0) return null;
  return clamp(raw, 0.6, 1.6);
}

export async function getCalibrationEntry(userId: string, gymId: string, liftName: string): Promise<CalibrationEntry | null> {
  const store = await getCalibrationStore();
  const liftKey = normalizeLiftKey(liftName);
  return store.calibrations.find(c => c.userId === userId && c.gymId === gymId && c.liftKey === liftKey) || null;
}

export async function upsertCalibrationEntry(entry: CalibrationEntry): Promise<CalibrationEntry> {
  const store = await getCalibrationStore();
  const idx = store.calibrations.findIndex(c => c.userId === entry.userId && c.gymId === entry.gymId && c.liftKey === entry.liftKey);
  if (idx >= 0) store.calibrations[idx] = entry;
  else store.calibrations.push(entry);
  await saveCalibrationStore(store);
  return entry;
}

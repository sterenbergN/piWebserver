import { getWorkoutData, updateWorkoutData } from '@/lib/workout/data';

type WorkoutHistoryItem = Record<string, any>;
export type HistoryData = { history: WorkoutHistoryItem[] };

export const HISTORY_FILE = 'history.json';

export function isCardioHistoryItem(entry: WorkoutHistoryItem) {
  return entry?.type?.name === 'Cardio';
}

export function removeCardioHistoryEntries<T extends { history: WorkoutHistoryItem[] }>(data: T): {
  changed: boolean;
  data: T;
} {
  const filteredHistory = data.history.filter((entry) => !isCardioHistoryItem(entry));
  return {
    changed: filteredHistory.length !== data.history.length,
    data: {
      ...data,
      history: filteredHistory,
    },
  };
}

/** Load all workout history, cleaning up legacy cardio entries once if present. */
export async function loadHistoryData(): Promise<HistoryData> {
  const raw = await getWorkoutData<HistoryData>(HISTORY_FILE, { history: [] });
  if (!Array.isArray(raw.history)) raw.history = [];
  const { data, changed } = removeCardioHistoryEntries(raw);
  if (!changed) return data;

  return updateWorkoutData<HistoryData, HistoryData>(HISTORY_FILE, { history: [] }, (current) => {
    current.history = removeCardioHistoryEntries({ history: current.history || [] }).data.history;
    return current;
  });
}

export async function loadUserHistory(userId: string) {
  const data = await loadHistoryData();
  return data.history
    .filter((entry) => entry.userId === userId)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

// ─── Payload sanitizing ────────────────────────────────────────────────────────

function finiteNumber(value: unknown): number | undefined {
  const parsed = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : undefined;
}

function optionalString(value: unknown, maxLength = 200): string | undefined {
  return typeof value === 'string' ? value.slice(0, maxLength) : undefined;
}

function sanitizeSet(raw: any) {
  const weight = finiteNumber(raw?.weight);
  const reps = finiteNumber(raw?.reps);
  if (weight === undefined || reps === undefined || weight < 0 || reps < 0) return null;

  const set: Record<string, any> = { weight, reps: Math.round(reps), completed: true };
  const plannedWeight = finiteNumber(raw?.plannedWeight);
  const plannedReps = finiteNumber(raw?.plannedReps);
  const rir = finiteNumber(raw?.rir);
  const timestamp = finiteNumber(raw?.timestamp);
  if (plannedWeight !== undefined) set.plannedWeight = plannedWeight;
  if (plannedReps !== undefined) set.plannedReps = Math.round(plannedReps);
  if (rir !== undefined) set.rir = Math.max(0, Math.min(10, rir));
  if (timestamp !== undefined) set.timestamp = timestamp;
  return set;
}

/**
 * Whitelist and validate a workout sent by the client before it is stored.
 * Previously the raw request body was spread into history.json as-is.
 */
export function sanitizeWorkoutPayload(payload: Record<string, any>) {
  const logs: Record<string, any[]> = {};
  if (payload.logs && typeof payload.logs === 'object' && !Array.isArray(payload.logs)) {
    for (const [liftId, sets] of Object.entries(payload.logs)) {
      if (!Array.isArray(sets)) continue;
      const cleanSets = sets.map(sanitizeSet).filter(Boolean) as any[];
      if (cleanSets.length > 0) logs[String(liftId)] = cleanSets;
    }
  }

  const liftMeta: Record<string, any> = {};
  if (payload.liftMeta && typeof payload.liftMeta === 'object') {
    for (const liftId of Object.keys(logs)) {
      const meta = payload.liftMeta[liftId];
      if (!meta || typeof meta !== 'object') continue;
      liftMeta[liftId] = {
        name: optionalString(meta.name),
        stationType: optionalString(meta.stationType, 40),
        stationId: optionalString(meta.stationId, 80),
        primaryMuscle: optionalString(meta.primaryMuscle, 40),
        secondaryMuscle: optionalString(meta.secondaryMuscle, 40),
        supersetId: optionalString(meta.supersetId, 80) || null,
        plannedSets: finiteNumber(meta.plannedSets),
      };
    }
  }

  const timestamp = typeof payload.timestamp === 'string' && !Number.isNaN(Date.parse(payload.timestamp))
    ? new Date(payload.timestamp).toISOString()
    : new Date().toISOString();

  const type = payload.type && typeof payload.type === 'object'
    ? {
        id: optionalString(payload.type.id, 80),
        name: optionalString(payload.type.name),
        muscles: Array.isArray(payload.type.muscles) ? payload.type.muscles.filter((m: unknown) => typeof m === 'string') : [],
        intensity: finiteNumber(payload.type.intensity),
        minReps: finiteNumber(payload.type.minReps),
        maxReps: finiteNumber(payload.type.maxReps),
        sets: finiteNumber(payload.type.sets),
      }
    : undefined;

  return {
    clientId: optionalString(payload.clientId, 80),
    planId: optionalString(payload.planId, 80),
    name: optionalString(payload.name) || 'Workout',
    type,
    duration: optionalString(payload.duration, 20),
    durationSecs: finiteNumber(payload.durationSecs),
    timestamp,
    logs,
    liftMeta,
    calories: finiteNumber(payload.calories),
    volume: finiteNumber(payload.volume),
    gymId: optionalString(payload.gymId, 80),
    gymName: optionalString(payload.gymName),
    // Deload sessions are excluded from progression trends and fatigue.
    isDeload: payload.isDeload === true,
    intensitySlider: finiteNumber(payload.intensitySlider),
  };
}

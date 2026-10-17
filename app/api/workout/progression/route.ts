import { NextResponse } from 'next/server';
import { generateNextWorkout, ProgressionInput, ProgressionProfile, Session, SetLog } from '@/lib/workout/progression';
import { CalibrationStore, findCalibration, findReferenceLift, getCalibrationStore } from '@/lib/workout/calibration';
import { normalizeLiftKey } from '@/lib/workout/calibration-utils';
import { exerciseKeyFromName, exerciseName } from '@/lib/workout/exercises';
import { kindKey, stationKindIndex } from '@/lib/workout/equipment-kinds';
import { getWorkoutData } from '@/lib/workout/data';
import { getPossibleWeights, snapToPossibleWeight } from '@/lib/workout/equipment';
import { loadUserHistory } from '@/lib/workout/history';
import { getAuthenticatedWorkoutUserId } from '@/lib/security/server-auth';
import { ApiError, handleApiError, readJsonObject } from '@/lib/workout/api';

// ─── Helpers ───────────────────────────────────────────────────────────────────

const PROFILES: ProgressionProfile[] = ['standard', 'high-rep', 'endurance'];

function isCalibratedStation(stationType: unknown) {
  return stationType === 'stack' || stationType === 'cable';
}

function toSetLogs(rawSets: any[], scaleFactor: number): SetLog[] {
  return rawSets
    .filter((log) => Number.isFinite(Number(log?.weight)) && Number.isFinite(Number(log?.reps)))
    .map((log) => {
      const weight = Number(log.weight);
      const reps = Number(log.reps);
      const plannedWeight = Number.isFinite(Number(log.plannedWeight)) ? Number(log.plannedWeight) : weight;
      const plannedReps = Number.isFinite(Number(log.plannedReps)) ? Number(log.plannedReps) : reps;
      return {
        plannedReps,
        actualReps: reps,
        plannedWeight: plannedWeight * scaleFactor,
        actualWeight: weight * scaleFactor,
        completed: log.completed !== false,
        rir: typeof log.rir === 'number' && Number.isFinite(log.rir) ? log.rir : undefined,
      };
    });
}

/**
 * Convert raw history logs for a specific lift into Session[] format
 * for the progression engine's history trend analysis.
 * Deload sessions are excluded so they don't skew the trend.
 */
function buildHistorySessions(
  historyData: any[],
  liftId: string,
  liftName: string | undefined,
  calibrationStore: CalibrationStore,
  userId: string
): Session[] {
  const sessions: Session[] = [];
  const liftKey = normalizeLiftKey(liftName || '');

  for (const workout of historyData) {
    if (!workout.logs || workout.isDeload) continue;

    const metaMap = workout.liftMeta || {};
    const matchedLiftIds = new Set<string>();
    if (workout.logs[liftId]) matchedLiftIds.add(liftId);
    if (liftKey) {
      Object.keys(metaMap)
        .filter(id => normalizeLiftKey(exerciseName(metaMap[id])) === liftKey)
        .forEach(id => matchedLiftIds.add(id));
    }

    for (const matchedId of matchedLiftIds) {
      const rawSets = workout.logs[matchedId];
      if (!Array.isArray(rawSets) || rawSets.length === 0) continue;
      const meta = metaMap[matchedId] || {};
      const scaleFactor = workout.gymId && isCalibratedStation(meta.stationType) && liftKey
        ? findCalibration(calibrationStore, userId, workout.gymId, liftKey)?.scaleFactor || 1
        : 1;

      sessions.push({
        liftId,
        timestamp: workout.timestamp || new Date(0).toISOString(),
        plannedSets: Number.isFinite(meta.plannedSets) ? meta.plannedSets : undefined,
        sets: toSetLogs(rawSets, scaleFactor),
      });
    }
  }

  sessions.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  return sessions;
}

/** The last time this lift was done at another gym, preferring the same kind of machine. */
async function findCalibrationReference(userHistory: any[], userId: string, gymId: string, liftKey: string, liftName: string, station: any) {
  const otherHistory = userHistory
    .filter((h: any) => h.gymId && h.gymId !== gymId && h.liftMeta)
    .sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  if (otherHistory.length === 0) return null;

  const gymData = await getWorkoutData('gyms.json', { gyms: [] as any[] });
  const stationKinds = stationKindIndex((gymData.gyms || []).filter((g: any) => g.ownerId === userId));
  const found = findReferenceLift(otherHistory, {
    liftKey,
    exerciseKey: exerciseKeyFromName(liftName),
    kindKey: (station?.id && stationKinds.get(String(station.id))) || kindKey(station) || undefined,
  }, stationKinds);
  return found && {
    referenceGymName: found.workout.gymName,
    referenceWeight: found.lastSet.weight,
    referenceReps: found.lastSet.reps,
  };
}

// ─── POST Handler ──────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  try {
    const payload = await readJsonObject(request);
    const { liftId, liftName, gymId, station, planType, intensity, timeLimitMinutes, progressionProfile, plannedSets, deload } = payload;
    const logs = Array.isArray(payload.logs) ? payload.logs : [];
    if (typeof liftId !== 'string' && typeof liftId !== 'number') {
      throw new ApiError(400, 'liftId is required');
    }
    const liftIdStr = String(liftId);

    // Progression works without login (demo mode) — it just has no history.
    const userId = (await getAuthenticatedWorkoutUserId().catch(() => null)) || undefined;

    const [calibrationStore, userHistory] = await Promise.all([
      getCalibrationStore(),
      userId ? loadUserHistory(userId) : Promise.resolve([] as any[]),
    ]);

    // ── Calibration ──
    const liftKey = normalizeLiftKey(liftName || '');
    let currentScaleFactor = 1;
    let calibrationStatus: 'none' | 'calibrated' | 'calibrating' = 'none';
    let calibrationConfidence = 0;
    let calibrationReference: Awaited<ReturnType<typeof findCalibrationReference>> = null;

    if (userId && gymId && liftKey && isCalibratedStation(station?.type)) {
      const entry = findCalibration(calibrationStore, userId, gymId, liftKey);
      if (entry) {
        currentScaleFactor = entry.scaleFactor || 1;
        calibrationConfidence = entry.confidence || 0;
        calibrationStatus = 'calibrated';
      } else {
        calibrationReference = await findCalibrationReference(userHistory, userId, gymId, liftKey, liftName || '', station);
        calibrationStatus = calibrationReference ? 'calibrating' : 'none';
      }
    }

    // ── Engine input ──
    const typeSets = Math.max(1, Math.round(Number(planType?.sets)) || 3);
    const minReps = Math.max(1, Math.round(Number(planType?.minReps)) || 5);
    const maxReps = Math.max(minReps, Math.round(Number(planType?.maxReps)) || 15);
    const validWeights = getPossibleWeights(station, currentScaleFactor);

    const input: ProgressionInput = {
      lastSession: {
        liftId: liftIdStr,
        timestamp: new Date().toISOString(),
        plannedSets: Number.isFinite(Number(plannedSets)) && Number(plannedSets) > 0 ? Number(plannedSets) : undefined,
        sets: toSetLogs(logs, currentScaleFactor),
      },
      history: userId ? buildHistorySessions(userHistory, liftIdStr, liftName, calibrationStore, userId) : [],
      constraints: {
        minReps,
        maxReps,
        minSets: Math.max(1, typeSets - 1),
        maxSets: typeSets + 1,
        timeLimit: Number(timeLimitMinutes) > 0 ? Number(timeLimitMinutes) : undefined,
      },
      equipment: {
        getValidWeights: () => validWeights,
      },
      intensity: Number.isFinite(Number(intensity)) ? Number(intensity) : 1.0,
      profile: PROFILES.includes(progressionProfile) ? progressionProfile : 'standard',
      deload: deload === true,
      typeIntensity: Number.isFinite(Number(planType?.intensity)) ? Number(planType.intensity) : undefined,
      // The explanation should quote the numbers printed on this gym's machine.
      displayWeight: currentScaleFactor !== 1 ? (w) => w / currentScaleFactor : undefined,
    };

    const plan = generateNextWorkout(input);

    if (currentScaleFactor !== 1) {
      // Convert back to the numbers printed on this gym's machine.
      plan.suggestedWeight = snapToPossibleWeight(plan.suggestedWeight / currentScaleFactor, getPossibleWeights(station));
      if (plan.scoringBreakdown) {
        plan.scoringBreakdown.e1RM /= currentScaleFactor;
        plan.scoringBreakdown.lastE1RM /= currentScaleFactor;
        plan.scoringBreakdown.totalLoad /= currentScaleFactor;
        plan.scoringBreakdown.lastLoad /= currentScaleFactor;
      }
    }

    return NextResponse.json({
      success: true,
      plan,
      calibration: {
        status: calibrationStatus,
        scaleFactor: currentScaleFactor,
        confidence: calibrationConfidence,
        ...calibrationReference,
      },
    });
  } catch (error) {
    return handleApiError(error, 'Progression API error');
  }
}

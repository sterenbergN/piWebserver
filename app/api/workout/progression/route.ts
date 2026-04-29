import { NextResponse } from 'next/server';
import { generateNextWorkout, ProgressionInput, Session, SetLog } from '@/lib/workout/progression';
import { getWorkoutData } from '@/lib/workout/data';
import { calcAverage1RM } from '@/lib/workout/analytics';
import { getCalibrationStore } from '@/lib/workout/calibration';
import { normalizeLiftKey } from '@/lib/workout/calibration-utils';
import { getAuthenticatedWorkoutUserId } from '@/lib/security/server-auth';

// Equipment validity mapper based on station type
function getPossibleWeightsForStation(station: any, scaleFactor = 1): number[] {
    if (!station) return [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50]; 
    if (station.type === 'stack' || station.type === 'cable') {
       const possible: number[] = [];
       const inc = station.increment || 10;
       for (let w = station.minWeight || 10; w <= (station.maxWeight || 300); w += inc) {
           possible.push(w * scaleFactor);
           if (station.additionalWeight) possible.push((w + station.additionalWeight) * scaleFactor);
       }
       return Array.from(new Set(possible)).sort((a,b) => a-b);
    }
    if (station.type === 'dumbbells') return [...(station.dumbbellPairs || [5,10,15,20,25])].sort((a,b)=>a-b);
    if (station.type === 'plates') {
       if (!station.plateSets || station.plateSets.length === 0) return [station.baseWeight || 45];
       const halfWeights = new Set([0]);
       for (const p of station.plateSets) {
            const currentPossible = Array.from(halfWeights);
            for (const w of currentPossible) {
                 halfWeights.add(w + p);
            }
       }
       return Array.from(halfWeights).map(hw => (station.baseWeight || 45) + (hw * 2)).sort((a,b) => a-b);
    }
    if (station.type === 'bodyweight') {
       if (!station.bodyWeightAdditions || station.bodyWeightAdditions.length === 0) return [0]; 
       const additions = station.bodyWeightAdditions.sort((a:number,b:number)=>a-b);
       return [0, ...additions];
    }
    return [0, 5, 10, 15];
}

/**
 * Convert raw history logs for a specific lift into Session[] format
 * for the progression engine's history trend analysis.
 */
function buildHistorySessions(historyData: any[], liftId: string, liftName: string | undefined, calibrationStore: any, userId: string | undefined): Session[] {
    const sessions: Session[] = [];
    const liftKey = normalizeLiftKey(liftName || '');

    for (const workout of historyData) {
        if (!workout.logs) continue;
        if (workout.type?.name === 'Cardio') continue;

        const metaMap = workout.liftMeta || {};
        const matchedLiftIdsSet = new Set<string>();
        if (workout.logs[liftId]) matchedLiftIdsSet.add(liftId);
        if (liftKey && metaMap) {
            for (const id of Object.keys(metaMap)) {
                if (normalizeLiftKey(metaMap[id]?.name || '') === liftKey) {
                    matchedLiftIdsSet.add(id);
                }
            }
        }
        const matchedLiftIds = Array.from(matchedLiftIdsSet);
        if (matchedLiftIds.length === 0) continue;

        for (const matchedId of matchedLiftIds) {
            const rawSets = workout.logs[matchedId];
            if (!rawSets || rawSets.length === 0) continue;
            const stationType = metaMap?.[matchedId]?.stationType;
            let scaleFactor = 1;
            if (userId && workout.gymId && (stationType === 'stack' || stationType === 'cable') && liftKey) {
                const entry = calibrationStore.calibrations.find((c: any) => c.userId === userId && c.gymId === workout.gymId && c.liftKey === liftKey);
                scaleFactor = entry?.scaleFactor || 1;
            }
            const sets: SetLog[] = rawSets.map((log: any) => ({
                plannedReps: log.plannedReps ?? log.reps,
                actualReps: log.reps,
                plannedWeight: (log.plannedWeight ?? log.weight) * scaleFactor,
                actualWeight: log.weight * scaleFactor,
                completed: true,
                rir: typeof log.rir === 'number' ? log.rir : undefined,
            }));

            sessions.push({
                liftId,
                timestamp: workout.timestamp || new Date().toISOString(),
                sets,
            });
        }
    }

    // Sort chronologically
    sessions.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    return sessions;
}

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    
    // Unpack payload
    const { liftId, liftName, gymId, station, logs, planType, intensity, timeLimitMinutes } = payload;
    
    // Build the last session from the provided logs
    const stationType = station?.type;
    const calibrationStore = await getCalibrationStore();
    const liftKey = normalizeLiftKey(liftName || '');
    let currentScaleFactor = 1;
    let calibrationStatus: 'none' | 'calibrated' | 'calibrating' = 'none';
    let calibrationReference: any = null;

    let userId: string | undefined;
    try {
        userId = (await getAuthenticatedWorkoutUserId()) || undefined;
    } catch {}

    let calibrationConfidence = 0;
    if (userId && gymId && liftKey && (stationType === 'stack' || stationType === 'cable')) {
        const entry = calibrationStore.calibrations.find((c: any) => c.userId === userId && c.gymId === gymId && c.liftKey === liftKey);
        if (entry) {
            currentScaleFactor = entry.scaleFactor || 1;
            calibrationConfidence = entry.confidence || 0;
            calibrationStatus = 'calibrated';
        } else {
            calibrationStatus = 'calibrating';
        }
    }

    // Find reference from other gyms for messaging
    if (calibrationStatus === 'calibrating' && userId) {
        const histData = await getWorkoutData('history.json', { history: [] as any[] });
        const userHistory = histData.history.filter((h: any) => h.userId === userId);
        const otherHistory = userHistory
          .filter((h: any) => h.gymId && h.gymId !== gymId && h.liftMeta)
          .sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        for (const entry of otherHistory) {
            const metaMap = entry.liftMeta || {};
            const matchedLiftId = Object.keys(metaMap).find((id) => normalizeLiftKey(metaMap[id]?.name || '') === liftKey);
            if (!matchedLiftId) continue;
            const sets = entry.logs?.[matchedLiftId] || [];
            const lastSet = sets[sets.length - 1];
            if (!lastSet) continue;
            calibrationReference = {
                referenceGymName: entry.gymName,
                referenceWeight: lastSet.weight,
                referenceReps: lastSet.reps
            };
            break;
        }
        if (!calibrationReference) calibrationStatus = 'none';
    }

    const sets: SetLog[] = logs.map((log: any) => ({
       plannedReps: log.plannedReps ?? log.reps,
       actualReps: log.reps,
       plannedWeight: (log.plannedWeight ?? log.weight) * currentScaleFactor,
       actualWeight: log.weight * currentScaleFactor,
       completed: true,
       rir: typeof log.rir === 'number' ? log.rir : undefined,
    }));

    // Fetch real history for this lift to enable trend analysis
    let historySessions: Session[] = [];
    try {
        if (userId) {
            const histData = await getWorkoutData('history.json', { history: [] as any[] });
            const userHistory = histData.history.filter((h: any) => h.userId === userId);
            historySessions = buildHistorySessions(userHistory, liftId, liftName, calibrationStore, userId);
        }
    } catch {
        // Silently fall back to empty history if fetching fails
    }

    const input: ProgressionInput = {
       lastSession: {
           liftId,
           timestamp: new Date().toISOString(),
           sets
       },
       history: historySessions,
       constraints: {
           minReps: planType?.minReps || 5,
           maxReps: planType?.maxReps || 15,
           minSets: Math.max(1, (planType?.sets || 3) - 1),
           maxSets: (planType?.sets || 3) + 1,
           timeLimit: timeLimitMinutes || undefined,
       },
       equipment: {
           getValidWeights: (id) => getPossibleWeightsForStation(station, currentScaleFactor)
       },
       intensity: intensity || 1.0
    };

    const plan = generateNextWorkout(input);
    if (currentScaleFactor !== 1) {
        plan.suggestedWeight = Number((plan.suggestedWeight / currentScaleFactor).toFixed(2));
        if (plan.scoringBreakdown) {
            plan.scoringBreakdown.e1RM = plan.scoringBreakdown.e1RM / currentScaleFactor;
            plan.scoringBreakdown.lastE1RM = plan.scoringBreakdown.lastE1RM / currentScaleFactor;
            plan.scoringBreakdown.totalLoad = plan.scoringBreakdown.totalLoad / currentScaleFactor;
            plan.scoringBreakdown.lastLoad = plan.scoringBreakdown.lastLoad / currentScaleFactor;
        }
    }

    return NextResponse.json({ success: true, plan, calibration: {
        status: calibrationStatus,
        scaleFactor: currentScaleFactor,
        confidence: calibrationConfidence,
        ...calibrationReference
    }});
  } catch (err) {
    console.error("Progression API Error:", err);
    return NextResponse.json({ success: false, message: "Server error" }, { status: 500 });
  }
}

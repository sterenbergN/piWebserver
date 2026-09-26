import { calcAverage1RM, calcBrzycki, calcEpley, calcLombardi, computeMuscleFatigue, type MuscleGroupFatigue } from './analytics';
import { analyzePerformance, computeHistoryTrend, type PerformanceMetrics, type Session } from './progression';
import { normalizeLiftKey } from './calibration-utils';

// Everything the analytics page shows, derived from the user's history in one
// pure pass so the page component only renders.

type SetEntry = { weight: number; reps: number; rir?: number; plannedWeight?: number; plannedReps?: number };
type Workout = {
  id?: string;
  timestamp: string;
  type?: { name?: string };
  calories?: number;
  gymId?: string;
  logs?: Record<string, SetEntry[]>;
  liftMeta?: Record<string, { name?: string; stationType?: string; primaryMuscle?: string }>;
};
type LiftInfo = { id: string; name: string; primaryMuscle?: string; stationType?: string };
type Calibration = { gymId: string; liftKey: string; scaleFactor?: number };

export type OneRMEntry = { liftId: string; name: string; epley: number; brzycki: number; lombardi: number; avg: number; scaleFactor: number };
export type OverloadEntry = {
  liftId: string;
  name: string;
  date: string;
  prevWeight: number; currWeight: number;
  prevReps: number; currReps: number;
  prevSets: number; currSets: number;
  prevLoad: number; currLoad: number;
  overloadRatio: number;
  prevE1RM: number; currE1RM: number;
  intensityRatio: number;
  performanceScore: number;
  performanceMetrics: PerformanceMetrics;
  historyTrend: number;
};

export type AnalyticsData = {
  oneRMs: OneRMEntry[];
  volumeTimeline: { date: string; volume: number; intensity: number; type: string }[];
  calorieTimeline: { date: string; calories: number }[];
  volumeByType: { name: string; avgVolume: number }[];
  overloadTracking: OverloadEntry[];
  muscleVolume: { name: string; volume: number }[];
  trainingDays: Map<string, { setCount: number; lifts: string[] }>;
  prTimeline: { date: string; liftName: string; rm: number; prevRM: number; timestamp: string }[];
  recovery: { muscle: string; lastTrained: string; hoursSince: number }[];
  fatigue: MuscleGroupFatigue[];
};

const shortDate = (timestamp: string) =>
  new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

function topSet<T extends { weight: number; reps: number }>(sets: T[]): T | undefined {
  let best: T | undefined;
  let bestE1RM = -1;
  for (const set of sets) {
    const e1rm = calcAverage1RM(set.weight, set.reps);
    if (e1rm > bestE1RM) {
      best = set;
      bestE1RM = e1rm;
    }
  }
  return best;
}

export function buildAnalyticsData(
  historyInput: Workout[],
  lifts: LiftInfo[],
  calibrations: Calibration[],
  now = Date.now(),
): AnalyticsData {
  const history = [...historyInput]
    .filter((w) => w.type?.name !== 'Cardio' && w.logs)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const liftById = new Map(lifts.map((lift) => [lift.id, lift]));

  // Name recorded with the workout first (survives lift renames/deletion), then gym config.
  const liftName = (workout: Workout, liftId: string) =>
    workout.liftMeta?.[liftId]?.name || liftById.get(liftId)?.name || liftId;
  const liftMuscle = (workout: Workout, liftId: string) =>
    workout.liftMeta?.[liftId]?.primaryMuscle || liftById.get(liftId)?.primaryMuscle || 'Other';

  const calibrationMap = new Map(calibrations.map((c) => [`${c.gymId}|${c.liftKey}`, c.scaleFactor || 1]));
  const scaleFor = (workout: Workout, liftId: string) => {
    const stationType = workout.liftMeta?.[liftId]?.stationType || liftById.get(liftId)?.stationType;
    const key = normalizeLiftKey(liftName(workout, liftId));
    if (!workout.gymId || !key || (stationType !== 'stack' && stationType !== 'cable')) return 1;
    return calibrationMap.get(`${workout.gymId}|${key}`) || 1;
  };

  const bestRM = new Map<string, OneRMEntry>();
  const volumeTimeline: AnalyticsData['volumeTimeline'] = [];
  const calorieTimeline: AnalyticsData['calorieTimeline'] = [];
  const typeTotals = new Map<string, { sum: number; count: number }>();
  const sessionsByLift = new Map<string, { date: string; timestamp: string; sets: SetEntry[]; name: string }[]>();
  const muscleVolume = new Map<string, number>();
  const trainingDays = new Map<string, { setCount: number; lifts: string[] }>();
  const prTimeline: AnalyticsData['prTimeline'] = [];
  const runningMax = new Map<string, number>();
  const muscleLastTrained = new Map<string, number>();

  for (const workout of history) {
    const date = shortDate(workout.timestamp);
    const time = new Date(workout.timestamp).getTime();
    calorieTimeline.push({ date, calories: workout.calories || 0 });

    let workoutVolume = 0;
    let workoutMaxRM = 0;
    let workoutSets = 0;
    const dayLifts: string[] = [];

    for (const [liftId, rawSets] of Object.entries(workout.logs || {})) {
      const scale = scaleFor(workout, liftId);
      const name = liftName(workout, liftId);
      const muscle = liftMuscle(workout, liftId);
      const sets = (rawSets || [])
        .map((s) => ({ ...s, weight: Number(s.weight) * scale, reps: Number(s.reps) }))
        .filter((s) => s.reps > 0);
      if (sets.length === 0) continue;
      dayLifts.push(name);
      workoutSets += sets.length;
      muscleLastTrained.set(muscle, Math.max(muscleLastTrained.get(muscle) || 0, time));

      let liftVolume = 0;
      for (const set of sets) {
        const volume = set.weight * set.reps;
        liftVolume += volume;
        const epley = calcEpley(set.weight, set.reps);
        const brzycki = calcBrzycki(set.weight, set.reps);
        const lombardi = calcLombardi(set.weight, set.reps);
        const avg = (epley + brzycki + lombardi) / 3;
        workoutMaxRM = Math.max(workoutMaxRM, avg);

        if (avg > (bestRM.get(liftId)?.avg || 0)) {
          bestRM.set(liftId, { liftId, name, epley, brzycki, lombardi, avg, scaleFactor: scale });
        }
        const prevMax = runningMax.get(name) || 0;
        if (avg > 0 && avg > prevMax * 1.01) {
          prTimeline.push({ date, liftName: name, rm: Math.round(avg), prevRM: Math.round(prevMax), timestamp: workout.timestamp });
          runningMax.set(name, avg);
        }
      }
      workoutVolume += liftVolume;
      muscleVolume.set(muscle, (muscleVolume.get(muscle) || 0) + liftVolume);

      const weighted = sets.filter((s) => s.weight > 0);
      if (weighted.length > 0) {
        if (!sessionsByLift.has(liftId)) sessionsByLift.set(liftId, []);
        sessionsByLift.get(liftId)!.push({ date, timestamp: workout.timestamp, sets: weighted, name });
      }
    }

    const typeName = workout.type?.name || 'Generic';
    volumeTimeline.push({ date, volume: workoutVolume, intensity: Math.round(workoutMaxRM), type: typeName });
    const totals = typeTotals.get(typeName) || { sum: 0, count: 0 };
    typeTotals.set(typeName, { sum: totals.sum + workoutVolume, count: totals.count + 1 });

    if (workoutSets > 0) {
      const dayKey = new Date(workout.timestamp).toISOString().slice(0, 10);
      const day = trainingDays.get(dayKey) || { setCount: 0, lifts: [] };
      trainingDays.set(dayKey, { setCount: day.setCount + workoutSets, lifts: Array.from(new Set([...day.lifts, ...dayLifts])) });
    }
  }

  // Session-over-session overload for every lift with 2+ sessions, compared on
  // each session's top set (a back-off last set would understate progress).
  const overloadTracking: OverloadEntry[] = [];
  for (const [liftId, sessions] of sessionsByLift) {
    if (sessions.length < 2) continue;
    const prev = sessions[sessions.length - 2];
    const curr = sessions[sessions.length - 1];
    const prevTop = topSet(prev.sets);
    const currTop = topSet(curr.sets);
    const prevLoad = prev.sets.reduce((sum, s) => sum + s.weight * s.reps, 0);
    const currLoad = curr.sets.reduce((sum, s) => sum + s.weight * s.reps, 0);
    if (!prevTop || !currTop || prevLoad <= 0 || currLoad <= 0) continue;

    const prevE1RM = calcAverage1RM(prevTop.weight, prevTop.reps);
    const currE1RM = calcAverage1RM(currTop.weight, currTop.reps);
    const toSession = (s: typeof prev): Session => ({
      liftId,
      timestamp: s.timestamp,
      sets: s.sets.map((set) => ({
        plannedReps: set.plannedReps ?? set.reps,
        actualReps: set.reps,
        plannedWeight: set.plannedWeight ?? set.weight,
        actualWeight: set.weight,
        completed: true,
        rir: typeof set.rir === 'number' ? set.rir : undefined,
      })),
    });
    const performanceMetrics = analyzePerformance(toSession(prev));
    overloadTracking.push({
      liftId,
      name: curr.name,
      date: curr.date,
      prevWeight: prevTop.weight, currWeight: currTop.weight,
      prevReps: prevTop.reps, currReps: currTop.reps,
      prevSets: prev.sets.length, currSets: curr.sets.length,
      prevLoad, currLoad,
      overloadRatio: currLoad / prevLoad,
      prevE1RM, currE1RM,
      intensityRatio: prevE1RM > 0 ? currE1RM / prevE1RM : 1,
      performanceScore: performanceMetrics.performanceScore,
      performanceMetrics,
      historyTrend: computeHistoryTrend(sessions.slice(0, -1).map(toSession)),
    });
  }
  // Most recently trained first.
  const lastTime = (entry: OverloadEntry) =>
    new Date(sessionsByLift.get(entry.liftId)!.slice(-1)[0].timestamp).getTime();
  overloadTracking.sort((a, b) => lastTime(b) - lastTime(a));

  return {
    oneRMs: Array.from(bestRM.values()).sort((a, b) => b.avg - a.avg),
    volumeTimeline,
    calorieTimeline,
    volumeByType: Array.from(typeTotals, ([name, t]) => ({ name, avgVolume: Math.round(t.sum / t.count) })),
    overloadTracking,
    muscleVolume: Array.from(muscleVolume, ([name, volume]) => ({ name, volume: Math.round(volume) })).sort((a, b) => b.volume - a.volume),
    trainingDays,
    prTimeline: prTimeline.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()),
    recovery: Array.from(muscleLastTrained, ([muscle, time]) => ({
      muscle,
      lastTrained: shortDate(new Date(time).toISOString()),
      hoursSince: (now - time) / (1000 * 60 * 60),
    })).sort((a, b) => a.hoursSince - b.hoursSince),
    fatigue: computeMuscleFatigue(history, lifts),
  };
}

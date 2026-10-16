import { calcAverage1RM } from './analytics';
import { exerciseName, lastSessionForLift } from './exercises';

// Pure helpers for the workout tracker (app/workout/active): formatting, the
// payload a finished workout is saved with, and the "how did today compare"
// numbers for the finish screen and share card.

export type LoggedSet = { weight: number; reps: number; rir?: number; plannedWeight?: number; plannedReps?: number; timestamp?: number; completed?: boolean };
export type WarmupSet = { weight: number; reps: number };

export type HistoricStats = { prevWeight: number; prevReps: number; prevSets: number; est1RM: number };

/** The progression engine's plan for one lift in the workout. */
export type Suggestion = {
  liftId: string;
  intensity: number;
  weight: number;
  reps: number;
  sets: number;
  reason: string;
  breakdown: any;
  metrics: any;
  candidates: number;
  calibration: any;
  historicStats: HistoricStats | null;
};

export function formatClock(totalSecs: number) {
  return `${Math.floor(totalSecs / 60)}:${String(totalSecs % 60).padStart(2, '0')}`;
}

export function newPlanId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

/** A planned lift's own id within this workout (the same lift can appear twice). */
export const uidOf = (lift: any) => String(lift?.uniquePlanId ?? '');

/** Middle of the workout type's rep range, for a lift with no history. */
export function getBaselineReps(type: any) {
  const min = Number(type?.minReps);
  const max = Number(type?.maxReps);
  return Number.isFinite(min) && Number.isFinite(max) && max >= min ? Math.floor((min + max) / 2) : 10;
}

/** Heaviest set (ties: most reps). */
export function topSet<T extends { weight: number; reps: number }>(sets: T[]): T | null {
  return sets.reduce<T | null>((best, set) =>
    !best || set.weight > best.weight || (set.weight === best.weight && set.reps > best.reps) ? set : best, null);
}

export function workoutTotals(logs: Record<string, LoggedSet[]>) {
  let volume = 0;
  let sets = 0;
  for (const list of Object.values(logs)) {
    for (const set of list || []) {
      volume += (Number(set.weight) || 0) * (Number(set.reps) || 0);
      sets++;
    }
  }
  return { volume, sets };
}

/** Rough calories for strength training (MET 4) at the user's bodyweight. */
export function estimateCalories(elapsedSecs: number, bodyweightLbs?: number) {
  const kg = bodyweightLbs ? bodyweightLbs * 0.453592 : 75;
  return Math.round(4 * kg * (elapsedSecs / 3600));
}

type PlanLike = {
  id: string;
  name: string;
  type?: any;
  gymId?: string;
  gymName?: string;
  isDeload?: boolean;
  programId?: string;
  programDay?: number;
  lifts: any[];
};

/**
 * The workout as it's saved to history: logs keyed by the lift's real id (so
 * history works across workouts), plus what each lift was at the time.
 */
export function buildSavePayload(input: {
  plan: PlanLike;
  logs: Record<string, LoggedSet[]>;
  warmups?: Record<string, WarmupSet[]>;
  targetSets: (lift: any) => number;
  elapsedSecs: number;
  intensity: number;
  bodyweightLbs?: number;
  isDemo: boolean;
  now?: Date;
}) {
  const { plan, logs, warmups = {}, targetSets, elapsedSecs, intensity, bodyweightLbs, isDemo, now = new Date() } = input;
  const exportLogs: Record<string, LoggedSet[]> = {};
  const exportWarmups: Record<string, WarmupSet[]> = {};
  const liftMeta: Record<string, any> = {};
  for (const lift of plan.lifts) {
    const uid = uidOf(lift);
    const liftLogs = logs[uid] || [];
    if (liftLogs.length === 0) continue;
    // The same lift can appear twice (e.g. re-added); merge rather than overwrite.
    exportLogs[lift.id] = [...(exportLogs[lift.id] || []), ...liftLogs];
    if (warmups[uid]?.length) exportWarmups[lift.id] = [...(exportWarmups[lift.id] || []), ...warmups[uid]];
    liftMeta[lift.id] = {
      name: lift.name,
      exercise: exerciseName(lift),
      stationType: lift.station?.type,
      stationId: lift.station?.id,
      primaryMuscle: lift.primaryMuscle,
      secondaryMuscle: lift.secondaryMuscle,
      supersetId: lift.supersetId || null,
      plannedSets: (liftMeta[lift.id]?.plannedSets || 0) + targetSets(lift),
    };
  }
  const { volume } = workoutTotals(exportLogs);
  return {
    clientId: plan.id, // lets the server ignore a duplicate save
    planId: plan.id,
    name: plan.name,
    type: plan.type,
    duration: formatClock(elapsedSecs),
    durationSecs: elapsedSecs,
    timestamp: now.toISOString(),
    logs: exportLogs,
    warmups: exportWarmups,
    calories: estimateCalories(elapsedSecs, bodyweightLbs),
    volume,
    gymId: plan.gymId,
    gymName: plan.gymName,
    liftMeta,
    isDeload: plan.isDeload === true,
    programId: plan.programId,
    programDay: plan.programDay,
    intensitySlider: intensity,
    isDemo,
  };
}

export type LiftComparison = {
  uid: string;
  name: string;
  sets: LoggedSet[];
  top: LoggedSet;
  e1rm: number;
  /** Top set last time this lift (or exercise) was done, if ever. */
  previousTop: { weight: number; reps: number } | null;
  /** 'up' = heavier or more reps than last time, 'down' = less, 'same', or 'new'. */
  change: 'up' | 'same' | 'down' | 'new';
  /** Human summary of the change, e.g. "+5 lbs" or "+2 reps". */
  changeText: string;
};

/** Each lift done today against its last session, for the finish screen. */
export function compareWithLastTime(plan: PlanLike, logs: Record<string, LoggedSet[]>, history: any[] | undefined): LiftComparison[] {
  const result: LiftComparison[] = [];
  for (const lift of plan.lifts) {
    const sets = (logs[uidOf(lift)] || []).filter((s) => Number(s.reps) > 0);
    if (sets.length === 0) continue;
    const top = topSet(sets)!;
    const last = lastSessionForLift(history, lift);
    const previousTop = last ? topSet(last.sets.filter((s: any) => Number(s.reps) > 0)) : null;
    let change: LiftComparison['change'] = 'new';
    let changeText = 'First time';
    if (previousTop) {
      const dw = top.weight - previousTop.weight;
      const dr = top.reps - previousTop.reps;
      const de = calcAverage1RM(top.weight, top.reps) - calcAverage1RM(previousTop.weight, previousTop.reps);
      if (dw === 0 && dr === 0) { change = 'same'; changeText = 'Same as last time'; }
      else if (dw > 0 || (dw === 0 && dr > 0) || (dw !== 0 && de > 0.5)) {
        change = 'up';
        changeText = dw > 0 ? `+${round(dw)} lbs` : dw === 0 ? `+${dr} rep${dr === 1 ? '' : 's'}` : `+${Math.round(de)} lbs e1RM`;
      } else {
        change = 'down';
        changeText = dw < 0 ? `${round(dw)} lbs` : `${dr} rep${dr === -1 ? '' : 's'}`;
      }
    }
    result.push({ uid: uidOf(lift), name: lift.name, sets, top, e1rm: calcAverage1RM(top.weight, top.reps), previousTop: previousTop ? { weight: previousTop.weight, reps: previousTop.reps } : null, change, changeText });
  }
  return result;
}

/** One line on how the session went, e.g. "Up on 3 of 4 lifts". */
export function sessionVerdict(comparisons: LiftComparison[], prCount: number) {
  const compared = comparisons.filter((c) => c.change !== 'new');
  const up = compared.filter((c) => c.change === 'up').length;
  const down = compared.filter((c) => c.change === 'down').length;
  if (prCount > 0) return `${prCount} new personal record${prCount === 1 ? '' : 's'} 🏆`;
  if (compared.length === 0) return 'A new baseline to beat next time.';
  if (up === compared.length) return `Stronger on every lift than last time 💪`;
  if (up > 0) return `Up on ${up} of ${compared.length} lifts vs last time`;
  if (down === 0) return 'Matched last time on every lift.';
  return 'Lighter than last time — recovery counts too.';
}

const round = (n: number) => Math.round(n * 100) / 100;

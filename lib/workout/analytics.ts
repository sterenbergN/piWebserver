import { exerciseKey } from './exercises';

// 1 RM Calculators
// All return 0 for invalid input (0/negative reps or weight) so bad data can't
// produce NaN or Infinity downstream.
function isValidSet(weight: number, reps: number) {
   return Number.isFinite(weight) && Number.isFinite(reps) && weight > 0 && reps > 0;
}

export function calcEpley(weight: number, reps: number) {
   if (!isValidSet(weight, reps)) return 0;
   if (reps === 1) return weight;
   return weight * (1 + reps / 30);
}

export function calcBrzycki(weight: number, reps: number) {
   if (!isValidSet(weight, reps)) return 0;
   if (reps === 1) return weight;
   if (reps >= 37) return weight; // Formula breaks down
   return weight * (36 / (37 - reps));
}

export function calcLombardi(weight: number, reps: number) {
   if (!isValidSet(weight, reps)) return 0;
   if (reps === 1) return weight;
   return weight * Math.pow(reps, 0.10);
}

export function calcAverage1RM(weight: number, reps: number) {
   return (calcEpley(weight, reps) + calcBrzycki(weight, reps) + calcLombardi(weight, reps)) / 3;
}

// Convert lbs to kg
const toKg = (lbs: number) => lbs * 0.453592;
const toCm = (inches: number) => inches * 2.54;

// Wilks Score (Standard formula)
export function calcWilks(totalM1RM_lbs: number, bodyWeightLbs: number, gender: string) {
   const bw = toKg(bodyWeightLbs);
   const m1rm = toKg(totalM1RM_lbs); // Total 1RM of S/B/D in kg

   if (gender === 'male' || gender === 'unspecified') {
      const a = -216.0475144, b = 16.2606339, c = -0.002388645, d = -0.00113732, e = 7.01863E-06, f = -1.291E-08;
      const coeff = 500 / (a + b*bw + c*Math.pow(bw,2) + d*Math.pow(bw,3) + e*Math.pow(bw,4) + f*Math.pow(bw,5));
      return m1rm * coeff;
   } else {
      const a = 594.31747775582, b = -27.23842536447, c = 0.82112226871, d = -0.00930733913, e = 4.731582E-05, f = -9.054E-08;
      const coeff = 500 / (a + b*bw + c*Math.pow(bw,2) + d*Math.pow(bw,3) + e*Math.pow(bw,4) + f*Math.pow(bw,5));
      return m1rm * coeff;
   }
}

// Boer Formula for Lean Body Mass
export function calcBoerLBM(weightLbs: number, heightInches: number, gender: string) {
    if (!weightLbs || !heightInches) return 0;
    const w = toKg(weightLbs);
    const h = toCm(heightInches);

    let lbmKg = 0;
    if (gender === 'male' || gender === 'unspecified') {
       lbmKg = (0.407 * w) + (0.267 * h) - 19.2;
    } else {
       lbmKg = (0.252 * w) + (0.473 * h) - 48.3;
    }
    
    return lbmKg / 0.453592; // Return in lbs
}

export function calcRelativeStrength(oneRM: number, bodyWeight: number) {
    if (!bodyWeight) return 0;
    return oneRM / bodyWeight;
}

export interface ExperienceResult {
  score: number;
  level: "Beginner" | "Novice" | "Intermediate" | "Advanced" | "Elite";
  symbol: string;
  breakdown: {
    time: number;
    consistency: number;
    strength: number;
    progression: number;
  };
  /** Typical strength gain per month (%) behind the progression part, or null without enough data. */
  progressPctPerMonth?: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Each lift's first sessions are the app finding your level (light starting weights), not progress. */
const RAMP_UP_SESSIONS = 3;

/**
 * Typical strength gain per month (%): for each exercise with enough history,
 * its best estimated 1RM over the last three sessions against its best in the
 * three sessions at least three weeks before those, per month between them;
 * the median across exercises. Ramp-up sessions, deloads and sets logged at
 * 5+ reps in reserve (too easy to show how strong you are) are left out, so
 * starting light doesn't read as a big jump.
 */
export function strengthProgressRate(workouts: any[]): { pctPerMonth: number; lifts: number } | null {
  const byExercise = new Map<string, { t: number; e1rm: number }[]>();
  const sorted = [...workouts].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  for (const w of sorted) {
    if (w.isDeload || !w.logs) continue;
    const t = new Date(w.timestamp).getTime();
    for (const [liftId, sets] of Object.entries(w.logs as Record<string, any[]>)) {
      let best = 0;
      for (const set of sets || []) {
        const weight = Number(set.weight);
        const reps = Number(set.reps);
        const rir = typeof set.rir === 'number' ? set.rir : 0;
        if (!(weight > 0) || !(reps > 0) || rir >= 5) continue;
        best = Math.max(best, calcAverage1RM(weight, Math.min(30, reps + Math.max(0, rir))));
      }
      if (best <= 0) continue;
      const key = exerciseKey(w.liftMeta?.[liftId]) || liftId;
      byExercise.set(key, [...(byExercise.get(key) || []), { t, e1rm: best }]);
    }
  }

  const rates: number[] = [];
  for (const sessions of byExercise.values()) {
    const usable = sessions.slice(RAMP_UP_SESSIONS);
    if (usable.length < 4) continue;
    const recent = usable.slice(-3);
    const base = usable.filter((s) => s.t <= recent[0].t - 21 * DAY_MS).slice(-3);
    if (base.length === 0) continue;
    const months = (recent[recent.length - 1].t - base[base.length - 1].t) / (30.44 * DAY_MS);
    if (months < 0.5) continue;
    const recentBest = Math.max(...recent.map((s) => s.e1rm));
    const baseBest = Math.max(...base.map((s) => s.e1rm));
    rates.push(((recentBest / baseBest - 1) / months) * 100);
  }
  if (rates.length === 0) return null;
  rates.sort((a, b) => a - b);
  const mid = Math.floor(rates.length / 2);
  const median = rates.length % 2 ? rates[mid] : (rates[mid - 1] + rates[mid]) / 2;
  return { pctPerMonth: Math.max(-10, Math.min(15, Math.round(median * 10) / 10)), lifts: rates.length };
}

// ─── Fatigue Model ─────────────────────────────────────────────────────────────

export type MuscleGroupFatigue = {
  muscle: string;
  fatigueScore: number;
  threshold: number;
  sessionsSinceStart: number;
  lastTrainedDate: string;
  recommendation: 'ok' | 'elevated' | 'deload_recommended';
};

const FATIGUE_THRESHOLD = 40;
const DECAY_PER_REST_DAY = 0.15;

/**
 * Computes per-muscle-group fatigue from workout history.
 *
 * Formula: fatigue += (1 - avgRIR/5) * setsCompleted * intensityFactor per session
 * Decay:   fatigue *= (1 - 0.15)^restDays between sessions
 * Deload sessions are skipped (no fatigue accumulation).
 */
export function computeMuscleFatigue(
  history: any[],
  allLifts: any[]
): MuscleGroupFatigue[] {
  // Build lift ID → primaryMuscle map
  const liftMuscleMap = new Map<string, string>();
  allLifts.forEach((l: any) => {
    if (l.id && l.primaryMuscle) liftMuscleMap.set(l.id, l.primaryMuscle);
  });

  // Sort history chronologically
  const sorted = [...history]
    .filter((w: any) => w.type?.name !== 'Cardio' && w.logs)
    .sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  // muscle → { fatigue, lastDate, sessions }
  const muscleData = new Map<string, { fatigue: number; lastDate: string; sessions: number }>();
  let prevDate: Date | null = null;

  for (const workout of sorted) {
    const workoutDate = new Date(workout.timestamp);

    // Apply rest-day decay between sessions
    if (prevDate) {
      const restDays = Math.max(
        0,
        (workoutDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24) - 1
      );
      if (restDays > 0) {
        muscleData.forEach(data => {
          data.fatigue *= Math.pow(1 - DECAY_PER_REST_DAY, restDays);
        });
      }
    }
    prevDate = workoutDate;

    // Skip deload sessions — they don't accumulate fatigue
    if (workout.isDeload) continue;

    const intensityFactor = workout.intensitySlider ?? 1.0;

    Object.keys(workout.logs).forEach(liftId => {
      const meta = workout.liftMeta?.[liftId];
      const muscle =
        meta?.primaryMuscle ||
        liftMuscleMap.get(liftId) ||
        'Unknown';

      const sets: any[] = workout.logs[liftId] || [];
      if (sets.length === 0) return;

      const rirSets = sets.filter((s: any) => typeof s.rir === 'number');
      const avgRir =
        rirSets.length > 0
          ? rirSets.reduce((sum: number, s: any) => sum + s.rir, 0) / rirSets.length
          : 2; // neutral if no RIR recorded

      const fatigueDelta = (1 - avgRir / 5) * sets.length * intensityFactor;

      if (!muscleData.has(muscle)) {
        muscleData.set(muscle, { fatigue: 0, lastDate: '', sessions: 0 });
      }
      const data = muscleData.get(muscle)!;
      data.fatigue = Math.max(0, data.fatigue + fatigueDelta);
      data.lastDate = workout.timestamp;
      data.sessions++;
    });
  }

  // Apply decay from the last workout to now
  if (prevDate) {
    const restDays = Math.max(
      0,
      (Date.now() - prevDate.getTime()) / (1000 * 60 * 60 * 24)
    );
    muscleData.forEach(data => {
      data.fatigue *= Math.pow(1 - DECAY_PER_REST_DAY, restDays);
    });
  }

  return Array.from(muscleData.entries())
    .map(([muscle, data]) => ({
      muscle,
      fatigueScore: Math.round(data.fatigue * 100) / 100,
      threshold: FATIGUE_THRESHOLD,
      sessionsSinceStart: data.sessions,
      lastTrainedDate: data.lastDate,
      recommendation:
        data.fatigue >= FATIGUE_THRESHOLD
          ? 'deload_recommended'
          : data.fatigue >= FATIGUE_THRESHOLD * 0.75
          ? 'elevated'
          : 'ok',
    } as MuscleGroupFatigue))
    .sort((a, b) => b.fatigueScore - a.fatigueScore);
}
export function calculateExperienceScore(user: { weight?: number }, history: any[], allLifts: any[]): ExperienceResult {
  if (!history || history.length === 0) {
      return { score: 0, level: "Beginner", symbol: "⚪", breakdown: { time: 0, consistency: 0, strength: 0, progression: 0 }};
  }

  const workouts = history.filter((h: any) => h.type?.name !== 'Cardio' && h.logs && Object.keys(h.logs).length > 0);
  workouts.sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  if (workouts.length === 0) {
      return { score: 0, level: "Beginner", symbol: "⚪", breakdown: { time: 0, consistency: 0, strength: 0, progression: 0 }};
  }

  // 1. Time (T)
  const firstDate = new Date(workouts[0].timestamp).getTime();
  const lastDate = new Date(workouts[workouts.length - 1].timestamp).getTime();
  const diffDays = Math.max(0, (lastDate - firstDate) / (1000 * 60 * 60 * 24));
  const months_trained = diffDays / 30.44;
  const totalWeeksTrained = Math.max(1, diffDays / 7);

  const T_raw = Math.log10(1 + months_trained); 

  // 2. Consistency (C)
  const total_workouts = workouts.length;
  const C_raw = total_workouts / totalWeeksTrained;
  const C = Math.min(Math.max(C_raw, 0), 7);

  // 3. Strength (S)
  const liftMaxes = new Map<string, number>();
  
  workouts.forEach((w: any) => {
      Object.keys(w.logs).forEach(liftId => {
          w.logs[liftId].forEach((set: any) => {
              if (set.weight > 0 && set.reps > 0) {
                  const rm = calcAverage1RM(set.weight, set.reps);
                  if (rm > (liftMaxes.get(liftId) || 0)) liftMaxes.set(liftId, rm);
              }
          });
      });
  });

  // Find SBD or core compounds. Name matches (e.g. "squat") always win over
  // muscle-group fallbacks (e.g. a Quads leg press), regardless of order.
  const liftById = new Map<string, any>(allLifts.map((l: any) => [l.id, l]));
  const pickCompound = (namePattern: RegExp, fallbackMuscle: string) => {
      let best = { max: 0, byName: false };
      liftMaxes.forEach((rm, liftId) => {
          const lift = liftById.get(liftId);
          if (!lift) return;
          const byName = namePattern.test(String(lift.name || '').toLowerCase());
          if (!byName && lift.primaryMuscle !== fallbackMuscle) return;
          const better = byName !== best.byName ? byName : rm > best.max;
          if (better) best = { max: rm, byName };
      });
      return best;
  };

  const squat = pickCompound(/squat/, 'Quads');
  const bench = pickCompound(/bench press/, 'Chest');
  const deadlift = pickCompound(/deadlift/, 'Hamstrings');
  const squatMax = squat.max, benchMax = bench.max, deadliftMax = deadlift.max;

  const bodyweight = user.weight || 150;
  const S_raw = (squatMax + benchMax + deadliftMax) / bodyweight;

  // 4. Progression (P): typical % gained per month, not raw pounds since the
  // first (light, ramp-up) weights. ~5%/month (fast novice gains) ≈ 2.5, capped at 3.
  const progress = strengthProgressRate(workouts);
  const P_raw = progress ? Math.min(3, Math.max(0, progress.pctPerMonth / 2)) : 0;

  // Calculate E
  const E = (0.2 * T_raw) + (0.3 * C) + (0.3 * S_raw) + (0.2 * P_raw);

  let level: "Beginner" | "Novice" | "Intermediate" | "Advanced" | "Elite" = "Beginner";
  let symbol = "⚪";

  if (E >= 8) { level = 'Elite'; symbol = '🟡'; }
  else if (E >= 6) { level = 'Advanced'; symbol = '🟣'; }
  else if (E >= 4) { level = 'Intermediate'; symbol = '🔵'; }
  else if (E >= 2) { level = 'Novice'; symbol = '🟢'; }
  else { level = 'Beginner'; symbol = '⚪'; }

  return {
    score: Number(E.toFixed(2)),
    level,
    symbol,
    breakdown: {
      time: Number(T_raw.toFixed(2)),
      consistency: Number(C.toFixed(2)),
      strength: Number(S_raw.toFixed(2)),
      progression: Number(P_raw.toFixed(2))
    },
    progressPctPerMonth: progress ? progress.pctPerMonth : null,
  };
}

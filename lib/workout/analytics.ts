// 1 RM Calculators
export function calcEpley(weight: number, reps: number) {
   if (reps === 1) return weight;
   return weight * (1 + reps / 30);
}

export function calcBrzycki(weight: number, reps: number) {
   if (reps === 1) return weight;
   if (reps >= 37) return weight; // Formula breaks down
   return weight * (36 / (37 - reps));
}

export function calcLombardi(weight: number, reps: number) {
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
  
  const firstMonthEnd = firstDate + (30.44 * 24 * 60 * 60 * 1000);
  const initialMaxes = new Map<string, number>();
  const currentMaxes = new Map<string, number>();

  workouts.forEach((w: any) => {
      const isFirstMonth = new Date(w.timestamp).getTime() <= firstMonthEnd;
      Object.keys(w.logs).forEach(liftId => {
          w.logs[liftId].forEach((set: any) => {
              if (set.weight > 0 && set.reps > 0) {
                  const rm = calcAverage1RM(set.weight, set.reps);
                  if (rm > (liftMaxes.get(liftId) || 0)) liftMaxes.set(liftId, rm);
                  if (isFirstMonth) {
                      if (rm > (initialMaxes.get(liftId) || 0)) initialMaxes.set(liftId, rm);
                  }
                  if (rm > (currentMaxes.get(liftId) || 0)) currentMaxes.set(liftId, rm);
              }
          });
      });
  });

  // Find SBD or core compounds
  let squatMax = 0, benchMax = 0, deadliftMax = 0;
  let initialSquatMax = 0, initialBenchMax = 0, initialDeadliftMax = 0;

  liftMaxes.forEach((rm, liftId) => {
      const lift = allLifts.find(l => l.id === liftId);
      if (lift) {
          const name = lift.name.toLowerCase();
          const pm = lift.primaryMuscle;
          
          if (name.includes('squat') && rm > squatMax) { squatMax = rm; initialSquatMax = initialMaxes.get(liftId) || 0; }
          else if (!squatMax && pm === 'Quads' && rm > squatMax) { squatMax = rm; initialSquatMax = initialMaxes.get(liftId) || 0; }

          if (name.includes('bench press') && rm > benchMax) { benchMax = rm; initialBenchMax = initialMaxes.get(liftId) || 0; }
          else if (!benchMax && pm === 'Chest' && rm > benchMax) { benchMax = rm; initialBenchMax = initialMaxes.get(liftId) || 0; }

          if (name.includes('deadlift') && rm > deadliftMax) { deadliftMax = rm; initialDeadliftMax = initialMaxes.get(liftId) || 0; }
          else if (!deadliftMax && pm === 'Hamstrings' && rm > deadliftMax) { deadliftMax = rm; initialDeadliftMax = initialMaxes.get(liftId) || 0; }
      }
  });

  const bodyweight = user.weight || 150;
  const S_raw = (squatMax + benchMax + deadliftMax) / bodyweight;

  // 4. Progression (P)
  const initialTotal = initialSquatMax + initialBenchMax + initialDeadliftMax;
  const currentTotal = squatMax + benchMax + deadliftMax;
  let P_raw = 0;
  if (months_trained > 0 && initialTotal > 0) {
      P_raw = Math.max(0, (currentTotal - initialTotal) / months_trained);
  }

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
    }
  };
}

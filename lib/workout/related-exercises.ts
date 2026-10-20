import { calcAverage1RM } from './analytics';
import { exerciseKeyFromName, exerciseName } from './exercises';

// A first-time lift's starting weight from a related one you already do —
// Dumbbell Bench Press from Bench Press, Front Squat from Back Squat — so a
// new exercise doesn't start at the bottom of the rack. Factors are rough
// strength ratios to each family's main lift (dumbbell lifts per hand).

type Variant = { family: string; factor: number };

const VARIANTS: [RegExp, Variant | null][] = [
  [/straight arm|face pull|rear delt|calf|shrug|crunch|plank|raise leg|leg raise/, null],
  [/incline (dumbbell|db)|(dumbbell|db) incline/, { family: 'press', factor: 0.33 }],
  [/(dumbbell|db) (bench|chest|press$)/, { family: 'press', factor: 0.38 }],
  [/incline .*(bench|press)/, { family: 'press', factor: 0.82 }],
  [/close grip bench/, { family: 'press', factor: 0.9 }],
  [/chest press/, { family: 'press', factor: 0.9 }],
  [/bench/, { family: 'press', factor: 1 }],
  [/(dumbbell|db) (shoulder|overhead) press|arnold/, { family: 'overhead', factor: 0.38 }],
  [/shoulder press|overhead press|military press/, { family: 'overhead', factor: 1 }],
  [/front squat/, { family: 'squat', factor: 0.82 }],
  [/goblet/, { family: 'squat', factor: 0.35 }],
  [/hack squat/, { family: 'squat', factor: 1.1 }],
  [/leg press/, { family: 'squat', factor: 1.8 }],
  [/split squat|lunge/, { family: 'squat', factor: 0.22 }],
  [/squat/, { family: 'squat', factor: 1 }],
  [/(dumbbell|db) (romanian|rdl)/, { family: 'hinge', factor: 0.3 }],
  [/romanian|rdl|stiff leg/, { family: 'hinge', factor: 0.7 }],
  [/hip thrust/, { family: 'hinge', factor: 1 }],
  [/deadlift/, { family: 'hinge', factor: 1 }],
  [/upright row/, null],
  [/(dumbbell|db) row/, { family: 'row', factor: 0.45 }],
  [/row/, { family: 'row', factor: 1 }],
  [/pulldown|pull down/, { family: 'pulldown', factor: 1 }],
  [/leg curl/, { family: 'leg-curl', factor: 1 }],
  [/hammer curl/, { family: 'curl', factor: 0.45 }],
  [/(dumbbell|db) curl/, { family: 'curl', factor: 0.42 }],
  [/preacher/, { family: 'curl', factor: 0.85 }],
  [/cable curl/, { family: 'curl', factor: 0.9 }],
  [/curl/, { family: 'curl', factor: 1 }],
  [/pushdown|push down/, { family: 'triceps', factor: 1 }],
  [/skull/, { family: 'triceps', factor: 0.9 }],
  [/(overhead|french) (tricep|extension)|tricep extension/, { family: 'triceps', factor: 0.8 }],
  [/cable lateral/, { family: 'lateral', factor: 0.6 }],
  [/lateral raise/, { family: 'lateral', factor: 1 }],
  [/cable fly|cable crossover|pec deck|chest fly/, { family: 'fly', factor: 1 }],
];

export function exerciseVariant(name: string): Variant | null {
  const key = exerciseKeyFromName(name);
  if (!key) return null;
  for (const [pattern, variant] of VARIANTS) if (pattern.test(key)) return variant;
  return null;
}

type HistoryLike = { timestamp?: string; isDeload?: boolean; logs?: Record<string, { weight: number; reps: number }[] | undefined>; liftMeta?: Record<string, { name?: string; exercise?: string } | undefined> };

export type RelatedStart = { weight: number; fromName: string; fromE1rm: number };

/**
 * Starting weight for `reps` reps with `rir` in reserve, from the most recent
 * related exercise in history, rounded down to a weight the station has and
 * then a little lighter again — better to start easy and move up.
 */
export function relatedStartingWeight(
  lift: { name?: string; exercise?: string },
  history: HistoryLike[] | undefined,
  { reps, rir = 2, possibleWeights = [] }: { reps: number; rir?: number; possibleWeights?: number[] },
): RelatedStart | null {
  const target = exerciseVariant(exerciseName(lift));
  if (!target) return null;
  const newestFirst = [...(history || [])].filter((w) => !w.isDeload)
    .sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime());
  for (const workout of newestFirst) {
    for (const [liftId, sets] of Object.entries(workout.logs || {})) {
      const name = exerciseName(workout.liftMeta?.[liftId]);
      const variant = name ? exerciseVariant(name) : null;
      if (!variant || variant.family !== target.family) continue;
      const e1rm = Math.max(0, ...(sets || []).filter((s) => Number(s.reps) > 0).map((s) => calcAverage1RM(Number(s.weight) || 0, Number(s.reps))));
      if (e1rm <= 0) continue;
      const targetE1rm = (e1rm / variant.factor) * target.factor;
      const ideal = (targetE1rm / (1 + (reps + rir) / 30)) * 0.9;
      const ladder = [...possibleWeights].sort((a, b) => a - b);
      const fits = ladder.filter((w) => w <= ideal);
      const weight = ladder.length ? (fits.length ? fits[fits.length - 1] : ladder[0]) : Math.max(0, Math.floor(ideal / 5) * 5);
      return { weight, fromName: name, fromE1rm: Math.round(e1rm) };
    }
  }
  return null;
}

// ─── Swapping a lift mid-workout ─────────────────────────────────────────────

const MUSCLE_AREA: Record<string, string> = {
  Chest: 'push', Shoulders: 'push', Triceps: 'push',
  Back: 'pull', Biceps: 'pull',
  Quads: 'legs', Hamstrings: 'legs', Glutes: 'legs', Calves: 'legs',
  Core: 'core',
};

type SwapLift = { name?: string; exercise?: string; primaryMuscle?: string; secondaryMuscle?: string };
export type SwapGroup<T> = { label: string; lifts: T[] };

function musclesOf(lift: SwapLift) {
  return [lift.primaryMuscle, lift.secondaryMuscle].filter((m): m is string => !!m && m !== 'None');
}

/**
 * Every other lift, closest to `current` first: the same movement (bench →
 * chest press), the same main muscle, a shared muscle, the same area of the
 * body (push / pull / legs / core), today's other muscles, then everything
 * else — so any lift can be swapped in, but the likely ones are on top.
 */
export function rankSwapCandidates<T extends SwapLift>(current: SwapLift, candidates: T[], workoutMuscles: string[] = []): SwapGroup<T>[] {
  const family = exerciseVariant(exerciseName(current))?.family;
  const primary = current.primaryMuscle || '';
  const muscles = musclesOf(current);
  const areas = new Set(muscles.map((m) => MUSCLE_AREA[m]).filter(Boolean));
  const areaLabel = areas.size === 1 ? `Other ${[...areas][0]} lifts` : 'Same area of the body';

  const tiers: SwapGroup<T>[] = [
    { label: 'Same movement', lifts: [] },
    { label: primary ? `Also ${primary}` : 'Same muscle', lifts: [] },
    { label: `Works ${muscles.join(' or ') || 'the same muscles'}`, lifts: [] },
    { label: areaLabel, lifts: [] },
    { label: "Today's other muscles", lifts: [] },
    { label: 'Everything else', lifts: [] },
  ];
  const tierOf = (lift: T) => {
    const theirs = musclesOf(lift);
    if (family && exerciseVariant(exerciseName(lift))?.family === family) return 0;
    if (primary && lift.primaryMuscle === primary) return 1;
    if (theirs.some((m) => muscles.includes(m))) return 2;
    if (theirs.some((m) => areas.has(MUSCLE_AREA[m]))) return 3;
    if (theirs.some((m) => workoutMuscles.includes(m))) return 4;
    return 5;
  };
  for (const lift of candidates) tiers[tierOf(lift)].lifts.push(lift);
  for (const tier of tiers) tier.lifts.sort((a, b) => exerciseName(a).localeCompare(exerciseName(b)));
  return tiers.filter((tier) => tier.lifts.length > 0);
}

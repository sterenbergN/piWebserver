import type { FoodSettings } from './types';

// The day's targets. Calories follow the weight plan (its daily calories, or
// what it now says is needed to finish on time) unless you set your own;
// protein follows your latest bodyweight; fat is 30% of calories and carbs
// fill the rest. Optionally the day's active calories from Health go on top.

export const FALLBACK_KCAL = 2000;
const FAT_SHARE = 0.3;

export type TargetInputs = {
  settings: FoodSettings;
  /** The weight plan's daily calories, when there's a plan. */
  planKcal?: number | null;
  /** Calories the plan says would still finish on time. */
  neededKcal?: number | null;
  /** Latest bodyweight in lb. */
  weightLbs?: number | null;
  /** Active calories burned that day (Health / logged workouts). */
  exerciseKcal?: number | null;
};

export type KcalSource = 'custom' | 'plan' | 'needed' | 'default';
export type ProteinSource = 'custom' | 'bodyweight' | 'default';

export type Targets = {
  kcal: number;
  /** Calories before exercise was added. */
  baseKcal: number;
  /** What was added for exercise (0 when off or unknown). */
  exerciseKcal: number;
  protein: number;
  carbs: number;
  fat: number;
  kcalSource: KcalSource;
  proteinSource: ProteinSource;
};

const valid = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;

export function resolveTargets({ settings, planKcal, neededKcal, weightLbs, exerciseKcal }: TargetInputs): Targets {
  let baseKcal: number;
  let kcalSource: KcalSource;
  if (valid(settings.kcalTarget)) { baseKcal = settings.kcalTarget; kcalSource = 'custom'; }
  else if (settings.planTarget === 'needed' && valid(neededKcal)) { baseKcal = Math.round(neededKcal); kcalSource = 'needed'; }
  else if (valid(planKcal)) { baseKcal = Math.round(planKcal); kcalSource = 'plan'; }
  else { baseKcal = FALLBACK_KCAL; kcalSource = 'default'; }

  // Exercise only counts when asked for, and never more than a hard day's worth.
  const added = settings.addExercise && valid(exerciseKcal) ? Math.min(Math.round(exerciseKcal), 2500) : 0;
  const kcal = baseKcal + added;

  let protein: number;
  let proteinSource: ProteinSource;
  if (valid(settings.proteinTarget)) { protein = settings.proteinTarget; proteinSource = 'custom'; }
  else if (valid(weightLbs)) { protein = Math.round(weightLbs * settings.proteinPerLb); proteinSource = 'bodyweight'; }
  else { protein = Math.round((baseKcal * 0.25) / 4); proteinSource = 'default'; }

  const fat = valid(settings.fatTarget) ? settings.fatTarget : Math.round((kcal * FAT_SHARE) / 9);
  const carbs = typeof settings.carbsTarget === 'number' && settings.carbsTarget >= 0
    ? settings.carbsTarget
    : Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
  return { kcal, baseKcal, exerciseKcal: added, protein, carbs, fat, kcalSource, proteinSource };
}

/**
 * Active calories for a day: Health's daily active energy when it has it,
 * otherwise what the watch recorded during that day's logged workouts.
 */
export function exerciseKcalFor(activeKcal: number | undefined, workoutKcals: number[]): number | null {
  if (typeof activeKcal === 'number' && activeKcal > 0) return Math.round(activeKcal);
  const sum = workoutKcals.filter((k) => Number.isFinite(k) && k > 0).reduce((s, k) => s + k, 0);
  return sum > 0 ? Math.round(sum) : null;
}

export const KCAL_SOURCE_LABELS: Record<KcalSource, string> = {
  custom: 'your own target',
  plan: 'your weight plan',
  needed: 'what your plan needs now',
  default: 'a default (set a weight plan or your own)',
};

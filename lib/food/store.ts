import path from 'path';
import { readJson, updateJson } from '@/lib/json-store';
import { ApiError } from '@/lib/workout/api';
import { buildSeededCalculatorDefaults, calculateMifflinStJeor } from '@/lib/workout/calculators';
import { loadBodyweight } from '@/lib/workout/bodyweight';
import { loadUserHealth } from '@/lib/workout/health-store';
import { findWorkoutUser } from '@/lib/workout/users';
import { planProgress, type WeightPlan } from '@/lib/workout/weight-plan';
import { dayTotals, emptyFoodData, normalizeFoodData } from './log';
import { estimateMaintenance } from './maintenance';
import { FOOD_DIR } from './settings';
import { exerciseKcalFor, resolveTargets, type Targets } from './targets';
import type { FoodUserData } from './types';

// One account's food file, and everything around it the Food page shows: the
// weight plan's calories, the latest bodyweight, Health's active calories, and
// the maintenance estimate. Workout data is only read here, never changed.

export function foodUserFile(userId: string) {
  if (!/^[\w-]{1,64}$/.test(userId)) throw new ApiError(400, 'Invalid account');
  return path.join(FOOD_DIR(), 'logs', `${userId}.json`);
}

export async function loadFoodData(userId: string): Promise<FoodUserData> {
  return normalizeFoodData(await readJson(foodUserFile(userId), emptyFoodData()));
}

/** Read → change → write one account's food file under its lock. */
export async function updateFoodData<R>(userId: string, change: (data: FoodUserData) => R): Promise<{ data: FoodUserData; result: R }> {
  return updateJson<Record<string, unknown>, { data: FoodUserData; result: R }>(foodUserFile(userId), {}, (stored) => {
    const data = normalizeFoodData(stored);
    const result = change(data);
    for (const key of Object.keys(stored)) delete stored[key];
    Object.assign(stored, data);
    return { data, result };
  });
}

export type PlanInfo = {
  hasPlan: boolean;
  planKcal: number | null;
  neededKcal: number | null;
  /** The calculator's maintenance for your current weight (from the plan, or your calculator profile). */
  calculatorMaintenance: number | null;
  /** What the plan page's own estimate says (from weigh-ins and the plan's calories). */
  planRealMaintenance: number | null;
  status?: string;
};

export type FoodContext = {
  plan: PlanInfo;
  weighIns: { date: string; weight: number }[];
  latestWeight: number | null;
  /** Active calories by day, where Health or a logged workout knows them. */
  exercise: Record<string, number>;
};

export async function loadFoodContext(userId: string, today: string): Promise<FoodContext> {
  const [user, weighIns, health] = await Promise.all([
    findWorkoutUser(userId).catch(() => null),
    loadBodyweight(userId).catch(() => []),
    loadUserHealth(userId).catch(() => null),
  ]);
  const weights = weighIns.map((e) => ({ date: e.date, weight: e.weight }));
  const latestWeight = weights.length ? weights[weights.length - 1].weight : (typeof user?.weight === 'number' ? user.weight : null);

  const plan: PlanInfo = { hasPlan: false, planKcal: null, neededKcal: null, calculatorMaintenance: null, planRealMaintenance: null };
  if (user) {
    const defaults = buildSeededCalculatorDefaults(user as Record<string, any>);
    const saved: WeightPlan | undefined = defaults.calorie?.plan;
    if (saved) {
      const progress = planProgress(saved, weights, today);
      plan.hasPlan = true;
      plan.planKcal = saved.targetCalories;
      plan.neededKcal = progress.status === 'finished' ? null : progress.neededCalories;
      plan.planRealMaintenance = progress.realMaintenance?.kcal ?? null;
      plan.calculatorMaintenance = progress.realMaintenance?.calculator ?? null;
      plan.status = progress.status;
    }
    const c = defaults.calorie;
    if (plan.calculatorMaintenance === null && c && typeof c.age === 'number' && typeof c.heightInches === 'number' && c.sex) {
      const weight = latestWeight ?? (typeof c.weightLbs === 'number' ? c.weightLbs : null);
      if (weight) {
        plan.calculatorMaintenance = Math.round(calculateMifflinStJeor({ sex: c.sex, age: c.age, heightInches: c.heightInches, weightLbs: weight, activityLevel: c.activityLevel ?? 'moderate' }).maintenanceCalories);
      }
    }
  }

  const exercise: Record<string, number> = {};
  if (health) {
    const workoutKcals: Record<string, number[]> = {};
    for (const w of Object.values(health.workouts || {})) {
      if (!w?.start || !w.kcal) continue;
      const d = new Date(w.start);
      if (Number.isNaN(d.getTime())) continue;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      (workoutKcals[key] ??= []).push(w.kcal);
    }
    for (const key of new Set([...Object.keys(health.days || {}), ...Object.keys(workoutKcals)])) {
      const kcal = exerciseKcalFor(health.days?.[key]?.activeKcal, workoutKcals[key] ?? []);
      if (kcal) exercise[key] = kcal;
    }
  }
  return { plan, weighIns: weights, latestWeight, exercise };
}

export function targetsFor(data: FoodUserData, ctx: FoodContext, date: string): Targets {
  return resolveTargets({
    settings: data.settings,
    planKcal: ctx.plan.planKcal,
    neededKcal: ctx.plan.neededKcal,
    weightLbs: ctx.latestWeight,
    exerciseKcal: ctx.exercise[date] ?? null,
  });
}

/** Maintenance from your logs and weigh-ins, next to the calculator's number. */
export function maintenanceInsight(data: FoodUserData, ctx: FoodContext, today: string) {
  const intake = Object.fromEntries(Object.entries(data.days).map(([date, entries]) => [date, dayTotals(entries).kcal]));
  const { estimate, shortfall } = estimateMaintenance(intake, ctx.weighIns, today);
  return { estimate, shortfall, calculator: ctx.plan.calculatorMaintenance, planEstimate: ctx.plan.planRealMaintenance };
}

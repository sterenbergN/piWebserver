import { calculateMifflinStJeor, type ActivityLevel } from './calculators';

export { normalizePlan } from './calculators';

// A saved weight plan: the calorie calculator's numbers frozen on a start
// date, compared against the weigh-ins that actually happened (typed in or
// from a smart scale). The planned line is the calculator's projection; a
// second projection re-runs the same maths from your current weight to the
// plan's end, and the calories needed to still finish on plan are solved for.

export type WeightPlan = {
  startDate: string; // YYYY-MM-DD
  startWeightLbs: number;
  targetCalories: number;
  goalRate: number; // lb/week the plan was made for (negative = lose)
  weeks: number;
  sex: 'male' | 'female';
  age: number;
  heightInches: number;
  activityLevel: ActivityLevel;
  createdAt?: string;
};

type Profile = Pick<WeightPlan, 'sex' | 'age' | 'heightInches' | 'activityLevel'>;
export type WeighIn = { date: string; weight: number };

const DAY_MS = 86_400_000;
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Whole days from one YYYY-MM-DD to another (local calendar days). */
export function daysBetween(from: string, to: string) {
  const [a, b] = [from, to].map((d) => { const [y, m, day] = d.split('-').map(Number); return Date.UTC(y, m - 1, day); });
  return Math.round((b - a) / DAY_MS);
}

export function addDays(date: string, n: number) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/**
 * Weight each day for `days` days eating `targetCalories`, starting at
 * `startWeight`: maintenance is recalculated from the day's weight (so loss
 * slows as you get lighter), 3,500 kcal ≈ 1 lb. Index 0 is the start.
 */
export function projectDaily(profile: Profile, startWeight: number, targetCalories: number, days: number): number[] {
  const out = [startWeight];
  let w = startWeight;
  for (let d = 1; d <= days; d++) {
    const maintenance = calculateMifflinStJeor({ ...profile, weightLbs: w }).maintenanceCalories;
    w += (targetCalories - maintenance) / 3500;
    out.push(w);
  }
  return out;
}

/** Daily calories that take `fromWeight` to `toWeight` in `days` days (by bisection). */
export function caloriesToReach(profile: Profile, fromWeight: number, toWeight: number, days: number): number {
  if (days <= 0) return NaN;
  let lo = 500;
  let hi = 7000;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const end = projectDaily(profile, fromWeight, mid, days)[days];
    if (end < toWeight) lo = mid; else hi = mid;
  }
  return Math.round((lo + hi) / 2);
}

/** Least-squares slope of weight over time, in lb per week (null without enough spread). */
export function paceLbsPerWeek(points: { day: number; weight: number }[]) {
  if (points.length < 3) return null;
  const span = points[points.length - 1].day - points[0].day;
  if (span < 7) return null;
  const n = points.length;
  const mx = points.reduce((s, p) => s + p.day, 0) / n;
  const my = points.reduce((s, p) => s + p.weight, 0) / n;
  const num = points.reduce((s, p) => s + (p.day - mx) * (p.weight - my), 0);
  const den = points.reduce((s, p) => s + (p.day - mx) ** 2, 0);
  return den ? Math.round((num / den) * 7 * 100) / 100 : null;
}

export type PlanProgress = {
  totalDays: number;
  /** Today, counted from the start (can be before 0 or past the end). */
  today: number;
  planned: number[];
  plannedEnd: number;
  /** Weigh-ins from the start on, and their 7-entry rolling average. */
  weighIns: { day: number; weight: number; average: number }[];
  current: { day: number; weight: number } | null;
  expectedNow: number | null;
  /** Positive = ahead of plan (further toward the goal than planned). */
  aheadBy: number | null;
  status: 'not-started' | 'no-data' | 'ahead' | 'on-track' | 'behind' | 'finished';
  /** The plan's calories re-run from your current weight to the end. */
  reprojection: { day: number; weight: number }[];
  projectedEnd: number | null;
  /** Calories a day that would still finish exactly on the planned end weight. */
  neededCalories: number | null;
  pace: number | null;
  plannedPace: number;
  /**
   * Maintenance calories your weigh-ins imply (eating the plan's calories and
   * changing at your real pace), next to what the calculator assumed. Needs
   * two weeks of weigh-ins.
   */
  realMaintenance: { kcal: number; calculator: number } | null;
};

/** How a plan is going, given every bodyweight entry. */
export function planProgress(plan: WeightPlan, entries: WeighIn[], todayKey: string): PlanProgress {
  const profile: Profile = { sex: plan.sex, age: plan.age, heightInches: plan.heightInches, activityLevel: plan.activityLevel };
  const totalDays = plan.weeks * 7;
  const planned = projectDaily(profile, plan.startWeightLbs, plan.targetCalories, totalDays);
  const plannedEnd = planned[totalDays];
  const today = daysBetween(plan.startDate, todayKey);

  // Weigh-ins from day 0 on, each with the average of the 7 days up to it
  // (earlier entries count too, so the average is warm at the start).
  const all = [...entries]
    .map((e) => ({ day: daysBetween(plan.startDate, e.date), weight: e.weight }))
    .sort((a, b) => a.day - b.day);
  const weighIns = all
    .filter((e) => e.day >= 0 && e.day <= Math.max(today, 0) && e.day <= totalDays)
    .map((e) => {
      const win = all.filter((x) => x.day > e.day - 7 && x.day <= e.day);
      return { ...e, average: round1(win.reduce((s, x) => s + x.weight, 0) / win.length) };
    });
  const current = currentWeight(weighIns);

  const direction = Math.sign(round1(plannedEnd - plan.startWeightLbs));
  const expectedNow = current ? planned[Math.min(current.day, totalDays)] : null;
  const aheadBy = current && expectedNow !== null
    ? round1(direction === 0 ? -Math.abs(current.weight - expectedNow) : (current.weight - expectedNow) * direction)
    : null;

  const fromDay = current ? Math.min(Math.max(current.day, 0), totalDays) : 0;
  const remaining = totalDays - fromDay;
  const reprojection = current && remaining > 0
    ? projectDaily(profile, current.weight, plan.targetCalories, remaining).map((w, i) => ({ day: fromDay + i, weight: round1(w) }))
    : [];
  const projectedEnd = reprojection.length ? reprojection[reprojection.length - 1].weight : null;
  const neededCalories = current && remaining >= 7 ? caloriesToReach(profile, current.weight, plannedEnd, remaining) : null;

  const pace = paceLbsPerWeek(weighIns);
  const status: PlanProgress['status'] = today < 0 ? 'not-started'
    : !current ? 'no-data'
    : today > totalDays ? 'finished'
    : aheadBy! >= 1 ? 'ahead'
    : aheadBy! <= -1 ? 'behind'
    : 'on-track';

  return {
    totalDays,
    today,
    planned: planned.map(round1),
    plannedEnd: round1(plannedEnd),
    weighIns,
    current,
    expectedNow: expectedNow === null ? null : round1(expectedNow),
    aheadBy,
    status,
    reprojection,
    projectedEnd,
    neededCalories,
    pace,
    realMaintenance: current && pace !== null && weighIns.length >= 4 && weighIns[weighIns.length - 1].day - weighIns[0].day >= 14
      ? {
        // 3,500 kcal ≈ 1 lb: losing x lb/day on the plan's calories means burning x × 3,500 more than that.
        kcal: Math.round((plan.targetCalories - (pace / 7) * 3500) / 10) * 10,
        calculator: Math.round(calculateMifflinStJeor({ ...profile, weightLbs: current.weight }).maintenanceCalories / 10) * 10,
      }
      : null,
    plannedPace: Math.round(((plannedEnd - plan.startWeightLbs) / totalDays) * 7 * 100) / 100,
  };
}

/**
 * Today's weight without the day-to-day water noise: the trend line through
 * the last two weeks of weigh-ins, read at the latest one. (A rolling average
 * trails a steady loss by days or weeks when you weigh in only now and then.)
 * Falls back to the average of what there is when there are too few points.
 */
export function currentWeight(points: { day: number; weight: number }[]): { day: number; weight: number } | null {
  if (!points.length) return null;
  const lastDay = points[points.length - 1].day;
  const recent = points.filter((p) => p.day >= lastDay - 14);
  const slope = paceLbsPerWeek(recent);
  if (slope === null) {
    const tail = recent.slice(-3);
    return { day: lastDay, weight: round1(tail.reduce((s, p) => s + p.weight, 0) / tail.length) };
  }
  const mx = recent.reduce((s, p) => s + p.day, 0) / recent.length;
  const my = recent.reduce((s, p) => s + p.weight, 0) / recent.length;
  return { day: lastDay, weight: round1(my + (slope / 7) * (lastDay - mx)) };
}

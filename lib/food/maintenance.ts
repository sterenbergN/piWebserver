// Your real maintenance calories, from what you ate and what the scale did:
// over a window, average daily intake minus the energy the weight change
// accounts for (about 3,500 kcal per lb). Needs two weeks of logged days and
// weigh-ins spread across them, because day-to-day water swings swamp
// anything shorter.

export const KCAL_PER_LB = 3500;
export const MIN_LOGGED_DAYS = 14;
export const MIN_WEIGH_INS = 4;
export const MIN_SPAN_DAYS = 14;
/** Days under this look half-logged (a forgotten dinner) and would drag the average down. */
export const MIN_DAY_KCAL = 800;

export type MaintenanceEstimate = {
  kcal: number;
  avgIntake: number;
  /** lb per week over the window (negative = losing). */
  weeklyChange: number;
  loggedDays: number;
  weighIns: number;
  /** "low" with just enough data, "good" with plenty. */
  confidence: 'low' | 'good';
  from: string;
  to: string;
};

export type MaintenanceShortfall = { loggedDays: number; weighIns: number; needDays: number; needWeighIns: number };

const dayNumber = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
};

/** Least-squares slope (per day) of points, or null without at least two distinct days. */
export function slopePerDay(points: { day: number; value: number }[]): number | null {
  if (points.length < 2) return null;
  const n = points.length;
  const mx = points.reduce((s, p) => s + p.day, 0) / n;
  const my = points.reduce((s, p) => s + p.value, 0) / n;
  const den = points.reduce((s, p) => s + (p.day - mx) ** 2, 0);
  if (!den) return null;
  return points.reduce((s, p) => s + (p.day - mx) * (p.value - my), 0) / den;
}

/**
 * Estimate maintenance from intake by day (kcal) and weigh-ins (lb), looking
 * at the `windowDays` up to `today`. Returns the estimate, or what's still
 * missing.
 */
export function estimateMaintenance(
  intake: Record<string, number>,
  weighIns: { date: string; weight: number }[],
  today: string,
  windowDays = 28,
): { estimate: MaintenanceEstimate | null; shortfall: MaintenanceShortfall | null } {
  const end = dayNumber(today);
  const start = end - windowDays + 1;
  const inWindow = (date: string) => { const d = dayNumber(date); return d >= start && d <= end; };
  // Today is usually still being logged, so it doesn't count.
  const days = Object.entries(intake).filter(([date, kcal]) => inWindow(date) && date !== today && kcal >= MIN_DAY_KCAL);
  const weights = weighIns.filter((w) => inWindow(w.date) && w.weight > 0).map((w) => ({ day: dayNumber(w.date), value: w.weight }));
  const span = weights.length ? Math.max(...weights.map((w) => w.day)) - Math.min(...weights.map((w) => w.day)) : 0;
  if (days.length < MIN_LOGGED_DAYS || weights.length < MIN_WEIGH_INS || span < MIN_SPAN_DAYS) {
    return { estimate: null, shortfall: { loggedDays: days.length, weighIns: weights.length, needDays: MIN_LOGGED_DAYS, needWeighIns: MIN_WEIGH_INS } };
  }
  const slope = slopePerDay(weights)!;
  const avgIntake = days.reduce((s, [, k]) => s + k, 0) / days.length;
  const kcal = Math.round((avgIntake - slope * KCAL_PER_LB) / 10) * 10;
  const sortedDays = days.map(([d]) => d).sort();
  return {
    estimate: {
      kcal,
      avgIntake: Math.round(avgIntake),
      weeklyChange: Math.round(slope * 7 * 100) / 100,
      loggedDays: days.length,
      weighIns: weights.length,
      confidence: days.length >= 21 && weights.length >= 8 ? 'good' : 'low',
      from: sortedDays[0],
      to: sortedDays[sortedDays.length - 1],
    },
    shortfall: null,
  };
}

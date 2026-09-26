import { calcAverage1RM } from './analytics';

// Weekly training report and monthly strength summary, computed from saved
// workouts. Pure functions so they're easy to test and reuse (page, export).

type Set = { weight: number; reps: number };
export type ReportWorkout = {
  id?: string;
  timestamp: string;
  name?: string;
  type?: { name?: string };
  durationSecs?: number;
  calories?: number;
  isDeload?: boolean;
  logs?: Record<string, Set[]>;
  liftMeta?: Record<string, { name?: string; primaryMuscle?: string }>;
};

const DAY = 24 * 60 * 60 * 1000;

/** Monday 00:00 (local time) of the week containing `date`. */
export function startOfWeek(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const offset = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - offset);
  return d;
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

const liftKey = (w: ReportWorkout, liftId: string) =>
  (w.liftMeta?.[liftId]?.name || liftId).trim().toLowerCase();
const liftLabel = (w: ReportWorkout, liftId: string) => w.liftMeta?.[liftId]?.name || liftId;
const validSets = (sets: Set[] | undefined) => (sets || []).filter((s) => Number(s.reps) > 0);

function inRange(workouts: ReportWorkout[], from: Date, to: Date) {
  return workouts.filter((w) => {
    const t = new Date(w.timestamp).getTime();
    return t >= from.getTime() && t < to.getTime();
  });
}

type PeriodTotals = { sessions: number; sets: number; volume: number; minutes: number; calories: number };

function totals(workouts: ReportWorkout[]): PeriodTotals {
  const out: PeriodTotals = { sessions: workouts.length, sets: 0, volume: 0, minutes: 0, calories: 0 };
  for (const w of workouts) {
    for (const sets of Object.values(w.logs || {})) {
      const valid = validSets(sets);
      out.sets += valid.length;
      out.volume += valid.reduce((sum, s) => sum + Number(s.weight) * Number(s.reps), 0);
    }
    out.minutes += Math.round((w.durationSecs || 0) / 60);
    out.calories += w.calories || 0;
  }
  out.volume = Math.round(out.volume);
  return out;
}

export type WeeklyReport = {
  weekStart: string;
  weekEnd: string;
  current: PeriodTotals;
  previous: PeriodTotals;
  /** Sets per primary muscle this week, most first. */
  muscles: { muscle: string; sets: number; previous: number }[];
  /** Lifts whose best e1RM this week beat everything logged before it. */
  prs: { lift: string; e1rm: number; previousBest: number; weight: number; reps: number }[];
  /** Days (0 = Monday) with at least one workout. */
  activeDays: number[];
  topLifts: { lift: string; sets: number; volume: number }[];
  /** Consecutive weeks (ending this one) with at least one workout. */
  weekStreak: number;
};

export function weeklyReport(history: ReportWorkout[], weekOf: Date = new Date()): WeeklyReport {
  const start = startOfWeek(weekOf);
  const end = new Date(start.getTime() + 7 * DAY);
  const prevStart = new Date(start.getTime() - 7 * DAY);
  const week = inRange(history, start, end);
  const prevWeek = inRange(history, prevStart, start);

  const muscleSets = (workouts: ReportWorkout[]) => {
    const map = new Map<string, number>();
    for (const w of workouts) {
      for (const [liftId, sets] of Object.entries(w.logs || {})) {
        const muscle = w.liftMeta?.[liftId]?.primaryMuscle || 'Other';
        map.set(muscle, (map.get(muscle) || 0) + validSets(sets).length);
      }
    }
    return map;
  };
  const now = muscleSets(week);
  const before = muscleSets(prevWeek);
  const muscles = [...new Set([...now.keys(), ...before.keys()])]
    .map((muscle) => ({ muscle, sets: now.get(muscle) || 0, previous: before.get(muscle) || 0 }))
    .filter((m) => m.sets > 0 || m.previous > 0)
    .sort((a, b) => b.sets - a.sets || b.previous - a.previous);

  // PRs: compare this week's best set per lift with the best before the week.
  const bestBefore = new Map<string, number>();
  for (const w of history) {
    if (new Date(w.timestamp).getTime() >= start.getTime()) continue;
    for (const [liftId, sets] of Object.entries(w.logs || {})) {
      const key = liftKey(w, liftId);
      for (const s of validSets(sets)) bestBefore.set(key, Math.max(bestBefore.get(key) || 0, calcAverage1RM(Number(s.weight), Number(s.reps))));
    }
  }
  const weekBest = new Map<string, { lift: string; e1rm: number; weight: number; reps: number }>();
  const liftTotals = new Map<string, { lift: string; sets: number; volume: number }>();
  for (const w of week) {
    for (const [liftId, sets] of Object.entries(w.logs || {})) {
      const key = liftKey(w, liftId);
      const valid = validSets(sets);
      const t = liftTotals.get(key) || { lift: liftLabel(w, liftId), sets: 0, volume: 0 };
      t.sets += valid.length;
      t.volume += valid.reduce((sum, s) => sum + Number(s.weight) * Number(s.reps), 0);
      liftTotals.set(key, t);
      for (const s of valid) {
        const e1rm = calcAverage1RM(Number(s.weight), Number(s.reps));
        if (e1rm > (weekBest.get(key)?.e1rm || 0)) weekBest.set(key, { lift: liftLabel(w, liftId), e1rm, weight: Number(s.weight), reps: Number(s.reps) });
      }
    }
  }
  const prs = [...weekBest.entries()]
    .filter(([key, best]) => best.e1rm > 0 && bestBefore.has(key) && best.e1rm > (bestBefore.get(key) || 0) * 1.001)
    .map(([key, best]) => ({ ...best, e1rm: Math.round(best.e1rm), previousBest: Math.round(bestBefore.get(key) || 0) }))
    .sort((a, b) => b.e1rm / (b.previousBest || 1) - a.e1rm / (a.previousBest || 1));

  const activeDays = [...new Set(week.map((w) => (new Date(w.timestamp).getDay() + 6) % 7))].sort();

  let weekStreak = 0;
  for (let i = 0; i < 520; i++) {
    const from = new Date(start.getTime() - i * 7 * DAY);
    const to = new Date(from.getTime() + 7 * DAY);
    if (inRange(history, from, to).length === 0) break;
    weekStreak++;
  }

  return {
    weekStart: start.toISOString(),
    weekEnd: new Date(end.getTime() - DAY).toISOString(),
    current: totals(week),
    previous: totals(prevWeek),
    muscles,
    prs,
    activeDays,
    topLifts: [...liftTotals.values()].map((t) => ({ ...t, volume: Math.round(t.volume) })).sort((a, b) => b.volume - a.volume).slice(0, 5),
    weekStreak,
  };
}

export type LiftStrength = {
  lift: string;
  muscle: string;
  sessions: number;
  best: { e1rm: number; weight: number; reps: number } | null;
  previousBest: number | null;
  /** Percent change of this month's best e1RM vs last month's (null if either is missing). */
  change: number | null;
};

export type MonthlyStrength = { monthStart: string; lifts: LiftStrength[]; improved: number; declined: number; sessions: number };

export function monthlyStrength(history: ReportWorkout[], monthOf: Date = new Date()): MonthlyStrength {
  const start = startOfMonth(monthOf);
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
  const prevStart = new Date(start.getFullYear(), start.getMonth() - 1, 1);
  const month = inRange(history, start, end).filter((w) => !w.isDeload);
  const prevMonth = inRange(history, prevStart, start).filter((w) => !w.isDeload);

  const bestPer = (workouts: ReportWorkout[]) => {
    const map = new Map<string, { lift: string; muscle: string; sessions: number; e1rm: number; weight: number; reps: number }>();
    for (const w of workouts) {
      for (const [liftId, sets] of Object.entries(w.logs || {})) {
        const valid = validSets(sets).filter((s) => Number(s.weight) > 0);
        if (valid.length === 0) continue;
        const key = liftKey(w, liftId);
        const entry = map.get(key) || { lift: liftLabel(w, liftId), muscle: w.liftMeta?.[liftId]?.primaryMuscle || 'Other', sessions: 0, e1rm: 0, weight: 0, reps: 0 };
        entry.sessions++;
        for (const s of valid) {
          const e1rm = calcAverage1RM(Number(s.weight), Number(s.reps));
          if (e1rm > entry.e1rm) Object.assign(entry, { e1rm, weight: Number(s.weight), reps: Number(s.reps) });
        }
        map.set(key, entry);
      }
    }
    return map;
  };
  const now = bestPer(month);
  const before = bestPer(prevMonth);
  const lifts: LiftStrength[] = [...now.entries()].map(([key, e]) => {
    const prev = before.get(key)?.e1rm ?? null;
    return {
      lift: e.lift,
      muscle: e.muscle,
      sessions: e.sessions,
      best: { e1rm: Math.round(e.e1rm), weight: e.weight, reps: e.reps },
      previousBest: prev === null ? null : Math.round(prev),
      change: prev ? Math.round(((e.e1rm - prev) / prev) * 1000) / 10 : null,
    };
  }).sort((a, b) => (b.change ?? -Infinity) - (a.change ?? -Infinity) || b.sessions - a.sessions);

  return {
    monthStart: start.toISOString(),
    lifts,
    improved: lifts.filter((l) => (l.change ?? 0) > 0).length,
    declined: lifts.filter((l) => (l.change ?? 0) < 0).length,
    sessions: month.length,
  };
}

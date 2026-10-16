import { calcAverage1RM } from './analytics';
import { exerciseKey, exerciseName } from './exercises';

// Numbers behind the analytics page, computed in one pure pass so they're easy
// to test: a chosen period against the one before it, weekly trends, a
// day-by-day consistency grid, per-exercise strength trends and rep records,
// sets per muscle, push/pull balance, and plain-language insights.

export type Period = '4w' | '12w' | '6m' | '1y' | 'all';
export const PERIODS: { key: Period; label: string; days: number | null }[] = [
  { key: '4w', label: '4 weeks', days: 28 },
  { key: '12w', label: '12 weeks', days: 84 },
  { key: '6m', label: '6 months', days: 182 },
  { key: '1y', label: '1 year', days: 365 },
  { key: 'all', label: 'All time', days: null },
];

type SetLike = { weight: number; reps: number; rir?: number };
export type Workout = {
  id?: string;
  timestamp: string;
  name?: string;
  type?: { id?: string; name?: string };
  gymId?: string;
  gymName?: string;
  durationSecs?: number;
  isDeload?: boolean;
  logs?: Record<string, SetLike[]>;
  liftMeta?: Record<string, { name?: string; exercise?: string; primaryMuscle?: string; secondaryMuscle?: string; stationType?: string }>;
};
type LiftLookup = Record<string, { name?: string; primaryMuscle?: string; secondaryMuscle?: string }>;
/** Machine calibration: converts a set's weight on one gym's machine to a common scale. */
export type ScaleFor = (workout: Workout, liftId: string) => number;

const DAY = 24 * 60 * 60 * 1000;
const time = (w: { timestamp: string }) => new Date(w.timestamp).getTime();

/** YYYY-MM-DD in local time (toISOString would shift late-evening workouts to the next day). */
export function localDayKey(date: Date | number) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Monday 00:00 local of the week containing `date`. */
export function weekStart(date: Date | number) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

const validSets = (sets: SetLike[] | undefined) => (sets || []).filter((s) => Number(s.reps) > 0);

// ─── Period totals ────────────────────────────────────────────────────────────

export type Totals = { workouts: number; sets: number; volume: number; avgMinutes: number | null; perWeek: number; days: number };

function totals(workouts: Workout[], days: number): Totals {
  let sets = 0;
  let volume = 0;
  const durations: number[] = [];
  for (const w of workouts) {
    for (const list of Object.values(w.logs || {})) {
      for (const s of validSets(list)) {
        sets++;
        volume += (Number(s.weight) || 0) * Number(s.reps);
      }
    }
    if (Number(w.durationSecs) > 0) durations.push(Number(w.durationSecs) / 60);
  }
  return {
    workouts: workouts.length,
    sets,
    volume: Math.round(volume),
    avgMinutes: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
    perWeek: days > 0 ? Math.round((workouts.length / (days / 7)) * 10) / 10 : 0,
    days,
  };
}

/** Workouts in the period, and the same-length period before it (none for "all"). */
export function periodWindow(history: Workout[], period: Period, now = Date.now()) {
  const days = PERIODS.find((p) => p.key === period)?.days ?? null;
  const sorted = [...history].sort((a, b) => time(a) - time(b));
  if (days === null) {
    const first = sorted.length ? time(sorted[0]) : now;
    const span = Math.max(7, Math.ceil((now - first) / DAY));
    return { current: sorted, previous: null as Workout[] | null, days: span, start: first };
  }
  const start = now - days * DAY;
  const prevStart = start - days * DAY;
  // Per-week averages only count the weeks you've been training (a 12-week
  // view of 4 weeks of history shouldn't look like a quarter of the effort).
  const first = sorted.length ? time(sorted[0]) : now;
  const activeDays = Math.max(7, Math.min(days, Math.ceil((now - first) / DAY)));
  return {
    current: sorted.filter((w) => time(w) > start && time(w) <= now),
    previous: sorted.filter((w) => time(w) > prevStart && time(w) <= start),
    days: activeDays,
    start,
  };
}

export function periodSummary(history: Workout[], period: Period, now = Date.now()) {
  const { current, previous, days } = periodWindow(history, period, now);
  return { current: totals(current, days), previous: previous ? totals(previous, days) : null };
}

/** Relative change (0.12 = +12%), or null when there's nothing to compare with. */
export function change(current: number, previous: number | null | undefined) {
  if (previous === null || previous === undefined || previous <= 0) return null;
  return (current - previous) / previous;
}

// ─── Trends ───────────────────────────────────────────────────────────────────

export type WeekPoint = { key: string; label: string; workouts: number; sets: number; volume: number };

/** One point per calendar week (Monday start), oldest first, including empty weeks. */
export function weeklySeries(history: Workout[], weeks: number, now = Date.now()): WeekPoint[] {
  const thisWeek = weekStart(now);
  const points: WeekPoint[] = [];
  const index = new Map<string, WeekPoint>();
  for (let i = weeks - 1; i >= 0; i--) {
    const start = new Date(thisWeek);
    start.setDate(start.getDate() - i * 7);
    const point = { key: localDayKey(start), label: start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), workouts: 0, sets: 0, volume: 0 };
    points.push(point);
    index.set(point.key, point);
  }
  for (const w of history) {
    const point = index.get(localDayKey(weekStart(time(w))));
    if (!point) continue;
    point.workouts++;
    for (const list of Object.values(w.logs || {})) {
      for (const s of validSets(list)) {
        point.sets++;
        point.volume += (Number(s.weight) || 0) * Number(s.reps);
      }
    }
  }
  points.forEach((p) => { p.volume = Math.round(p.volume); });
  return points;
}

export type DayCell = { key: string; date: Date; sets: number; workouts: { id?: string; name: string }[] };

/** Every day for the last `weeks` whole weeks (Monday-first rows), for a consistency calendar. */
export function consistencyGrid(history: Workout[], weeks: number, now = Date.now()): DayCell[][] {
  const byDay = new Map<string, DayCell>();
  const first = weekStart(now);
  first.setDate(first.getDate() - (weeks - 1) * 7);
  const columns: DayCell[][] = [];
  for (let w = 0; w < weeks; w++) {
    const column: DayCell[] = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(first);
      date.setDate(first.getDate() + w * 7 + d);
      const cell: DayCell = { key: localDayKey(date), date, sets: 0, workouts: [] };
      byDay.set(cell.key, cell);
      column.push(cell);
    }
    columns.push(column);
  }
  for (const w of history) {
    const cell = byDay.get(localDayKey(time(w)));
    if (!cell) continue;
    cell.workouts.push({ id: w.id, name: w.type?.name || w.name || 'Workout' });
    for (const list of Object.values(w.logs || {})) cell.sets += validSets(list).length;
  }
  return columns;
}

// ─── Per exercise ─────────────────────────────────────────────────────────────

export type ExerciseSession = {
  workoutId?: string;
  timestamp: string;
  gymName?: string;
  sets: SetLike[];
  top: { weight: number; reps: number };
  /** Best estimated 1RM of the session (calibrated to a common scale for machines). */
  e1rm: number;
  volume: number;
  pr: boolean;
};

export type RepRecord = { reps: number; weight: number; timestamp: string };

export type ExerciseStat = {
  key: string;
  name: string;
  muscle: string;
  sessions: ExerciseSession[];
  /** Best e1RM over the last three sessions — a steadier "current strength" than one day. */
  current: number;
  best: number;
  /** Change in e1RM across the period (current vs the session at or just before its start). */
  periodChange: number | null;
  sessionsInPeriod: number;
  lastDone: string;
  gyms: string[];
  /** Heaviest weight done for at least N reps, for common rep counts. */
  repRecords: RepRecord[];
};

const REP_TARGETS = [1, 3, 5, 8, 10, 12, 15];

export function exerciseStats(history: Workout[], period: Period, { scaleFor, lifts = {}, now = Date.now() }: { scaleFor?: ScaleFor; lifts?: LiftLookup; now?: number } = {}): ExerciseStat[] {
  const { start } = periodWindow(history, period, now);
  const groups = new Map<string, { name: string; muscle: string; sessions: ExerciseSession[]; gyms: Set<string> }>();
  const sorted = [...history].sort((a, b) => time(a) - time(b));

  for (const w of sorted) {
    // A lift can appear under several ids in one workout (same exercise twice) — merge them.
    const perExercise = new Map<string, { name: string; muscle: string; sets: SetLike[]; scaled: SetLike[] }>();
    for (const [liftId, rawSets] of Object.entries(w.logs || {})) {
      const sets = validSets(rawSets);
      if (sets.length === 0) continue;
      const meta = { ...lifts[liftId], ...w.liftMeta?.[liftId] };
      const name = exerciseName(meta) || liftId;
      const key = exerciseKey(meta) || liftId;
      const scale = scaleFor?.(w, liftId) ?? 1;
      const entry = perExercise.get(key) || { name, muscle: meta.primaryMuscle || 'Other', sets: [], scaled: [] };
      entry.sets.push(...sets);
      entry.scaled.push(...sets.map((s) => ({ ...s, weight: (Number(s.weight) || 0) * scale })));
      perExercise.set(key, entry);
    }
    for (const [key, entry] of perExercise) {
      const group = groups.get(key) || { name: entry.name, muscle: entry.muscle, sessions: [], gyms: new Set<string>() };
      group.name = entry.name; // latest name wins
      if (w.gymName) group.gyms.add(w.gymName);
      let top = entry.sets[0];
      let e1rm = 0;
      entry.sets.forEach((s, i) => {
        const estimate = calcAverage1RM(entry.scaled[i].weight, Number(s.reps));
        if (estimate > e1rm) { e1rm = estimate; top = s; }
      });
      const previousBest = Math.max(0, ...group.sessions.map((s) => s.e1rm));
      group.sessions.push({
        workoutId: w.id,
        timestamp: w.timestamp,
        gymName: w.gymName,
        sets: entry.sets,
        top: { weight: Number(top.weight) || 0, reps: Number(top.reps) },
        e1rm,
        volume: Math.round(entry.sets.reduce((sum, s) => sum + (Number(s.weight) || 0) * Number(s.reps), 0)),
        // A PR beats every earlier session by more than 1% (the first session is a baseline, not a PR).
        pr: previousBest > 0 && e1rm > previousBest * 1.01 && !w.isDeload,
      });
      groups.set(key, group);
    }
  }

  const stats: ExerciseStat[] = [];
  for (const [key, group] of groups) {
    const sessions = group.sessions;
    const recent = sessions.slice(-3);
    const current = Math.max(...recent.map((s) => s.e1rm));
    const inPeriod = sessions.filter((s) => new Date(s.timestamp).getTime() > start);
    // Baseline: the last session before the period, else the first one inside it.
    const before = sessions.filter((s) => new Date(s.timestamp).getTime() <= start).slice(-1)[0];
    const baseline = before || (inPeriod.length > 1 ? inPeriod[0] : undefined);
    const repRecords: RepRecord[] = [];
    for (const reps of REP_TARGETS) {
      let record: RepRecord | null = null;
      for (const s of sessions) {
        for (const set of s.sets) {
          if (Number(set.reps) >= reps && Number(set.weight) > 0 && (!record || Number(set.weight) > record.weight)) {
            record = { reps, weight: Number(set.weight), timestamp: s.timestamp };
          }
        }
      }
      if (record) repRecords.push(record);
    }
    // A record only counts if no higher rep count matched or beat its weight
    // (150 × 10 makes "150 for 1, 3, 5, 8" redundant — keep "10+ reps: 150").
    const records = repRecords.filter((r) => !repRecords.some((o) => o.reps > r.reps && o.weight >= r.weight));
    stats.push({
      key,
      name: group.name,
      muscle: group.muscle,
      sessions,
      current,
      best: Math.max(...sessions.map((s) => s.e1rm)),
      periodChange: baseline && baseline.e1rm > 0 && inPeriod.length > 0 ? (current - baseline.e1rm) / baseline.e1rm : null,
      sessionsInPeriod: inPeriod.length,
      lastDone: sessions[sessions.length - 1].timestamp,
      gyms: [...group.gyms],
      repRecords: records,
    });
  }
  return stats.sort((a, b) => new Date(b.lastDone).getTime() - new Date(a.lastDone).getTime());
}

/** PRs set in the period, newest first. */
export function recentPRs(stats: ExerciseStat[], period: Period, history: Workout[], now = Date.now()) {
  const { start } = periodWindow(history, period, now);
  return stats
    .flatMap((stat) => stat.sessions.filter((s) => s.pr && new Date(s.timestamp).getTime() > start).map((s) => ({ name: stat.name, key: stat.key, session: s })))
    .sort((a, b) => new Date(b.session.timestamp).getTime() - new Date(a.session.timestamp).getTime());
}

// ─── Muscles ──────────────────────────────────────────────────────────────────

export const MUSCLE_ORDER = ['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Quads', 'Hamstrings', 'Glutes', 'Calves', 'Core'];

export type MuscleWeek = { muscle: string; perWeek: number; total: number };

/**
 * Working sets per muscle per week across the period: a set counts fully for
 * the lift's main muscle and half for its secondary one.
 */
export function muscleSetsPerWeek(history: Workout[], period: Period, { lifts = {}, now = Date.now() }: { lifts?: LiftLookup; now?: number } = {}): MuscleWeek[] {
  const { current, days } = periodWindow(history, period, now);
  const totalsByMuscle = new Map<string, number>();
  const add = (muscle: string | undefined, n: number) => {
    if (!muscle || muscle === 'None') return;
    totalsByMuscle.set(muscle, (totalsByMuscle.get(muscle) || 0) + n);
  };
  for (const w of current) {
    if (w.isDeload) continue;
    for (const [liftId, sets] of Object.entries(w.logs || {})) {
      const meta = { ...lifts[liftId], ...w.liftMeta?.[liftId] };
      const n = validSets(sets).length;
      add(meta.primaryMuscle, n);
      if (meta.secondaryMuscle !== meta.primaryMuscle) add(meta.secondaryMuscle, n * 0.5);
    }
  }
  const weeks = Math.max(1, days / 7);
  const known = new Set(MUSCLE_ORDER);
  const muscles = [...MUSCLE_ORDER.filter((m) => totalsByMuscle.has(m)), ...[...totalsByMuscle.keys()].filter((m) => !known.has(m))];
  return muscles.map((muscle) => ({ muscle, total: totalsByMuscle.get(muscle) || 0, perWeek: Math.round(((totalsByMuscle.get(muscle) || 0) / weeks) * 10) / 10 }));
}

export type BalancePair = { label: string; left: string; right: string; leftSets: number; rightSets: number; ratio: number | null; ok: boolean; advice: string };

const sum = (muscles: MuscleWeek[], names: string[]) => muscles.filter((m) => names.includes(m.muscle)).reduce((a, m) => a + m.perWeek, 0);

/** Common balance checks; "ok" when within the usual range. */
export function muscleBalance(muscles: MuscleWeek[]): BalancePair[] {
  const pair = (label: string, left: string, leftMuscles: string[], right: string, rightMuscles: string[], low: number, high: number, fixLow: string, fixHigh: string): BalancePair => {
    const leftSets = Math.round(sum(muscles, leftMuscles) * 10) / 10;
    const rightSets = Math.round(sum(muscles, rightMuscles) * 10) / 10;
    const ratio = rightSets > 0 ? leftSets / rightSets : null;
    const ok = ratio !== null && ratio >= low && ratio <= high;
    const advice = ratio === null ? `No ${right.toLowerCase()} work yet` : ratio > high ? fixHigh : ratio < low ? fixLow : 'Balanced';
    return { label, left, right, leftSets, rightSets, ratio, ok, advice };
  };
  return [
    pair('Push vs pull', 'Push', ['Chest', 'Shoulders', 'Triceps'], 'Pull', ['Back', 'Biceps'], 0.7, 1.4, 'More pulling than pushing — fine if intended', 'More pushing than pulling — add rows or pulldowns'),
    pair('Upper vs lower', 'Upper', ['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps'], 'Lower', ['Quads', 'Hamstrings', 'Glutes', 'Calves'], 0.6, 2.2, 'Lower-body heavy', 'Upper-body heavy — consider another leg session'),
    pair('Quads vs hamstrings', 'Quads', ['Quads'], 'Hamstrings', ['Hamstrings'], 0.7, 2, 'Hamstring heavy', 'Quad heavy — add curls or RDLs'),
  ].filter((p) => p.leftSets + p.rightSets > 0);
}

// ─── Insights ─────────────────────────────────────────────────────────────────

export type Insight = { tone: 'good' | 'info' | 'warn'; text: string };

/** Estimated 1RM (lb) below which percent changes are too noisy to call out. */
const MIN_LOAD_FOR_TRENDS = 40;
const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

export function buildInsights(input: {
  summary: ReturnType<typeof periodSummary>;
  stats: ExerciseStat[];
  muscles: MuscleWeek[];
  balance: BalancePair[];
  stalled: { name: string }[];
  weeklySetGoal: number;
  daysSinceLast: number | null;
  periodLabel: string;
}): Insight[] {
  const out: Insight[] = [];
  const { summary, stats, muscles, balance, stalled, weeklySetGoal, daysSinceLast, periodLabel } = input;
  const { current, previous } = summary;

  if (daysSinceLast !== null && daysSinceLast >= 7) out.push({ tone: 'warn', text: `No workouts in the last ${daysSinceLast} days.` });
  if (previous && previous.workouts > 0) {
    const diff = current.perWeek - previous.perWeek;
    if (Math.abs(diff) >= 0.5) {
      out.push({ tone: diff > 0 ? 'good' : 'warn', text: `Training ${current.perWeek}×/week, ${diff > 0 ? 'up' : 'down'} from ${previous.perWeek} the ${periodLabel.toLowerCase()} before.` });
    }
  }
  // Light lifts swing wildly in percent (10 → 15 lb is +50%), so only rank meaningful loads.
  const gainers = stats.filter((s) => s.periodChange !== null && s.sessionsInPeriod >= 2 && s.current >= MIN_LOAD_FOR_TRENDS).sort((a, b) => (b.periodChange || 0) - (a.periodChange || 0));
  if (gainers[0] && (gainers[0].periodChange || 0) >= 0.02) {
    out.push({ tone: 'good', text: `Biggest gain: ${gainers[0].name}, est. 1RM up ${Math.round((gainers[0].periodChange || 0) * 100)}% (${Math.round(gainers[0].current)} lbs).` });
  }
  const losers = gainers.filter((s) => (s.periodChange || 0) <= -0.05);
  if (losers.length) out.push({ tone: 'warn', text: `${losers.map((s) => s.name).slice(0, 2).join(' and ')} ${losers.length === 1 ? 'is' : 'are'} down more than 5% — a deload or a form check might help.` });
  if (stalled.length) out.push({ tone: 'info', text: `Plateau${stalled.length === 1 ? '' : 's'}: ${stalled.slice(0, 3).map((s) => s.name).join(', ')} — try a new rep range or a variation.` });
  const low = muscles.filter((m) => m.perWeek > 0 && m.perWeek < weeklySetGoal / 2).map((m) => m.muscle);
  if (low.length) out.push({ tone: 'info', text: `Low weekly volume for ${low.slice(0, 3).join(', ')} (under ${Math.round(weeklySetGoal / 2)} sets/week vs a goal of ${weeklySetGoal}).` });
  const missing = MUSCLE_ORDER.filter((m) => m !== 'Core' && !muscles.some((x) => x.muscle === m));
  if (muscles.length > 0 && missing.length > 0 && missing.length <= 4) out.push({ tone: 'info', text: `Not trained in this period: ${missing.join(', ')}.` });
  for (const pair of balance) if (!pair.ok && pair.ratio !== null) out.push({ tone: 'info', text: `${pair.label}: ${lowerFirst(pair.advice)} (${pair.leftSets} vs ${pair.rightSets} sets/week).` });
  if (out.length === 0 && current.workouts > 0) out.push({ tone: 'good', text: 'Steady training and nothing out of balance — keep it up.' });
  return out;
}

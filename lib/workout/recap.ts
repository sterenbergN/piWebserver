import { periodWindow, PERIODS, weekStart, type ExerciseStat, type MuscleWeek, type Period, type Workout } from './insights';

// "Wrapped"-style recap of a period: the story slides' data, worked out from
// history and the analytics already computed for the page. Drawn as images in
// recap-cards.ts.

/** Below this e1RM a lift's % change is mostly noise (light isolation work). */
const MIN_LOAD_FOR_GAINS = 40;
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Things that weigh about this much (lb), biggest first, for "that's like lifting…". */
const COMPARISONS = [
  { lb: 300_000, one: 'blue whale', many: 'blue whales' },
  { lb: 13_000, one: 'elephant', many: 'elephants' },
  { lb: 4_000, one: 'car', many: 'cars' },
  { lb: 1_000, one: 'grand piano', many: 'grand pianos' },
];

export type RecapSlide =
  | { kind: 'cover'; title: string; range: string; name?: string }
  | { kind: 'showing-up'; workouts: number; hours: number; activeDays: number; bestStreakWeeks: number; favouriteDay: string | null; timeOfDay: string | null }
  | { kind: 'volume'; volume: number; sets: number; reps: number; comparison: string }
  | { kind: 'top-lifts'; lifts: { name: string; sessions: number; sets: number }[] }
  | { kind: 'gains'; lifts: { name: string; from: number; to: number; pct: number }[] }
  | { kind: 'records'; count: number; lifts: { name: string; weight: number; reps: number }[] }
  | { kind: 'muscles'; muscles: { muscle: string; sets: number; share: number }[] }
  | { kind: 'summary'; persona: string; personaWhy: string; workouts: number; volume: number; topLift: string | null; topMuscle: string | null; prs: number; range: string };

const rangeLabel = (start: number, end: number) => {
  const fmt = (t: number, year: boolean) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(year ? { year: 'numeric' } : {}) });
  const sameYear = new Date(start).getFullYear() === new Date(end).getFullYear();
  return `${fmt(start, !sameYear)} – ${fmt(end, true)}`;
};

/** "12 elephants" — the biggest thing that fits at least once. */
export function volumeComparison(volume: number) {
  const thing = COMPARISONS.find((c) => volume >= c.lb) || COMPARISONS[COMPARISONS.length - 1];
  const n = volume / thing.lb;
  const count = n >= 10 ? Math.round(n) : Math.round(n * 10) / 10;
  return `${count.toLocaleString()} ${count === 1 ? thing.one : thing.many}`;
}

/** The most consecutive calendar weeks with at least one workout. */
export function longestWeekStreak(workouts: Workout[]) {
  const weeks = [...new Set(workouts.map((w) => weekStart(new Date(w.timestamp)).getTime()))].sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  for (let i = 0; i < weeks.length; i++) {
    // A week apart, allowing an hour either way for daylight saving.
    run = i > 0 && Math.abs(weeks[i] - weeks[i - 1] - 7 * 86_400_000) <= 3_600_000 ? run + 1 : 1;
    best = Math.max(best, run);
  }
  return best;
}

function mostCommon<T>(values: T[]): T | null {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
  let top: T | null = null;
  let topCount = 0;
  for (const [v, n] of counts) if (n > topCount) { top = v; topCount = n; }
  return top;
}

const timeOfDayOf = (date: Date) => {
  const h = date.getHours();
  return h < 5 ? 'late night' : h < 11 ? 'morning' : h < 16 ? 'afternoon' : h < 20 ? 'evening' : 'night';
};

/** A playful lifter "type" from rep ranges and when you train, with the reason. */
export function lifterPersona(avgReps: number, timeOfDay: string | null, topMuscle: string | null) {
  const style = avgReps > 0 && avgReps <= 6 ? 'Strength Chaser' : avgReps >= 12 ? 'Pump Seeker' : 'Muscle Builder';
  const when = timeOfDay === 'morning' ? 'Early Bird' : timeOfDay === 'night' || timeOfDay === 'late night' ? 'Night Owl' : null;
  const legDay = topMuscle && ['Quads', 'Hamstrings', 'Glutes', 'Calves'].includes(topMuscle);
  const persona = legDay ? `Leg Day Loyalist` : when ? `${when} ${style}` : style;
  const reps = avgReps > 0 ? `${Math.round(avgReps)} reps a set on average` : '';
  const why = [
    legDay ? `${topMuscle} got the most sets` : '',
    reps,
    timeOfDay ? `usually in the ${timeOfDay}` : '',
  ].filter(Boolean).join(', ');
  return { persona, why: why ? `${why[0].toUpperCase()}${why.slice(1)}.` : '' };
}

/**
 * The recap's slides for a period. Slides without anything to say (no gains,
 * no records…) are left out, so a short history still makes a tidy story.
 */
export function buildRecap(input: {
  history: Workout[];
  period: Period;
  stats: ExerciseStat[];
  muscles: MuscleWeek[];
  name?: string;
  now?: number;
}): RecapSlide[] {
  const { history, period, stats, muscles, name, now = Date.now() } = input;
  const { current, start } = periodWindow(history, period, now);
  if (current.length === 0) return [];
  const label = PERIODS.find((p) => p.key === period)!.label;
  const range = rangeLabel(period === 'all' ? start + 1 : start, now);

  let sets = 0;
  let reps = 0;
  let volume = 0;
  let seconds = 0;
  for (const w of current) {
    seconds += Number(w.durationSecs) > 0 ? Number(w.durationSecs) : 0;
    for (const list of Object.values(w.logs || {})) {
      for (const s of list || []) {
        if (!(Number(s.reps) > 0)) continue;
        sets++;
        reps += Number(s.reps);
        volume += (Number(s.weight) || 0) * Number(s.reps);
      }
    }
  }
  volume = Math.round(volume);
  const dates = current.map((w) => new Date(w.timestamp));
  const activeDays = new Set(dates.map((d) => d.toDateString())).size;
  const favouriteDayIndex = mostCommon(dates.map((d) => d.getDay()));
  const timeOfDay = mostCommon(dates.map(timeOfDayOf));

  const inPeriod = stats.filter((s) => s.sessionsInPeriod > 0);
  const setsInPeriod = (stat: ExerciseStat) => stat.sessions.filter((s) => new Date(s.timestamp).getTime() > start).reduce((n, s) => n + s.sets.length, 0);
  const topLifts = [...inPeriod]
    .map((s) => ({ name: s.name, sessions: s.sessionsInPeriod, sets: setsInPeriod(s) }))
    .sort((a, b) => b.sessions - a.sessions || b.sets - a.sets)
    .slice(0, 5);
  const gains = inPeriod
    .filter((s) => s.periodChange !== null && s.periodChange > 0 && s.current >= MIN_LOAD_FOR_GAINS && s.sessionsInPeriod >= 2)
    .map((s) => ({ name: s.name, to: Math.round(s.current), from: Math.round(s.current / (1 + (s.periodChange as number))), pct: Math.round((s.periodChange as number) * 100) }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 3);
  const records = stats
    .flatMap((stat) => stat.sessions.filter((s) => s.pr && new Date(s.timestamp).getTime() > start).map((s) => ({ name: stat.name, weight: s.top.weight, reps: s.top.reps, e1rm: s.e1rm })))
    .sort((a, b) => b.e1rm - a.e1rm);
  // One line per lift (its best PR of the period).
  const recordLifts = records.filter((r, i) => records.findIndex((o) => o.name === r.name) === i).slice(0, 5);
  const muscleTotal = muscles.reduce((n, m) => n + m.total, 0);
  const topMuscles = [...muscles]
    .sort((a, b) => b.total - a.total)
    .slice(0, 5)
    .map((m) => ({ muscle: m.muscle, sets: Math.round(m.total), share: muscleTotal > 0 ? m.total / muscleTotal : 0 }));
  const { persona, why } = lifterPersona(sets > 0 ? reps / sets : 0, timeOfDay, topMuscles[0]?.muscle ?? null);

  const slides: RecapSlide[] = [
    { kind: 'cover', title: period === 'all' ? 'Your lifting, all time' : `Your last ${label}`, range, name },
    {
      kind: 'showing-up',
      workouts: current.length,
      hours: Math.round((seconds / 3600) * 10) / 10,
      activeDays,
      bestStreakWeeks: longestWeekStreak(current),
      favouriteDay: favouriteDayIndex === null ? null : DAY_NAMES[favouriteDayIndex],
      timeOfDay,
    },
  ];
  if (volume > 0) slides.push({ kind: 'volume', volume, sets, reps, comparison: volumeComparison(volume) });
  if (topLifts.length > 0) slides.push({ kind: 'top-lifts', lifts: topLifts });
  if (gains.length > 0) slides.push({ kind: 'gains', lifts: gains });
  if (records.length > 0) slides.push({ kind: 'records', count: records.length, lifts: recordLifts.map(({ name, weight, reps }) => ({ name, weight, reps })) });
  if (topMuscles.length > 0) slides.push({ kind: 'muscles', muscles: topMuscles });
  slides.push({
    kind: 'summary',
    persona,
    personaWhy: why,
    workouts: current.length,
    volume,
    topLift: topLifts[0]?.name ?? null,
    topMuscle: topMuscles[0]?.muscle ?? null,
    prs: records.length,
    range,
  });
  return slides;
}

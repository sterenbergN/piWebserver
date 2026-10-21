import { calcAverage1RM } from './analytics';
import { CATALOG_LIFT_NAMES, inferLiftDetails } from './catalog';
import { exerciseKey, exerciseName } from './exercises';
import { exerciseVariant } from './related-exercises';
import type { CoachInsight } from './health-coach';

// The things a coach watching you train would say, read from the log: how
// hard your sets are (reps in reserve), whether you add weight when lifts get
// easy, how heavy your main lifts are, whether you follow the suggested
// weights, how long you rest (set times), warm-ups, and how weekly volume is
// spread across muscles. Each check needs a minimum amount of recent data;
// until then it's listed as "still learning" with what it's waiting for.

type SetLog = { weight?: number; reps?: number; rir?: number; plannedWeight?: number; plannedReps?: number; timestamp?: number };
type LiftMeta = { name?: string; exercise?: string; primaryMuscle?: string; secondaryMuscle?: string; supersetId?: string | null; stationType?: string };
export type TrainingWorkout = {
  id?: string;
  timestamp: string;
  isDeload?: boolean;
  logs?: Record<string, SetLog[] | undefined>;
  warmups?: Record<string, unknown[] | undefined>;
  liftMeta?: Record<string, LiftMeta | undefined>;
};

export type CoachPending = { area: string; need: string; have: number; of: number };
/** `fine`: checks that had enough data and found nothing to change. */
export type TrainingAdvice = { insights: CoachInsight[]; pending: CoachPending[]; fine: string[]; workouts: number };

const DAY_MS = 86_400_000;
export const COACH_WINDOW_DAYS = 42;
const COMPOUND = new Set(['press', 'overhead', 'squat', 'hinge', 'row', 'pulldown']);

const median = (list: number[]) => {
  const s = [...list].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const share = (part: number, whole: number) => (whole ? part / whole : 0);
const pctText = (x: number) => `${Math.round(x * 100)}%`;
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const listNames = (names: string[]) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);
const round5 = (n: number) => Math.round(n / 5) * 5;

const isCompound = (meta: LiftMeta | undefined) => COMPOUND.has(exerciseVariant(exerciseName(meta))?.family || '');
const working = (sets: SetLog[] | undefined) => (sets || []).filter((s) => Number(s.reps) > 0);
const topSet = (sets: SetLog[]) => sets.reduce<SetLog | null>((best, s) => (!best || Number(s.weight) > Number(best.weight) || (Number(s.weight) === Number(best.weight) && Number(s.reps) > Number(best.reps)) ? s : best), null);

type LiftSession = { workout: TrainingWorkout; liftId: string; key: string; name: string; meta: LiftMeta | undefined; sets: SetLog[]; at: number; firstCompound: boolean };

/** Every lift done in every workout, oldest first, with the exercise it counts as. */
function liftSessions(history: TrainingWorkout[]): LiftSession[] {
  const out: LiftSession[] = [];
  for (const w of [...history].filter((x) => !x.isDeload).sort((a, b) => a.timestamp.localeCompare(b.timestamp))) {
    let sawCompound = false;
    for (const [liftId, raw] of Object.entries(w.logs || {})) {
      const sets = working(raw);
      if (!sets.length) continue;
      const meta = w.liftMeta?.[liftId];
      const compound = isCompound(meta);
      out.push({ workout: w, liftId, key: exerciseKey(meta) || liftId, name: exerciseName(meta) || 'Lift', meta, sets, at: Date.parse(w.timestamp), firstCompound: compound && !sawCompound });
      if (compound) sawCompound = true;
    }
  }
  return out;
}

/** Best estimated 1RM for each exercise from sessions before `at`. */
function bestBefore(sessions: LiftSession[]) {
  const best = new Map<string, number>();
  const before = new Map<LiftSession, number>();
  for (const s of sessions) {
    if (best.has(s.key)) before.set(s, best.get(s.key)!);
    for (const set of s.sets) {
      const reps = Number(set.reps);
      const weight = Number(set.weight);
      if (reps >= 1 && reps <= 12 && weight > 0) best.set(s.key, Math.max(best.get(s.key) || 0, calcAverage1RM(weight, reps)));
    }
  }
  return { best, before };
}

function effort(recent: LiftSession[], pending: CoachPending[]): CoachInsight | null {
  const sets = recent.flatMap((s) => s.sets.filter((x) => typeof x.rir === 'number').map((x) => ({ rir: Number(x.rir), name: s.name })));
  if (sets.length < 30) {
    pending.push({ area: 'How hard you train', need: 'sets with reps-left logged', have: sets.length, of: 30 });
    return null;
  }
  const easy = share(sets.filter((s) => s.rir >= 3).length, sets.length);
  const failure = share(sets.filter((s) => s.rir === 0).length, sets.length);
  const typical = median(sets.map((s) => s.rir));
  const byLift = new Map<string, number[]>();
  sets.forEach((s) => byLift.set(s.name, [...(byLift.get(s.name) || []), s.rir]));
  const easiest = [...byLift].filter(([, l]) => l.length >= 6 && median(l) >= 3).sort((a, b) => median(b[1]) - median(a[1])).slice(0, 2).map(([n]) => n);
  const evidence = `${sets.length} sets in the last 6 weeks`;
  if (easy >= 0.5) {
    return {
      id: 'effort-easy', category: 'effort', tone: 'warn', priority: 92,
      title: 'You’re not pushing your sets hard enough',
      detail: `${pctText(easy)} of your working sets ended with 3 or more reps left (typically ${typical >= 5 ? '5+' : typical}). Sets build muscle and strength when they end about 1–3 reps short of failure.${easiest.length ? ` Most of all on ${listNames(easiest)}.` : ''}`,
      steps: [
        'Pick weights you can do for the target reps with only 1–2 reps left. If you could have done 3 more, it was too light.',
        'When a set ends with 3+ reps left, go up one weight step on the next set — don’t wait for next week.',
        'Keep tapping the honest reps-left number: the suggested weights climb faster when you do.',
      ],
      evidence,
    };
  }
  if (failure >= 0.4) {
    return {
      id: 'effort-failure', category: 'effort', tone: 'warn', priority: 84,
      title: 'Too many sets taken to failure',
      detail: `${pctText(failure)} of your working sets ended with 0 reps left. Going to failure every set piles up fatigue without adding much growth, and drags down the sets that follow.`,
      steps: [
        'Stop most sets with 1–2 reps left; save all-out efforts for the last set of an exercise.',
        'If even the first set hits 0 reps left, the weight is too heavy for the rep target — drop one step.',
      ],
      evidence,
    };
  }
  if (typical >= 1 && typical <= 2 && easy < 0.3) {
    return { id: 'effort-good', category: 'effort', tone: 'good', priority: 30, title: 'Your effort is in the sweet spot', detail: `Most sets end with ${typical} rep${typical === 1 ? '' : 's'} left — hard enough to grow, without grinding every set.`, evidence };
  }
  return null;
}

function progression(sessions: LiftSession[], since: number, pending: CoachPending[]): CoachInsight | null {
  const byKey = new Map<string, LiftSession[]>();
  sessions.forEach((s) => byKey.set(s.key, [...(byKey.get(s.key) || []), s]));
  let chances = 0;
  const missed: string[] = [];
  for (const list of byKey.values()) {
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1];
      const next = list[i];
      if (next.at < since || next.at - prev.at > 21 * DAY_MS) continue;
      const top = topSet(prev.sets);
      if (!top || typeof top.rir !== 'number' || top.rir < 3 || !(Number(top.weight) > 0)) continue;
      chances++;
      const nextTop = topSet(next.sets)!;
      if (Number(nextTop.weight) <= Number(top.weight) && Number(nextTop.reps) <= Number(top.reps)) missed.push(next.name);
    }
  }
  if (chances < 5) {
    pending.push({ area: 'Adding weight when lifts get easy', need: 'lifts that ended with 3+ reps left and were done again', have: chances, of: 5 });
    return null;
  }
  const rate = share(missed.length, chances);
  const names = [...new Set(missed)].slice(0, 3);
  const evidence = `${chances} times a top set ended with 3+ reps left`;
  if (rate >= 0.5) {
    return {
      id: 'progression', category: 'progression', tone: 'warn', priority: 88,
      title: 'You don’t add weight when lifts get easy',
      detail: `${missed.length} of ${chances} times your top set had 3+ reps left, the next session used the same weight for the same reps or fewer${names.length ? ` (${listNames(names)})` : ''}. Strength only goes up if the work does.`,
      steps: [
        'When a top set ends with 3+ reps left, add the smallest weight step next session — the suggested weight already does this, so start from it.',
        'Can’t add weight? Add a rep to every set, and add weight once you reach the top of your rep range.',
      ],
      evidence,
    };
  }
  if (rate <= 0.2) {
    return { id: 'progression', category: 'progression', tone: 'good', priority: 32, title: 'You add weight when lifts get easy', detail: `${chances - missed.length} of ${chances} times, the session after an easy top set went heavier or did more reps.`, evidence };
  }
  return null;
}

function heaviness(recent: LiftSession[], before: Map<LiftSession, number>, best: Map<string, number>, pending: CoachPending[]): CoachInsight | null {
  const rel = recent.filter((s) => isCompound(s.meta) && before.has(s)).flatMap((s) => s.sets.map((x) => ({ r: Number(x.weight) / before.get(s)!, name: s.name, key: s.key })));
  if (rel.length < 20) {
    pending.push({ area: 'How heavy your main lifts are', need: 'sets on compound lifts (squats, presses, rows…)', have: rel.length, of: 20 });
    return null;
  }
  const heavy = share(rel.filter((x) => x.r >= 0.75).length, rel.length);
  if (heavy >= 0.15) return null;
  const counts = new Map<string, { name: string; n: number }>();
  rel.forEach((x) => counts.set(x.key, { name: x.name, n: (counts.get(x.key)?.n || 0) + 1 }));
  const [mainKey, main] = [...counts].sort((a, b) => b[1].n - a[1].n)[0];
  const example = round5((best.get(mainKey) || 0) * 0.8);
  return {
    id: 'heaviness', category: 'load', tone: 'warn', priority: 80,
    title: 'Your main lifts are almost always light',
    detail: `Only ${pctText(heavy)} of your compound sets in 6 weeks were above 75% of your estimated max (typically ${pctText(median(rel.map((x) => x.r)))}). Light, higher-rep sets build muscle, but strength needs some heavier work too.`,
    steps: [
      `Start your first lift of the day with 3 sets of 4–6 reps at about 80% of your max${example > 0 ? ` — for ${main.name}, around ${example} lb` : ''}.`,
      'Keep the lighter, higher-rep sets for the lifts after it.',
      'Training purely for size? A few heavy sets a week still help you keep progressing.',
    ],
    evidence: `${rel.length} compound sets in the last 6 weeks`,
  };
}

function suggestions(recent: LiftSession[], pending: CoachPending[]): CoachInsight | null {
  const rows = recent.map((s) => topSet(s.sets)).filter((t): t is SetLog => !!t && Number(t.plannedWeight) > 0);
  if (rows.length < 10) {
    pending.push({ area: 'Following the suggested weights', need: 'lifts done with a suggested weight', have: rows.length, of: 10 });
    return null;
  }
  const under = rows.filter((t) => Number(t.weight) < Number(t.plannedWeight) * 0.97);
  const over = rows.filter((t) => Number(t.weight) > Number(t.plannedWeight) * 1.03);
  const rirOf = (list: SetLog[]) => { const r = list.map((t) => t.rir).filter((x): x is number => typeof x === 'number'); return r.length ? median(r) : null; };
  const evidence = `${rows.length} lifts with a suggested weight`;
  if (share(under.length, rows.length) >= 0.4) {
    const rir = rirOf(under);
    if (rir !== null && rir >= 2) {
      return {
        id: 'suggestions-under', category: 'suggestions', tone: 'warn', priority: 76,
        title: 'You lift below the suggested weight — with reps to spare',
        detail: `On ${under.length} of ${rows.length} lifts your top set was lighter than suggested, yet those sets still ended with about ${rir} reps left.`,
        steps: [
          'Start each lift at the suggested weight — it comes from your own logged sets.',
          'If a set really is too heavy, log the reps you got; the next suggestion adjusts.',
          'Want everything a little lighter on purpose? Lower Default Intensity in your profile instead of changing weights by hand.',
        ],
        evidence,
      };
    }
    return {
      id: 'suggestions-under', category: 'suggestions', tone: 'info', priority: 50,
      title: 'The suggested weights look too heavy for you',
      detail: `On ${under.length} of ${rows.length} lifts you went lighter than suggested${rir !== null ? `, and those sets were still hard (about ${rir} left)` : ''}.`,
      steps: ['Lower Default Intensity in your profile (✏️ Edit Profile) to about 0.9.', 'Keep logging reps-left honestly so the suggestions recalibrate.'],
      evidence,
    };
  }
  if (share(over.length, rows.length) >= 0.4) {
    const rir = rirOf(over);
    if (rir !== null && rir <= 1) {
      return {
        id: 'suggestions-over', category: 'suggestions', tone: 'warn', priority: 66,
        title: 'You go heavier than suggested, and grind',
        detail: `On ${over.length} of ${rows.length} lifts you went heavier than suggested, and those sets ended with about ${rir} rep${rir === 1 ? '' : 's'} left.`,
        steps: ['Start at the suggested weight and let a set with 3+ reps left earn the jump.', 'Heavier-than-planned top sets tend to cost you reps on every set after them.'],
        evidence,
      };
    }
    return {
      id: 'suggestions-over', category: 'suggestions', tone: 'info', priority: 45,
      title: 'You’re outpacing the suggested weights',
      detail: `On ${over.length} of ${rows.length} lifts you went heavier than suggested and still had reps left.`,
      steps: ['Raise Default Intensity in your profile to about 1.1 so the suggestions keep up.'],
      evidence,
    };
  }
  return null;
}

function rest(recent: LiftSession[], pending: CoachPending[]): CoachInsight[] {
  type Gap = { secs: number; heavy: boolean; light: boolean; name: string; workout: string };
  const gaps: Gap[] = [];
  let dropping = 0;
  let multiSet = 0;
  for (const s of recent) {
    if (s.meta?.supersetId) continue; // alternating lifts: the gap isn't the rest
    const timed = s.sets.filter((x) => Number(x.timestamp) > 0).sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
    for (let i = 1; i < timed.length; i++) {
      const secs = (Number(timed[i].timestamp) - Number(timed[i - 1].timestamp)) / 1000;
      if (secs < 30 || secs > 600) continue;
      const reps = Number(timed[i].reps);
      gaps.push({ secs, heavy: reps <= 6 && isCompound(s.meta), light: reps > 12 || !isCompound(s.meta), name: s.name, workout: s.workout.id || s.workout.timestamp });
    }
    // Reps falling off at the same weight across 3+ sets.
    const sameWeight = s.sets.filter((x) => Number(x.weight) === Number(s.sets[0].weight));
    if (sameWeight.length >= 3) {
      multiSet++;
      const first = Number(sameWeight[0].reps);
      const last = Number(sameWeight[sameWeight.length - 1].reps);
      if (first > 0 && (first - last) / first >= 0.25) dropping++;
    }
  }
  if (gaps.length < 10) {
    pending.push({ area: 'Rest between sets', need: 'rests timed between logged sets', have: gaps.length, of: 10 });
    return [];
  }
  const out: CoachInsight[] = [];
  const heavy = gaps.filter((g) => g.heavy);
  const dropRate = share(dropping, multiSet);
  if (heavy.length >= 8 && median(heavy.map((g) => g.secs)) < 120) {
    const byName = new Map<string, number[]>();
    heavy.forEach((g) => byName.set(g.name, [...(byName.get(g.name) || []), g.secs]));
    const names = [...byName].sort((a, b) => median(a[1]) - median(b[1])).slice(0, 2).map(([n]) => n);
    out.push({
      id: 'rest-heavy-short', category: 'rest', tone: 'warn', priority: 78,
      title: 'You rest too little between heavy sets',
      detail: `Between heavy sets (6 reps or fewer on big lifts) you rest about ${clock(median(heavy.map((g) => g.secs)))}. Heavy sets need 2–3 minutes for strength to come back${multiSet >= 4 ? `; ${pctText(dropRate)} of the time your reps drop by a quarter or more from first set to last` : ''}.`,
      steps: [
        `Rest 2:30–3:00 between heavy sets${names.length ? ` of ${listNames(names)}` : ''}. Tap +15 on the rest timer until it reads that — it remembers it for each lift.`,
        'Start the next set when the timer says “Rested”, not when you feel ready.',
      ],
      evidence: `${heavy.length} timed rests between heavy sets`,
    });
  } else if (multiSet >= 6 && dropRate >= 0.5) {
    out.push({
      id: 'rep-dropoff', category: 'rest', tone: 'info', priority: 52,
      title: 'Your reps fall off sharply across sets',
      detail: `In ${dropping} of ${multiSet} lifts done for 3+ sets at one weight, the last set had at least a quarter fewer reps than the first.`,
      steps: ['Rest a little longer (about 30 seconds more) between those sets.', 'Or start slightly lighter so every set lands in your rep range.'],
      evidence: `${multiSet} lifts with 3+ sets at the same weight`,
    });
  }
  const light = gaps.filter((g) => g.light);
  const lightMedian = light.length ? median(light.map((g) => g.secs)) : 0;
  if (light.length >= 10 && lightMedian > 210) {
    const perWorkout = light.length / new Set(light.map((g) => g.workout)).size;
    const saved = Math.round(((lightMedian - 105) * perWorkout) / 60);
    const byName = new Map<string, number[]>();
    light.forEach((g) => byName.set(g.name, [...(byName.get(g.name) || []), g.secs]));
    const names = [...byName].sort((a, b) => median(b[1]) - median(a[1])).slice(0, 2).map(([n]) => n);
    out.push({
      id: 'rest-light-long', category: 'rest', tone: 'info', priority: 34,
      title: 'Long rests on lighter lifts',
      detail: `You rest about ${clock(lightMedian)} between sets of isolation and high-rep work. About 1:30–2:00 is plenty there${saved >= 3 ? ` — that would save around ${saved} minutes a workout` : ''}.`,
      steps: [`Set the rest timer to about 1:45 on ${listNames(names) || 'those lifts'}.`, 'Or pair two of them as a superset and alternate.'],
      evidence: `${light.length} timed rests on lighter lifts`,
    });
  }
  return out;
}

function warmups(recent: LiftSession[], before: Map<LiftSession, number>, pending: CoachPending[]): CoachInsight | null {
  const heavyFirst = recent.filter((s) => s.firstCompound && before.has(s) && Number(topSet(s.sets)?.weight) / before.get(s)! >= 0.7);
  if (heavyFirst.length < 8) {
    pending.push({ area: 'Warming up', need: 'workouts that start with a heavy lift', have: heavyFirst.length, of: 8 });
    return null;
  }
  const warmed = heavyFirst.filter((s) => (s.workout.warmups?.[s.liftId] || []).length > 0).length;
  const rate = share(warmed, heavyFirst.length);
  if (rate >= 0.25) return null;
  return {
    id: 'warmups', category: 'warmup', tone: 'info', priority: 55,
    title: 'You rarely warm up before heavy lifts',
    detail: `Only ${warmed} of ${heavyFirst.length} workouts that opened with a heavy compound lift had warm-up sets ticked off. Warm-ups make the first working set stronger and safer (or you warm up but don't tick them).`,
    steps: [
      'Do the 2–3 warm-up sets the tracker lists above your first heavy lift, and tick them off.',
      'Ramp quickly from about half your working weight to about 85%; the lifts after it don’t need their own.',
    ],
    evidence: `${heavyFirst.length} workouts starting with a heavy lift`,
  };
}

const MAJOR = ['Chest', 'Back', 'Shoulders', 'Quads', 'Hamstrings', 'Glutes', 'Biceps', 'Triceps'];

function muscles(history: TrainingWorkout[], now: number, pending: CoachPending[]): CoachInsight[] {
  const since = now - 28 * DAY_MS;
  const recent = history.filter((w) => !w.isDeload && Date.parse(w.timestamp) >= since);
  if (recent.length < 6) {
    pending.push({ area: 'How volume is spread across muscles', need: 'workouts in the last 4 weeks', have: recent.length, of: 6 });
    return [];
  }
  const sets = new Map<string, number>();
  const days = new Map<string, Set<string>>();
  for (const w of recent) {
    const day = w.timestamp.slice(0, 10);
    for (const [liftId, raw] of Object.entries(w.logs || {})) {
      const n = working(raw).length;
      const meta = w.liftMeta?.[liftId];
      const add = (m: string | undefined, f: number) => {
        if (!m || m === 'None') return;
        sets.set(m, (sets.get(m) || 0) + n * f);
        if (f === 1) days.set(m, (days.get(m) || new Set()).add(day));
      };
      add(meta?.primaryMuscle, 1);
      add(meta?.secondaryMuscle, 0.5);
    }
  }
  const weekly = (m: string) => (sets.get(m) || 0) / 4;
  const trained = MAJOR.filter((m) => weekly(m) >= 8);
  const out: CoachInsight[] = [];
  const neglected = MAJOR.filter((m) => weekly(m) < 3);
  if (trained.length >= 2 && neglected.length) {
    const ideas = neglected.slice(0, 3).map((m) => {
      const options = CATALOG_LIFT_NAMES.filter((n) => inferLiftDetails(n)?.primaryMuscle === m).slice(0, 2);
      return `${m}: add 3 sets of ${listNames(options) || 'one exercise'} twice a week.`;
    });
    out.push({
      id: 'neglected', category: 'volume', tone: 'warn', priority: 62,
      title: `${listNames(neglected.slice(0, 3))} get${neglected.length === 1 ? 's' : ''} very little work`,
      detail: `Over the last 4 weeks: ${neglected.map((m) => `${m} ${weekly(m).toFixed(1)}`).join(', ')} sets a week, while ${listNames(trained.slice(0, 3))} get 8 or more. Most muscles grow best on about 10–20 sets a week.`,
      steps: ideas,
      evidence: `${recent.length} workouts in the last 4 weeks`,
    });
  }
  const onceAWeek = trained.filter((m) => (days.get(m)?.size || 0) / 4 <= 1.2);
  if (onceAWeek.length >= 2) {
    out.push({
      id: 'frequency', category: 'volume', tone: 'info', priority: 40,
      title: 'Big muscles trained only once a week',
      detail: `${listNames(onceAWeek.slice(0, 3))} get all their weekly sets on a single day. The same sets split over two days usually builds more muscle and each session is fresher.`,
      steps: ['Split each muscle’s weekly sets across two workouts (e.g. half on Monday, half on Thursday) rather than adding more.'],
      evidence: `${recent.length} workouts in the last 4 weeks`,
    });
  }
  return out;
}

/** Everything the training log says, plus what's still being learned. */
export function trainingAdvice(history: TrainingWorkout[], now = Date.now()): TrainingAdvice {
  const since = now - COACH_WINDOW_DAYS * DAY_MS;
  const sessions = liftSessions(history.filter((w) => Date.parse(w.timestamp) <= now));
  const recent = sessions.filter((s) => s.at >= since);
  const { best, before } = bestBefore(sessions);
  const pending: CoachPending[] = [];
  const fine: string[] = [];
  // Run one check; if it had the data and found nothing, it "looks fine".
  const check = (area: string, run: () => CoachInsight | CoachInsight[] | null) => {
    const waiting = pending.length;
    const found = [run()].flat().filter((i): i is CoachInsight => !!i);
    if (pending.length === waiting && !found.some((i) => i.tone !== 'good')) fine.push(area);
    return found;
  };
  const insights = [
    ...check('How hard you train', () => effort(recent, pending)),
    ...check('Adding weight when lifts get easy', () => progression(sessions, since, pending)),
    ...check('How heavy your main lifts are', () => heaviness(recent, before, best, pending)),
    ...check('Following the suggested weights', () => suggestions(recent, pending)),
    ...check('Rest between sets', () => rest(recent, pending)),
    ...check('Warming up', () => warmups(recent, before, pending)),
    ...check('How volume is spread across muscles', () => muscles(history, now, pending)),
  ];
  return { insights, pending, fine, workouts: new Set(recent.map((s) => s.workout.timestamp)).size };
}

/** Training advice and health findings in one list, most important first. */
export function sortInsights(list: CoachInsight[]) {
  const seen = new Set<string>();
  return list
    .filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)))
    .sort((a, b) => (a.tone === 'warn' ? 0 : 1) - (b.tone === 'warn' ? 0 : 1) || b.priority - a.priority);
}

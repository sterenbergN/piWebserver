import { calcAverage1RM } from './analytics';
import { ACTIVITY_LEVELS, buildSeededCalculatorDefaults, calculateMifflinStJeor, type ActivityLevel } from './calculators';
import { exerciseKey, exerciseName } from './exercises';
import { formatMinutes, lastKeys, localKey, readiness } from './health-insights';
import { coachInsights, restRecovery, type CoachInsight } from './health-coach';
import { exerciseVariant } from './related-exercises';
import { sortInsights, trainingAdvice, type CoachPending, type TrainingAdvice, type TrainingWorkout } from './training-coach';
import type { HealthDay, PublicHealth } from './health';

// The whole coach: advice from the training log, findings from Apple Health,
// and the two read together — training advice adjusted for sleep, recovery
// and how fast you're cutting; rest advice backed by heart rate; whether your
// hardest day follows your worst night; the activity level your Watch
// actually shows; and strength relative to bodyweight.

export type CoachProfile = { sex: 'male' | 'female'; age: number; heightInches: number; weightLbs: number; activityLevel: ActivityLevel };

const DAY_MS = 86_400_000;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const COMPOUND = new Set(['press', 'overhead', 'squat', 'hinge', 'row', 'pulldown']);
const mean = (l: number[]) => l.reduce((a, b) => a + b, 0) / l.length;
type Days = Record<string, HealthDay>;

/** The calculator's view of you (its saved inputs, else your profile), or null if incomplete. */
export function profileFromUser(user: Record<string, any> | null | undefined): CoachProfile | null {
  if (!user) return null;
  const c = buildSeededCalculatorDefaults(user).calorie || {};
  const num = (v: unknown) => (typeof v === 'number' && v > 0 ? v : null);
  const age = num(c.age);
  const heightInches = num(c.heightInches);
  const weightLbs = num(c.weightLbs) ?? num(Number(user.weight));
  if (!age || !heightInches || !weightLbs) return null;
  return { sex: c.sex === 'female' ? 'female' : 'male', age, heightInches, weightLbs, activityLevel: c.activityLevel || 'moderate' };
}

/** Daily steps that roughly match each activity level, when there's no calorie data. */
const STEP_LEVELS: [number, ActivityLevel][] = [[5000, 'sedentary'], [7500, 'light'], [10000, 'moderate'], [12500, 'very-active'], [Infinity, 'extra-active']];

export type MeasuredActivity = {
  /** Complete days the estimate is based on. */
  days: number;
  basis: 'calories' | 'steps' | null;
  avgActive: number | null;
  avgResting: number | null;
  avgSteps: number | null;
  level: (typeof ACTIVITY_LEVELS)[number] | null;
  multiplier: number | null;
  /** Calories a day to stay the same weight, from what was measured. */
  maintenance: number | null;
  bmr: number;
};

/**
 * Your activity level from Apple Health over the last two weeks (complete
 * days only): total burn — resting plus active calories (your formula BMR
 * stands in for resting if Health hasn't sent it) — over your formula BMR
 * gives the calculator's activity multiplier. Without calorie data, average daily
 * steps pick a level instead. Needs 7 days of either.
 */
export function measuredActivity(days: Days, profile: Omit<CoachProfile, 'activityLevel'>, now = Date.now()): MeasuredActivity {
  const keys = lastKeys(localKey(now - DAY_MS), 14); // yesterday back: today isn't finished
  const pick = (f: (d: HealthDay) => number | undefined, min: number) => keys.map((k) => (days[k] ? f(days[k]) : undefined)).filter((v): v is number => typeof v === 'number' && v >= min);
  const active = pick((d) => d.activeKcal, 50);
  const resting = pick((d) => d.restingKcal, 800);
  const steps = pick((d) => d.steps, 200);
  const { bmr } = calculateMifflinStJeor({ ...profile, activityLevel: 'sedentary' });
  const nearest = (m: number) => ACTIVITY_LEVELS.reduce((best, l) => (Math.abs(l.multiplier - m) < Math.abs(best.multiplier - m) ? l : best));
  const avgSteps = steps.length ? Math.round(mean(steps)) : null;
  if (active.length >= 7) {
    const avgActive = Math.round(mean(active));
    const avgResting = resting.length >= 7 ? Math.round(mean(resting)) : null;
    // Watch active calories tend to run high, which roughly covers digestion (TEF) that Health doesn't count.
    const total = (avgResting ?? bmr) + avgActive;
    const multiplier = total / bmr;
    return { days: active.length, basis: 'calories', avgActive, avgResting, avgSteps, level: nearest(multiplier), multiplier, maintenance: Math.round(total / 10) * 10, bmr: Math.round(bmr) };
  }
  if (steps.length >= 7) {
    const value = STEP_LEVELS.find(([max]) => avgSteps! < max)![1];
    const level = ACTIVITY_LEVELS.find((l) => l.value === value)!;
    return { days: steps.length, basis: 'steps', avgActive: null, avgResting: null, avgSteps, level, multiplier: level.multiplier, maintenance: Math.round(bmr * level.multiplier / 10) * 10, bmr: Math.round(bmr) };
  }
  return { days: Math.max(active.length, steps.length), basis: null, avgActive: null, avgResting: null, avgSteps, level: null, multiplier: null, maintenance: null, bmr: Math.round(bmr) };
}

/** What the measurement was, in words, e.g. "2,710 kcal a day (1,850 resting + 610 active)". */
export function describeActivity(m: MeasuredActivity) {
  if (m.basis === 'calories') {
    return m.avgResting !== null
      ? `you burn about ${m.maintenance!.toLocaleString()} kcal a day (${m.avgResting.toLocaleString()} resting + ${m.avgActive!.toLocaleString()} active, over ${m.days} days)`
      : `you burn about ${m.avgActive!.toLocaleString()} active kcal a day on top of resting (over ${m.days} days)`;
  }
  if (m.basis === 'steps') return `you average ${m.avgSteps!.toLocaleString()} steps a day (over ${m.days} days)`;
  return '';
}

/** Body weight trend over the last `days` days, as % of bodyweight per week (null without data). */
function weightRatePct(days: Days, now: number, span = 42) {
  const pts = lastKeys(localKey(now), span).map((k, i) => ({ x: i, y: days[k]?.weight })).filter((p): p is { x: number; y: number } => typeof p.y === 'number');
  if (pts.length < 4 || pts[pts.length - 1].x - pts[0].x < 14) return null;
  const mx = mean(pts.map((p) => p.x));
  const my = mean(pts.map((p) => p.y));
  const slope = pts.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0) / pts.reduce((s, p) => s + (p.x - mx) ** 2, 0);
  return (slope * 7 / my) * 100;
}

/** Does your hardest training day of the week come after your worst night? */
function sleepVsSchedule(history: TrainingWorkout[], days: Days, now: number, pending: CoachPending[]): CoachInsight | null {
  const since = now - 56 * DAY_MS;
  const sleepByDay = new Map<number, number[]>();
  for (const key of lastKeys(localKey(now), 56)) {
    const night = days[key]?.sleep;
    if (!night) continue;
    const [y, m, d] = key.split('-').map(Number);
    const wd = new Date(y, m - 1, d).getDay();
    sleepByDay.set(wd, [...(sleepByDay.get(wd) || []), night.asleepMin]);
  }
  const setsByDay = new Map<number, { sets: number; sessions: number }>();
  for (const w of history) {
    const at = Date.parse(w.timestamp);
    if (w.isDeload || at < since || at > now) continue;
    const wd = new Date(at).getDay();
    const sets = Object.values(w.logs || {}).reduce((n, list) => n + (list || []).filter((s) => Number(s.reps) > 0).length, 0);
    const cur = setsByDay.get(wd) || { sets: 0, sessions: 0 };
    setsByDay.set(wd, { sets: cur.sets + sets, sessions: cur.sessions + 1 });
  }
  const nights = [...sleepByDay.values()].flat();
  const [hardDay, hard] = [...setsByDay].filter(([, v]) => v.sessions >= 3).sort((a, b) => b[1].sets - a[1].sets)[0] || [];
  if (nights.length < 21 || hardDay === undefined || (sleepByDay.get(hardDay) || []).length < 3) {
    pending.push({ area: 'Sleep vs your training week', need: 'nights of sleep with your usual training days', have: Math.min(nights.length, 21), of: 21 });
    return null;
  }
  const usual = mean(nights);
  const before = mean(sleepByDay.get(hardDay)!);
  if (usual - before < 40) return null;
  const prevDay = WEEKDAYS[(hardDay + 6) % 7];
  const best = [...sleepByDay].filter(([, l]) => l.length >= 3).sort((a, b) => mean(b[1]) - mean(a[1]))[0][0];
  const gap = Math.round((usual - before) / 15) * 15;
  return {
    id: 'sleep-schedule', category: 'sleep', tone: 'warn', priority: 64, usesHealth: true,
    title: 'Your hardest day follows your shortest night',
    detail: `${WEEKDAYS[hardDay]} is your biggest training day (${hard!.sets} sets over 8 weeks), but you sleep ${formatMinutes(before)} on ${prevDay} nights vs ${formatMinutes(usual)} on average.`,
    steps: [
      `Get to bed about ${gap} minutes earlier on ${prevDay} nights.`,
      // Sleep is filed under the day you wake, so sleepByDay[best] is the night before `best`.
      best !== hardDay ? `Or move your heaviest session to ${WEEKDAYS[best]}, which follows your best night (${formatMinutes(mean(sleepByDay.get(best)!))}).` : 'Or swap it with a lighter day.',
    ],
    evidence: `${nights.length} nights and 8 weeks of workouts`,
  };
}

function activityLevelCheck(days: Days, profile: CoachProfile | null, now: number, pending: CoachPending[]): CoachInsight | null {
  if (!profile) return null;
  const m = measuredActivity(days, profile, now);
  if (!m.level) {
    pending.push({ area: 'Your activity level from Apple Health', need: 'days of calories burned (or steps)', have: m.days, of: 7 });
    return null;
  }
  if (m.level.value === profile.activityLevel) return null;
  const chosen = ACTIVITY_LEVELS.find((l) => l.value === profile.activityLevel)!;
  const current = Math.round(m.bmr * chosen.multiplier / 10) * 10;
  return {
    id: 'activity-level', category: 'activity', tone: 'info', priority: 48, usesHealth: true,
    title: `Your data says your activity level is “${m.level.label}”`,
    detail: `Apple Health shows ${describeActivity(m)} — that fits ${m.level.label}, not the ${chosen.label} your calorie plan uses (${current.toLocaleString()} vs about ${m.maintenance!.toLocaleString()} kcal to maintain).`,
    steps: [`Switch to ${m.level.label} in Health → Plan (or the calorie calculator); there's a one-tap button.`, 'Your calorie target and weight projection then match how active you really are.'],
    evidence: m.basis === 'calories' ? `${m.days} days of calories from Apple Health` : `${m.days} days of steps`,
  };
}

function relativeStrength(history: TrainingWorkout[], days: Days, now: number): CoachInsight | null {
  const half = now - 21 * DAY_MS;
  const start = now - 42 * DAY_MS;
  const bw = (keys: string[]) => { const l = keys.map((k) => days[k]?.weight).filter((v): v is number => !!v); return l.length ? mean(l) : null; };
  const bwNow = bw(lastKeys(localKey(now), 21));
  const bwThen = bw(lastKeys(localKey(half), 21));
  if (!bwNow || !bwThen) return null;
  const best = (from: number, to: number) => {
    const m = new Map<string, { name: string; e1rm: number; n: number }>();
    for (const w of history) {
      const at = Date.parse(w.timestamp);
      if (w.isDeload || at < from || at >= to) continue;
      for (const [liftId, sets] of Object.entries(w.logs || {})) {
        const meta = w.liftMeta?.[liftId];
        if (!COMPOUND.has(exerciseVariant(exerciseName(meta))?.family || '')) continue;
        const key = exerciseKey(meta) || liftId;
        const top = Math.max(0, ...(sets || []).filter((s) => Number(s.reps) >= 1 && Number(s.reps) <= 12).map((s) => calcAverage1RM(Number(s.weight) || 0, Number(s.reps))));
        if (!top) continue;
        const cur = m.get(key);
        m.set(key, { name: exerciseName(meta) || 'Lift', e1rm: Math.max(cur?.e1rm || 0, top), n: (cur?.n || 0) + 1 });
      }
    }
    return m;
  };
  const now3 = best(half, now + 1);
  const then3 = best(start, half);
  const lifts = [...now3].filter(([k]) => then3.has(k)).sort((a, b) => b[1].n - a[1].n).slice(0, 3)
    .map(([k, v]) => ({ name: v.name, now: v.e1rm / bwNow, then: then3.get(k)!.e1rm / bwThen }));
  if (!lifts.length) return null;
  const change = mean(lifts.map((l) => l.now - l.then));
  if (Math.abs(change) < 0.02) return null;
  const up = change > 0;
  return {
    id: 'relative-strength', category: 'body', tone: up ? 'good' : 'info', priority: up ? 28 : 46, usesHealth: true,
    title: up ? 'Stronger for your bodyweight' : 'Strength for your bodyweight is slipping',
    detail: `${lifts.map((l) => `${l.name} ${l.now.toFixed(2)}× bodyweight (was ${l.then.toFixed(2)}×)`).join(', ')} — your estimated max divided by your scale weight, last 3 weeks vs the 3 before.`,
    steps: up ? undefined : ['If you’re bulking this can be fine for a while; if you’re cutting or holding weight, see the weight-and-strength point and check sleep.'],
    evidence: `scale weigh-ins and ${lifts.length} main lift${lifts.length === 1 ? '' : 's'} over 6 weeks`,
  };
}

/** Everything the coach has to say, training and health together, most important first. */
export function fullCoach({ history, health, profile = null, now = Date.now() }: {
  history: TrainingWorkout[];
  health?: Pick<PublicHealth, 'days' | 'workouts'> | null;
  profile?: CoachProfile | null;
  now?: number;
}): TrainingAdvice {
  const days: Days = health?.days || {};
  const hasHealth = Object.keys(days).length > 0;

  // Easing off on a low-readiness day is the right call, not a lack of effort.
  const easyDays = new Set<string>();
  if (hasHealth) {
    for (const w of history) {
      const key = localKey(new Date(w.timestamp));
      if (readiness(days, key)?.level === 'low') easyDays.add(key);
    }
  }
  const training = trainingAdvice(history, now, { easyDays });
  if (!hasHealth) return training;

  const fromHealth = coachInsights({ history, days, workoutHealth: health?.workouts || {}, now }).map((i) => ({ ...i, usesHealth: true }));
  const pending = [...training.pending];
  const insights: CoachInsight[] = training.insights.map((i) => ({ ...i }));

  // Why progress might be stalling: sleep, recovery, or a fast cut — fix those first.
  const nights = lastKeys(localKey(now), 14).map((k) => days[k]?.sleep?.asleepMin).filter((v): v is number => typeof v === 'number');
  const sleepAvg = nights.length >= 7 ? mean(nights) : null;
  const strained = fromHealth.some((i) => i.id === 'recovery-load' && i.tone === 'warn');
  const rate = weightRatePct(days, now);
  const progression = insights.find((i) => i.id === 'progression' && i.tone === 'warn');
  if (progression) {
    const why: string[] = [];
    const first: string[] = [];
    if (sleepAvg !== null && sleepAvg < 405) { why.push(`you're averaging ${formatMinutes(sleepAvg)} of sleep`); first.push(`Sleep first: strength rarely climbs on under 7 hours, and you're averaging ${formatMinutes(sleepAvg)}.`); }
    if (strained) { why.push('your resting heart rate / HRV show extra strain this week'); first.push('Let resting heart rate settle (a lighter week if it doesn’t) before pushing weights up.'); }
    if (rate !== null && rate <= -0.9) { why.push(`you're losing about ${Math.abs(rate).toFixed(1)}% of bodyweight a week`); first.push(`On a cut this fast, holding your weights is a win — keep effort high, and slow the cut if lifts start dropping.`); }
    if (why.length) {
      progression.detail += ` Your health data suggests part of why: ${why.join(', and ')}.`;
      progression.steps = [...first, ...(progression.steps || [])];
      progression.usesHealth = true;
    }
  }

  // Rest: back the set-times advice with what heart rate shows, instead of saying it twice.
  const restShort = insights.find((i) => i.id === 'rest-heavy-short');
  if (restShort) {
    const rows = restRecovery(history, health?.workouts || {}, days).filter((r) => r.recovered < 0.6);
    const named = rows.find((r) => restShort.steps?.some((s) => s.includes(r.name))) || rows[0];
    if (named) {
      restShort.detail += ` Your Watch agrees: on ${named.name} your heart rate has only come ${Math.round(named.recovered * 100)}% of the way down when the next set starts.`;
      restShort.usesHealth = true;
    }
  }
  const health2 = fromHealth.filter((i) => !(restShort && i.id === 'rest-short'));

  const extra = [
    sleepVsSchedule(history, days, now, pending),
    activityLevelCheck(days, profile, now, pending),
    relativeStrength(history, days, now),
  ].filter((i): i is CoachInsight => !!i);

  return { ...training, pending, insights: sortInsights([...insights, ...health2, ...extra]) };
}

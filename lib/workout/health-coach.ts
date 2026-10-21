import { calcAverage1RM } from './analytics';
import { exerciseKey, exerciseName } from './exercises';
import { formatMinutes, lastKeys, localKey, readiness, shiftKey } from './health-insights';
import type { HealthDay, WorkoutHealth } from './health';

// Health data read against the training log: does sleep or readiness show
// up in your lifts, is recovery keeping up with the work, is body weight
// moving the way strength needs, and are you resting long enough between
// sets. Every insight needs a minimum amount of data and says how much it's
// based on; with too little, it says nothing rather than guess.

export type CoachInsight = {
  id: string;
  category: 'sleep' | 'recovery' | 'body' | 'rest' | 'activity';
  tone: 'good' | 'warn' | 'info';
  title: string;
  detail: string;
  tip?: string;
  /** What it's based on, e.g. "12 workouts with sleep data". */
  evidence: string;
  /** Higher shows first. */
  priority: number;
};

type SetLog = { weight?: number; reps?: number; timestamp?: number };
export type CoachWorkout = {
  id?: string;
  timestamp: string;
  isDeload?: boolean;
  logs?: Record<string, SetLog[] | undefined>;
  liftMeta?: Record<string, { name?: string; exercise?: string } | undefined>;
};
type Days = Record<string, HealthDay>;

const DAY_MS = 86_400_000;
const mean = (list: number[]) => list.reduce((a, b) => a + b, 0) / list.length;
const pct = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(Math.round(n * 10) / 10)}%`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function slopePerDay(points: { x: number; y: number }[]) {
  if (points.length < 2) return null;
  const mx = mean(points.map((p) => p.x));
  const my = mean(points.map((p) => p.y));
  const den = points.reduce((s, p) => s + (p.x - mx) ** 2, 0);
  return den ? points.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0) / den : null;
}

/** Best estimated 1RM per exercise in one workout (sets of 1–12 reps with weight). */
function topLifts(w: CoachWorkout) {
  const out = new Map<string, number>();
  for (const [liftId, sets] of Object.entries(w.logs || {})) {
    const key = exerciseKey(w.liftMeta?.[liftId]) || liftId;
    for (const s of sets || []) {
      const reps = Number(s.reps);
      const weight = Number(s.weight);
      if (!(reps >= 1 && reps <= 12 && weight > 0)) continue;
      out.set(key, Math.max(out.get(key) || 0, calcAverage1RM(weight, reps)));
    }
  }
  return out;
}

/**
 * How strong each workout was compared with your recent form: for each lift,
 * today's best estimated 1RM as a share of your best on that lift in the 90
 * days before, averaged over the lifts. 1.00 = matched your recent best.
 */
export function sessionStrength(history: CoachWorkout[]): Map<string, { index: number; lifts: number }> {
  const sorted = history.filter((w) => w.id && !w.isDeload).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const seen: { at: number; lifts: Map<string, number> }[] = [];
  const out = new Map<string, { index: number; lifts: number }>();
  for (const w of sorted) {
    const at = Date.parse(w.timestamp);
    const lifts = topLifts(w);
    const ratios: number[] = [];
    for (const [key, e1rm] of lifts) {
      const before = seen.filter((s) => s.at < at && s.at >= at - 90 * DAY_MS).map((s) => s.lifts.get(key) || 0);
      const best = Math.max(0, ...before);
      if (best > 0) ratios.push(e1rm / best);
    }
    if (ratios.length) out.set(w.id!, { index: mean(ratios), lifts: ratios.length });
    seen.push({ at, lifts });
  }
  return out;
}

/** Compare session strength between two groups of workouts; null without 3+ in each. */
function compareGroups(a: number[], b: number[]) {
  if (a.length < 3 || b.length < 3) return null;
  return { a: mean(a) * 100, b: mean(b) * 100, diff: (mean(a) - mean(b)) * 100 };
}

function sleepAndStrength(history: CoachWorkout[], days: Days, strength: ReturnType<typeof sessionStrength>): CoachInsight | null {
  const rested: number[] = [];
  const short: number[] = [];
  for (const w of history) {
    const s = w.id ? strength.get(w.id) : undefined;
    const night = days[localKey(new Date(w.timestamp))]?.sleep;
    if (!s || !night) continue;
    if (night.asleepMin >= 420) rested.push(s.index);
    else if (night.asleepMin < 390) short.push(s.index);
  }
  const c = compareGroups(rested, short);
  if (!c) return null;
  const evidence = `${plural(rested.length + short.length, 'workout')} with sleep data (${rested.length} after 7h+, ${short.length} after under 6½h)`;
  if (c.diff >= 2) {
    return {
      id: 'sleep-strength', category: 'sleep', tone: 'warn', priority: 80 + Math.min(15, c.diff),
      title: 'Short nights cost you strength',
      detail: `After 7 hours or more, your top sets average ${Math.round(c.a)}% of your recent best; after under 6½ hours, ${Math.round(c.b)}%. That's about ${Math.round(c.diff)}% weaker on short sleep.`,
      tip: 'Guard sleep before heavy days. After a short night, keep the planned sets but skip PR attempts.',
      evidence,
    };
  }
  if (c.diff <= -2) return null; // stronger after short sleep: likely noise, don't advise on it
  return {
    id: 'sleep-strength', category: 'sleep', tone: 'info', priority: 20,
    title: 'Sleep hasn’t shown up in your lifts yet',
    detail: `Your top sets are about the same after short and full nights (${Math.round(c.b)}% vs ${Math.round(c.a)}% of your recent best).`,
    evidence,
  };
}

function readinessAndStrength(history: CoachWorkout[], days: Days, strength: ReturnType<typeof sessionStrength>): CoachInsight | null {
  const low: number[] = [];
  const ok: number[] = [];
  for (const w of history) {
    const s = w.id ? strength.get(w.id) : undefined;
    if (!s) continue;
    const r = readiness(days, localKey(new Date(w.timestamp)));
    if (!r) continue;
    (r.level === 'low' ? low : ok).push(s.index);
  }
  const c = compareGroups(ok, low);
  if (!c || c.diff < 2) return null;
  return {
    id: 'readiness-strength', category: 'recovery', tone: 'info', priority: 60 + Math.min(10, c.diff),
    title: 'Low-readiness mornings predict weaker sessions',
    detail: `On days your readiness was low you averaged ${Math.round(c.b)}% of your recent best, vs ${Math.round(c.a)}% on normal days.`,
    tip: 'When the readiness card says take it easier, the lower intensity it offers is worth using.',
    evidence: `${plural(low.length + ok.length, 'workout')} with readiness (${low.length} low)`,
  };
}

/** Sets in the 7 days ending `end` (exclusive of deloads). */
function setsBetween(history: CoachWorkout[], from: number, to: number) {
  return history
    .filter((w) => !w.isDeload && Date.parse(w.timestamp) >= from && Date.parse(w.timestamp) < to)
    .reduce((n, w) => n + Object.values(w.logs || {}).reduce((m, sets) => m + (sets || []).filter((s) => Number(s.reps) > 0).length, 0), 0);
}

function recoveryVsLoad(history: CoachWorkout[], days: Days, today: string, now: number): CoachInsight | null {
  const week = lastKeys(today, 7);
  const base = lastKeys(shiftKey(today, 7), 28);
  const vals = (keys: string[], pick: (d: HealthDay) => number | undefined) => keys.map((k) => (days[k] ? pick(days[k]) : undefined)).filter((v): v is number => typeof v === 'number');
  const rhrNow = vals(week, (d) => d.restingHr);
  const rhrBase = vals(base, (d) => d.restingHr);
  const hrvNow = vals(week, (d) => d.hrv);
  const hrvBase = vals(base, (d) => d.hrv);
  if (rhrNow.length < 4 || rhrBase.length < 10) return null;
  const rhrDiff = mean(rhrNow) - mean(rhrBase);
  const hrvChange = hrvNow.length >= 4 && hrvBase.length >= 10 ? (mean(hrvNow) / mean(hrvBase) - 1) * 100 : null;
  const setsNow = setsBetween(history, now - 7 * DAY_MS, now);
  const setsBase = setsBetween(history, now - 35 * DAY_MS, now - 7 * DAY_MS) / 4;
  // No sets this week isn't "−100% load": it just means the strain isn't from training.
  const loadChange = setsBase > 0 && setsNow > 0 ? (setsNow / setsBase - 1) * 100 : null;
  const loadText = loadChange !== null
    ? `, while training sets are ${pct(loadChange)} vs your weekly average (${setsNow} vs ${Math.round(setsBase)})`
    : setsNow === 0 ? ', with no training logged this week' : '';
  const strained = rhrDiff >= 3 || (hrvChange !== null && hrvChange <= -10);
  const evidence = `resting HR on ${rhrNow.length} of the last 7 days vs the 4 weeks before${hrvChange !== null ? ', with HRV' : ''}`;
  const markers = [
    `resting heart rate ${rhrDiff >= 0 ? 'up' : 'down'} ${Math.abs(Math.round(rhrDiff * 10) / 10)} bpm`,
    hrvChange !== null ? `HRV ${pct(hrvChange)}` : '',
  ].filter(Boolean).join(' and ');
  if (strained) {
    const loadUp = loadChange !== null && loadChange >= 15;
    return {
      id: 'recovery-load', category: 'recovery', tone: 'warn', priority: loadUp ? 95 : 75,
      title: loadUp ? 'Recovery isn’t keeping up with the extra work' : 'Your body is under more strain than usual',
      detail: `This week: ${markers} vs your normal${loadText}.`,
      tip: loadUp
        ? 'Hold volume where it is (or take a lighter week) until resting heart rate settles. Sleep is the quickest fix.'
        : 'Often it’s sleep, stress, alcohol or a bug rather than training. If it lasts more than a week, take a lighter week.',
      evidence,
    };
  }
  if (rhrDiff <= -2 || (hrvChange !== null && hrvChange >= 8)) {
    return {
      id: 'recovery-load', category: 'recovery', tone: 'good', priority: 40,
      title: 'Recovering well',
      detail: `This week: ${markers} vs your normal${loadChange !== null ? `, on ${pct(loadChange)} sets vs your weekly average` : ''}. There's room to push.`,
      evidence,
    };
  }
  return null;
}

function bodyVsStrength(history: CoachWorkout[], days: Days, now: number): CoachInsight | null {
  const end = now;
  const start = now - 42 * DAY_MS;
  const keys = lastKeys(localKey(now), 42);
  const weights = keys.map((k, i) => ({ x: i, y: days[k]?.weight })).filter((p): p is { x: number; y: number } => typeof p.y === 'number');
  if (weights.length < 4 || weights[weights.length - 1].x - weights[0].x < 14) return null;
  const perDay = slopePerDay(weights)!;
  const avgWeight = mean(weights.map((p) => p.y));
  const ratePct = (perDay * 7 / avgWeight) * 100; // % of bodyweight per week
  const lbsPerWeek = perDay * 7;

  // Strength: best e1RM per exercise in the last 3 weeks vs the 3 weeks before.
  const half = now - 21 * DAY_MS;
  const best = (from: number, to: number) => {
    const m = new Map<string, number>();
    for (const w of history) {
      const at = Date.parse(w.timestamp);
      if (w.isDeload || at < from || at >= to) continue;
      for (const [k, v] of topLifts(w)) m.set(k, Math.max(m.get(k) || 0, v));
    }
    return m;
  };
  const recent = best(half, end);
  const before = best(start, half);
  const changes = [...recent].filter(([k]) => before.has(k)).map(([k, v]) => (v / before.get(k)! - 1) * 100);
  if (changes.length < 2) return null;
  const strength = mean(changes);

  // Lean vs fat mass from the scale's body fat (first vs last two weeks).
  let comp = '';
  const lean = (ks: string[]) => ks.map((k) => days[k]).filter((d) => d?.weight && d.bodyFat).map((d) => ({ lean: d!.weight! * (1 - d!.bodyFat! / 100), fat: d!.weight! * d!.bodyFat! / 100 }));
  const first = lean(keys.slice(0, 14));
  const last = lean(keys.slice(-14));
  if (first.length >= 2 && last.length >= 2) {
    const dl = mean(last.map((x) => x.lean)) - mean(first.map((x) => x.lean));
    const df = mean(last.map((x) => x.fat)) - mean(first.map((x) => x.fat));
    comp = ` By the scale's estimate that's ${dl >= 0 ? '+' : '−'}${Math.abs(dl).toFixed(1)} lb lean and ${df >= 0 ? '+' : '−'}${Math.abs(df).toFixed(1)} lb fat.`;
  }
  const weightText = Math.abs(lbsPerWeek) < 0.15 ? 'Your weight has held steady' : `You're ${lbsPerWeek < 0 ? 'losing' : 'gaining'} about ${Math.abs(lbsPerWeek).toFixed(1)} lb a week (${Math.abs(ratePct).toFixed(1)}% of bodyweight)`;
  const detail = `${weightText} while your lifts are ${pct(strength)} over the last 3 weeks vs the 3 before.${comp}`;
  const evidence = `${plural(weights.length, 'weigh-in')} and ${plural(changes.length, 'lift')} over 6 weeks`;

  if (ratePct <= -1 && strength <= -2) {
    return { id: 'body-strength', category: 'body', tone: 'warn', priority: 90, title: 'Cutting fast enough to lose strength', detail, evidence,
      tip: 'Slow the loss to about 0.5–1% of bodyweight a week (eat ~200–300 kcal more), keep protein high and keep some heavy sets in every workout.' };
  }
  if (ratePct < -0.2 && strength >= -1) {
    return { id: 'body-strength', category: 'body', tone: 'good', priority: 55, title: 'Losing weight and keeping your strength', detail, evidence,
      tip: 'This is the pace to hold. If strength starts slipping, slow the cut a little.' };
  }
  if (ratePct >= 0.5 && strength < 1) {
    return { id: 'body-strength', category: 'body', tone: 'warn', priority: 70, title: 'Gaining weight faster than strength', detail, evidence,
      tip: 'A smaller surplus (about 0.25–0.5% of bodyweight a week) builds the same muscle with less fat.' };
  }
  if (ratePct > 0.1 && strength >= 1) {
    return { id: 'body-strength', category: 'body', tone: 'good', priority: 50, title: 'Your bulk is paying off', detail, evidence };
  }
  if (Math.abs(ratePct) <= 0.2 && strength <= -2) {
    return { id: 'body-strength', category: 'body', tone: 'warn', priority: 65, title: 'Strength is slipping at a steady weight', detail, evidence,
      tip: 'With weight steady this usually means fatigue or under-recovery: check sleep, and consider a lighter week.' };
  }
  if (Math.abs(ratePct) <= 0.2 && strength >= 1) {
    return { id: 'body-strength', category: 'body', tone: 'good', priority: 45, title: 'Getting stronger at the same weight', detail, evidence };
  }
  return null;
}

function sleepHabits(days: Days, today: string): CoachInsight | null {
  const nights = lastKeys(today, 14).map((k) => days[k]?.sleep).filter((n): n is NonNullable<HealthDay['sleep']> => !!n);
  if (nights.length < 7) return null;
  const avg = mean(nights.map((n) => n.asleepMin));
  const afterNoon = (iso: string) => { const d = new Date(iso); return (d.getHours() * 60 + d.getMinutes() + 720) % 1440; };
  const beds = nights.map((n) => afterNoon(n.bedtime));
  const m = mean(beds);
  const spread = Math.sqrt(mean(beds.map((b) => (b - m) ** 2)));
  const evidence = `${plural(nights.length, 'night')} in the last 2 weeks`;
  if (avg < 420) {
    return {
      id: 'sleep-habits', category: 'sleep', tone: 'warn', priority: 70 + Math.round((420 - avg) / 6),
      title: `Averaging ${formatMinutes(avg)} of sleep`,
      detail: `Most lifters recover and build muscle best on 7–9 hours.${spread > 60 ? ` Your bedtime also varies by about ±${Math.round(spread)} minutes.` : ''}`,
      tip: spread > 60 ? 'A steadier bedtime is the easiest way to add sleep: pick one and keep it within 30 minutes, weekends too.' : 'Even 30 more minutes a night helps recovery. Moving bedtime earlier usually works better than sleeping in.',
      evidence,
    };
  }
  if (spread > 75) {
    return {
      id: 'sleep-habits', category: 'sleep', tone: 'info', priority: 35,
      title: 'Your bedtime moves around a lot',
      detail: `You're getting ${formatMinutes(avg)} on average, but bedtime varies by about ±${Math.round(spread)} minutes, which tends to lower sleep quality.`,
      tip: 'Keeping bedtime within about 30 minutes, weekends included, usually improves how rested you feel.',
      evidence,
    };
  }
  if (avg >= 450) {
    return { id: 'sleep-habits', category: 'sleep', tone: 'good', priority: 25, title: 'Sleep is solid', detail: `${formatMinutes(avg)} a night on average, at a steady bedtime.`, evidence };
  }
  return null;
}

function activityTrend(days: Days, today: string): CoachInsight | null {
  const now = lastKeys(today, 14).map((k) => days[k]?.steps).filter((v): v is number => typeof v === 'number');
  const before = lastKeys(shiftKey(today, 14), 14).map((k) => days[k]?.steps).filter((v): v is number => typeof v === 'number');
  if (now.length < 7 || before.length < 7) return null;
  const change = (mean(now) / mean(before) - 1) * 100;
  if (Math.abs(change) < 20) return null;
  const weight = Object.values(days).map((d) => d.weight).filter((v): v is number => !!v).pop() || 180;
  const kcal = Math.round(Math.abs(mean(now) - mean(before)) * 0.00028 * weight / 10) * 10;
  return {
    id: 'activity', category: 'activity', tone: change < 0 ? 'info' : 'good', priority: change < 0 ? 45 : 20,
    title: change < 0 ? `Steps are down ${Math.round(-change)}%` : `Steps are up ${Math.round(change)}%`,
    detail: `${Math.round(mean(now)).toLocaleString()} a day over the last 2 weeks vs ${Math.round(mean(before)).toLocaleString()} before — roughly ${kcal} kcal a day ${change < 0 ? 'less' : 'more'} burned.`,
    tip: change < 0 ? 'Worth knowing if weight loss stalls: walking is the easiest way to burn more without hurting recovery.' : undefined,
    evidence: '4 weeks of daily steps',
  };
}

/**
 * Heart rate around your logged sets: how far it has come back down (toward
 * resting) by the time you start the next set, per exercise.
 */
export function restRecovery(history: CoachWorkout[], workoutHealth: Record<string, WorkoutHealth>, days: Days) {
  const per = new Map<string, { name: string; recovered: number[]; rest: number[] }>();
  for (const w of history) {
    const wh = w.id ? workoutHealth[w.id] : undefined;
    if (!wh?.trace || wh.trace.length < 6) continue;
    const start = Date.parse(wh.start);
    const rhr = days[localKey(new Date(w.timestamp))]?.restingHr ?? 60;
    const at = (sec: number) => wh.trace!.reduce((best, p) => (Math.abs(p[0] - sec) < Math.abs(best[0] - sec) ? p : best))[1];
    const peak = (from: number, to: number) => Math.max(0, ...wh.trace!.filter(([t]) => t >= from && t <= to).map(([, b]) => b));
    for (const [liftId, sets] of Object.entries(w.logs || {})) {
      const times = (sets || []).map((s) => Number(s.timestamp)).filter((t) => t > 0).sort((a, b) => a - b);
      const key = exerciseKey(w.liftMeta?.[liftId]) || liftId;
      const entry = per.get(key) || { name: exerciseName(w.liftMeta?.[liftId]) || 'Lift', recovered: [], rest: [] };
      for (let i = 1; i < times.length; i++) {
        const gap = (times[i] - times[i - 1]) / 1000;
        if (gap < 45 || gap > 600) continue;
        const done = (times[i - 1] - start) / 1000;
        const top = peak(done - 60, done + 30);
        const ready = at((times[i] - start) / 1000 - 45); // roughly when the next set started
        if (!top || top - rhr < 15) continue;
        entry.recovered.push(Math.min(1, Math.max(0, (top - ready) / (top - rhr))));
        entry.rest.push(gap);
      }
      per.set(key, entry);
    }
  }
  return [...per.values()]
    .filter((e) => e.recovered.length >= 4)
    .map((e) => ({ name: e.name, recovered: mean(e.recovered), rest: mean(e.rest), intervals: e.recovered.length }));
}

function restInsights(history: CoachWorkout[], workoutHealth: Record<string, WorkoutHealth>, days: Days): CoachInsight[] {
  const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
  const out: CoachInsight[] = [];
  const rows = restRecovery(history, workoutHealth, days);
  const short = rows.filter((r) => r.recovered < 0.4 && r.rest < 150).sort((a, b) => a.recovered - b.recovered)[0];
  if (short) {
    out.push({
      id: 'rest-short', category: 'rest', tone: 'warn', priority: 58,
      title: `Heart rate is still high when you start ${short.name}`,
      detail: `With about ${clock(short.rest)} between sets, your heart rate has only come ${Math.round(short.recovered * 100)}% of the way back down when the next set starts.`,
      tip: 'Try 2:30–3:00 between heavy sets of this lift. Change it once on the rest timer and it remembers it for this lift.',
      evidence: `${short.intervals} rests measured by your Watch`,
    });
  }
  const long = rows.filter((r) => r.recovered > 0.85 && r.rest >= 180).sort((a, b) => b.rest - a.rest)[0];
  if (long) {
    out.push({
      id: 'rest-long', category: 'rest', tone: 'info', priority: 30,
      title: `You're recovered well before your next set of ${long.name}`,
      detail: `You rest about ${clock(long.rest)}, but your heart rate is ${Math.round(long.recovered * 100)}% recovered by then.`,
      tip: 'For lighter or isolation work, about 1:30–2:00 would likely do and shortens the workout.',
      evidence: `${long.intervals} rests measured by your Watch`,
    });
  }
  return out;
}

/** Every insight there's enough data for, most important first. */
export function coachInsights({ history, days, workoutHealth = {}, now = Date.now() }: {
  history: CoachWorkout[];
  days: Days;
  workoutHealth?: Record<string, WorkoutHealth>;
  now?: number;
}): CoachInsight[] {
  const today = localKey(now);
  const strength = sessionStrength(history);
  return [
    sleepAndStrength(history, days, strength),
    readinessAndStrength(history, days, strength),
    recoveryVsLoad(history, days, today, now),
    bodyVsStrength(history, days, now),
    sleepHabits(days, today),
    activityTrend(days, today),
    ...restInsights(history, workoutHealth, days),
  ]
    .filter((i): i is CoachInsight => !!i)
    .sort((a, b) => (a.tone === 'warn' ? 0 : 1) - (b.tone === 'warn' ? 0 : 1) || b.priority - a.priority);
}

/** A deload reason from a week of raised resting heart rate or lowered HRV, or null. */
export function recoveryDeloadReason(days: Days, now = Date.now()): string | null {
  const today = localKey(now);
  const week = lastKeys(today, 7);
  const base = lastKeys(shiftKey(today, 7), 28);
  const vals = (keys: string[], pick: (d: HealthDay) => number | undefined) => keys.map((k) => (days[k] ? pick(days[k]) : undefined)).filter((v): v is number => typeof v === 'number');
  const rhr = vals(week, (d) => d.restingHr);
  const rhrBase = vals(base, (d) => d.restingHr);
  if (rhr.length >= 5 && rhrBase.length >= 14) {
    const diff = mean(rhr) - mean(rhrBase);
    if (diff >= 4) return `Resting heart rate has averaged ${Math.round(diff)} bpm above your normal this week.`;
  }
  const hrv = vals(week, (d) => d.hrv);
  const hrvBase = vals(base, (d) => d.hrv);
  if (hrv.length >= 5 && hrvBase.length >= 14) {
    const drop = (1 - mean(hrv) / mean(hrvBase)) * 100;
    if (drop >= 15) return `HRV has been ${Math.round(drop)}% below your normal this week.`;
  }
  return null;
}

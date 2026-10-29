import type { HealthDay, SleepNight } from './health';

// Turning synced Apple Health days into what the pages show: today's
// readiness, averages over a range (vs the range before), chart series and
// typical sleep times. Pure functions over the `days` map (YYYY-MM-DD keys).

type Days = Record<string, HealthDay>;
const DAY_MS = 86_400_000;

/** Local calendar day key, e.g. "2026-10-20". */
export function localKey(date: Date | number) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The day `n` days before `key` (negative = after). */
export function shiftKey(key: string, n: number) {
  const [y, m, d] = key.split('-').map(Number);
  return localKey(new Date(y, m - 1, d - n));
}

/** Keys from `n - 1` days before `end` up to `end`, oldest first. */
export function lastKeys(end: string, n: number) {
  return Array.from({ length: n }, (_, i) => shiftKey(end, n - 1 - i));
}

export function formatMinutes(min: number) {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

const mean = (list: number[]) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null);
function median(list: number[]) {
  if (!list.length) return null;
  const s = [...list].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** A value from the last `within` days up to `today` (newest first), with its day. */
function recent(days: Days, today: string, pick: (d: HealthDay) => number | undefined, within = 2) {
  for (let i = 0; i < within; i++) {
    const key = shiftKey(today, i);
    const value = days[key] ? pick(days[key]) : undefined;
    if (typeof value === 'number') return { key, value };
  }
  return null;
}

/** Values over the `n` days before `before` (not including it). */
function baseline(days: Days, before: string, pick: (d: HealthDay) => number | undefined, n = 28) {
  return lastKeys(shiftKey(before, 1), n).map((k) => (days[k] ? pick(days[k]) : undefined)).filter((v): v is number => typeof v === 'number');
}

// ─── Readiness ───────────────────────────────────────────────────────────────

export type Tone = 'good' | 'neutral' | 'warn';
export type ReadinessFactor = { key: 'sleep' | 'rhr' | 'hrv'; label: string; value: string; typical: string; tone: Tone; note: string };
export type Readiness = {
  level: 'high' | 'normal' | 'low';
  title: string;
  advice: string;
  /** Lower the intensity slider to this on a low day. */
  suggestedIntensity: number | null;
  factors: ReadinessFactor[];
};

/** How many usable days a baseline needs before it's compared against. */
export const BASELINE_MIN = { sleep: 5, rhr: 7, hrv: 7 };

/**
 * Today's recovery from last night's sleep, resting heart rate and HRV, each
 * compared with your own last four weeks. Only a suggestion — one short night
 * is a nudge, not a reason to skip. Null until there's enough history.
 */
export function readiness(days: Days, today: string, defaultIntensity = 1): Readiness | null {
  const factors: ReadinessFactor[] = [];
  let points = 0;

  const night = days[today]?.sleep;
  const sleepBase = median(baseline(days, today, (d) => d.sleep?.asleepMin));
  if (night && sleepBase !== null && baseline(days, today, (d) => d.sleep?.asleepMin).length >= BASELINE_MIN.sleep) {
    const ratio = night.asleepMin / sleepBase;
    const p = ratio < 0.7 || night.asleepMin < 300 ? -2 : ratio < 0.85 || night.asleepMin < 360 ? -1 : ratio >= 1.05 ? 1 : 0;
    points += p;
    factors.push({
      key: 'sleep', label: 'Sleep', value: formatMinutes(night.asleepMin), typical: formatMinutes(sleepBase),
      tone: p < 0 ? 'warn' : p > 0 ? 'good' : 'neutral',
      note: p === 0 ? 'About usual' : `${p < 0 ? '−' : '+'}${formatMinutes(Math.abs(night.asleepMin - sleepBase))}`,
    });
  }

  const rhr = recent(days, today, (d) => d.restingHr);
  const rhrList = baseline(days, rhr?.key || today, (d) => d.restingHr);
  if (rhr && rhrList.length >= BASELINE_MIN.rhr) {
    const base = mean(rhrList)!;
    const diff = rhr.value - base;
    const p = diff >= 8 ? -2 : diff >= 5 ? -1 : diff <= -2 ? 1 : 0;
    points += p;
    factors.push({
      key: 'rhr', label: 'Resting HR', value: `${rhr.value} bpm`, typical: `${Math.round(base)} bpm`,
      tone: p < 0 ? 'warn' : p > 0 ? 'good' : 'neutral',
      note: p === 0 ? 'Normal' : `${diff > 0 ? '+' : '−'}${Math.abs(Math.round(diff))} bpm`,
    });
  }

  const hrv = recent(days, today, (d) => d.hrv);
  const hrvList = baseline(days, hrv?.key || today, (d) => d.hrv);
  if (hrv && hrvList.length >= BASELINE_MIN.hrv) {
    const base = mean(hrvList)!;
    const ratio = hrv.value / base;
    const p = ratio < 0.75 ? -2 : ratio < 0.85 ? -1 : ratio > 1.1 ? 1 : 0;
    points += p;
    factors.push({
      key: 'hrv', label: 'HRV', value: `${hrv.value} ms`, typical: `${Math.round(base)} ms`,
      tone: p < 0 ? 'warn' : p > 0 ? 'good' : 'neutral',
      note: p === 0 ? 'Normal' : `${ratio > 1 ? '+' : '−'}${Math.abs(Math.round(hrv.value - base))} ms`,
    });
  }

  if (factors.length === 0) return null;
  const warn = factors.filter((f) => f.tone === 'warn').length;
  if (points <= -2 || warn >= 2) {
    return {
      level: 'low', factors,
      title: 'Take it a bit easier',
      advice: 'Recovery looks low today. Keep the lifts, but drop the intensity a notch and skip chasing PRs.',
      suggestedIntensity: Math.max(0.5, Math.round((defaultIntensity - 0.1) * 100) / 100),
    };
  }
  if (points >= 2 && warn === 0) {
    return { level: 'high', factors, title: 'Well recovered', advice: 'Everything is at or better than usual — a good day to push.', suggestedIntensity: null };
  }
  return { level: 'normal', factors, title: 'Ready as usual', advice: 'Nothing out of the ordinary. Train as planned.', suggestedIntensity: null };
}

// ─── Ranges and series ───────────────────────────────────────────────────────

/**
 * Calories burned that day (resting + active), or undefined when there's no
 * real reading: a day with 0 active calories is a day the Watch wasn't worn.
 */
export function dailyBurn(d: HealthDay | undefined): number | undefined {
  if (!d || !(typeof d.activeKcal === 'number' && d.activeKcal > 0)) return undefined;
  return (d.restingKcal ?? 0) + d.activeKcal;
}

/**
 * Days the Watch was worn all day. Resting calories barely change from day
 * to day, so a day more than 10% under your usual (the median of the month
 * either side) means the Watch was off for part of it: its calories would
 * read as a very lazy day. Without resting readings, active calories under a
 * quarter of usual stand in. Today isn't complete until it's over, so it
 * drops out the same way.
 */
export function fullWearDays(days: Days): Set<string> {
  const keys = Object.keys(days).filter((k) => (days[k].activeKcal ?? 0) > 0).sort();
  const usual = (key: string, pick: (d: HealthDay) => number | undefined) => {
    const lo = shiftKey(key, 30);
    const hi = shiftKey(key, -30);
    return median(keys.filter((k) => k >= lo && k <= hi).map((k) => pick(days[k])).filter((v): v is number => typeof v === 'number' && v > 0)) ?? 0;
  };
  return new Set(keys.filter((k) => {
    const d = days[k];
    if ((d.restingKcal ?? 0) > 0) return d.restingKcal! >= 0.9 * usual(k, (x) => x.restingKcal);
    return d.activeKcal! >= 0.25 * usual(k, (x) => x.activeKcal);
  }));
}

export type RangeStats = {
  sleepMin: number | null;
  steps: number | null;
  restingHr: number | null;
  hrv: number | null;
  /** Average calories burned a day (resting + active), and active alone, over days the Watch was worn all day. */
  burnKcal: number | null;
  activeKcal: number | null;
  /** Latest reading in the range and its change from the first one. */
  weight: { latest: number; change: number | null } | null;
  bodyFat: { latest: number; change: number | null } | null;
  nights: number;
  stepDays: number;
};

/** Averages over `keys` (missing days are left out, not counted as zero). */
export function rangeStats(days: Days, keys: string[]): RangeStats {
  const values = (pick: (d: HealthDay) => number | undefined) => keys.map((k) => (days[k] ? pick(days[k]) : undefined)).filter((v): v is number => typeof v === 'number');
  const trend = (pick: (d: HealthDay) => number | undefined) => {
    const list = values(pick);
    if (!list.length) return null;
    return { latest: list[list.length - 1], change: list.length > 1 ? Math.round((list[list.length - 1] - list[0]) * 10) / 10 : null };
  };
  const worn = fullWearDays(days);
  const burns = keys.filter((k) => worn.has(k)).map((k) => dailyBurn(days[k])!);
  const sleep = values((d) => d.sleep?.asleepMin);
  const steps = values((d) => d.steps);
  const round = (n: number | null) => (n === null ? null : Math.round(n));
  return {
    sleepMin: round(mean(sleep)),
    steps: round(mean(steps)),
    restingHr: round(mean(values((d) => d.restingHr))),
    hrv: round(mean(values((d) => d.hrv))),
    burnKcal: round(mean(burns)),
    activeKcal: round(mean(keys.filter((k) => worn.has(k)).map((k) => days[k].activeKcal!))),
    weight: trend((d) => d.weight),
    bodyFat: trend((d) => d.bodyFat),
    nights: sleep.length,
    stepDays: steps.length,
  };
}

export type SeriesPoint = { key: string; label: string; days: number }
  & Partial<Record<'steps' | 'sleepHours' | 'deepMin' | 'remMin' | 'coreMin' | 'awakeMin' | 'restingHr' | 'hrv' | 'weight' | 'bodyFat' | 'burnKcal' | 'activeKcal' | 'hrAvg', number>>
  & { bedtime?: string; wake?: string; /** Lowest and highest heart rate (a week's, for weekly points). */ hrRange?: [number, number] };

const label = (key: string) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

function point(key: string, list: HealthDay[], burns: number[], actives: number[]): SeriesPoint {
  const avg = (pick: (d: HealthDay) => number | undefined, digits = 0) => {
    const v = mean(list.map(pick).filter((n): n is number => typeof n === 'number'));
    return v === null ? undefined : Math.round(v * 10 ** digits) / 10 ** digits;
  };
  const night: SleepNight | undefined = list.length === 1 ? list[0].sleep : undefined;
  const lows = list.map((d) => d.hrMin).filter((n): n is number => typeof n === 'number');
  const highs = list.map((d) => d.hrMax).filter((n): n is number => typeof n === 'number');
  return {
    key, label: label(key), days: list.length,
    steps: avg((d) => d.steps),
    sleepHours: avg((d) => (d.sleep ? d.sleep.asleepMin / 60 : undefined), 2),
    deepMin: avg((d) => d.sleep?.deepMin),
    remMin: avg((d) => d.sleep?.remMin),
    coreMin: avg((d) => d.sleep?.coreMin),
    awakeMin: avg((d) => d.sleep?.awakeMin),
    restingHr: avg((d) => d.restingHr),
    hrv: avg((d) => d.hrv),
    weight: avg((d) => d.weight, 1),
    bodyFat: avg((d) => d.bodyFat, 1),
    burnKcal: burns.length ? Math.round(mean(burns)!) : undefined,
    activeKcal: actives.length ? Math.round(mean(actives)!) : undefined,
    hrAvg: avg((d) => d.hrAvg),
    hrRange: lows.length && highs.length ? [Math.min(...lows), Math.max(...highs)] : undefined,
    bedtime: night?.bedtime,
    wake: night?.wake,
  };
}

/** One point per day, or per week (averaged) when `weekly`, for the last `n` days ending `end`. */
export function healthSeries(days: Days, end: string, n: number, weekly = false): SeriesPoint[] {
  const keys = lastKeys(end, n);
  const worn = fullWearDays(days);
  const burns = (list: string[]) => list.filter((k) => worn.has(k)).map((k) => dailyBurn(days[k])!);
  const actives = (list: string[]) => list.filter((k) => worn.has(k)).map((k) => days[k].activeKcal!);
  if (!weekly) return keys.map((k) => point(k, days[k] ? [days[k]] : [], burns([k]), actives([k])));
  const out: SeriesPoint[] = [];
  for (let i = 0; i < keys.length; i += 7) {
    const chunk = keys.slice(i, i + 7);
    out.push(point(chunk[0], chunk.map((k) => days[k]).filter(Boolean), burns(chunk), actives(chunk)));
  }
  return out;
}

/** Typical bedtime and wake time (median clock time) over these nights. */
export function typicalSleepTimes(days: Days, keys: string[]) {
  const nights = keys.map((k) => days[k]?.sleep).filter((n): n is SleepNight => !!n);
  if (nights.length < 3) return null;
  // Minutes after noon, so 11 pm and 1 am sort as neighbours.
  const afterNoon = (iso: string) => {
    const d = new Date(iso);
    return (d.getHours() * 60 + d.getMinutes() + 12 * 60) % (24 * 60);
  };
  const clock = (mins: number) => {
    const d = new Date(2000, 0, 1, 12, 0);
    d.setMinutes(d.getMinutes() + Math.round(mins));
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  };
  return { bedtime: clock(median(nights.map((n) => afterNoon(n.bedtime)))!), wake: clock(median(nights.map((n) => afterNoon(n.wake)))!) };
}

/** Days since the last sync, or null if never. */
export function daysSince(iso: string | null | undefined, now = Date.now()) {
  return iso ? Math.floor((now - Date.parse(iso)) / DAY_MS) : null;
}

export function timeAgo(iso: string, now = Date.now()) {
  const mins = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const d = Math.round(hours / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

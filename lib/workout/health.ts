// Optional Apple Health data, sent from the phone by an iOS Shortcut (or any
// app that can POST JSON): daily steps, sleep, weight and body fat, plus heart
// rate and active energy that are matched to logged workouts. Nothing else in
// the tracker needs it; it only adds detail where it exists.
//
// Shortcuts work in lists, so each metric arrives as columns: `values` and
// `dates` (or `starts`/`ends`), each a JSON array or newline-separated text,
// e.g. { "stepsValues": "8123\n10422", "stepsDates": "2026-10-19T00:00:00-05:00\n…" }.
// The nested form { "steps": { "values": …, "dates": … } } works too.

export type SleepNight = {
  asleepMin: number;
  inBedMin: number;
  awakeMin: number;
  deepMin: number;
  coreMin: number;
  remMin: number;
  /** ISO times of falling asleep and waking. */
  bedtime: string;
  wake: string;
};

export type HealthDay = {
  steps?: number;
  sleep?: SleepNight;
  weight?: number;
  bodyFat?: number;
  /** Resting heart rate (bpm) and heart rate variability (SDNN, ms): the day's average. */
  restingHr?: number;
  hrv?: number;
  /** Active calories burned that day (from the watch), as far as uploads have covered it. */
  activeKcal?: number;
  /** activeKcal came from Health's own daily total (exact), not added up from readings. */
  activeExact?: boolean;
  /** Resting (basal) calories that day: with activeKcal, your total burn. */
  restingKcal?: number;
  /**
   * Heart rate through the day from the Watch's readings (bpm): average (of
   * 5-minute averages, so a workout's dense readings don't swamp the rest of
   * the day), lowest and highest. Kept after the readings themselves are dropped.
   */
  hrAvg?: number;
  hrMin?: number;
  hrMax?: number;
};

/** A workout session recorded by the watch (if the sender can read workouts). */
export type WatchWorkout = { start: string; end: string; name?: string; kcal?: number };

/** Heart rate and calories during one logged workout (keyed by its history id). */
export type WorkoutHealth = {
  start: string;
  end: string;
  avgHr?: number;
  maxHr?: number;
  minHr?: number;
  kcal?: number;
  /** Heart rate every 30 seconds: [seconds from start, bpm]. */
  trace?: [number, number][];
  /** A watch session matched this workout. */
  watch?: boolean;
  /**
   * Seconds to add to the logged set times to line them up with the heart
   * rate (negative: sets were tapped done a while after they finished).
   * Missing when they already line up or there's too little data to tell.
   */
  setOffsetSec?: number;
};

export type SyncSummary = {
  at: string;
  steps: number; sleep: number; weight: number; bodyFat: number; restingHr: number; hrv: number; dailyCalories: number;
  heartRate: number; activeEnergy: number; workouts: number;
  /**
   * Per-reading heart rate and energy in this upload: 'ok', 'empty' (the
   * fields came but had nothing in them: the shortcut's search found
   * nothing) or 'missing' (the upload had no such fields).
   */
  detail?: { heartRate: FieldState; activeEnergy: FieldState };
  /** The earliest heart rate reading in this upload (to spot a gap since the last one). */
  heartRateFrom?: string;
  /** Fields in the upload that were not recognised, and dates that could not be read. */
  ignored?: string[];
  unreadableDates?: number;
  mismatched?: string[];
};

export type FieldState = 'ok' | 'empty' | 'missing';

export type UserHealth = {
  keyHash?: string;
  keyHint?: string;
  keyCreatedAt?: string;
  lastSync?: SyncSummary;
  days: Record<string, HealthDay>;
  /** Recent heart rate samples [epoch seconds, bpm], kept RAW_DAYS for matching to workouts. */
  hr: [number, number][];
  /** Recent active energy samples [start s, end s, kcal]. */
  energy: [number, number, number][];
  watchWorkouts: WatchWorkout[];
  workouts: Record<string, WorkoutHealth>;
};

export type HealthStore = { users: Record<string, UserHealth> };

export const HEALTH_FILE = 'health.json';
/** How long raw heart rate / energy samples are kept (a workout saved late still gets matched). */
export const RAW_DAYS = 14;
/** The daily shortcut's per-reading data: at most this far back, and always this much before the newest reading on hand. */
export const DETAIL_MAX_MINUTES = 3 * 24 * 60;
export const DETAIL_OVERLAP_MINUTES = 6 * 60;
const DAY_MS = 86_400_000;

export function emptyUserHealth(): UserHealth {
  return { days: {}, hr: [], energy: [], watchWorkouts: [], workouts: {} };
}

// ─── Parsing what the phone sends ────────────────────────────────────────────

/** A JSON array, newline-separated text, or a single value → list of strings. */
export function parseList(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value.map((item) => String(item ?? '').trim());
  return String(value).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

/** "10,234", "72 count/min", "0.18" → number (NaN when there's none). */
export function parseNumber(text: string): number {
  const match = text.replace(/(\d),(?=\d{3}(\D|$))/g, '$1').match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : NaN;
}

type ParsedDate = { ms: number; offsetMin: number | null };

/**
 * ISO 8601 (best: keeps the phone's time zone) or Shortcuts' default
 * "Oct 20, 2026 at 7:15 AM" (read in the server's time zone).
 */
export function parseHealthDate(text: string): ParsedDate | null {
  const clean = text.trim().replace(/ /g, ' ');
  if (!clean) return null;
  let ms = Date.parse(clean);
  if (Number.isNaN(ms)) ms = Date.parse(clean.replace(/ at /i, ' '));
  if (Number.isNaN(ms)) return null;
  const zone = clean.match(/T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(Z|([+-])(\d{2}):?(\d{2}))$/);
  const offsetMin = !zone ? null : zone[1] === 'Z' ? 0 : (zone[2] === '-' ? -1 : 1) * (Number(zone[3]) * 60 + Number(zone[4]));
  return { ms, offsetMin };
}

/** The calendar day (YYYY-MM-DD) a moment falls on where the phone was. */
export function dayKeyAt(ms: number, offsetMin: number | null): string {
  if (offsetMin === null) {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  return new Date(ms + offsetMin * 60_000).toISOString().slice(0, 10);
}

type Column = { values: string[]; starts: string[]; ends: string[]; unit: string; calories: string[] };

/** Other names a sender (or an AI-built shortcut) might use for each metric. */
const ALIASES: Record<string, string[]> = {
  steps: ['steps', 'stepCount'],
  sleep: ['sleep', 'sleepAnalysis'],
  weight: ['weight', 'bodyMass'],
  bodyFat: ['bodyFat', 'bodyFatPercentage'],
  restingHeartRate: ['restingHeartRate', 'restingHr'],
  hrv: ['hrv', 'heartRateVariability'],
  heartRate: ['heartRate'],
  activeEnergy: ['activeEnergy', 'activeEnergyBurned', 'activeCalories'],
  workouts: ['workouts'],
  activeEnergyDaily: ['activeEnergyDaily', 'activeCaloriesDaily'],
  restingEnergy: ['restingEnergy', 'basalEnergy', 'basalEnergyBurned'],
};

/** What an upload contained that couldn't be used, so the sender can be fixed. */
type Diagnostics = { used: Set<string>; unreadableDates: number; mismatched: string[] };

const firstDefined = (o: Record<string, any>, keys: string[]) => {
  for (const key of keys) if (o[key] !== undefined && o[key] !== null) return o[key];
  return undefined;
};

/**
 * One metric's columns. Accepts flat fields (`stepsValues`, `stepsDates`…),
 * a nested object ({ steps: { values, dates } }) or a list of samples
 * ({ steps: [{ value, startDate, endDate }] }).
 */
function column(body: Record<string, any>, name: string, diag: Diagnostics): Column {
  for (const alias of ALIASES[name] || [name]) {
    const own = body[alias];
    if (Array.isArray(own) && own.some((item) => item && typeof item === 'object')) {
      diag.used.add(alias);
      const list = own.filter((item) => item && typeof item === 'object');
      const get = (keys: string[]) => list.map((item) => String(firstDefined(item, keys) ?? '').trim());
      return {
        values: get(['value', 'Value', 'qty', 'quantity', 'name', 'Name']),
        starts: get(['start', 'startDate', 'Start Date', 'date', 'Date']),
        ends: get(['end', 'endDate', 'End Date']),
        unit: String(firstDefined(list[0], ['unit', 'Unit', 'units']) ?? '').toLowerCase(),
        calories: get(['calories', 'kcal', 'activeEnergy', 'Active Energy']),
      };
    }
    const nested = own && typeof own === 'object' && !Array.isArray(own) ? own : null;
    const pick = (...suffixes: string[]) => {
      for (const suffix of suffixes) {
        const flatKey = `${alias}${suffix[0].toUpperCase()}${suffix.slice(1)}`;
        const value = nested?.[suffix] ?? body[flatKey];
        if (value !== undefined) {
          diag.used.add(nested?.[suffix] !== undefined ? alias : flatKey);
          return value;
        }
      }
      return undefined;
    };
    const col: Column = {
      values: parseList(pick('values', 'names')),
      starts: parseList(pick('starts', 'dates', 'startDates')),
      ends: parseList(pick('ends', 'endDates')),
      unit: String(pick('unit', 'units') ?? '').toLowerCase(),
      calories: parseList(pick('calories')),
    };
    if (col.values.length || col.starts.length) {
      if (col.values.length !== col.starts.length) diag.mismatched.push(name);
      return col;
    }
  }
  return { values: [], starts: [], ends: [], unit: '', calories: [] };
}

type Sample = { value: string; start: ParsedDate; end: ParsedDate | null };

function samples(col: Column, diag: Diagnostics): Sample[] {
  const out: Sample[] = [];
  const count = Math.min(col.values.length, col.starts.length);
  for (let i = 0; i < count; i++) {
    const start = parseHealthDate(col.starts[i]);
    if (!start) { diag.unreadableDates++; continue; }
    out.push({ value: col.values[i], start, end: col.ends[i] ? parseHealthDate(col.ends[i]) : null });
  }
  return out;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

// ─── Sleep ───────────────────────────────────────────────────────────────────

type Stage = 'deep' | 'core' | 'rem' | 'asleep' | 'awake' | 'inBed';

export function sleepStage(value: string): Stage | null {
  const v = value.toLowerCase();
  if (v.includes('deep')) return 'deep';
  if (/\brem\b/.test(v)) return 'rem';
  if (v.includes('core') || v.includes('light')) return 'core';
  if (v.includes('awake')) return 'awake';
  if (v.includes('bed')) return 'inBed';
  if (v.includes('asleep') || v.includes('unspecified') || v.includes('sleep')) return 'asleep';
  return null;
}

/** Total minutes covered by intervals, counting overlaps (watch + phone) once. */
function unionMinutes(intervals: [number, number][]): number {
  const sorted = intervals.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  let total = 0;
  let current: [number, number] | null = null;
  for (const [a, b] of sorted) {
    if (!current || a > current[1]) {
      if (current) total += current[1] - current[0];
      current = [a, b];
    } else current[1] = Math.max(current[1], b);
  }
  if (current) total += current[1] - current[0];
  return Math.round(total / 60_000);
}

/** Sleep segments grouped into nights, each filed under the day you woke up. */
export function sleepNights(segments: { stage: Stage; start: number; end: number; offsetMin: number | null }[]): Record<string, SleepNight> {
  const byNight = new Map<string, typeof segments>();
  for (const seg of segments) {
    // Noon-to-noon: a night that starts at 11pm or 1am counts for the next/same morning.
    const key = dayKeyAt(seg.start + 12 * 3_600_000, seg.offsetMin);
    byNight.set(key, [...(byNight.get(key) || []), seg]);
  }
  const nights: Record<string, SleepNight> = {};
  for (const [key, segs] of byNight) {
    const of = (...stages: Stage[]) => segs.filter((s) => stages.includes(s.stage)).map((s) => [s.start, s.end] as [number, number]);
    const asleep = of('deep', 'core', 'rem', 'asleep');
    if (asleep.length === 0) continue;
    const bedtime = Math.min(...asleep.map(([a]) => a));
    const wake = Math.max(...asleep.map(([, b]) => b));
    const inBed = of('inBed');
    nights[key] = {
      asleepMin: unionMinutes(asleep),
      inBedMin: inBed.length ? unionMinutes([...inBed, ...asleep]) : Math.round((wake - bedtime) / 60_000),
      awakeMin: unionMinutes(of('awake')),
      deepMin: unionMinutes(of('deep')),
      coreMin: unionMinutes(of('core')),
      remMin: unionMinutes(of('rem')),
      bedtime: new Date(bedtime).toISOString(),
      wake: new Date(wake).toISOString(),
    };
  }
  return nights;
}

// ─── Applying an upload ──────────────────────────────────────────────────────

export type ImportResult = { health: UserHealth; summary: SyncSummary; weights: { date: string; weight: number }[] };

/**
 * Merge one upload into a user's health data. Re-sending the same days is
 * safe: each day's value is replaced, and samples are de-duplicated by time.
 */
export function applyHealthImport(current: UserHealth, body: Record<string, any>, now = Date.now()): ImportResult {
  const health: UserHealth = { ...emptyUserHealth(), ...current, days: { ...current.days } };
  const day = (key: string) => (health.days[key] = { ...health.days[key] });
  const summary: SyncSummary = { at: new Date(now).toISOString(), steps: 0, sleep: 0, weight: 0, bodyFat: 0, restingHr: 0, hrv: 0, dailyCalories: 0, heartRate: 0, activeEnergy: 0, workouts: 0 };
  const diag: Diagnostics = { used: new Set(['key']), unreadableDates: 0, mismatched: [] };

  // Steps: one total per day (send them grouped by day; ungrouped samples are added up).
  const steps = new Map<string, number>();
  for (const s of samples(column(body, 'steps', diag), diag)) {
    const n = parseNumber(s.value);
    if (!(n >= 0)) continue;
    const key = dayKeyAt(s.start.ms, s.start.offsetMin);
    steps.set(key, (steps.get(key) || 0) + n);
  }
  for (const [key, total] of steps) {
    if (total > 200_000) continue;
    day(key).steps = Math.round(total);
    summary.steps++;
  }

  // Weight and body fat: the day's last reading.
  const lastPerDay = (name: string, convert: (n: number, unit: string) => number | null) => {
    const col = column(body, name, diag);
    const latest = new Map<string, { ms: number; value: number }>();
    for (const s of samples(col, diag)) {
      const value = convert(parseNumber(s.value), col.unit || s.value.toLowerCase());
      if (value === null) continue;
      const key = dayKeyAt(s.start.ms, s.start.offsetMin);
      if (!latest.has(key) || latest.get(key)!.ms <= s.start.ms) latest.set(key, { ms: s.start.ms, value });
    }
    return latest;
  };
  const weights = lastPerDay('weight', (n, unit) => {
    const lbs = /kg|kilo/.test(unit) ? n * 2.20462 : n;
    return lbs >= 50 && lbs <= 800 ? round1(lbs) : null;
  });
  for (const [key, { value }] of weights) { day(key).weight = value; summary.weight++; }
  const fat = lastPerDay('bodyFat', (n) => {
    const pct = n > 0 && n <= 1 ? n * 100 : n; // Health stores 0.18 for 18%
    return pct >= 2 && pct <= 70 ? round1(pct) : null;
  });
  for (const [key, { value }] of fat) { day(key).bodyFat = value; summary.bodyFat++; }

  // Resting heart rate and HRV: the day's average (one reading or several).
  const dailyAverage = (name: string, min: number, max: number, set: (key: string, value: number) => void) => {
    const perDay = new Map<string, number[]>();
    for (const s of samples(column(body, name, diag), diag)) {
      const n = parseNumber(s.value);
      if (!(n >= min && n <= max)) continue;
      const key = dayKeyAt(s.start.ms, s.start.offsetMin);
      perDay.set(key, [...(perDay.get(key) || []), n]);
    }
    for (const [key, list] of perDay) set(key, Math.round(list.reduce((a, b) => a + b, 0) / list.length));
    return perDay.size;
  };
  summary.restingHr = dailyAverage('restingHeartRate', 25, 150, (key, v) => { day(key).restingHr = v; });
  summary.hrv = dailyAverage('hrv', 3, 300, (key, v) => { day(key).hrv = v; });

  // Daily calorie totals (send them grouped by day): active and resting burn.
  // Today's total grows through the day, so a day's value is only ever raised.
  const dailyTotal = (name: string, set: (key: string, kcal: number) => void) => {
    const col = column(body, name, diag);
    const perDay = new Map<string, number>();
    for (const s of samples(col, diag)) {
      let kcal = parseNumber(s.value);
      if (/kj|kilojoule/.test(col.unit || s.value.toLowerCase())) kcal /= 4.184;
      if (!(kcal >= 0 && kcal <= 10_000)) continue;
      const key = dayKeyAt(s.start.ms, s.start.offsetMin);
      perDay.set(key, (perDay.get(key) || 0) + kcal);
    }
    for (const [key, kcal] of perDay) set(key, Math.round(kcal));
    return perDay.size;
  };
  summary.dailyCalories += dailyTotal('activeEnergyDaily', (key, kcal) => {
    const d = health.days[key];
    if (!d?.activeExact || kcal > (d.activeKcal || 0)) { day(key).activeKcal = kcal; day(key).activeExact = true; }
  });
  summary.dailyCalories += dailyTotal('restingEnergy', (key, kcal) => {
    if (kcal > (health.days[key]?.restingKcal || 0)) day(key).restingKcal = kcal;
  });

  // Sleep: rebuild each night from its segments. A night cut off by the
  // edge of the upload's date range never replaces a longer one already saved.
  const segments = samples(column(body, 'sleep', diag), diag).flatMap((s) => {
    const stage = sleepStage(s.value);
    return stage && s.end ? [{ stage, start: s.start.ms, end: s.end.ms, offsetMin: s.start.offsetMin }] : [];
  });
  for (const [key, night] of Object.entries(sleepNights(segments))) {
    const saved = health.days[key]?.sleep;
    // Only a night that starts later than the saved one (cut off by the range) is kept back;
    // a complete night replaces whatever was there, even a longer, wrong one.
    if (saved && saved.asleepMin > night.asleepMin && Date.parse(night.bedtime) > Date.parse(saved.bedtime) + 30 * 60_000) continue;
    day(key).sleep = night;
    summary.sleep++;
  }

  // Heart rate and active energy: kept raw for a while, for matching to workouts.
  const cutoff = Math.floor((now - RAW_DAYS * DAY_MS) / 1000);
  const hr = new Map(health.hr.map(([t, bpm]) => [t, bpm]));
  // Which fields each column came from, to tell "sent empty" from "not sent".
  const fieldState = (col: Column, before: Set<string>): FieldState => (col.values.length ? 'ok' : [...diag.used].some((k) => !before.has(k)) ? 'empty' : 'missing');
  const beforeHr = new Set(diag.used);
  const hrCol = column(body, 'heartRate', diag);
  const hrState = fieldState(hrCol, beforeHr);
  const hrDays = new Map<string, number | null>(); // days this upload touched → their UTC offset
  for (const s of samples(hrCol, diag)) {
    const bpm = parseNumber(s.value);
    if (!(bpm >= 25 && bpm <= 250)) continue;
    hrDays.set(dayKeyAt(s.start.ms, s.start.offsetMin), s.start.offsetMin);
    hr.set(Math.floor(s.start.ms / 1000), Math.round(bpm));
    summary.heartRate++;
    if (!summary.heartRateFrom || s.start.ms < Date.parse(summary.heartRateFrom)) summary.heartRateFrom = new Date(s.start.ms).toISOString();
  }
  health.hr = [...hr.entries()].filter(([t]) => t >= cutoff).sort((a, b) => a[0] - b[0]);
  // Every day's summary from all of its readings on hand (an upload may cover only part of a day,
  // and readings already stored get summarised too), in this upload's time zone. The oldest day
  // is skipped: the 14-day trim has cut part of it off.
  if (hrDays.size) {
    const offset = [...hrDays.values()].pop()!;
    const oldest = dayKeyAt(cutoff * 1000, offset);
    const byDay = new Map<string, [number, number][]>();
    for (const reading of health.hr) {
      const key = dayKeyAt(reading[0] * 1000, offset);
      if (key > oldest) byDay.set(key, [...(byDay.get(key) || []), reading]);
    }
    for (const [key, readings] of byDay) {
      if (readings.length < 20) continue;
      const buckets = new Map<number, number[]>();
      for (const [t, bpm] of readings) buckets.set(Math.floor(t / 300), [...(buckets.get(Math.floor(t / 300)) || []), bpm]);
      const means = [...buckets.values()].map((list) => list.reduce((a, b) => a + b, 0) / list.length);
      const d = day(key);
      d.hrAvg = Math.round(means.reduce((a, b) => a + b, 0) / means.length);
      d.hrMin = Math.min(...readings.map(([, b]) => b));
      d.hrMax = Math.max(...readings.map(([, b]) => b));
    }
  }

  const beforeEnergy = new Set(diag.used);
  const energyCol = column(body, 'activeEnergy', diag);
  summary.detail = { heartRate: hrState, activeEnergy: fieldState(energyCol, beforeEnergy) };
  let energyOffset: number | null | undefined;
  const energy = new Map(health.energy.map((e) => [e[0], e]));
  for (const s of samples(energyCol, diag)) {
    let kcal = parseNumber(s.value);
    if (/kj|kilojoule/.test(energyCol.unit)) kcal /= 4.184;
    if (!(kcal >= 0 && kcal <= 2000)) continue;
    const start = Math.floor(s.start.ms / 1000);
    const end = s.end ? Math.max(start, Math.floor(s.end.ms / 1000)) : start + 60;
    energy.set(start, [start, end, Math.round(kcal * 100) / 100]);
    summary.activeEnergy++;
    if (energyOffset === undefined) energyOffset = s.start.offsetMin;
  }
  health.energy = [...energy.values()].filter(([, end]) => end >= cutoff).sort((a, b) => a[0] - b[0]);
  // Daily active calories (for your activity level). An upload may cover only part
  // of a day, so a day's total only ever grows as later uploads fill it in.
  if (energyOffset !== undefined) {
    const totals = new Map<string, number>();
    for (const [start, , kcal] of health.energy) {
      const key = dayKeyAt(start * 1000, energyOffset);
      totals.set(key, (totals.get(key) || 0) + kcal);
    }
    for (const [key, total] of totals) {
      // Health's exact daily total wins over a sum of readings (which can count a reading from phone and watch twice).
      if (!health.days[key]?.activeExact && total > (health.days[key]?.activeKcal || 0)) day(key).activeKcal = Math.round(total);
    }
  }

  // Watch workouts, if the sender can read them (`workoutsStarts`, `workoutsEnds`, names, calories).
  const wcol = column(body, 'workouts', diag);
  const kcals = wcol.calories;
  const watch = new Map(health.watchWorkouts.map((w) => [w.start, w]));
  wcol.starts.forEach((startText, i) => {
    const start = parseHealthDate(startText);
    const end = wcol.ends[i] ? parseHealthDate(wcol.ends[i]) : null;
    if (!start || !end || end.ms <= start.ms || end.ms - start.ms > 6 * 3_600_000) return;
    const kcal = kcals[i] ? parseNumber(kcals[i]) : NaN;
    const entry: WatchWorkout = { start: new Date(start.ms).toISOString(), end: new Date(end.ms).toISOString() };
    if (wcol.values[i]) entry.name = wcol.values[i].slice(0, 80);
    if (kcal >= 0 && kcal < 5000) entry.kcal = Math.round(kcal);
    watch.set(entry.start, entry);
    summary.workouts++;
  });
  health.watchWorkouts = [...watch.values()].sort((a, b) => a.start.localeCompare(b.start)).slice(-1000);

  summary.ignored = Object.keys(body).filter((k) => !diag.used.has(k)).slice(0, 20);
  summary.unreadableDates = diag.unreadableDates;
  summary.mismatched = [...new Set(diag.mismatched)];
  health.lastSync = summary;
  return { health, summary, weights: [...weights.entries()].map(([date, { value }]) => ({ date, weight: value })) };
}

// ─── Matching to logged workouts ─────────────────────────────────────────────

type LoggedWorkout = { id?: string; timestamp?: string; durationSecs?: number; logs?: Record<string, { timestamp?: number }[]> };

/** When a logged workout ran: from its start (end − duration, or the first set) to when it was saved. */
export function workoutWindow(workout: LoggedWorkout): [number, number] | null {
  const end = Date.parse(workout.timestamp || '');
  if (Number.isNaN(end)) return null;
  const setTimes = Object.values(workout.logs || {}).flat().map((s) => Number(s?.timestamp)).filter((t) => t > 0 && t <= end);
  const fromDuration = workout.durationSecs ? end - workout.durationSecs * 1000 : end;
  const start = Math.min(fromDuration, setTimes.length ? Math.min(...setTimes) - 60_000 : end);
  return start < end ? [start, end] : null;
}

const overlap = (a: [number, number], b: [number, number]) => Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0]));

/** Heart rate tops out about this long after the last rep. */
const PEAK_AFTER_SET = 15;

/**
 * How far the logged set times sit from the sets the heart rate shows, in
 * seconds (negative: sets were tapped done after they finished). Heart rate
 * climbs through a set, peaks just after it and falls through the rest, so
 * the shift that puts the most sets on a peak wins. The gaps between sets
 * are right whatever the shift, so one shift fits the whole workout. Searched
 * within 3 minutes and under half the usual rest (so it can't slip a whole
 * set), and only kept when it fits clearly better than none. Needs a reading
 * every few seconds (a Watch workout) and 4 timed sets; otherwise 0.
 */
export function alignSets(beats: [number, number][], setTimes: number[]): number {
  const sets = setTimes.filter((t) => t > 0).map((t) => t / 1000).sort((a, b) => a - b);
  if (sets.length < 4) return 0;
  const gaps = sets.slice(1).map((t, i) => t - sets[i]).filter((g) => g > 20).sort((a, b) => a - b);
  const maxShift = Math.min(180, gaps.length ? gaps[Math.floor(gaps.length / 2)] / 2 : 0);
  if (maxShift < 30) return 0;
  const from = sets[0] - maxShift - 300;
  const to = sets[sets.length - 1] + maxShift + 300;
  const near = beats.filter(([t]) => t >= from && t <= to).sort((a, b) => a[0] - b[0]);
  const during = near.filter(([t]) => t >= sets[0] - 60 && t <= sets[sets.length - 1] + 60).length;
  if (during < (sets[sets.length - 1] - sets[0] + 120) / 20) return 0; // fewer than one reading per 20 s

  // Heart rate every 5 s (gaps over a minute left empty), minus its 5-minute average so only the set-by-set swings remain.
  const STEP = 5;
  const grid: number[] = [];
  let j = 0;
  for (let t = from; t <= to; t += STEP) {
    while (j < near.length - 1 && near[j + 1][0] < t) j++;
    const [t0, b0] = near[j];
    const [t1, b1] = near[Math.min(j + 1, near.length - 1)];
    if (t < t0 || t > t1 || t1 - t0 > 60) grid.push(NaN);
    else grid.push(t1 === t0 ? b0 : b0 + ((b1 - b0) * (t - t0)) / (t1 - t0));
  }
  const HALF = 150 / STEP;
  const swing = grid.map((v, i) => {
    if (Number.isNaN(v)) return NaN;
    const around = grid.slice(Math.max(0, i - HALF), i + HALF + 1).filter((x) => !Number.isNaN(x));
    return v - around.reduce((a, b) => a + b, 0) / around.length;
  });
  const at = (t: number) => swing[Math.round((t - from) / STEP)] ?? NaN;
  // How far above its local average heart rate is, on average, around each set's peak.
  const fit = (shift: number) => {
    const values = sets.flatMap((s) => [-10, -5, 0, 5, 10].map((d) => at(s + shift + d))).filter((v) => !Number.isNaN(v));
    return values.length >= sets.length * 2 ? values.reduce((a, b) => a + b, 0) / values.length : -Infinity;
  };
  let best = PEAK_AFTER_SET;
  for (let shift = -Math.round(maxShift / STEP) * STEP; shift <= maxShift; shift += STEP) {
    if (fit(shift) > fit(best)) best = shift;
  }
  const offset = best - PEAK_AFTER_SET;
  // Not worth moving for a few seconds, and only when it fits clearly better (2+ bpm) than as logged.
  if (Math.abs(offset) < 20 || !(fit(best) > 0) || fit(best) - fit(PEAK_AFTER_SET) < 2) return 0;
  return offset;
}

/** Heart rate and calories for one logged workout, or null if nothing was recorded then. */
export function workoutHealth(workout: LoggedWorkout, health: Pick<UserHealth, 'hr' | 'energy' | 'watchWorkouts'>): WorkoutHealth | null {
  let window = workoutWindow(workout);
  if (!window) return null;
  // A watch session covering most of the workout gives the real start and end.
  const session = health.watchWorkouts.find((w) => {
    const span: [number, number] = [Date.parse(w.start), Date.parse(w.end)];
    return overlap(span, window!) > 0.5 * Math.min(span[1] - span[0], window![1] - window![0]);
  });
  if (session) window = [Date.parse(session.start), Date.parse(session.end)];
  // Line the logged sets up with the heart rate they caused; without a watch session the start moves with them.
  const setTimes = Object.values(workout.logs || {}).flat().map((s) => Number(s?.timestamp)).filter((t) => t > 0);
  const offsetSec = setTimes.length >= 4 ? alignSets(health.hr, setTimes) : 0;
  if (!session && offsetSec < 0) window = [window[0] + offsetSec * 1000, window[1]];
  const [from, to] = window;

  const beats = health.hr.filter(([t]) => t * 1000 >= from && t * 1000 <= to);
  const result: WorkoutHealth = { start: new Date(from).toISOString(), end: new Date(to).toISOString() };
  if (session) result.watch = true;
  if (offsetSec) result.setOffsetSec = offsetSec;
  if (beats.length >= 5) {
    const bpms = beats.map(([, bpm]) => bpm);
    result.avgHr = Math.round(bpms.reduce((a, b) => a + b, 0) / bpms.length);
    result.maxHr = Math.max(...bpms);
    result.minHr = Math.min(...bpms);
    const buckets = new Map<number, number[]>();
    for (const [t, bpm] of beats) {
      const bucket = Math.floor((t * 1000 - from) / 30_000) * 30;
      buckets.set(bucket, [...(buckets.get(bucket) || []), bpm]);
    }
    result.trace = [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([sec, list]) => [sec, Math.round(list.reduce((a, b) => a + b, 0) / list.length)]);
  }
  if (session?.kcal !== undefined) {
    result.kcal = session.kcal;
  } else {
    // Energy samples overlapping the workout, counted for the part inside it.
    let kcal = 0;
    let any = false;
    for (const [s, e, value] of health.energy) {
      const span: [number, number] = [s * 1000, Math.max(e * 1000, s * 1000 + 1)];
      const inside = overlap(span, window);
      if (inside <= 0) continue;
      any = true;
      kcal += value * (inside / (span[1] - span[0]));
    }
    if (any) result.kcal = Math.round(kcal);
  }
  return result.avgHr !== undefined || result.kcal !== undefined ? result : null;
}

/**
 * Match recent logged workouts to the samples on hand (a workout saved after
 * the last upload is matched by the next one, or when the page loads).
 * Returns true if anything changed.
 */
export function refreshWorkoutHealth(health: UserHealth, history: LoggedWorkout[], now = Date.now()): boolean {
  let changed = false;
  for (const workout of history) {
    const at = Date.parse(workout.timestamp || '');
    if (!workout.id || !(at >= now - RAW_DAYS * DAY_MS)) continue;
    const result = workoutHealth(workout, health);
    if (!result) continue;
    if (JSON.stringify(health.workouts[workout.id]) === JSON.stringify(result)) continue;
    health.workouts = { ...health.workouts, [workout.id]: result };
    changed = true;
  }
  return changed;
}

/** One-paragraph result of an upload: what arrived, and anything that needs fixing in the shortcut. */
export function describeSync(summary: SyncSummary): string {
  const n = (count: number, one: string, many: string) => count && `${count} ${count === 1 ? one : many}`;
  const parts = [
    n(summary.steps, 'day of steps', 'days of steps'),
    n(summary.sleep, 'night of sleep', 'nights of sleep'),
    n(summary.weight, 'weight', 'weights'),
    n(summary.bodyFat, 'body fat reading', 'body fat readings'),
    n(summary.restingHr, 'day of resting heart rate', 'days of resting heart rate'),
    n(summary.hrv, 'day of HRV', 'days of HRV'),
    n(summary.dailyCalories, 'daily calorie total', 'daily calorie totals'),
    n(summary.heartRate, 'heart rate reading', 'heart rate readings'),
    n(summary.activeEnergy, 'energy reading', 'energy readings'),
    n(summary.workouts, 'workout', 'workouts'),
  ].filter(Boolean);
  const problems = [
    summary.unreadableDates ? `${summary.unreadableDates} date${summary.unreadableDates === 1 ? '' : 's'} couldn't be read (set Date Format to ISO 8601)` : '',
    summary.mismatched?.length ? `values and dates don't line up for ${summary.mismatched.join(', ')}` : '',
    summary.ignored?.length ? `unknown fields ignored: ${summary.ignored.join(', ')}` : '',
  ].filter(Boolean);
  const head = parts.length ? `Synced ${parts.join(', ')}.` : 'Nothing usable in this upload.';
  return problems.length ? `${head} Check: ${problems.join('; ')}.` : head;
}

/** Heart rate this old (or older) while daily data keeps arriving means the shortcut stopped sending it. */
export const STALE_HEART_RATE_MS = 12 * 3_600_000;
/** A gap this long between the newest stored reading and an upload's first one is missing data, not a quiet spell. */
const HEART_RATE_GAP_MS = 90 * 60_000;

/**
 * The notification for an automatic sync: the upload's description when
 * something needs fixing (or nothing usable arrived), else empty, so a
 * good sync stays quiet. Also speaks up when daily data arrives without any
 * heart rate or energy although the site has had them before and its newest
 * heart rate (`newestHeartRateMs`, before this upload) is over 12 hours old:
 * the shortcut's heart rate steps are finding nothing.
 */
export function syncAlert(summary: SyncSummary, newestHeartRateMs: number | null = null, now = Date.now()): string {
  const empty = !(summary.steps || summary.sleep || summary.weight || summary.bodyFat || summary.restingHr || summary.hrv
    || summary.dailyCalories || summary.heartRate || summary.activeEnergy || summary.workouts);
  const problems = !!(summary.unreadableDates || summary.mismatched?.length || summary.ignored?.length);
  if (empty || problems) return describeSync(summary);
  if (!summary.heartRate && !summary.activeEnergy && newestHeartRateMs !== null && now - newestHeartRateMs > STALE_HEART_RATE_MS) {
    const hours = Math.round((now - newestHeartRateMs) / 3_600_000);
    const age = hours >= 48 ? `${Math.round(hours / 24)} days` : `${hours} hours`;
    const head = `No heart rate came in, and the newest on the site is ${age} old.`;
    if (summary.detail?.heartRate === 'missing') {
      return `${head} The upload has no heartRateValues / heartRateDates fields: add them to the shortcut's upload (STEP 4).`;
    }
    return `${head} The heart rate fields came but were empty: the shortcut's Heart Rate search found nothing. Check the Health app has recent heart rate (if not, the Watch isn't passing it to the phone); if it does, the search is set up wrong.`;
  }
  // The daily shortcut reads a fixed day back: after a longer break, the readings between are never sent.
  if (summary.heartRateFrom && newestHeartRateMs !== null && Date.parse(summary.heartRateFrom) - newestHeartRateMs > HEART_RATE_GAP_MS) {
    const hours = Math.round((Date.parse(summary.heartRateFrom) - newestHeartRateMs) / 3_600_000);
    const gap = hours >= 48 ? `about ${Math.round(hours / 24)} days` : `about ${hours} hours`;
    return `Heart rate is missing for ${gap} before this sync (it hadn't run for over a day). Run "Sync Health – Last 30 Days" once to fill it in.`;
  }
  return '';
}

/**
 * How many minutes of heart rate and energy readings the daily shortcut
 * should send (for shortcuts built from older prompts; current ones read a
 * fixed day back, since a date worked out at run time didn't work as a
 * Health search filter): from the newest reading already here (the older of the two
 * kinds), less 6 hours because the Watch hands readings to the phone late
 * sometimes, and at most 3 days. Turning thousands of readings into text is
 * what makes a sync slow, so this keeps it to a few hours' worth.
 */
export function detailSinceMinutes(health: Pick<UserHealth, 'hr' | 'energy'>, now = Date.now()) {
  const newest = [
    health.hr.length ? health.hr[health.hr.length - 1][0] : null,
    health.energy.length ? Math.max(...health.energy.slice(-50).map(([, end]) => end)) : null,
  ];
  if (newest.some((t) => t === null)) return DETAIL_MAX_MINUTES;
  const since = Math.ceil((now / 1000 - Math.min(...(newest as number[]))) / 60) + DETAIL_OVERLAP_MINUTES;
  return Math.max(DETAIL_OVERLAP_MINUTES, Math.min(DETAIL_MAX_MINUTES, since));
}

/**
 * What the site holds around a recent logged workout that has no heart rate
 * or calories yet, so the page can say why: its time window (null when it has
 * no timer or set times to place it), readings inside that window, and the
 * newest reading of each kind on hand.
 */
export type MatchCheck = {
  id: string;
  from: string | null;
  to: string | null;
  heartRate: number;
  energy: number;
  newestHeartRate: string | null;
  newestEnergy: string | null;
};

export function matchChecks(health: UserHealth, history: LoggedWorkout[], now = Date.now(), days = 3): MatchCheck[] {
  const newestHr = health.hr.length ? health.hr[health.hr.length - 1][0] * 1000 : null;
  const newestEnergy = health.energy.length ? Math.max(...health.energy.slice(-50).map(([, end]) => end)) * 1000 : null;
  const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());
  return history
    .filter((w) => w.id && !health.workouts[w.id] && Date.parse(w.timestamp || '') >= now - days * DAY_MS)
    .map((w) => {
      const window = workoutWindow(w);
      const inside = (t: number) => !!window && t >= window[0] && t <= window[1];
      return {
        id: w.id!,
        from: iso(window ? window[0] : null),
        to: iso(window ? window[1] : null),
        heartRate: health.hr.filter(([t]) => inside(t * 1000)).length,
        energy: health.energy.filter(([s, e]) => !!window && e * 1000 >= window[0] && s * 1000 <= window[1]).length,
        newestHeartRate: iso(newestHr),
        newestEnergy: iso(newestEnergy),
      };
    });
}

/** What the page gets: everything except the key and the raw samples (plus checks on unmatched recent workouts). */
export function publicHealth(health: UserHealth | undefined, history: LoggedWorkout[] = []) {
  const h = health || emptyUserHealth();
  return {
    waiting: matchChecks(h, history),
    connected: !!h.keyHash,
    keyHint: h.keyHint || null,
    keyCreatedAt: h.keyCreatedAt || null,
    lastSync: h.lastSync || null,
    days: h.days,
    workouts: h.workouts,
    watchWorkouts: h.watchWorkouts.slice(-60),
  };
}

export type PublicHealth = ReturnType<typeof publicHealth>;

/**
 * A shortcut's upload as an object: JSON as the prompts ask for, or form
 * fields (what Get Contents of URL sends if its Request Body is switched to
 * Form). Anything else throws an error saying what did arrive, with any
 * sync key blanked out, since it ends up in a notification.
 */
export function parseSyncBody(text: string, contentType = ''): Record<string, any> {
  const body = text.replace(/^\uFEFF/, '').trim();
  const fix = 'In the shortcut, set Get Contents of URL\'s Request Body to JSON.';
  if (!body) throw new Error(`The upload was empty. ${fix}`);
  if (body.startsWith('{')) {
    try {
      const parsed = JSON.parse(body);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {
      const cut = body.endsWith('}') ? '' : ' It looks cut off, as if the upload stopped part way.';
      throw new Error(`The upload isn't valid JSON (${body.length.toLocaleString('en-US')} characters).${cut}`);
    }
  }
  if (/x-www-form-urlencoded/i.test(contentType) || /^[\w.%-]+=/.test(body)) {
    return Object.fromEntries(new URLSearchParams(body));
  }
  const preview = body.slice(0, 60).replace(/nsh_[\w-]+/g, 'nsh_…').replace(/\s+/g, ' ');
  throw new Error(`Couldn't read the upload (${contentType || 'no content type'}, starts "${preview}"). ${fix}`);
}

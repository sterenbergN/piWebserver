import test from 'node:test';
import assert from 'node:assert/strict';
import { fullCoach, measuredActivity, profileFromUser, restingVsFormula } from './coach';
import { dailyBurn, fullWearDays, healthSeries, lastKeys, localKey, rangeStats, shiftKey } from './health-insights';
import type { HealthDay } from './health';
import type { TrainingWorkout } from './training-coach';

const NOW = new Date(2026, 9, 20, 20, 0).getTime();
const TODAY = localKey(NOW);
const DAY = 86_400_000;
const profile = { sex: 'male' as const, age: 30, heightInches: 70, weightLbs: 180, activityLevel: 'moderate' as const };
const night = (asleepMin: number) => ({ asleepMin, inBedMin: asleepMin, awakeMin: 0, deepMin: 60, coreMin: 200, remMin: 90, bedtime: '2026-10-01T23:00:00', wake: '2026-10-02T07:00:00' });

function workout(at: number, weight: number, rir: number): TrainingWorkout {
  let t = at - 3600_000;
  const sets = Array.from({ length: 3 }, () => ({ weight, reps: 8, rir, timestamp: (t += 150_000) }));
  return { id: `w${at}`, timestamp: new Date(at).toISOString(), logs: { bench: sets }, liftMeta: { bench: { name: 'Bench Press', primaryMuscle: 'Chest' } } };
}

test('the calculator profile comes from saved inputs or the user profile', () => {
  assert.equal(profileFromUser({ weight: 180, height: 70, birthdate: '1996-01-01', gender: 'male' })?.heightInches, 70);
  assert.equal(profileFromUser({ weight: 180 }), null);
});

test('total burn (resting + active) picks an activity level; steps do when there are no calories', () => {
  const days: Record<string, HealthDay> = {};
  lastKeys(shiftKey(TODAY, 1), 14).forEach((k) => { days[k] = { activeKcal: 900, restingKcal: 1800, steps: 13000 }; });
  const m = measuredActivity(days, profile, NOW);
  assert.equal(m.basis, 'calories');
  assert.equal(m.maintenance, 2700); // 1,800 resting + 900 active
  assert.equal(m.level?.value, 'moderate');
  const advice = fullCoach({ history: [], health: { days, workouts: {} }, profile: { ...profile, activityLevel: 'sedentary' }, now: NOW });
  assert.match(advice.insights.find((i) => i.id === 'activity-level')!.title, /Moderate/);
  const stepsOnly: Record<string, HealthDay> = {};
  lastKeys(shiftKey(TODAY, 1), 10).forEach((k) => { stepsOnly[k] = { steps: 11000 }; });
  const s = measuredActivity(stepsOnly, profile, NOW);
  assert.equal(s.basis, 'steps');
  assert.equal(s.level?.value, 'very-active');
});

test('a stall during short sleep and a fast cut puts those fixes first', () => {
  const history = Array.from({ length: 10 }, (_, i) => workout(NOW - (36 - i * 4) * DAY, 185, 4));
  const days: Record<string, HealthDay> = {};
  for (let i = 0; i < 42; i++) days[shiftKey(TODAY, i)] = { sleep: night(370), ...(i % 2 ? {} : { weight: 180 + i * 0.3 }) };
  const p = fullCoach({ history, health: { days, workouts: {} }, now: NOW }).insights.find((i) => i.id === 'progression')!;
  assert.equal(p.usesHealth, true);
  assert.match(p.detail, /6h 10m of sleep/);
  assert.match(p.steps![0], /^Sleep first/);
  assert.match(p.steps![1], /cut this fast/);
});

test('easy sets on low-readiness days are not held against you', () => {
  const history = Array.from({ length: 12 }, (_, i) => workout(NOW - (40 - i * 3) * DAY, 185 + i * 5, 4));
  const days: Record<string, HealthDay> = {};
  for (let i = 0; i < 70; i++) days[shiftKey(TODAY, i)] = { sleep: night(460), restingHr: 52, hrv: 60 };
  // Every workout day: a short night, high resting HR and low HRV → low readiness.
  for (const w of history) days[localKey(new Date(w.timestamp))] = { sleep: night(280), restingHr: 62, hrv: 40 };
  const withHealth = fullCoach({ history, health: { days, workouts: {} }, now: NOW });
  const without = fullCoach({ history, now: NOW });
  assert.ok(without.insights.some((i) => i.id === 'effort-easy'));
  assert.ok(!withHealth.insights.some((i) => i.id === 'effort-easy'));
});

test('the heaviest day after the worst night of the week is flagged', () => {
  const history: TrainingWorkout[] = [];
  const days: Record<string, HealthDay> = {};
  for (let i = 0; i < 56; i++) {
    const key = shiftKey(TODAY, i);
    const [y, m, d] = key.split('-').map(Number);
    const date = new Date(y, m - 1, d, 18);
    const monday = date.getDay() === 1;
    days[key] = { sleep: night(monday ? 340 : 450) };
    if (monday) history.push({ ...workout(date.getTime(), 185, 2), logs: { bench: Array.from({ length: 12 }, () => ({ weight: 185, reps: 8, rir: 2 })) } });
    else if (date.getDay() === 4) history.push(workout(date.getTime(), 185, 2));
  }
  const s = fullCoach({ history, health: { days, workouts: {} }, now: NOW }).insights.find((i) => i.id === 'sleep-schedule')!;
  assert.match(s.detail, /^Monday is your biggest training day/);
  assert.match(s.steps![0], /Sunday nights/);
});

test('days with 0 active calories (Watch not worn) are left out of the burn', () => {
  assert.equal(dailyBurn({ activeKcal: 0, restingKcal: 0 }), undefined);
  assert.equal(dailyBurn({ activeKcal: 500, restingKcal: 1800 }), 2300);
  const days: Record<string, HealthDay> = { a: { activeKcal: 0, restingKcal: 0 }, b: { activeKcal: 500, restingKcal: 1800 } };
  assert.equal(rangeStats(days, ['a', 'b']).burnKcal, 2300);
});

test('Watch resting calories are compared with Mifflin-St Jeor and, with body fat, the lean-mass formulas', () => {
  const days: Record<string, HealthDay> = {};
  lastKeys(shiftKey(TODAY, 1), 10).forEach((k) => { days[k] = { activeKcal: 600, restingKcal: 2000 }; });
  days[shiftKey(TODAY, 11)] = { activeKcal: 0, restingKcal: 300 }; // not worn
  const noFat = restingVsFormula(days, profile, NOW)!;
  assert.equal(noFat.days, 10);
  assert.equal(noFat.watch, 2000);
  assert.deepEqual(noFat.formulas.map((f) => f.key), ['mifflin']);
  assert.equal(noFat.formulas[0].kcal, 1783); // 10×81.6 + 6.25×177.8 − 5×30 + 5

  days[shiftKey(TODAY, 2)].bodyFat = 15;
  const withFat = restingVsFormula(days, profile, NOW)!;
  assert.equal(withFat.bodyFat, 15);
  assert.equal(withFat.best.name, 'Katch-McArdle');
  assert.equal(withFat.formulas.find((f) => f.key === 'katch')!.kcal, Math.round(370 + 21.6 * 180 * 0.45359237 * 0.85));
  assert.equal(restingVsFormula({}, profile, NOW), null);
});

test('days the Watch was off for part of the day are left out of the burn and the activity level', () => {
  const days: Record<string, HealthDay> = {};
  const keys = lastKeys(shiftKey(TODAY, 1), 14);
  keys.forEach((k) => { days[k] = { activeKcal: 700, restingKcal: 1800, steps: 9000 }; });
  days[keys[3]] = { activeKcal: 160, restingKcal: 450 }; // half a day
  days[keys[8]] = { activeKcal: 350, restingKcal: 1790 }; // a lazy day, worn all day
  days[TODAY] = { activeKcal: 300, restingKcal: 1100 }; // not over yet
  const worn = fullWearDays(days);
  assert.equal(worn.has(keys[3]), false);
  assert.equal(worn.has(keys[8]), true);
  assert.equal(worn.has(TODAY), false);
  assert.equal(rangeStats(days, [keys[2], keys[3], keys[4]]).burnKcal, 2500);
  assert.equal(healthSeries(days, keys[3], 1)[0].burnKcal, undefined);
  assert.equal(measuredActivity(days, profile, NOW).days, 13);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { fullCoach, profileFromUser, watchActivity } from './coach';
import { lastKeys, localKey, shiftKey } from './health-insights';
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

test('the Watch’s active calories pick an activity level', () => {
  const days: Record<string, HealthDay> = {};
  lastKeys(shiftKey(TODAY, 1), 14).forEach((k) => { days[k] = { activeKcal: 1150 }; });
  const w = watchActivity(days, profile, NOW);
  assert.equal(w.avgActive, 1150);
  assert.equal(w.level?.value, 'very-active');
  const advice = fullCoach({ history: [], health: { days, workouts: {} }, profile, now: NOW });
  assert.match(advice.insights.find((i) => i.id === 'activity-level')!.title, /Very Active/);
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

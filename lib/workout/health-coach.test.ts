import test from 'node:test';
import assert from 'node:assert/strict';
import { coachInsights, recoveryDeloadReason, restRecovery, sessionStrength, type CoachWorkout } from './health-coach';
import { localKey, shiftKey } from './health-insights';
import type { HealthDay } from './health';

const NOW = new Date(2026, 9, 20, 20, 0).getTime();
const TODAY = localKey(NOW);
const dayAt = (daysAgo: number, hour = 18) => new Date(new Date(NOW).setHours(hour, 0, 0, 0) - daysAgo * 86_400_000);
const night = (asleepMin: number) => ({ asleepMin, inBedMin: asleepMin + 20, awakeMin: 10, deepMin: 60, coreMin: 200, remMin: 90, bedtime: '2026-10-01T23:00:00', wake: '2026-10-02T07:00:00' });
const workout = (id: string, daysAgo: number, benchWeight: number, extra: Record<string, { weight: number; reps: number }[]> = {}): CoachWorkout => ({
  id,
  timestamp: dayAt(daysAgo).toISOString(),
  logs: { bench: [{ weight: benchWeight, reps: 5 }, { weight: benchWeight, reps: 5 }], ...extra },
  liftMeta: { bench: { name: 'Bench Press' }, squat: { name: 'Squat' } },
});

test('session strength compares each lift with the best of the 90 days before', () => {
  const s = sessionStrength([workout('a', 10, 200), workout('b', 8, 210), workout('c', 6, 189)]);
  assert.equal(s.has('a'), false); // nothing to compare with yet
  assert.ok(Math.abs(s.get('b')!.index - 1.05) < 0.001);
  assert.ok(Math.abs(s.get('c')!.index - 0.9) < 0.001);
});

test('short nights that line up with weaker sessions are called out', () => {
  const history: CoachWorkout[] = [workout('base', 30, 200)];
  const days: Record<string, HealthDay> = {};
  // Alternate full and short nights; short-night sessions are ~6% lighter.
  for (let i = 0; i < 8; i++) {
    const ago = 24 - i * 3;
    const shortNight = i % 2 === 1;
    history.push(workout(`w${i}`, ago, shortNight ? 188 : 200));
    days[localKey(dayAt(ago))] = { sleep: night(shortNight ? 330 : 470) };
  }
  const sleep = coachInsights({ history, days, now: NOW }).find((i) => i.id === 'sleep-strength')!;
  assert.equal(sleep.tone, 'warn');
  assert.match(sleep.detail, /about 6% weaker/);
  assert.match(sleep.evidence, /8 workouts/);
});

test('a strained week with more training sets warns about recovery, and suggests a deload', () => {
  const days: Record<string, HealthDay> = {};
  for (let i = 7; i < 35; i++) days[shiftKey(TODAY, i)] = { restingHr: 52, hrv: 60 };
  for (let i = 0; i < 7; i++) days[shiftKey(TODAY, i)] = { restingHr: 58, hrv: 48 };
  const history = [
    ...[30, 23, 16, 9].map((d, i) => workout(`old${i}`, d, 200)),
    ...[6, 4, 2, 1].map((d, i) => workout(`new${i}`, d, 200, { squat: [{ weight: 300, reps: 5 }, { weight: 300, reps: 5 }] })),
  ];
  const r = coachInsights({ history, days, now: NOW }).find((i) => i.id === 'recovery-load')!;
  assert.equal(r.tone, 'warn');
  assert.match(r.title, /extra work/);
  assert.match(recoveryDeloadReason(days, NOW)!, /6 bpm above/);
  assert.equal(recoveryDeloadReason({}, NOW), null);
});

test('a fast cut with falling strength gets a slow-down tip', () => {
  const days: Record<string, HealthDay> = {};
  for (let i = 0; i < 42; i += 2) days[shiftKey(TODAY, i)] = { weight: 190 - (42 - i) * 0.05 * 6 }; // ~2 lb/week down
  const history = [
    workout('a', 35, 220, { squat: [{ weight: 300, reps: 5 }] }),
    workout('b', 28, 220, { squat: [{ weight: 300, reps: 5 }] }),
    workout('c', 10, 205, { squat: [{ weight: 280, reps: 5 }] }),
    workout('d', 3, 205, { squat: [{ weight: 280, reps: 5 }] }),
  ];
  const body = coachInsights({ history, days, now: NOW }).find((i) => i.id === 'body-strength')!;
  assert.equal(body.tone, 'warn');
  assert.match(body.title, /Cutting fast/);
});

test('short sleep on average is flagged', () => {
  const days: Record<string, HealthDay> = {};
  for (let i = 0; i < 10; i++) days[shiftKey(TODAY, i)] = { sleep: night(370) };
  const s = coachInsights({ history: [], days, now: NOW }).find((i) => i.id === 'sleep-habits')!;
  assert.equal(s.tone, 'warn');
  assert.match(s.title, /6h 10m/);
});

test('rest recovery reads heart rate around logged sets', () => {
  const start = dayAt(1, 17).getTime();
  // Set every 100 s; heart rate peaks at 150 after each set and only falls to ~140 before the next.
  const sets = Array.from({ length: 6 }, (_, i) => ({ weight: 225, reps: 5, timestamp: start + (60 + i * 100) * 1000 }));
  const trace: [number, number][] = [];
  for (let t = 0; t <= 700; t += 30) trace.push([t, (t - 60) % 100 < 30 ? 150 : 140]);
  const w: CoachWorkout = { id: 'w', timestamp: new Date(start + 700_000).toISOString(), logs: { squat: sets }, liftMeta: { squat: { name: 'Squat' } } };
  const rows = restRecovery([w], { w: { start: new Date(start).toISOString(), end: new Date(start + 700_000).toISOString(), trace } }, { [localKey(start)]: { restingHr: 55 } });
  assert.equal(rows[0].name, 'Squat');
  assert.ok(rows[0].recovered < 0.4);
  const insight = coachInsights({ history: [w], days: { [localKey(start)]: { restingHr: 55 } }, workoutHealth: { w: { start: new Date(start).toISOString(), end: '', trace } }, now: NOW }).find((i) => i.id === 'rest-short');
  assert.match(insight!.title, /Squat/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import type { HealthDay } from './health';
import { formatMinutes, healthSeries, lastKeys, rangeStats, readiness, shiftKey, typicalSleepTimes } from './health-insights';

const night = (asleepMin: number, bed = '2026-10-01T23:00:00', wake = '2026-10-02T07:00:00') => ({ asleepMin, inBedMin: asleepMin + 20, awakeMin: 10, deepMin: 60, coreMin: asleepMin - 150, remMin: 90, bedtime: bed, wake });

/** Four weeks of ordinary days before `today`, then today's values. */
function history(today: string, todays: HealthDay) {
  const days: Record<string, HealthDay> = {};
  for (let i = 1; i <= 28; i++) days[shiftKey(today, i)] = { sleep: night(450), restingHr: 52 + (i % 3) - 1, hrv: 60, steps: 8000 };
  days[today] = todays;
  return days;
}

test('day keys shift across months', () => {
  assert.equal(shiftKey('2026-11-01', 1), '2026-10-31');
  assert.deepEqual(lastKeys('2026-10-03', 3), ['2026-10-01', '2026-10-02', '2026-10-03']);
  assert.equal(formatMinutes(452), '7h 32m');
});

test('readiness is low after a short night with a raised resting heart rate', () => {
  const r = readiness(history('2026-10-20', { sleep: night(320), restingHr: 59, hrv: 58 }), '2026-10-20', 1)!;
  assert.equal(r.level, 'low');
  assert.equal(r.suggestedIntensity, 0.9);
  assert.deepEqual(r.factors.map((f) => [f.key, f.tone]), [['sleep', 'warn'], ['rhr', 'warn'], ['hrv', 'neutral']]);
});

test('readiness is high when everything is better than usual, normal otherwise', () => {
  assert.equal(readiness(history('2026-10-20', { sleep: night(500), restingHr: 48, hrv: 70 }), '2026-10-20')!.level, 'high');
  assert.equal(readiness(history('2026-10-20', { sleep: night(440), restingHr: 52, hrv: 61 }), '2026-10-20')!.level, 'normal');
});

test('no readiness without a baseline', () => {
  assert.equal(readiness({ '2026-10-20': { sleep: night(300), restingHr: 70 } }, '2026-10-20'), null);
});

test('range averages skip missing days and trends use first and last readings', () => {
  const stats = rangeStats({
    '2026-10-01': { steps: 4000, weight: 184, bodyFat: 19 },
    '2026-10-03': { steps: 8000, sleep: night(420), weight: 182.5 },
  }, lastKeys('2026-10-03', 3));
  assert.equal(stats.steps, 6000);
  assert.equal(stats.sleepMin, 420);
  assert.deepEqual(stats.weight, { latest: 182.5, change: -1.5 });
  assert.deepEqual(stats.bodyFat, { latest: 19, change: null });
});

test('weekly series averages each week', () => {
  const days: Record<string, HealthDay> = {};
  lastKeys('2026-10-14', 14).forEach((k, i) => { days[k] = { steps: i < 7 ? 1000 : 3000 }; });
  const weeks = healthSeries(days, '2026-10-14', 14, true);
  assert.deepEqual(weeks.map((w) => w.steps), [1000, 3000]);
});

test('typical sleep times handle bedtimes either side of midnight', () => {
  const days = {
    '2026-10-02': { sleep: night(420, '2026-10-01T23:30:00', '2026-10-02T06:30:00') },
    '2026-10-03': { sleep: night(420, '2026-10-03T00:30:00', '2026-10-03T07:30:00') },
    '2026-10-04': { sleep: night(420, '2026-10-03T23:50:00', '2026-10-04T06:50:00') },
  };
  const times = typicalSleepTimes(days, Object.keys(days))!;
  assert.match(times.bedtime, /11:50/);
  assert.match(times.wake, /6:50/);
});

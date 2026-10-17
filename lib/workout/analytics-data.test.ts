import test from 'node:test';
import { strict as assert } from 'node:assert';
import { buildAnalyticsData } from './analytics-data';

const workout = (day: number, sets: [number, number][], extra: object = {}) => ({
  id: `w${day}`,
  timestamp: new Date(Date.UTC(2026, 0, day)).toISOString(),
  type: { name: 'Push' },
  logs: { gone: sets.map(([weight, reps]) => ({ weight, reps })) },
  liftMeta: { gone: { name: 'Old Bench', primaryMuscle: 'Chest' } },
  ...extra,
});

test('buildAnalyticsData names lifts from saved liftMeta and compares top sets', () => {
  const data = buildAnalyticsData([
    workout(1, [[135, 10], [135, 9]]),
    workout(8, [[145, 8], [95, 15]]), // back-off last set must not look like regression
  ], [], [], Date.UTC(2026, 0, 10));

  assert.equal(data.oneRMs[0].name, 'Old Bench');
  assert.equal(data.overloadTracking.length, 1);
  const entry = data.overloadTracking[0];
  assert.equal(entry.currWeight, 145);
  assert.ok(entry.intensityRatio > 1, `ratio ${entry.intensityRatio}`);
  assert.equal(data.muscleVolume[0].name, 'Chest');
  assert.equal(data.prTimeline.length, 2);
  assert.equal(data.recovery[0].muscle, 'Chest');
  assert.equal(data.trainingDays.size, 2);
});

test('buildAnalyticsData applies calibration scale to stack lifts', () => {
  const data = buildAnalyticsData([
    workout(1, [[100, 10]], { gymId: 'g1', liftMeta: { gone: { name: 'Chest Press', stationType: 'stack' } } }),
  ], [], [{ gymId: 'g1', liftKey: 'chest press', scaleFactor: 1.2 }]);
  assert.equal(data.oneRMs[0].scaleFactor, 1.2);
  assert.equal(data.volumeTimeline[0].volume, 1200);
});

test('progression ignores ramp-up from light starting weights', async () => {
  const { strengthProgressRate, calculateExperienceScore } = await import('./analytics');
  const day = (n: number) => new Date(Date.UTC(2026, 0, 1) + n * 86_400_000).toISOString();
  // Ramp-up 45 → 135 in the first three sessions, then flat at 135 × 8 for weeks.
  const weights = [45, 95, 135, 135, 135, 135, 135, 135, 135, 135];
  const history = weights.map((w, i) => ({ timestamp: day(i * 7), logs: { b: [{ weight: w, reps: 8, rir: 2 }] }, liftMeta: { b: { name: 'Bench Press' } } }));
  assert.equal(strengthProgressRate(history)?.pctPerMonth, 0);
  assert.equal(calculateExperienceScore({ weight: 180 }, history, [{ id: 'b', name: 'Bench Press', primaryMuscle: 'Chest' }]).breakdown.progression, 0);
  // Real progress: +5 lb a session after the ramp-up.
  const growing = weights.map((w, i) => ({ timestamp: day(i * 7), logs: { b: [{ weight: i < 3 ? w : 135 + (i - 3) * 5, reps: 8, rir: 2 }] }, liftMeta: { b: { name: 'Bench Press' } } }));
  assert.ok(strengthProgressRate(growing)!.pctPerMonth > 5);
});

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

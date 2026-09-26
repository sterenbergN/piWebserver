import test from 'node:test';
import { strict as assert } from 'node:assert';
import { bestE1RMByLift, findPreviousSameType, restTargetSeconds, workoutVolume } from './session-insights';

test('rest target scales with rep range', () => {
  assert.equal(restTargetSeconds(3), 180);
  assert.equal(restTargetSeconds(8), 120);
  assert.equal(restTargetSeconds(10), 90);
  assert.equal(restTargetSeconds(15), 60);
});

test('bestE1RMByLift keeps the strongest set per lift', () => {
  const best = bestE1RMByLift([
    { logs: { bench: [{ weight: 135, reps: 10 }, { weight: 155, reps: 5 }] } },
    { logs: { bench: [{ weight: 145, reps: 8 }], squat: [{ weight: 0, reps: 10 }] } },
  ]);
  assert.ok(best.bench > 170 && best.bench < 185, `bench ${best.bench}`);
  assert.equal(best.squat, undefined);
});

test('workoutVolume and findPreviousSameType', () => {
  assert.equal(workoutVolume({ a: [{ weight: 100, reps: 5 }, { weight: 100, reps: 5 }], b: [{ weight: 20, reps: 10 }] }), 1200);
  const history = [
    { id: '1', timestamp: '2026-01-01T00:00:00Z', type: { id: 'push' } },
    { id: '2', timestamp: '2026-01-08T00:00:00Z', type: { id: 'push' } },
    { id: '3', timestamp: '2026-01-09T00:00:00Z', type: { id: 'pull' } },
  ];
  assert.equal(findPreviousSameType(history, { id: 'push' })?.id, '2');
  assert.equal(findPreviousSameType(history, { id: 'legs' }), null);
});

test('trainingStreak counts weeks and tolerates an empty current week', async () => {
  const { trainingStreak } = await import('./session-insights');
  const now = new Date('2026-09-24T12:00:00'); // Thursday
  const at = (iso: string) => ({ timestamp: new Date(iso).toISOString() });
  const history = [
    at('2026-09-22T10:00:00'), // this week (Tue)
    at('2026-09-15T10:00:00'), // last week
    at('2026-09-09T10:00:00'), // 2 weeks ago
    at('2026-08-20T10:00:00'), // gap before this
  ];
  assert.deepEqual(trainingStreak(history, now), { workoutsThisWeek: 1, weekStreak: 3, daysSinceLast: 2 });
  // Nothing yet this week: the streak from previous weeks still stands.
  assert.equal(trainingStreak(history.slice(1), now).weekStreak, 2);
  assert.equal(trainingStreak([], now).daysSinceLast, null);
});

test('warmupSets ramps toward the working weight on real plate increments', async () => {
  const { warmupSets } = await import('./session-insights');
  const plates = [45, 55, 65, 75, 85, 95, 105, 115, 125, 135, 145, 155, 165, 175, 185, 195, 205, 215, 225];
  assert.deepEqual(warmupSets(225, plates), [{ weight: 85, reps: 8 }, { weight: 135, reps: 5 }, { weight: 175, reps: 3 }]);
  assert.deepEqual(warmupSets(40, plates), []);
  // Lightest weight repeated is collapsed rather than listed twice.
  assert.deepEqual(warmupSets(95, plates), [{ weight: 45, reps: 8 }, { weight: 55, reps: 5 }, { weight: 75, reps: 3 }]);
});

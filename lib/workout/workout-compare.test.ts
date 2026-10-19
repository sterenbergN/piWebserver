import test from 'node:test';
import assert from 'node:assert/strict';
import { compareWorkouts, defaultComparison } from './workout-compare';
import type { Workout } from './insights';

const push1: Workout = { id: 'p1', timestamp: '2026-09-01T18:00:00Z', type: { name: 'Push' }, durationSecs: 3000, logs: { bench: [{ weight: 135, reps: 10 }, { weight: 135, reps: 8 }], fly: [{ weight: 30, reps: 12 }] }, liftMeta: { bench: { name: 'Bench Press' }, fly: { name: 'Cable Fly' } } };
const legs: Workout = { id: 'l1', timestamp: '2026-09-20T18:00:00Z', type: { name: 'Legs' }, logs: { squat: [{ weight: 225, reps: 5 }] }, liftMeta: { squat: { name: 'Back Squat' } } };
// Bench at another gym (different lift id, same exercise); no fly; dips added.
const push2: Workout = { id: 'p2', timestamp: '2026-10-01T18:00:00Z', type: { name: 'Push' }, durationSecs: 3600, logs: { bench2: [{ weight: 155, reps: 8 }], dips: [{ weight: 0, reps: 12 }] }, liftMeta: { bench2: { name: 'Bench Press' }, dips: { name: 'Dip' } } };

test('lifts line up by exercise across gyms', () => {
  const c = compareWorkouts(push2, push1);
  assert.deepEqual(c.lifts.map((r) => [r.name, r.a?.top.weight ?? null, r.b?.top.weight ?? null]), [['Bench Press', 155, 135], ['Dip', 0, null], ['Cable Fly', null, 30]]);
  assert.ok((c.lifts[0].change ?? 0) > 0);
  assert.equal(c.lifts[1].change, null);
  assert.deepEqual(c.totals, [{ label: 'Sets', a: 2, b: 3 }, { label: 'Volume (lb)', a: 1240, b: 2790 }, { label: 'Minutes', a: 60, b: 50 }]);
});

test('the default comparison is the previous workout of the same type', () => {
  assert.equal(defaultComparison(push2, [push1, legs, push2])?.id, 'p1');
  assert.equal(defaultComparison(legs, [push1, legs, push2])?.id, 'p1'); // no earlier Legs: the one before
  assert.equal(defaultComparison(push1, [push1, legs, push2]), null);
});

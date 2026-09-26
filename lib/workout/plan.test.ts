import test from 'node:test';
import { strict as assert } from 'node:assert';
import { buildLiftPlan } from './plan';

const lifts = [
  { id: 'bench', name: 'Bench Press', primaryMuscle: 'Chest' },
  { id: 'fly', name: 'Cable Fly', primaryMuscle: 'Chest' },
  { id: 'ohp', name: 'Overhead Press', primaryMuscle: 'Shoulders' },
  { id: 'lat', name: 'Lateral Raise', primaryMuscle: 'Shoulders' },
  { id: 'push', name: 'Tricep Pushdown', primaryMuscle: 'Triceps' },
  { id: 'curl', name: 'Curl', primaryMuscle: 'Biceps' },
];

test('random plan covers each target muscle, no duplicates, stays in muscles', () => {
  for (let i = 0; i < 20; i++) {
    const plan = buildLiftPlan(lifts, ['Chest', 'Shoulders', 'Triceps'], 4);
    assert.equal(plan.length, 4);
    assert.equal(new Set(plan.map((l) => l.id)).size, 4);
    for (const muscle of ['Chest', 'Shoulders', 'Triceps']) assert.ok(plan.some((l) => l.primaryMuscle === muscle));
    assert.ok(!plan.some((l) => l.id === 'curl'));
  }
});

test('pinned lifts come first in order, rest is filled randomly', () => {
  const plan = buildLiftPlan(lifts, ['Chest', 'Shoulders', 'Triceps'], 4, [], [
    { liftId: 'lat', name: 'Lateral Raise' },
    { liftId: 'gone', name: 'bench press' }, // matched by name at this gym
  ]);
  assert.deepEqual(plan.slice(0, 2).map((l) => l.id), ['lat', 'bench']);
  assert.equal(plan.length, 4);
  assert.ok(plan.some((l) => l.primaryMuscle === 'Triceps'));
});

test('pinned lifts are kept even when they exceed the lift count', () => {
  const pins = ['bench', 'fly', 'ohp'].map((id) => ({ liftId: id, name: id }));
  assert.equal(buildLiftPlan(lifts, ['Chest'], 2, [], pins).length, 3);
});

test('recently done lifts are deprioritized', () => {
  const history = [{ timestamp: '2026-01-02', logs: { bench: [] } }];
  for (let i = 0; i < 10; i++) {
    const plan = buildLiftPlan(lifts, ['Chest'], 1, history);
    assert.equal(plan[0].id, 'fly');
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { exerciseVariant, relatedStartingWeight } from './related-exercises';

test('exercises are grouped into families with rough strength ratios', () => {
  assert.deepEqual(exerciseVariant('Dumbbell Bench Press'), { family: 'press', factor: 0.38 });
  assert.equal(exerciseVariant('Incline Dumbbell Press')?.factor, 0.33);
  assert.equal(exerciseVariant('Flat Bench')?.family, 'press');
  assert.equal(exerciseVariant('Dumbbell Shoulder Press')?.family, 'overhead');
  assert.equal(exerciseVariant('Seated Leg Curl')?.family, 'leg-curl');
  assert.equal(exerciseVariant('Hammer Curl')?.family, 'curl');
  assert.equal(exerciseVariant('Rear Delt Fly'), null);
  assert.equal(exerciseVariant('Straight-Arm Pulldown'), null);
});

const history = [
  { timestamp: '2026-10-01T18:00:00Z', logs: { bp: [{ weight: 185, reps: 5 }] }, liftMeta: { bp: { name: 'Bench Press' } } },
  { timestamp: '2026-10-08T18:00:00Z', logs: { bp: [{ weight: 150, reps: 10 }], curl: [{ weight: 60, reps: 10 }] }, liftMeta: { bp: { name: 'Bench Press' }, curl: { name: 'EZ-Bar Curl' } } },
];

test('a new dumbbell press starts from recent bench numbers, rounded down to the rack', () => {
  const rack = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60];
  const start = relatedStartingWeight({ name: 'Dumbbell Bench Press' }, history, { reps: 10, possibleWeights: rack })!;
  assert.equal(start.fromName, 'Bench Press');
  assert.equal(start.fromE1rm, 196); // the most recent session, not the best
  // 196 × 0.38 ≈ 74.5 e1RM → for 12 reps-to-failure ≈ 52 → ×0.9 ≈ 47 → 45 on the rack
  assert.equal(start.weight, 45);
});

test('no related lift, or an unrelated exercise, gives nothing', () => {
  assert.equal(relatedStartingWeight({ name: 'Front Squat' }, history, { reps: 5 }), null);
  assert.equal(relatedStartingWeight({ name: 'Plank' }, history, { reps: 5 }), null);
  assert.equal(relatedStartingWeight({ name: 'Hammer Curl' }, history, { reps: 10 })?.fromName, 'EZ-Bar Curl');
});

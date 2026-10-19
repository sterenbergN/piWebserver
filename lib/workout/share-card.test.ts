import test from 'node:test';
import assert from 'node:assert/strict';
import { cardDataForWorkout } from './share-card';

const day = (d: number) => `2026-03-${String(d).padStart(2, '0')}T18:00:00Z`;
const history = [
  { id: 'a', timestamp: day(1), type: { name: 'Push' }, logs: { bench: [{ weight: 185, reps: 5 }], fly: [{ weight: 30, reps: 12 }] }, liftMeta: { bench: { name: 'Bench Press' }, fly: { name: 'Fly' } } },
  { id: 'b', timestamp: day(8), type: { name: 'Push' }, durationSecs: 2400, gymName: 'Big Gym', logs: { bench: [{ weight: 195, reps: 5 }, { weight: 185, reps: 0 }], fly: [{ weight: 25, reps: 12 }], dips: [{ weight: 0, reps: 10 }] }, liftMeta: { bench: { name: 'Bench Press' }, fly: { name: 'Fly' }, dips: { name: 'Dips' } } },
  { id: 'c', timestamp: day(15), type: { name: 'Push' }, logs: { bench: [{ weight: 225, reps: 3 }] }, liftMeta: { bench: { name: 'Bench Press' } } },
];

test('a past workout is compared with the workouts before it, not after', () => {
  const card = cardDataForWorkout(history[1], history);
  assert.equal(card.title, 'Push');
  assert.equal(card.gymName, 'Big Gym');
  assert.equal(card.duration, '40:00');
  assert.equal(card.sets, 3); // the 0-rep set is left out
  assert.equal(card.volume, 195 * 5 + 25 * 12);
  assert.deepEqual(card.lifts.map((l) => [l.name, l.top, l.change, !!l.pr]), [
    ['Bench Press', '195×5', 'up', true],
    ['Fly', '25×12', 'down', false],
    ['Dips', '0×10', 'new', false],
  ]);
  assert.match(card.verdict, /1 new personal record/);
});

test('the first workout has nothing to compare with', () => {
  const card = cardDataForWorkout(history[0], history, { gymName: 'Home' });
  assert.equal(card.gymName, 'Home');
  assert.ok(card.lifts.every((l) => l.change === 'new' && !l.pr));
  assert.equal(card.verdict, 'A new baseline to beat next time.');
});

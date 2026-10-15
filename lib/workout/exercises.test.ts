import test from 'node:test';
import assert from 'node:assert/strict';
import { exerciseKey, exerciseLibrary, exerciseName, lastSessionForLift, libraryExercisesFor, liftFromNameOrLibrary } from './exercises';
import { finalizeLift } from './stations';
import { bestE1RMByExercise, detectStalledLifts, liftSessions } from './session-insights';
import type { Gym } from './types';

const lift = (id: string, name: string, extra: Record<string, unknown> = {}) =>
  ({ id, name, primaryMuscle: 'Chest', secondaryMuscle: 'Triceps', singleArmLeg: false, ...extra });

const gyms: Gym[] = [
  { id: 'g1', name: 'Home', ownerId: 'u', stations: [{ id: 's1', name: 'Rack', type: 'plates', lifts: [lift('l1', 'Bench', { exercise: 'Bench Press' })] }] },
  { id: 'g2', name: 'Big Gym', ownerId: 'u', stations: [
    { id: 's2', name: 'Bench', type: 'plates', lifts: [lift('l2', 'Bench Press', { progressionProfile: 'high-rep' })] },
    { id: 's3', name: 'Cables', type: 'cable', lifts: [lift('l3', 'Cable Fly', { secondaryMuscle: 'None' })] },
  ] },
];

test('a lift counts as its exercise, else its own name', () => {
  assert.equal(exerciseName(lift('a', 'Bench', { exercise: 'Bench Press' })), 'Bench Press');
  assert.equal(exerciseName(lift('a', 'Bench Press')), 'Bench Press');
  assert.equal(exerciseKey({ name: 'Close-Grip  Bench' }), exerciseKey({ name: 'close grip bench' }));
});

test('exerciseLibrary merges lifts that are the same exercise across gyms', () => {
  const library = exerciseLibrary(gyms);
  assert.deepEqual(library.map((e) => e.name), ['Bench Press', 'Cable Fly']);
  assert.deepEqual(library[0].uses.map((u) => `${u.gymName}/${u.liftName}`), ['Home/Bench', 'Big Gym/Bench Press']);
});

test('library suggestions match the kind of equipment and skip what it has', () => {
  const library = exerciseLibrary(gyms);
  assert.deepEqual(libraryExercisesFor({ type: 'plates', lifts: [] }, library).map((e) => e.name), ['Bench Press']);
  assert.deepEqual(libraryExercisesFor({ type: 'plates', lifts: [lift('x', 'bench press')] as any }, library), []);
});

test('typed names reuse your own exercise details', () => {
  const library = exerciseLibrary(gyms);
  const reused = liftFromNameOrLibrary('cable fly', library);
  assert.equal(reused.name, 'Cable Fly');
  assert.equal(reused.secondaryMuscle, 'None');
  assert.equal(liftFromNameOrLibrary('Lat Pulldown', library).primaryMuscle, 'Back');
});

test('finalizeLift only keeps an exercise that differs from the name', () => {
  assert.equal(finalizeLift({ name: 'Bench', exercise: 'Bench Press' }).exercise, 'Bench Press');
  assert.equal(finalizeLift({ name: 'Bench Press', exercise: 'bench press' }).exercise, undefined);
});

type Saved = { id: string; timestamp: string; gymId: string; gymName: string; logs: Record<string, { weight: number; reps: number }[]>; liftMeta: Record<string, { name: string; exercise?: string }> };
const history: Saved[] = [
  { id: 'w1', timestamp: '2026-01-01T10:00:00Z', gymId: 'g2', gymName: 'Big Gym', logs: { l2: [{ weight: 135, reps: 10 }] }, liftMeta: { l2: { name: 'Bench Press' } } },
  { id: 'w2', timestamp: '2026-01-05T10:00:00Z', gymId: 'g1', gymName: 'Home', logs: { l1: [{ weight: 145, reps: 8 }] }, liftMeta: { l1: { name: 'Bench', exercise: 'Bench Press' } } },
];

test('last session prefers the same lift, then the same exercise elsewhere', () => {
  const same = lastSessionForLift(history, lift('l2', 'Bench Press'));
  assert.equal(same?.workout.id, 'w1');
  assert.equal(same?.sameLift, true);
  const elsewhere = lastSessionForLift(history, lift('new', 'Bench Press'));
  assert.equal(elsewhere?.workout.id, 'w2');
  assert.equal(elsewhere?.sameLift, false);
  assert.equal(lastSessionForLift(history, lift('new', 'Squat')), null);
});

test('history, bests and plateaus follow the exercise across gyms', () => {
  assert.equal(liftSessions(history, 'l2', 'Bench Press').length, 2);
  const best = bestE1RMByExercise(history);
  assert.deepEqual(Object.keys(best), ['bench press']);
  const flat = Array.from({ length: 6 }, (_, i) => ({
    timestamp: `2026-02-0${i + 1}T10:00:00Z`,
    logs: { [i % 2 ? 'l1' : 'l2']: [{ weight: 135, reps: 10 }] },
    liftMeta: { [i % 2 ? 'l1' : 'l2']: i % 2 ? { name: 'Bench', exercise: 'Bench Press' } : { name: 'Bench Press' } },
  }));
  const stalled = detectStalledLifts(flat);
  assert.equal(stalled.length, 1);
  assert.equal(stalled[0].name, 'Bench Press');
  assert.equal(stalled[0].sessions, 6);
});

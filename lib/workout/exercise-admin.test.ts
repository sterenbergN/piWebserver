import test from 'node:test';
import assert from 'node:assert/strict';
import { likelyDuplicates, renameInCalibrations, renameInGoals, renameInGyms, renameInHistory } from './exercise-admin';
import { exerciseLibrary } from './exercises';
import type { Gym } from './types';

const lift = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, name, primaryMuscle: 'Chest', secondaryMuscle: 'None', singleArmLeg: false, ...extra });

test('renaming an exercise renames lifts named after it and relinks the rest', () => {
  const gyms = [{ stations: [{ lifts: [lift('a', 'Bench Press'), lift('b', 'Flat Bench', { exercise: 'Bench Press' }), lift('c', 'Squat')] }] }];
  const changed = renameInGyms(gyms, new Set(['bench press']), 'Barbell Bench');
  assert.equal(changed, 2);
  const [a, b, c] = gyms[0].stations[0].lifts as any[];
  assert.equal(a.name, 'Barbell Bench');
  assert.equal(a.exercise, undefined);
  assert.equal(b.name, 'Flat Bench');
  assert.equal(b.exercise, 'Barbell Bench');
  assert.equal(c.name, 'Squat');
});

test('merging points history, goals and calibrations at the kept name', () => {
  type Meta = Record<string, { name: string; exercise?: string }>;
  const history: { liftMeta: Meta }[] = [{ liftMeta: { x: { name: 'Bench' }, y: { name: 'Squat' } } }, { liftMeta: { z: { name: 'Flat Bench', exercise: 'Bench' } } }];
  assert.equal(renameInHistory(history, new Set(['bench']), 'Bench Press'), 2);
  assert.equal(history[0].liftMeta.x.exercise, 'Bench Press');
  assert.equal(history[0].liftMeta.y.exercise, undefined);
  assert.equal(history[1].liftMeta.z.exercise, 'Bench Press');

  const goals = [{ exercise: 'bench' }, { exercise: 'Squat' }];
  assert.equal(renameInGoals(goals, new Set(['bench']), 'Bench Press'), 1);
  assert.equal(goals[0].exercise, 'Bench Press');

  const calibrations = renameInCalibrations([
    { gymId: 'g', liftKey: 'chest press', confidence: 0.4 },
    { gymId: 'g', liftKey: 'chest press machine', confidence: 0.9 },
  ], ['Chest Press Machine'], 'Chest Press');
  assert.deepEqual(calibrations, [{ gymId: 'g', liftKey: 'chest press', confidence: 0.9 }]);
});

test('likely duplicates ignore filler words, plurals and spacing', () => {
  const gyms: Gym[] = [{ id: 'g', name: 'G', ownerId: 'u', stations: [{ id: 's', name: 'S', type: 'plates', lifts: [
    lift('1', 'Bench Press'), lift('2', 'Barbell Bench Press'), lift('3', 'Incline Bench Press'),
    lift('4', 'Bicep Curls'), lift('5', 'bicep curl'), lift('6', 'Pull-Ups'), lift('7', 'Pullup'),
  ] as any }] }];
  const groups = likelyDuplicates(exerciseLibrary(gyms)).map((g) => g.map((e) => e.name).sort());
  assert.deepEqual(groups.sort(), [['Barbell Bench Press', 'Bench Press'], ['Bicep Curls', 'bicep curl'], ['Pull-Ups', 'Pullup']].sort());
});

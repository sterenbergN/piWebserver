import test from 'node:test';
import assert from 'node:assert/strict';
import { buildShareSnapshot, findImportedGym, gymFromSnapshot, mergeSnapshotIntoGym, missingFromGym, planFromShare } from './workout-share';
import type { Gym } from './types';

const lift = (id: string, name: string, extra = {}) => ({ id, name, primaryMuscle: 'Chest', secondaryMuscle: 'None', singleArmLeg: false, ...extra });
const sharerGym: Gym = {
  id: 'g1', name: 'Big Gym', emoji: '🏢', ownerId: 'alex',
  stations: [
    { id: 'rack', name: 'Squat Rack', type: 'plates', baseWeight: 45, plateSets: [45, 25], photo: 'p1', lifts: [lift('squat', 'Back Squat'), lift('ohp', 'Overhead Press')] },
    { id: 'row', name: 'Row Machine', type: 'stack', minWeight: 10, maxWeight: 200, increment: 10, lifts: [lift('mrow', 'Machine Row')] },
    { id: 'bench', name: 'Bench', type: 'plates', lifts: [lift('bp', 'Bench Press')] },
  ],
};
const workout = {
  name: 'Pull @ Big Gym',
  timestamp: '2026-03-01T18:00:00Z',
  gymId: 'g1',
  logs: { squat: [{ weight: 225, reps: 5, rir: 2 }], mrow: [{ weight: 120, reps: 10 }], gone: [{ weight: 50, reps: 10 }] },
  liftMeta: { squat: { name: 'Back Squat', stationId: 'rack' }, mrow: { name: 'Machine Row', stationId: 'row' } },
};

test('a snapshot carries only the machines and lifts used, without photos', () => {
  const snap = buildShareSnapshot(workout, sharerGym);
  assert.deepEqual(snap.lifts.map((l) => l.name), ['Back Squat', 'Machine Row']);
  assert.deepEqual(snap.gym.stations.map((s) => [s.name, s.lifts.map((l) => l.name)]), [['Squat Rack', ['Back Squat']], ['Row Machine', ['Machine Row']]]);
  assert.equal(snap.gym.stations[0].photo, undefined);
  assert.deepEqual(snap.lifts[0].sets, [{ weight: 225, reps: 5, rir: 2 }]);
});

test('importing creates a gym that later shares from the same gym will find', () => {
  const snap = buildShareSnapshot(workout, sharerGym);
  const imported = { id: 'mine', ownerId: 'sam', ...gymFromSnapshot(snap.gym, { id: 'alex', name: 'Alex' }) } as Gym;
  assert.equal(imported.stations[0].sourceId, 'rack');
  assert.equal(imported.stations[0].lifts[0].sourceId, 'squat');
  assert.notEqual(imported.stations[0].id, 'rack');
  assert.equal(findImportedGym([imported], 'alex', 'g1')?.id, 'mine');
  assert.equal(findImportedGym([imported], 'someone-else', 'g1'), undefined);

  // A later share from the same gym adds only what's new.
  const later = buildShareSnapshot({ ...workout, logs: { squat: workout.logs.squat, ohp: [{ weight: 95, reps: 8 }], bp: [{ weight: 185, reps: 5 }] }, liftMeta: {} }, sharerGym);
  assert.deepEqual(missingFromGym(imported, later.gym), { stations: 1, lifts: 1 });
  const merged = mergeSnapshotIntoGym(imported, later.gym);
  assert.equal(merged.stations.length, 3);
  assert.deepEqual(merged.stations[0].lifts.map((l) => l.name), ['Back Squat', 'Overhead Press']);
  const plan = planFromShare(later, { stations: merged.stations });
  assert.deepEqual(plan.entries.map((e) => e.lift.name), ['Back Squat', 'Overhead Press', 'Bench Press']);
  assert.deepEqual(plan.missing, []);
});

test('a share maps onto your own gym by machine kind and exercise', () => {
  const snap = buildShareSnapshot(workout, sharerGym);
  const myGym = { stations: [
    { id: 'm1', name: 'Machine Row', kind: 'Row Machine', type: 'stack' as const, lifts: [lift('x', 'Seated Row', { exercise: 'Machine Row' })] },
    { id: 'm2', name: 'Power Rack', type: 'plates' as const, lifts: [lift('y', 'Back Squat')] },
  ] };
  const plan = planFromShare(snap, myGym);
  assert.deepEqual(plan.entries.map((e) => [e.station.id, e.lift.id]), [['m2', 'y'], ['m1', 'x']]);
  assert.deepEqual(planFromShare(snap, { stations: [] }).missing, ['Back Squat', 'Machine Row']);
});

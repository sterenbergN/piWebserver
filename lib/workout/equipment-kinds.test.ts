import test from 'node:test';
import assert from 'node:assert/strict';
import {
  kindPairKey, liftLinkSuggestions, machineKindLibrary, renameDismissedPairs, setKindInGyms, suggestKindMatches, unlinkStation,
} from './equipment-kinds';
import { equipmentLibrary } from './equipment-library';
import { findReferenceLift } from './calibration';
import { finalizeStation, listFieldsFromStation } from './stations';
import type { Gym, Station, StationType } from './types';

const lift = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, name, primaryMuscle: 'Back', secondaryMuscle: 'None', singleArmLeg: false, ...extra });
const station = (id: string, name: string, type: StationType, lifts: ReturnType<typeof lift>[] = [], extra: Partial<Station> = {}): Station =>
  ({ id, name, type, minWeight: 10, maxWeight: 200, increment: 10, lifts, ...extra });
const gym = (id: string, stations: Station[]): Gym => ({ id, name: `Gym ${id.toUpperCase()}`, ownerId: 'u', stations });

test('stations of the same kind are one machine with each gym’s copy', () => {
  const gyms = [
    gym('a', [station('s1', 'Row Machine', 'stack', [lift('l1', 'Machine Row')])]),
    gym('b', [station('s2', 'Machine Row', 'stack', [lift('l2', 'Seated Row'), lift('l3', 'Rear Delt Row')], { kind: 'Row Machine', maxWeight: 250 })]),
  ];
  const kinds = machineKindLibrary(gyms);
  assert.equal(kinds.length, 1);
  assert.equal(kinds[0].name, 'Row Machine');
  assert.deepEqual(kinds[0].copies.map((c) => [c.gymName, c.stationName, c.liftCount]), [['Gym A', 'Row Machine', 1], ['Gym B', 'Machine Row', 2]]);
  assert.equal(kinds[0].copies[1].weights, '10–250 lb by 10');

  // "From your other gyms" offers the linked machine once, and not where it already is.
  assert.deepEqual(equipmentLibrary([...gyms, gym('c', [])], gyms[2] ?? null).map((s) => s.id), ['s2']);
  assert.deepEqual(equipmentLibrary([...gyms, gym('c', [])], gyms[0]), []);
});

test('possible matches: loosely equal names of the same type, or a shared exercise', () => {
  const gyms = [
    gym('a', [
      station('a1', 'Row Machine', 'stack', [lift('1', 'Machine Row')]),
      station('a2', 'Leg Press', 'stack', [lift('2', 'Leg Press')]),
      station('a3', 'Cable Tower', 'cable', [lift('3', 'Tricep Pushdown'), lift('4', 'Face Pull')]),
      station('a4', 'Squat Rack', 'plates', [lift('5', 'Back Squat')]),
    ]),
    gym('b', [
      station('b1', 'Machine Rows', 'stack', [lift('6', 'Seated Row')]),
      station('b2', 'Leg Curl', 'stack', [lift('7', 'Seated Leg Curl')]),
      station('b3', 'Functional Trainer', 'cable', [lift('8', 'Tricep Pushdown')]),
      station('b4', 'Squat Racks', 'stack', []), // same name but a different type of equipment
    ]),
  ];
  const kinds = machineKindLibrary(gyms);
  const matches = suggestKindMatches(kinds);
  const pairs = matches.map((m) => [m.a.name, m.b.name].sort().join(' / '));
  assert.ok(pairs.includes('Machine Rows / Row Machine'));
  assert.ok(pairs.includes('Cable Tower / Functional Trainer'));
  assert.ok(!pairs.some((p) => p.includes('Leg Press') && p.includes('Leg Curl')));
  assert.equal(matches.length, 2);
  assert.equal(matches[0].sameName, true, 'name matches rank first');
  assert.deepEqual(matches[1].sharedExercises, ['Tricep Pushdown']);

  // "Not the same" is remembered per pair.
  const rows = matches[0];
  assert.equal(suggestKindMatches(kinds, [kindPairKey(rows.b.key, rows.a.key)]).length, 1);
});

test('two machines in the same gym are never suggested as one', () => {
  const kinds = machineKindLibrary([
    gym('a', [station('a1', 'Smith Machine', 'plates', [lift('1', 'Incline Bench Press')]), station('a2', 'Incline Bench', 'plates', [lift('2', 'Incline Bench Press')])]),
    gym('b', [station('b1', 'Incline Bench', 'plates', [lift('3', 'Incline Bench Press')])]),
  ]);
  const pairs = suggestKindMatches(kinds).map((m) => [m.a.name, m.b.name].sort().join(' / '));
  assert.deepEqual(pairs, []);
});

test('linking keeps station names; renaming everywhere renames stations named after the kind', () => {
  const gyms = [
    gym('a', [station('a1', 'Row Machine', 'stack')]),
    gym('b', [station('b1', 'Machine Row', 'stack'), station('b2', 'Leg Press', 'plates')]),
  ];
  assert.equal(setKindInGyms(gyms, new Set(['machine row']), 'Row Machine'), 1);
  assert.equal(gyms[1].stations[0].name, 'Machine Row');
  assert.equal(gyms[1].stations[0].kind, 'Row Machine');
  assert.equal(machineKindLibrary(gyms).find((k) => k.key === 'row machine')?.copies.length, 2);

  assert.equal(setKindInGyms(gyms, new Set(['row machine']), 'Seated Row', { renameStations: true }), 2);
  assert.equal(gyms[0].stations[0].name, 'Seated Row');
  assert.equal(gyms[0].stations[0].kind, undefined);
  assert.equal(gyms[1].stations[0].name, 'Machine Row');
  assert.equal(gyms[1].stations[0].kind, 'Seated Row');
  assert.equal(gyms[1].stations[1].kind, undefined);

  assert.deepEqual(renameDismissedPairs(['leg press|row machine', 'machine row|row machine'], new Set(['row machine']), 'seated row'), ['leg press|seated row', 'machine row|seated row']);
});

test('unlinking a copy leaves the others linked', () => {
  const gyms = [
    gym('a', [station('a1', 'Row Machine', 'stack')]),
    gym('b', [station('b1', 'Machine Row', 'stack', [], { kind: 'Row Machine' })]),
    gym('c', [station('c1', 'Row Machine', 'stack')]),
  ];
  assert.deepEqual(unlinkStation(gyms, 'b', 'b1'), { from: 'row machine', to: 'machine row' });
  assert.equal(gyms[1].stations[0].kind, undefined);
  // Named after the kind: it gets a kind of its own so the other copy stays linked.
  assert.deepEqual(unlinkStation(gyms, 'c', 'c1'), { from: 'row machine', to: 'row machine gym c' });
  assert.equal(gyms[2].stations[0].kind, 'Row Machine (Gym C)');
  assert.deepEqual(machineKindLibrary(gyms).map((k) => k.copies.length), [1, 1, 1]);
  assert.equal(unlinkStation(gyms, 'x', 'a1'), null);
});

test('linked machines suggest linking lifts that look like the same exercise', () => {
  const kept = [station('a1', 'Row Machine', 'stack', [lift('1', 'Machine Row'), lift('2', 'Chest Press'), lift('3', 'Rear Delt Fly')])];
  const linked = [station('b1', 'Machine Row', 'stack', [lift('4', 'Machine Chest Press'), lift('5', 'Rear Delt Fly'), lift('6', 'Seated Row')])];
  assert.deepEqual(liftLinkSuggestions(kept, linked), [
    { keep: 'Chest Press', other: 'Machine Chest Press' },
    { keep: 'Machine Row', other: 'Seated Row' }, // the one lift left on each side
  ]);
  assert.deepEqual(liftLinkSuggestions([station('a', 'A', 'stack', [lift('1', 'Leg Press')])], [station('b', 'B', 'stack', [lift('2', 'Leg Press'), lift('3', 'Leg Curl')])]), []);
});

test('a station only stores its kind when it differs from its name', () => {
  const lists = listFieldsFromStation(undefined);
  assert.equal(finalizeStation({ name: 'Row Machine', type: 'stack', kind: 'row  machine' }, lists).kind, undefined);
  assert.equal(finalizeStation({ name: 'Machine Row', type: 'stack', kind: ' Row Machine ' }, lists).kind, 'Row Machine');
});

test('calibration prefers the same exercise on the same kind of machine', () => {
  type Workout = { gymId: string; gymName: string; timestamp: string; liftMeta: Record<string, { name: string; stationId: string }>; logs: Record<string, { weight: number; reps: number }[]> };
  const history: Workout[] = [
    { gymId: 'b', gymName: 'B', timestamp: '2026-10-02', liftMeta: { x: { name: 'Row', stationId: 'cable-row' } }, logs: { x: [{ weight: 50, reps: 10 }] } },
    { gymId: 'b', gymName: 'B', timestamp: '2026-10-01', liftMeta: { y: { name: 'Row', stationId: 'row-machine-b' } }, logs: { y: [{ weight: 120, reps: 10 }] } },
  ];
  const kinds = new Map([['cable-row', 'cable row'], ['row-machine-b', 'row machine'], ['row-machine-a', 'row machine']]);
  assert.equal(findReferenceLift(history, { liftKey: 'row', kindKey: 'row machine' }, kinds)?.liftId, 'y');
  // No kind known: the newest lift with the same name, as before.
  assert.equal(findReferenceLift(history, { liftKey: 'row' })?.liftId, 'x');
  assert.equal(findReferenceLift(history, { liftKey: 'row', kindKey: 'leg press' }, kinds)?.liftId, 'x');
});

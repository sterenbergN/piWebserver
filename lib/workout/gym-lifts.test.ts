import test from 'node:test';
import { strict as assert } from 'node:assert';
import { liftsOfGym, withGymLifts } from './gym-lifts';

const station = (id: string, name: string, baseWeight: number, lifts: string[]) => ({ id, name, type: 'plates', baseWeight, plateSets: [45, 25], lifts: lifts.map((l) => ({ id: `${id}-${l}`, name: l })) });

test('a gym’s lifts each carry their machine and gym', () => {
  const gym = { id: 'g1', name: 'Home', stations: [station('s1', 'Leg press', 100, ['Leg Press']), station('s2', 'Rack', 45, ['Squat', 'Bench'])] } as never;
  const lifts = liftsOfGym(gym);
  assert.deepEqual(lifts.map((l) => [l.name, l.station.name, l.gymId]), [['Leg Press', 'Leg press', 'g1'], ['Squat', 'Rack', 'g1'], ['Bench', 'Rack', 'g1']]);
});

test('after an edit, a deleted machine is gone and changed weights are current; other gyms stay', () => {
  const before = { id: 'g1', name: 'Home', stations: [station('s1', 'Leg press', 100, ['Leg Press']), station('s1b', 'Leg press', 110, ['Leg Press'])] } as never;
  const other = { id: 'g2', name: 'Work', stations: [station('s9', 'Cable', 0, ['Row'])] } as never;
  const list = [...liftsOfGym(before), ...liftsOfGym(other)];
  assert.equal(list.filter((l) => l.name === 'Leg Press').length, 2);
  // The copy deleted in the equipment panel, and the base weight changed back.
  const after = { id: 'g1', name: 'Home', stations: [station('s1', 'Leg press', 90, ['Leg Press'])] } as never;
  const next = withGymLifts(list, after) as ReturnType<typeof liftsOfGym>;
  assert.equal(next.filter((l) => l.name === 'Leg Press').length, 1);
  assert.equal(next.find((l) => l.name === 'Leg Press')!.station.baseWeight, 90);
  assert.ok(next.some((l) => l.name === 'Row' && l.gymId === 'g2'));
});

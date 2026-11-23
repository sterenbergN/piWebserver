import test from 'node:test';
import { strict as assert } from 'node:assert';
import { finalizeLift, finalizeStation, listFieldsFromStation } from './stations';

test('finalizeStation parses lists and drops fields for other station types', () => {
  const station = finalizeStation(
    { id: 's1', name: ' Rack ', type: 'plates', baseWeight: 45, minWeight: 10, dumbbellPairs: [5], lifts: [] },
    { plates: '45, 25, abc, 2.5', dumbbells: '5,10', bodyWeight: '', additionalWeights: '5' }
  );
  assert.equal(station.name, 'Rack');
  assert.deepEqual(station.plateSets, [45, 25, 2.5]);
  assert.equal(station.minWeight, undefined);
  assert.equal(station.dumbbellPairs, undefined);
  assert.equal(station.additionalWeights, undefined);
});

test('finalizeStation migrates the legacy add-on weight into the list', () => {
  const draft = { id: 's2', name: 'Stack', type: 'stack' as const, additionalWeight: 5, lifts: [] };
  const station = finalizeStation(draft, listFieldsFromStation(draft));
  assert.deepEqual(station.additionalWeights, [5]);
  assert.equal(station.additionalWeight, undefined);
});

test('finalizeStation clears lift attachments that no longer exist', () => {
  const lifts = [
    { id: 'a', name: 'Pushdown', singleArmLeg: false, primaryMuscle: 'Triceps', secondaryMuscle: 'None', attachment: 'Rope' },
    { id: 'b', name: 'Row', singleArmLeg: false, primaryMuscle: 'Back', secondaryMuscle: 'None', attachment: 'V-Bar' },
  ];
  const cable = finalizeStation({ id: 's3', name: 'Cable', type: 'cable', attachments: ['Rope'], lifts }, listFieldsFromStation({}));
  assert.deepEqual(cable.lifts.map((l) => l.attachment), ['Rope', undefined]);

  const stack = finalizeStation({ id: 's3', name: 'Cable', type: 'stack', attachments: ['Rope'], lifts }, listFieldsFromStation({}));
  assert.deepEqual(stack.attachments, []);
  assert.deepEqual(stack.lifts.map((l) => l.attachment), [undefined, undefined]);
});

test('finalizeLift keeps the attachment and fills defaults', () => {
  const lift = finalizeLift({ id: 'x', name: ' Face Pull ', attachment: 'Rope' });
  assert.equal(lift.name, 'Face Pull');
  assert.equal(lift.attachment, 'Rope');
  assert.equal(lift.progressionProfile, 'standard');
  assert.equal(lift.secondaryMuscle, 'None');
});

test('finalizeStation trims, truncates, and drops blank manufacturer and model', () => {
  const lists = listFieldsFromStation(undefined);
  const s1 = finalizeStation(
    { id: 's4', name: 'Chest Press', type: 'stack', manufacturer: '  Life Fitness  ', model: '  Insignia  ', lifts: [] },
    lists
  );
  assert.equal(s1.manufacturer, 'Life Fitness');
  assert.equal(s1.model, 'Insignia');

  const longBrand = 'A'.repeat(100);
  const longModel = 'B'.repeat(95);
  const s2 = finalizeStation(
    { id: 's5', name: 'Row', type: 'stack', manufacturer: ` ${longBrand} `, model: longModel, lifts: [] },
    lists
  );
  assert.equal(s2.manufacturer?.length, 80);
  assert.equal(s2.model?.length, 80);

  const s3 = finalizeStation(
    { id: 's6', name: 'Row', type: 'stack', manufacturer: '   ', model: '', lifts: [] },
    lists
  );
  assert.equal(s3.manufacturer, undefined);
  assert.equal(s3.model, undefined);
});

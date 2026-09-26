import test from 'node:test';
import { strict as assert } from 'node:assert';
import { EQUIPMENT_PRESETS, GYM_TEMPLATES, findPreset, inferLiftDetails, liftFromName, presetLifts, stationsFromTemplate, suggestedLiftNames } from './catalog';
import { MUSCLE_OPTIONS_WITH_NONE } from './types';

test('inferLiftDetails matches catalog names regardless of case and punctuation', () => {
  const d = inferLiftDetails('romanian  deadlift');
  assert.equal(d?.known, true);
  assert.equal(d?.primaryMuscle, 'Hamstrings');
  assert.equal(liftFromName('pull up').name, 'Pull-Up');
  assert.equal(liftFromName('zercher  squat').name, 'Zercher Squat');
  assert.equal(liftFromName('JM Press').name, 'JM Press');
});

test('inferLiftDetails falls back to keywords', () => {
  assert.equal(inferLiftDetails('Single Arm Cable Row')?.primaryMuscle, 'Back');
  assert.equal(inferLiftDetails('Single Arm Cable Row')?.singleArmLeg, true);
  assert.equal(inferLiftDetails('Machine Leg Curl')?.primaryMuscle, 'Hamstrings');
  assert.equal(inferLiftDetails('Incline Hammer Curl')?.primaryMuscle, 'Biceps');
  assert.equal(inferLiftDetails('Donkey Calf Raise')?.primaryMuscle, 'Calves');
  assert.equal(inferLiftDetails('Landmine Press')?.primaryMuscle, 'Chest');
  assert.equal(inferLiftDetails('Zzz'), undefined);
});

test('every preset and template is internally consistent', () => {
  const muscles = new Set(MUSCLE_OPTIONS_WITH_NONE);
  for (const preset of EQUIPMENT_PRESETS) {
    for (const lift of presetLifts(preset)) {
      assert.ok(inferLiftDetails(lift.name)?.known, `${preset.key}: ${lift.name} should be in the catalog`);
      assert.ok(muscles.has(lift.primaryMuscle) && muscles.has(lift.secondaryMuscle));
    }
    for (const l of preset.lifts) {
      if (l.attachment) assert.ok(preset.station.attachments?.includes(l.attachment), `${preset.key}: ${l.attachment}`);
    }
  }
  for (const t of GYM_TEMPLATES) for (const key of t.presets) assert.ok(findPreset(key), `${t.key}: ${key}`);
});

test('templates skip stations the gym already has and give unique ids', () => {
  const stations = stationsFromTemplate('home', [{ id: 'x', name: 'Barbell Bench', type: 'plates', lifts: [] }]);
  assert.ok(!stations.some((s) => s.name === 'Barbell Bench'));
  const ids = stations.flatMap((s) => [s.id, ...s.lifts.map((l) => l.id)]);
  assert.equal(new Set(ids).size, ids.length);
});

test('suggestedLiftNames uses the matching preset and omits existing lifts', () => {
  const names = suggestedLiftNames({ name: 'Lat Pulldown', type: 'cable', lifts: [liftFromName('Lat Pulldown')] });
  assert.deepEqual(names, ['Close-Grip Pulldown', 'Straight-Arm Pulldown']);
  assert.ok(suggestedLiftNames({ name: 'My Machine', type: 'stack' }).includes('Leg Extension'));
});

test('equipmentLibrary dedupes stations across gyms and skips what the gym already has', async () => {
  const { equipmentLibrary, copyStation } = await import('./equipment-library');
  const lift = (id: string, name: string) => ({ id, name, primaryMuscle: 'Chest', secondaryMuscle: 'None', singleArmLeg: false });
  const gyms = [
    { id: 'a', name: 'A', ownerId: 'u', stations: [{ id: 's1', name: 'Lat Pulldown', type: 'cable' as const, lifts: [lift('l1', 'Lat Pulldown')] }] },
    { id: 'b', name: 'B', ownerId: 'u', stations: [
      { id: 's2', name: 'lat  pulldown', type: 'cable' as const, lifts: [lift('l2', 'Lat Pulldown'), lift('l3', 'Straight-Arm Pulldown')] },
      { id: 's3', name: 'Squat Rack', type: 'plates' as const, lifts: [] },
    ] },
    { id: 'c', name: 'New', ownerId: 'u', stations: [{ id: 's4', name: 'Squat Rack', type: 'plates' as const, lifts: [] }] },
  ];
  const lib = equipmentLibrary(gyms, gyms[2]);
  assert.deepEqual(lib.map((s) => s.id), ['s2']);
  const copy = copyStation(lib[0], ['l3']);
  assert.notEqual(copy.id, 's2');
  assert.deepEqual(copy.lifts.map((l) => l.name), ['Straight-Arm Pulldown']);
  assert.notEqual(copy.lifts[0].id, 'l3');
});

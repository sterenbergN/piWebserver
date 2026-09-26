import test from 'node:test';
import assert from 'node:assert/strict';
import { describeStationWeights, describeWeightRange, formatPlateCounts, weightRange } from './station-summary';

test('formatPlateCounts groups repeats, heaviest first', () => {
  assert.equal(formatPlateCounts([10, 45, 2.5, 45, 25]), '45×2, 25, 10, 2.5');
  assert.equal(formatPlateCounts([]), '');
});

test('describeStationWeights summarises each station type', () => {
  assert.equal(describeStationWeights({ type: 'plates', baseWeight: 45, plateSets: [45, 45, 25] }), '45 lb bar · 45×2, 25 per side');
  assert.equal(describeStationWeights({ type: 'plates', baseWeight: 0 }), '0 lb bar · no plates yet');
  assert.equal(describeStationWeights({ type: 'cable', minWeight: 5, maxWeight: 150, increment: 5, additionalWeights: [2.5] }), '5–150 lb by 5 · +2.5');
  assert.equal(describeStationWeights({ type: 'stack' }), '10–300 lb by 10');
  assert.equal(describeStationWeights({ type: 'dumbbells', dumbbellPairs: [5, 10, 15] }), '5–15 lb · 3 pairs');
  assert.equal(describeStationWeights({ type: 'dumbbells', dumbbellPairs: [] }), 'No dumbbells yet');
  assert.equal(describeStationWeights({ type: 'bodyweight', bodyWeightAdditions: [10, 25] }), 'Bodyweight · +10/25 lb');
  assert.equal(describeStationWeights({ type: 'bodyweight' }), 'Bodyweight');
});

test('describeWeightRange reports what the tracker will offer', () => {
  assert.equal(describeWeightRange({ type: 'plates', baseWeight: 45, plateSets: [45] }), '2 settings · 45–135 lb');
  assert.equal(describeWeightRange({ type: 'plates', baseWeight: 45, plateSets: [] }), 'Only 45 lb');
});

test('weightRange fills evenly and rejects bad input', () => {
  assert.deepEqual(weightRange(5, 20, 5), [5, 10, 15, 20]);
  assert.deepEqual(weightRange(5, 10, 2.5), [5, 7.5, 10]);
  assert.deepEqual(weightRange(10, 5, 5), []);
  assert.deepEqual(weightRange(5, 10, 0), []);
});

import test from 'node:test';
import { strict as assert } from 'node:assert';
import { calculatePlates, getPossibleWeights, stepWeight } from './equipment';

test('stack weights include every combination of add-on weights', () => {
  const weights = getPossibleWeights({ type: 'stack', minWeight: 10, maxWeight: 30, increment: 10, additionalWeights: [2.5, 5] });
  assert.deepEqual(weights, [10, 12.5, 15, 17.5, 20, 22.5, 25, 27.5, 30, 32.5, 35, 37.5]);
});

test('legacy single additionalWeight is still honored', () => {
  const weights = getPossibleWeights({ type: 'cable', minWeight: 10, maxWeight: 20, increment: 10, additionalWeight: 5 });
  assert.deepEqual(weights, [10, 15, 20, 25]);
});

test('stack ladder with a zero increment does not loop forever', () => {
  const weights = getPossibleWeights({ type: 'stack', minWeight: 10, maxWeight: 50, increment: 0 });
  assert.deepEqual(weights, [10, 20, 30, 40, 50]);
});

test('scale factor is applied and rounded', () => {
  const weights = getPossibleWeights({ type: 'stack', minWeight: 10, maxWeight: 30, increment: 10 }, 1.1);
  assert.deepEqual(weights, [11, 22, 33]);
});

test('plate ladder loads each per-side plate on both sides', () => {
  const weights = getPossibleWeights({ type: 'plates', baseWeight: 45, plateSets: [45, 25] });
  assert.deepEqual(weights, [45, 95, 135, 185]);
});

test('calculatePlates finds combinations greedy selection misses', () => {
  assert.deepEqual(calculatePlates(105, 45, [25, 15, 15]), [15, 15]);
});

test('calculatePlates prefers fewer plates and reports impossible targets', () => {
  assert.deepEqual(calculatePlates(135, 45, [45, 25, 10, 10, 5, 5]), [45]);
  assert.deepEqual(calculatePlates(45, 45, [45]), []);
  assert.equal(calculatePlates(50, 45, [45, 25]), null);
});

test('stepWeight moves along the ladder and recovers from off-ladder values', () => {
  const ladder = [10, 20, 30];
  assert.equal(stepWeight(20, 1, ladder), 30);
  assert.equal(stepWeight(30, 1, ladder), 30);
  assert.equal(stepWeight(10, -1, ladder), 10);
  assert.equal(stepWeight(25, 1, ladder), 30);
  assert.equal(stepWeight(25, -1, ladder), 20);
});

import test from 'node:test';
import { strict as assert } from 'node:assert';
import { inferScaleFactor } from './calibration.js';

test('inferScaleFactor: happy paths', () => {
  // Equal E1RM gives 1.0
  assert.equal(inferScaleFactor(100, 100), 1.0);

  // Half current E1RM gives 0.5 clamped to 0.6
  assert.equal(inferScaleFactor(50, 100), 0.6);

  // Normal valid cases
  assert.equal(inferScaleFactor(120, 100), 1.2);
  assert.equal(inferScaleFactor(90, 100), 0.9);
});

test('inferScaleFactor: clamping limits', () => {
  // Over 1.6 clamps to 1.6
  assert.equal(inferScaleFactor(200, 100), 1.6);
  assert.equal(inferScaleFactor(161, 100), 1.6);

  // Under 0.6 clamps to 0.6
  assert.equal(inferScaleFactor(59, 100), 0.6);
  assert.equal(inferScaleFactor(10, 100), 0.6);
});

test('inferScaleFactor: error and edge conditions', () => {
  // Missing / falsy values
  assert.equal(inferScaleFactor(0, 100), null);
  assert.equal(inferScaleFactor(100, 0), null);
  assert.equal(inferScaleFactor(NaN, 100), null);
  assert.equal(inferScaleFactor(100, NaN), null);

  // Negative values result in negative scale factor <= 0, returning null
  assert.equal(inferScaleFactor(-100, 100), null);
  assert.equal(inferScaleFactor(100, -100), null);

  // Infinity values
  assert.equal(inferScaleFactor(Infinity, 100), null);
  assert.equal(inferScaleFactor(100, Infinity), null);
});

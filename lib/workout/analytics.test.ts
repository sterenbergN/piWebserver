import test from 'node:test';
import { strict as assert } from 'node:assert';
import {
  calcEpley,
  calcBrzycki,
  calcLombardi,
  calcAverage1RM
} from './analytics.js';

test('1. calcEpley: returns weight for 1 rep', () => {
  assert.equal(calcEpley(100, 1), 100);
});

test('2. calcEpley: calculates 1RM for > 1 rep', () => {
  // 100 * (1 + 5/30) = 100 * (35/30) = 116.666...
  const result = calcEpley(100, 5);
  assert.ok(Math.abs(result - 116.666) < 0.01, `Expected ~116.666, got ${result}`);
});

test('3. calcBrzycki: returns weight for 1 rep', () => {
  assert.equal(calcBrzycki(100, 1), 100);
});

test('4. calcBrzycki: calculates 1RM for normal reps', () => {
  // 100 * (36 / (37 - 5)) = 100 * (36 / 32) = 112.5
  assert.equal(calcBrzycki(100, 5), 112.5);
});

test('5. calcBrzycki: returns weight for 37 or more reps (formula breakdown)', () => {
  assert.equal(calcBrzycki(100, 37), 100);
  assert.equal(calcBrzycki(100, 40), 100);
});

test('6. calcLombardi: returns weight for 1 rep', () => {
  assert.equal(calcLombardi(100, 1), 100);
});

test('7. calcLombardi: calculates 1RM for > 1 rep', () => {
  // 100 * (5^0.10) = 117.46189...
  const result = calcLombardi(100, 5);
  assert.ok(Math.abs(result - 117.461) < 0.01, `Expected ~117.461, got ${result}`);
});

test('8. calcAverage1RM: returns weight for 1 rep', () => {
  assert.equal(calcAverage1RM(100, 1), 100);
});

test('9. calcAverage1RM: calculates average of 3 formulas for > 1 rep', () => {
  const weight = 100;
  const reps = 5;
  const epley = calcEpley(weight, reps);
  const brzycki = calcBrzycki(weight, reps);
  const lombardi = calcLombardi(weight, reps);
  const expected = (epley + brzycki + lombardi) / 3;

  const result = calcAverage1RM(weight, reps);
  assert.ok(Math.abs(result - expected) < 0.0001, `Expected ~${expected}, got ${result}`);
});

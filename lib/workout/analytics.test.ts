import test from 'node:test';
import { strict as assert } from 'node:assert';
import { calcWilks } from './analytics.js';

test('calcWilks: Calculates Wilks score for male correctly', () => {
   // A male lifter of 80kg (176.3698 lbs) lifting 400kg (881.849 lbs)
   // should have a Wilks score of ~273.08
   const score = calcWilks(881.849, 176.3698, 'male');
   assert.ok(Math.abs(score - 273.08) < 0.1, `Expected ~273.08, got ${score}`);
});

test('calcWilks: Calculates Wilks score for female correctly', () => {
   // A female lifter of 80kg (176.3698 lbs) lifting 400kg (881.849 lbs)
   // should have a Wilks score of ~366.00
   const score = calcWilks(881.849, 176.3698, 'female');
   assert.ok(Math.abs(score - 366.00) < 0.1, `Expected ~366.00, got ${score}`);
});

test('calcWilks: Defaults to male formula when gender is unspecified', () => {
   const maleScore = calcWilks(881.849, 176.3698, 'male');
   const unspecifiedScore = calcWilks(881.849, 176.3698, 'unspecified');
   assert.equal(maleScore, unspecifiedScore, 'Score for unspecified gender should match male score');
});

test('calcWilks: Handled zero total weight correctly', () => {
   // If total weight is 0, score should be 0
   const score = calcWilks(0, 176.3698, 'male');
   assert.equal(score, 0, `Expected 0, got ${score}`);
});

test('calcWilks: Handled small body weights', () => {
   // Small bodyweight should not crash and should return a numeric value
   // (Even though Wilks formulas typically aren't valid for very small/zero body weights, it should compute without Error)
   const score = calcWilks(100, 1, 'male');
   assert.ok(typeof score === 'number' && !Number.isNaN(score), `Expected a number, got ${score}`);
});

test('calcWilks: Different body weights with same total weight yield different scores', () => {
   const scoreLight = calcWilks(500, 150, 'male');
   const scoreHeavy = calcWilks(500, 200, 'male');
   // A lighter person lifting the same amount is relatively stronger, hence higher Wilks
   assert.ok(scoreLight > scoreHeavy, `Expected lighter lifter to have higher score, got ${scoreLight} vs ${scoreHeavy}`);
});

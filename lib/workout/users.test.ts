import test from 'node:test';
import { strict as assert } from 'node:assert';
import { normalizeIntensityFactor, normalizeWorkoutUser, normalizeUsersData } from './users.js';

test('normalizeIntensityFactor - uses valid intensityFactor and clamps it', () => {
  assert.equal(normalizeIntensityFactor({ intensityFactor: 1.0 }), 1.0);
  assert.equal(normalizeIntensityFactor({ intensityFactor: 0.1 }), 0.5); // Clamped to 0.5
  assert.equal(normalizeIntensityFactor({ intensityFactor: 2.0 }), 1.5); // Clamped to 1.5
});

test('normalizeIntensityFactor - falls back to progressionFactor and converts it', () => {
  // progressionFactor is divided by 0.05
  assert.equal(normalizeIntensityFactor({ progressionFactor: 0.05 }), 1.0); // 0.05 / 0.05 = 1.0
  assert.equal(normalizeIntensityFactor({ progressionFactor: 0.01 }), 0.5); // 0.01 / 0.05 = 0.2, clamped to 0.5
  assert.equal(normalizeIntensityFactor({ progressionFactor: 0.1 }), 1.5); // 0.1 / 0.05 = 2.0, clamped to 1.5
});

test('normalizeIntensityFactor - returns 1.0 when no valid factors are present', () => {
  assert.equal(normalizeIntensityFactor({}), 1.0);
  assert.equal(normalizeIntensityFactor({ intensityFactor: 'not a number' }), 1.0);
  assert.equal(normalizeIntensityFactor({ progressionFactor: null }), 1.0);
});

test('normalizeWorkoutUser - standardizes properties and handles passwords', () => {
  const input = {
    id: 1,
    birthdate: '1-1-1990', // non-standard but parsable
    intensityFactor: 1.2,
    progressionFactor: 0.05, // should be removed
    password: 'plaintextpassword', // should be hashed
    calculatorDefaults: { calorie: { heightInches: 70 } }
  };

  const normalized = normalizeWorkoutUser(input);

  assert.equal(normalized.id, 1);
  assert.equal(normalized.birthdate, '01-01-1990');
  assert.equal(normalized.intensityFactor, 1.2);
  assert.equal('progressionFactor' in normalized, false);

  assert.ok(normalized.password);
  assert.ok(normalized.password.startsWith('scrypt$'));
});

test('normalizeWorkoutUser - does not hash an already hashed password', () => {
  const input = {
    id: 1,
    password: 'scrypt$salt$hash'
  };

  const normalized = normalizeWorkoutUser(input);

  assert.equal(normalized.password, 'scrypt$salt$hash');
});

test('normalizeUsersData - correctly processes an array of users and returns changed state', () => {
  const data = {
    metadata: { version: 1 },
    users: [
      { id: 1, intensityFactor: 1.0 }, // No change expected except perhaps adding empty default objects if missing
      { id: 2, progressionFactor: 0.06 } // Needs conversion
    ]
  };

  const result = normalizeUsersData(data);

  assert.equal(result.changed, true);
  assert.equal(result.data.users.length, 2);

  assert.equal(result.data.users[0].id, 1);
  assert.equal(result.data.users[1].id, 2);
  assert.equal(result.data.users[1].intensityFactor, 1.2); // 0.06 / 0.05 = 1.2
  assert.equal('progressionFactor' in result.data.users[1], false);

  // Test when no changes are needed
  const cleanData = { users: result.data.users };
  const result2 = normalizeUsersData(cleanData);

  assert.equal(result2.changed, false);
});

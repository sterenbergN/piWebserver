import test from 'node:test';
import { strict as assert } from 'node:assert';
import { isCardioHistoryItem, removeCardioHistoryEntries } from './history.js';

test('isCardioHistoryItem: identifies Cardio entries', () => {
  const cardioEntry = { type: { name: 'Cardio' } };
  assert.equal(isCardioHistoryItem(cardioEntry), true);
});

test('isCardioHistoryItem: returns false for non-Cardio entries', () => {
  const strengthEntry = { type: { name: 'Strength' } };
  assert.equal(isCardioHistoryItem(strengthEntry), false);
});

test('isCardioHistoryItem: returns false gracefully for malformed entries', () => {
  assert.equal(isCardioHistoryItem({}), false);
  assert.equal(isCardioHistoryItem({ type: {} }), false);
  assert.equal(isCardioHistoryItem({ type: null }), false);
  assert.equal(isCardioHistoryItem(null as any), false);
  assert.equal(isCardioHistoryItem(undefined as any), false);
});

test('removeCardioHistoryEntries: removes cardio entries and marks changed', () => {
  const data = {
    history: [
      { id: 1, type: { name: 'Cardio' } },
      { id: 2, type: { name: 'Strength' } },
      { id: 3, type: { name: 'Cardio' } }
    ],
    otherProp: 'keep me'
  };

  const result = removeCardioHistoryEntries(data);

  assert.equal(result.changed, true);
  assert.deepEqual(result.data.history, [
    { id: 2, type: { name: 'Strength' } }
  ]);
  assert.equal(result.data.otherProp, 'keep me');
});

test('removeCardioHistoryEntries: does not change array if no cardio entries', () => {
  const data = {
    history: [
      { id: 1, type: { name: 'Strength' } },
      { id: 2, type: { name: 'Flexibility' } }
    ],
    otherProp: 'keep me'
  };

  const result = removeCardioHistoryEntries(data);

  assert.equal(result.changed, false);
  assert.deepEqual(result.data.history, data.history);
  assert.equal(result.data.otherProp, 'keep me');
});

test('removeCardioHistoryEntries: handles empty history', () => {
  const data = {
    history: []
  };

  const result = removeCardioHistoryEntries(data);

  assert.equal(result.changed, false);
  assert.deepEqual(result.data.history, []);
});

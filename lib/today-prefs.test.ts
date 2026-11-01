import test from 'node:test';
import { strict as assert } from 'node:assert';
import { readTodayHidden } from './today-prefs';

test('nothing is hidden until someone says so', () => {
  assert.deepEqual(readTodayHidden(undefined), []);
  assert.deepEqual(readTodayHidden(null), []);
  assert.deepEqual(readTodayHidden('study'), []);
  assert.deepEqual(readTodayHidden([]), []);
});

test('only real cards can be hidden, once each', () => {
  assert.deepEqual(readTodayHidden(['study']), ['study']);
  assert.deepEqual(readTodayHidden(['question']), ['question']);
  assert.deepEqual(readTodayHidden(['study', 'question', 'study', 'chores', 4, null]), ['question', 'study']);
});

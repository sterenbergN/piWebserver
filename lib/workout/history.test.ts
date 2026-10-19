import test from 'node:test';
import { strict as assert } from 'node:assert';
import { applyWorkoutEdit, sanitizeWorkoutPayload } from './history';

test('sanitizeWorkoutPayload keeps valid sets and drops junk fields', () => {
  const result = sanitizeWorkoutPayload({
    userId: 'someone-else',
    id: 'forged',
    name: 'Push Day',
    isDeload: true,
    logs: {
      bench: [
        { weight: 135, reps: 10, rir: 2, plannedWeight: 135, plannedReps: 10, timestamp: 1 },
        { weight: 'abc', reps: 5 },
        { weight: 135, reps: -3 },
      ],
      empty: [],
      notArray: 'x',
    },
    liftMeta: { bench: { name: 'Bench', stationType: 'plates', plannedSets: 3 }, empty: { name: 'Empty' } },
  });

  assert.equal((result as any).userId, undefined);
  assert.equal((result as any).id, undefined);
  assert.deepEqual(Object.keys(result.logs), ['bench']);
  assert.equal(result.logs.bench.length, 1);
  assert.deepEqual(Object.keys(result.liftMeta), ['bench']);
  assert.equal(result.liftMeta.bench.plannedSets, 3);
  assert.equal(result.isDeload, true);
});

test('applyWorkoutEdit fixes sets but cannot add lifts', () => {
  const entry = {
    id: 'w1', userId: 'me', volume: 1000,
    logs: { bench: [{ weight: 100, reps: 10 }], row: [{ weight: 50, reps: 10 }] },
    warmups: { bench: [{ weight: 45, reps: 10 }], row: [{ weight: 20, reps: 10 }] },
    liftMeta: { bench: { name: 'Bench' }, row: { name: 'Row' } },
  };
  const edited = applyWorkoutEdit(entry, { bench: [{ weight: 105, reps: 8, rir: 2 }, { weight: 'x', reps: 5 }], row: [], sneaky: [{ weight: 500, reps: 1 }] })!;
  assert.deepEqual(edited.logs, { bench: [{ weight: 105, reps: 8, rir: 2, completed: true }] });
  assert.equal(edited.volume, 840);
  assert.deepEqual(Object.keys(edited.liftMeta), ['bench']);
  assert.deepEqual(Object.keys(edited.warmups), ['bench']);
  assert.equal(edited.id, 'w1');
  assert.equal(edited.userId, 'me');
  assert.equal(applyWorkoutEdit(entry, { bench: [] }), null);
});

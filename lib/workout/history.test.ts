import test from 'node:test';
import { strict as assert } from 'node:assert';
import { sanitizeWorkoutPayload } from './history';

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

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSavePayload, compareWithLastTime, computeSessionAwards, sessionVerdict } from './tracker-utils';

const plan = {
  id: 'plan-1',
  name: 'Push @ Gym',
  type: { name: 'Push' },
  gymId: 'g',
  gymName: 'Gym',
  programId: 'p',
  programDay: 1,
  lifts: [
    { id: 'bench', name: 'Bench', exercise: 'Bench Press', uniquePlanId: 'u1', station: { id: 's', type: 'plates' }, primaryMuscle: 'Chest' },
    { id: 'fly', name: 'Cable Fly', uniquePlanId: 'u2', station: { id: 'c', type: 'cable' }, primaryMuscle: 'Chest' },
    { id: 'bench', name: 'Bench', exercise: 'Bench Press', uniquePlanId: 'u3', station: { id: 's', type: 'plates' }, primaryMuscle: 'Chest' },
  ],
};
const logs = {
  u1: [{ weight: 155, reps: 8, rir: 2 }, { weight: 155, reps: 8, rir: 1 }],
  u2: [],
  u3: [{ weight: 135, reps: 10, rir: 2 }],
};

test('the saved payload keys logs by lift id, merges repeats and keeps warm-ups apart', () => {
  const payload = buildSavePayload({
    plan, logs, warmups: { u1: [{ weight: 95, reps: 5 }] }, targetSets: () => 3,
    elapsedSecs: 1800, intensity: 1, bodyweightLbs: 180, isDemo: false, now: new Date('2026-02-01T10:00:00Z'),
  });
  assert.deepEqual(Object.keys(payload.logs), ['bench']);
  assert.equal(payload.logs.bench.length, 3);
  assert.deepEqual(payload.warmups, { bench: [{ weight: 95, reps: 5 }] });
  assert.equal(payload.liftMeta.bench.exercise, 'Bench Press');
  assert.equal(payload.liftMeta.bench.plannedSets, 6);
  assert.equal(payload.volume, 155 * 8 * 2 + 135 * 10);
  assert.equal(payload.duration, '30:00');
  assert.equal(payload.programId, 'p');
  assert.equal(payload.programDay, 1);
});

test('each lift is compared with its last session', () => {
  const history = [{ timestamp: '2026-01-25T10:00:00Z', logs: { bench: [{ weight: 150, reps: 8 }] }, liftMeta: { bench: { name: 'Bench', exercise: 'Bench Press' } } }];
  const [first, second] = compareWithLastTime({ ...plan, lifts: [plan.lifts[0], plan.lifts[2]] }, { u1: logs.u1, u3: [{ weight: 145, reps: 8 }] }, history);
  assert.equal(first.change, 'up');
  assert.equal(first.changeText, '+5 lbs');
  assert.equal(second.change, 'down');
  assert.equal(sessionVerdict([first, second], 0), 'Up on 1 of 2 lifts vs last time');
  assert.equal(sessionVerdict([first], 2), '2 new personal records 🏆');
  assert.equal(compareWithLastTime({ ...plan, lifts: [plan.lifts[0]] }, { u1: logs.u1 }, [])[0].change, 'new');
});

test('computeSessionAwards clears phantom PRs and goals when a typo set is edited or deleted', () => {
  const bestBefore = (lift: any) => (lift.id === 'bench' ? 215 : 0);
  const goals = [
    { id: 'g1', exercise: 'Bench Press', targetWeight: 315, targetReps: 1 },
    { id: 'g2', exercise: 'Bench Press', targetWeight: 225, targetReps: 1 },
  ];

  // Typo weight 2250 creates a phantom PR and phantom 315 goal hit.
  const withTypo = { u1: [{ weight: 2250, reps: 5 }, { weight: 225, reps: 5 }] };
  const typoAwards = computeSessionAwards([plan.lifts[0]], withTypo, bestBefore, goals);
  assert.equal(typoAwards.sessionPRs.bench?.weight, 2250);
  assert.deepEqual(typoAwards.goalsHit, ['Bench Press 315 × 1', 'Bench Press 225 × 1']);

  // Correcting 2250 -> 225 (e1RM ~262.5 > 215) replaces phantom PR with real one and drops 315 goal.
  const corrected225 = { u1: [{ weight: 225, reps: 5 }, { weight: 225, reps: 5 }] };
  const realAwards = computeSessionAwards([plan.lifts[0]], corrected225, bestBefore, goals);
  assert.equal(realAwards.sessionPRs.bench?.weight, 225);
  assert.deepEqual(realAwards.goalsHit, ['Bench Press 225 × 1']);

  // Correcting 2250 -> 135 when no other PR set exists removes PR and goals completely.
  const corrected135 = { u1: [{ weight: 135, reps: 5 }] };
  const clearedAwards = computeSessionAwards([plan.lifts[0]], corrected135, bestBefore, goals);
  assert.equal(clearedAwards.sessionPRs.bench, undefined);
  assert.deepEqual(clearedAwards.goalsHit, []);

  // Deleting all sets clears everything.
  const deletedAwards = computeSessionAwards([plan.lifts[0]], { u1: [] }, bestBefore, goals);
  assert.deepEqual(deletedAwards.sessionPRs, {});
  assert.deepEqual(deletedAwards.goalsHit, []);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { completedCycles, nextProgramDay, programDeloadDue, type Program } from './programs';
import { suggestDeload } from './deload';
import { goalProgress, setMeetsGoal } from './goals';

const ppl: Program = { id: 'p', name: 'PPL', days: [{ typeId: 'push' }, { typeId: 'pull' }, { typeId: 'legs' }], deloadEveryWeeks: 4 };
const day = (n: number) => new Date(Date.UTC(2026, 0, 1) + n * 86_400_000).toISOString();

test('the next program day follows the last one done, wrapping around', () => {
  assert.equal(nextProgramDay(ppl, []), 0);
  assert.equal(nextProgramDay(ppl, [{ timestamp: day(1), programId: 'p', programDay: 0 }]), 1);
  assert.equal(nextProgramDay(ppl, [
    { timestamp: day(1), programId: 'p', programDay: 1 },
    { timestamp: day(3), programId: 'p', programDay: 2 },
    { timestamp: day(4), programId: 'other', programDay: 0 },
  ]), 0);
  assert.equal(completedCycles(ppl, [0, 1, 2, 0].map((d, i) => ({ timestamp: day(i), programId: 'p', programDay: d }))), 1);
});

test('a program deload is due N weeks after its last deload (or its start)', () => {
  const start = [{ timestamp: day(0), programId: 'p', programDay: 0 }];
  assert.equal(programDeloadDue(ppl, start, Date.parse(day(20))), false);
  assert.equal(programDeloadDue(ppl, start, Date.parse(day(28))), true);
  const withDeload = [...start, { timestamp: day(27), programId: 'p', programDay: 1, isDeload: true }];
  assert.equal(programDeloadDue(ppl, withDeload, Date.parse(day(30))), false);
  assert.equal(programDeloadDue({ ...ppl, deloadEveryWeeks: undefined }, start, Date.parse(day(90))), false);
});

test('deload is suggested after weeks of steady training, with the reason', () => {
  // Three sessions a week for seven weeks, no deload.
  const history = Array.from({ length: 21 }, (_, i) => ({
    timestamp: day(Math.floor(i / 3) * 7 + (i % 3) * 2),
    logs: { a: [{ weight: 100 + i, reps: 8 }] },
    liftMeta: { a: { name: 'Squat' } },
  }));
  const now = Date.parse(day(50));
  const suggestion = suggestDeload(history, [{ id: 'a', primaryMuscle: 'Quads' }], { now });
  assert.ok(suggestion);
  assert.ok(suggestion!.reasons.some((r) => r.includes('weeks of training')));
  assert.equal(suggestDeload(history.slice(0, 4), [], { now: Date.parse(day(10)) }), null);
  assert.deepEqual(suggestDeload([], [], { programDue: true })?.reasons, ['Your program has a deload scheduled now.']);
});

test('goal progress uses recent bests and projects a date from the trend', () => {
  const goal = { id: 'g', exercise: 'Bench Press', targetWeight: 225, targetReps: 1 };
  const history = [0, 7, 14, 21].map((d, i) => ({
    timestamp: day(d),
    logs: { b: [{ weight: 185 + i * 5, reps: 3 }] },
    liftMeta: { b: { name: 'Bench' , exercise: 'Bench Press' } },
  }));
  const progress = goalProgress(goal, history, Date.parse(day(22)));
  assert.equal(progress.achieved, false);
  assert.ok(progress.fraction > 0.8 && progress.fraction < 1);
  assert.ok(progress.projectedDate && progress.projectedDate.getTime() > Date.parse(day(22)));
  assert.equal(setMeetsGoal({ weight: 225, reps: 2 }, goal), true);
  assert.equal(goalProgress(goal, [...history, { timestamp: day(25), logs: { b: [{ weight: 225, reps: 1 }] }, liftMeta: { b: { name: 'Bench Press' } } }]).achieved, true);
});

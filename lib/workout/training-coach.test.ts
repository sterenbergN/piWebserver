import test from 'node:test';
import assert from 'node:assert/strict';
import { trainingAdvice, type TrainingWorkout } from './training-coach';

const NOW = Date.parse('2026-10-20T20:00:00Z');
const DAY = 86_400_000;

type Lift = { id: string; name: string; muscle: string; weight: number; reps: number; rir?: number; planned?: number; sets?: number; restSecs?: number };

/** A workout `ago` days back with the given lifts, sets logged `restSecs` apart. */
function workout(ago: number, lifts: Lift[], extra: Partial<TrainingWorkout> = {}): TrainingWorkout {
  const at = NOW - ago * DAY;
  let t = at - 3600_000;
  const logs: TrainingWorkout['logs'] = {};
  const liftMeta: TrainingWorkout['liftMeta'] = {};
  for (const l of lifts) {
    logs[l.id] = Array.from({ length: l.sets ?? 3 }, () => {
      t += (l.restSecs ?? 150) * 1000;
      return { weight: l.weight, reps: l.reps, rir: l.rir, plannedWeight: l.planned, timestamp: t };
    });
    liftMeta[l.id] = { name: l.name, primaryMuscle: l.muscle };
  }
  return { id: `w${ago}`, timestamp: new Date(at).toISOString(), logs, liftMeta, ...extra };
}

const bench = (o: Partial<Lift> = {}): Lift => ({ id: 'bench', name: 'Bench Press', muscle: 'Chest', weight: 185, reps: 8, rir: 2, ...o });
const row = (o: Partial<Lift> = {}): Lift => ({ id: 'row', name: 'Barbell Row', muscle: 'Back', weight: 155, reps: 8, rir: 2, ...o });
const find = (history: TrainingWorkout[], id: string) => trainingAdvice(history, NOW).insights.find((i) => i.id === id);

test('with little data, every check says what it is still waiting for', () => {
  const { insights, pending } = trainingAdvice([workout(2, [bench()])], NOW);
  assert.equal(insights.length, 0);
  assert.ok(pending.length >= 5);
  assert.deepEqual(pending.find((p) => p.area === 'How hard you train'), { area: 'How hard you train', need: 'sets with reps-left logged', have: 3, of: 30 });
});

test('easy sets: most sets end with 3+ reps left', () => {
  const history = Array.from({ length: 12 }, (_, i) => workout(40 - i * 3, [bench({ rir: 4, weight: 185 + i * 5 }), row({ rir: 4, weight: 155 + i * 5 })]));
  const i = find(history, 'effort-easy')!;
  assert.equal(i.tone, 'warn');
  assert.match(i.detail, /100% of your working sets/);
  assert.equal(i.steps!.length, 3);
});

test('not adding weight after easy sessions', () => {
  const history = Array.from({ length: 10 }, (_, i) => workout(40 - i * 4, [bench({ rir: 4 }), row({ rir: 1 })]));
  const i = find(history, 'progression')!;
  assert.equal(i.tone, 'warn');
  assert.match(i.detail, /Bench Press/);
});

test('main lifts always light compared with your max', () => {
  const history = [
    workout(80, [bench({ weight: 245, reps: 5 })]),
    ...Array.from({ length: 10 }, (_, i) => workout(40 - i * 4, [bench({ weight: 135, reps: 12, rir: 2 })])),
  ];
  const i = find(history, 'heaviness')!;
  assert.equal(i.tone, 'warn');
  assert.match(i.steps![0], /Bench Press, around 2[0-9]5 lb/);
});

test('lifting under the suggested weight with reps to spare', () => {
  const history = Array.from({ length: 12 }, (_, i) => workout(40 - i * 3, [bench({ weight: 175, planned: 195, rir: 3 })]));
  assert.equal(find(history, 'suggestions-under')?.tone, 'warn');
  const hard = Array.from({ length: 12 }, (_, i) => workout(40 - i * 3, [bench({ weight: 175, planned: 195, rir: 0 })]));
  assert.equal(find(hard, 'suggestions-under')?.tone, 'info');
});

test('short rests between heavy sets', () => {
  const squat: Lift = { id: 'squat', name: 'Back Squat', muscle: 'Quads', weight: 275, reps: 5, rir: 2, restSecs: 75, sets: 4 };
  const history = Array.from({ length: 6 }, (_, i) => workout(30 - i * 4, [squat]));
  const i = find(history, 'rest-heavy-short')!;
  assert.match(i.detail, /1:15/);
  assert.match(i.steps![0], /Back Squat/);
});

test('long rests on isolation work, and skipped warm-ups', () => {
  const curl: Lift = { id: 'curl', name: 'Dumbbell Curl', muscle: 'Biceps', weight: 30, reps: 12, rir: 2, restSecs: 300 };
  const history = [
    workout(60, [bench({ weight: 225, reps: 5 })]),
    ...Array.from({ length: 9 }, (_, i) => workout(36 - i * 4, [bench({ weight: 205, reps: 5 }), curl])),
  ];
  assert.match(find(history, 'rest-light-long')!.detail, /5:00/);
  assert.equal(find(history, 'warmups')?.tone, 'info');
  const warmedUp = history.map((w) => ({ ...w, warmups: { bench: [{ weight: 135, reps: 5 }] } }));
  assert.equal(find(warmedUp, 'warmups'), undefined);
});

test('muscles left out of the week get named with exercise ideas', () => {
  const history = Array.from({ length: 8 }, (_, i) => workout(26 - i * 3, [bench({ sets: 6 }), row({ sets: 6 })]));
  const i = find(history, 'neglected')!;
  assert.match(i.title, /Shoulders/);
  assert.ok(i.steps!.some((s) => /^Quads: add 3 sets of /.test(s)));
});

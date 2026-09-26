import test from 'node:test';
import { strict as assert } from 'node:assert';
import { monthlyStrength, startOfWeek, weeklyReport, type ReportWorkout } from './reports';

const at = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12).toISOString();
const workout = (timestamp: string, lifts: Record<string, [number, number][]>, extra: Partial<ReportWorkout> = {}): ReportWorkout => ({
  timestamp,
  durationSecs: 3600,
  logs: Object.fromEntries(Object.entries(lifts).map(([id, sets]) => [id, sets.map(([weight, reps]) => ({ weight, reps }))])),
  liftMeta: Object.fromEntries(Object.keys(lifts).map((id) => [id, { name: id === 'b' ? 'Bench' : 'Squat', primaryMuscle: id === 'b' ? 'Chest' : 'Quads' }])),
  ...extra,
});

test('startOfWeek is Monday', () => {
  assert.equal(startOfWeek(new Date(2026, 8, 27)).getDay(), 1); // Sunday → previous Monday
  assert.equal(startOfWeek(new Date(2026, 8, 21)).getDate(), 21); // Monday stays
});

test('weeklyReport compares with last week and finds PRs', () => {
  const history = [
    workout(at(2026, 9, 15), { b: [[185, 5]], s: [[225, 5]] }),       // previous week
    workout(at(2026, 9, 22), { b: [[195, 5], [185, 5]] }),            // this week: bench PR
    workout(at(2026, 9, 24), { s: [[205, 5]] }, { durationSecs: 1800 }), // squat below best
  ];
  const r = weeklyReport(history, new Date(2026, 8, 25));
  assert.equal(r.current.sessions, 2);
  assert.equal(r.previous.sessions, 1);
  assert.equal(r.current.sets, 3);
  assert.equal(r.current.minutes, 90);
  assert.deepEqual(r.prs.map((p) => p.lift), ['Bench']);
  assert.deepEqual(r.activeDays, [1, 3]); // Tue, Thu
  assert.equal(r.muscles[0].muscle, 'Chest');
  assert.equal(r.weekStreak, 2);
});

test('monthlyStrength ranks lifts by change vs last month', () => {
  const history = [
    workout(at(2026, 8, 10), { b: [[185, 5]], s: [[225, 5]] }),
    workout(at(2026, 9, 10), { b: [[200, 5]], s: [[215, 5]] }),
    workout(at(2026, 9, 12), { s: [[500, 5]] }, { isDeload: true }), // deloads don't count
  ];
  const m = monthlyStrength(history, new Date(2026, 8, 20));
  assert.equal(m.sessions, 1);
  assert.deepEqual(m.lifts.map((l) => l.lift), ['Bench', 'Squat']);
  assert.ok(m.lifts[0].change! > 7 && m.lifts[0].change! < 9);
  assert.ok(m.lifts[1].change! < 0);
  assert.equal(m.improved, 1);
  assert.equal(m.declined, 1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInsights, change, consistencyGrid, exerciseStats, localDayKey, muscleBalance, muscleSetsPerWeek, periodSummary, recentPRs, weeklySeries, type Workout } from './insights';

const NOW = new Date(2026, 1, 25, 12).getTime(); // Wed 25 Feb 2026, local noon
const daysAgo = (n: number, hour = 9) => {
  const d = new Date(NOW - n * 86_400_000);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};
const bench = (weight: number, reps = 8) => [{ weight, reps }, { weight, reps: reps - 1 }];

// Six weeks of bench (rising), squats in the last two weeks, an old row session.
const history: Workout[] = [
  { id: 'old', timestamp: daysAgo(60), logs: { row: [{ weight: 100, reps: 10 }] }, liftMeta: { row: { name: 'Cable Row', primaryMuscle: 'Back', secondaryMuscle: 'Biceps' } } },
  ...[42, 35, 28, 21, 14, 7, 0].map((d, i) => ({
    id: `b${d}`,
    timestamp: daysAgo(d),
    gymName: i % 2 ? 'Home' : 'Big Gym',
    durationSecs: 3000,
    logs: {
      [i % 2 ? 'homeBench' : 'bench']: bench(135 + i * 5),
      ...(d <= 14 ? { squat: [{ weight: 185, reps: 5 }, { weight: 185, reps: 5 }, { weight: 185, reps: 5 }] } : {}),
    },
    liftMeta: {
      bench: { name: 'Bench Press', primaryMuscle: 'Chest', secondaryMuscle: 'Triceps' },
      homeBench: { name: 'Flat Bench', exercise: 'Bench Press', primaryMuscle: 'Chest', secondaryMuscle: 'Triceps' },
      squat: { name: 'Back Squat', primaryMuscle: 'Quads', secondaryMuscle: 'Glutes' },
    },
  })),
];

test('period totals compare with the period before', () => {
  const { current, previous } = periodSummary(history, '4w', NOW);
  assert.equal(current.workouts, 4); // 21, 14, 7, 0 days ago
  assert.equal(previous?.workouts, 3); // 42, 35, 28
  assert.equal(current.perWeek, 1);
  assert.equal(current.avgMinutes, 50);
  assert.equal(change(current.workouts, previous!.workouts)?.toFixed(2), '0.33');
  assert.equal(periodSummary(history, 'all', NOW).previous, null);
});

test('weekly series and consistency grid use local Monday weeks, including empty ones', () => {
  const weeks = weeklySeries(history, 8, NOW);
  assert.equal(weeks.length, 8);
  assert.equal(weeks[weeks.length - 1].workouts, 1);
  assert.ok(weeks.some((w) => w.workouts === 0) === false || weeks[0].workouts === 0);
  const grid = consistencyGrid(history, 4, NOW);
  assert.equal(grid.length, 4);
  assert.equal(grid[0].length, 7);
  assert.equal(grid[0][0].date.getDay(), 1); // Monday
  const today = grid.flat().find((c) => c.key === localDayKey(NOW))!;
  assert.equal(today.workouts.length, 1);
  assert.equal(today.sets, 5);
});

test('exercise stats merge linked lifts across gyms with trends, PRs and rep records', () => {
  const stats = exerciseStats(history, '4w', { now: NOW });
  const benchStat = stats.find((s) => s.name === 'Bench Press')!;
  const squat = () => stats.find((s) => s.name === 'Back Squat')!;
  assert.equal(benchStat.sessions.length, 7);
  assert.deepEqual(benchStat.gyms.sort(), ['Big Gym', 'Home']);
  assert.ok(benchStat.periodChange! > 0.05);
  assert.equal(benchStat.sessionsInPeriod, 4);
  assert.deepEqual(benchStat.repRecords.map((r) => [r.reps, r.weight]), [[8, 165]]); // best set 165 × 8
  assert.deepEqual(squat().repRecords.map((r) => [r.reps, r.weight]), [[5, 185]]);
  assert.equal(squat().sessions.some((s) => s.pr), false); // same weight each time
  const prs = recentPRs(stats, '4w', history, NOW);
  assert.equal(prs.length, 4);
  assert.equal(prs[0].name, 'Bench Press');
});

test('per-week averages only count weeks since training started', () => {
  const recent = history.filter((w) => w.id === 'b7' || w.id === 'b0');
  assert.equal(periodSummary(recent, '12w', NOW).current.perWeek, 1.8); // 2 workouts over 8 days, not 12 weeks
  assert.equal(muscleSetsPerWeek(recent, '12w', { now: NOW }).find((m) => m.muscle === 'Chest')!.perWeek, 3.5);
});

test('sets per muscle per week, balance and insights', () => {
  const muscles = muscleSetsPerWeek(history, '4w', { now: NOW });
  const chest = muscles.find((m) => m.muscle === 'Chest')!;
  assert.equal(chest.total, 8);
  assert.equal(chest.perWeek, 2);
  assert.equal(muscles.find((m) => m.muscle === 'Triceps')!.total, 4);
  const balance = muscleBalance(muscles);
  const pushPull = balance.find((b) => b.label === 'Push vs pull')!;
  assert.equal(pushPull.ratio, null);
  assert.equal(pushPull.advice, 'No pull work yet');
  const insights = buildInsights({ summary: periodSummary(history, '4w', NOW), stats: exerciseStats(history, '4w', { now: NOW }), muscles, balance, stalled: [], weeklySetGoal: 10, daysSinceLast: 0, periodLabel: '4 weeks' });
  assert.ok(insights.some((i) => i.text.startsWith('Biggest gain: Bench Press')));
  // Five groups untrained is a split routine, not a gap worth flagging (the list caps at four).
  assert.ok(!insights.some((i) => i.text.includes('Not trained in this period')));
});

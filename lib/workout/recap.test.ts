import test from 'node:test';
import assert from 'node:assert/strict';
import { exerciseStats, muscleSetsPerWeek, type Workout } from './insights';
import { buildRecap, lifterPersona, longestWeekStreak, volumeComparison } from './recap';

const NOW = new Date(2026, 1, 25, 12).getTime(); // Wed 25 Feb 2026, local noon
const daysAgo = (n: number, hour = 7) => {
  const d = new Date(NOW - n * 86_400_000);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};
const meta = {
  bench: { name: 'Bench Press', primaryMuscle: 'Chest', secondaryMuscle: 'Triceps' },
  curl: { name: 'Curl', primaryMuscle: 'Biceps', secondaryMuscle: 'None' },
};
// Weekly bench (rising) at 7am, curls on the last two, and a gap of a week.
const history: Workout[] = [35, 28, 14, 7, 0].map((d, i) => ({
  id: `w${d}`,
  timestamp: daysAgo(d),
  durationSecs: 3600,
  logs: {
    bench: [{ weight: 135 + i * 10, reps: 5 }, { weight: 135 + i * 10, reps: 5 }],
    ...(d <= 7 ? { curl: [{ weight: 30, reps: 12 }] } : {}),
  },
  liftMeta: meta,
}));

test('volume comparisons pick the biggest thing that fits', () => {
  assert.equal(volumeComparison(26_000), '2 elephants');
  assert.equal(volumeComparison(600_000), '2 blue whales');
  assert.equal(volumeComparison(9_000), '2.3 cars');
  assert.equal(volumeComparison(500), '0.5 grand pianos');
});

test('streaks count consecutive calendar weeks', () => {
  assert.equal(longestWeekStreak(history), 3); // 14, 7 and 0 days ago
  assert.equal(longestWeekStreak([]), 0);
});

test('persona reflects rep range, time of day and leg focus', () => {
  assert.equal(lifterPersona(5, 'morning', 'Chest').persona, 'Early Bird Strength Chaser');
  assert.equal(lifterPersona(14, 'evening', 'Back').persona, 'Pump Seeker');
  assert.equal(lifterPersona(10, 'night', 'Quads').persona, 'Leg Day Loyalist');
});

test('a recap has slides only for what there is to say', () => {
  const stats = exerciseStats(history, '12w', { now: NOW });
  const muscles = muscleSetsPerWeek(history, '12w', { now: NOW });
  const slides = buildRecap({ history, period: '12w', stats, muscles, name: 'Sam', now: NOW });
  assert.deepEqual(slides.map((s) => s.kind), ['cover', 'showing-up', 'volume', 'top-lifts', 'gains', 'records', 'muscles', 'summary']);
  const showingUp = slides.find((s) => s.kind === 'showing-up');
  assert.ok(showingUp && showingUp.kind === 'showing-up');
  assert.equal(showingUp.workouts, 5);
  assert.equal(showingUp.hours, 5);
  assert.equal(showingUp.favouriteDay, 'Wednesday');
  assert.equal(showingUp.timeOfDay, 'morning');
  const top = slides.find((s) => s.kind === 'top-lifts');
  assert.ok(top && top.kind === 'top-lifts');
  assert.deepEqual(top.lifts[0], { name: 'Bench Press', sessions: 5, sets: 10 });
  const summary = slides.at(-1)!;
  assert.ok(summary.kind === 'summary');
  assert.equal(summary.persona, 'Early Bird Muscle Builder'); // 6.2 reps a set on average

  // A single first session: nothing to compare, so no gains or records slides.
  const quiet = buildRecap({ history: history.slice(0, 1), period: 'all', stats: exerciseStats(history.slice(0, 1), 'all', { now: NOW }), muscles: [], now: NOW });
  assert.deepEqual(quiet.map((s) => s.kind), ['cover', 'showing-up', 'volume', 'top-lifts', 'summary']);
  assert.deepEqual(buildRecap({ history: [], period: '4w', stats: [], muscles: [], now: NOW }), []);
});

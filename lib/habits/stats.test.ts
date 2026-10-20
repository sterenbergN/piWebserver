import test from 'node:test';
import { strict as assert } from 'node:assert';
import { addDays, eachDay } from './dates';
import { applyHabitAction, emptyHabitsData, type HabitInput, type HabitsData } from './habits';
import { completion, dayStatus, freezeState, habitStreak, habitXp, perfectStreak, plantState, weekdayRates, XP } from './stats';
import { levelFromXp, xpForLevel } from '../progress/levels';

const TODAY = '2026-10-20'; // Tuesday
let n = 0;

/** A data set with one habit created `daysAgo` days before today. */
function withHabit(habit: HabitInput, daysAgo: number) {
  const data = emptyHabitsData();
  applyHabitAction(data, { type: 'save', habit }, addDays(TODAY, -daysAgo), () => `h${++n}`);
  return { data, habit: data.habits[0] };
}

function logDays(data: HabitsData, id: string, days: string[], value = 1) {
  for (const d of days) (data.log[d] ||= {})[id] = value;
}

test('a perfect week earns a freeze, which covers the next missed day', () => {
  const { data, habit } = withHabit({ name: 'Read' }, 10);
  const start = addDays(TODAY, -10);
  logDays(data, habit.id, eachDay(start, addDays(start, 6))); // 7 perfect days
  // day 8 missed, day 9 and 10 done
  logDays(data, habit.id, [addDays(start, 8), addDays(start, 9)]);

  const { frozen, available } = freezeState(data, TODAY);
  assert.deepEqual([...frozen], [addDays(start, 7)]);
  assert.equal(available, 0);
  assert.equal(dayStatus(habit, data.log, addDays(start, 7), TODAY, frozen), 'frozen');

  // Today isn't done yet: the streak carries on through the frozen day.
  const streak = habitStreak(habit, data.log, TODAY, frozen);
  assert.equal(streak.current, 9);
  assert.equal(streak.best, 9);
});

test('filling in a missed day later gives the freeze back', () => {
  const { data, habit } = withHabit({ name: 'Read' }, 10);
  const start = addDays(TODAY, -10);
  logDays(data, habit.id, eachDay(start, addDays(start, 6)));
  assert.equal(freezeState(data, TODAY).available, 0, 'spent on the missed days since');
  logDays(data, habit.id, eachDay(addDays(start, 7), addDays(TODAY, -1)));
  const state = freezeState(data, TODAY);
  assert.equal(state.frozen.size, 0);
  assert.equal(state.available, 1);
});

test('without a freeze a missed day breaks the streak; today pending does not', () => {
  const { data, habit } = withHabit({ name: 'Floss' }, 5);
  logDays(data, habit.id, [addDays(TODAY, -5), addDays(TODAY, -4), addDays(TODAY, -2), addDays(TODAY, -1)]);
  const { frozen } = freezeState(data, TODAY);
  assert.deepEqual(habitStreak(habit, data.log, TODAY, frozen), { current: 2, best: 2, unit: 'day' });
  logDays(data, habit.id, [TODAY]);
  assert.equal(habitStreak(habit, data.log, TODAY, frozen).current, 3);
});

test('weekday habits only count their days', () => {
  // Mon/Wed/Fri, created two weeks ago (a Tuesday)
  const { data, habit } = withHabit({ name: 'Gym', schedule: { type: 'weekdays', days: [1, 3, 5] } }, 14);
  logDays(data, habit.id, ['2026-10-07', '2026-10-09', '2026-10-12', '2026-10-14', '2026-10-16', '2026-10-19']);
  const { frozen } = freezeState(data, TODAY);
  assert.equal(dayStatus(habit, data.log, '2026-10-18', TODAY, frozen), 'off');
  assert.equal(habitStreak(habit, data.log, TODAY, frozen).current, 6);
  assert.deepEqual(completion([habit], data.log, addDays(TODAY, -13), TODAY, TODAY, frozen), { done: 6, due: 6, rate: 1 });
});

test('weekly habits: streak in weeks, this week still open', () => {
  const { data, habit } = withHabit({ name: 'Run', schedule: { type: 'weekly', times: 2 } }, 21);
  // weeks of Sep 28 (created Sep 29): 2 runs, Oct 5: 2, Oct 12: 1, Oct 19 (this week): 1 so far
  logDays(data, habit.id, ['2026-09-30', '2026-10-02', '2026-10-06', '2026-10-08', '2026-10-14', '2026-10-19']);
  const { frozen } = freezeState(data, TODAY);
  const streak = habitStreak(habit, data.log, TODAY, frozen);
  assert.equal(streak.unit, 'week');
  assert.equal(streak.current, 0, 'last week missed, this week not met yet');
  assert.equal(streak.best, 2);
  logDays(data, habit.id, [TODAY]);
  assert.equal(habitStreak(habit, data.log, TODAY, frozen).current, 1);
});

test('avoid habits: a slip breaks the streak and counts as a miss', () => {
  const { data, habit } = withHabit({ name: 'No soda', kind: 'avoid' }, 3);
  logDays(data, habit.id, [addDays(TODAY, -3), addDays(TODAY, -2), addDays(TODAY, -1)]);
  logDays(data, habit.id, [TODAY], -1);
  const { frozen } = freezeState(data, TODAY);
  assert.equal(dayStatus(habit, data.log, TODAY, TODAY, frozen), 'slipped');
  assert.deepEqual(habitStreak(habit, data.log, TODAY, frozen), { current: 0, best: 3, unit: 'day' });
  assert.equal(completion([habit], data.log, addDays(TODAY, -3), TODAY, TODAY, frozen).rate, 0.75);
});

test('count habits are done only at their target', () => {
  const { data, habit } = withHabit({ name: 'Water', kind: 'count', target: 8 }, 1);
  logDays(data, habit.id, [addDays(TODAY, -1)], 8);
  logDays(data, habit.id, [TODAY], 5);
  const { frozen } = freezeState(data, TODAY);
  assert.equal(dayStatus(habit, data.log, addDays(TODAY, -1), TODAY, frozen), 'done');
  assert.equal(dayStatus(habit, data.log, TODAY, TODAY, frozen), 'pending');
});

test('perfect-day streak and weekday rates across habits', () => {
  const data = emptyHabitsData();
  const add = (name: string) => applyHabitAction(data, { type: 'save', habit: { name } }, addDays(TODAY, -6), () => `h${++n}`);
  add('A');
  add('B');
  const [a, b] = data.habits;
  logDays(data, a.id, eachDay(addDays(TODAY, -6), addDays(TODAY, -1)));
  logDays(data, b.id, eachDay(addDays(TODAY, -3), addDays(TODAY, -1)));
  const { frozen } = freezeState(data, TODAY);
  assert.deepEqual(perfectStreak(data, TODAY, frozen), { current: 3, best: 3 });
  const rates = weekdayRates(data.habits, data.log, addDays(TODAY, -6), TODAY, frozen);
  assert.equal(rates[0].day, 'Mon');
  assert.equal(rates[0].rate, 1); // Mon Oct 19: both done
  assert.equal(rates[3].rate, 0.5); // Thu Oct 15: only A
  assert.equal(rates[1].rate, null); // Tue = today, still pending
});

test('XP: per habit, perfect days and milestones, and undo takes it back', () => {
  const { data, habit } = withHabit({ name: 'Read' }, 6);
  logDays(data, habit.id, eachDay(addDays(TODAY, -6), TODAY)); // 7 days
  assert.equal(habitXp(data, TODAY), 7 * XP.habit + 7 * XP.perfectDay + XP.milestones[0][1]);
  delete data.log[TODAY];
  assert.equal(habitXp(data, TODAY), 6 * XP.habit + 6 * XP.perfectDay);
});

test('garden: plants grow with completions and wilt when neglected', () => {
  const { data, habit } = withHabit({ name: 'Stretch' }, 20);
  logDays(data, habit.id, eachDay(addDays(TODAY, -20), addDays(TODAY, -15)));
  const { frozen } = freezeState(data, TODAY);
  const plant = plantState(habit, data.log, TODAY, frozen);
  assert.equal(plant.total, 6);
  assert.equal(plant.stageName, 'Seedling');
  assert.equal(plant.toNext, 9);
  assert.equal(plant.mood, 'wilting');
  logDays(data, habit.id, eachDay(addDays(TODAY, -13), TODAY));
  const revived = plantState(habit, data.log, TODAY, freezeState(data, TODAY).frozen);
  assert.equal(revived.mood, 'thriving');
  assert.equal(revived.wateredToday, true);
});

test('levels: thresholds and progress within a level', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(xpForLevel), [0, 100, 300, 600, 1000]);
  assert.equal(levelFromXp(0).level, 1);
  assert.equal(levelFromXp(99).level, 1);
  const l = levelFromXp(350);
  assert.equal(l.level, 3);
  assert.equal(l.into, 50);
  assert.equal(l.size, 300);
  assert.equal(l.toNext, 250);
  assert.equal(l.title, 'Sprout');
});

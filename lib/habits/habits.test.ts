import test from 'node:test';
import { strict as assert } from 'node:assert';
import { addDays, dayOfWeek, eachDay, isDateKey, weekStart } from './dates';
import { applyHabitAction, emptyHabitsData, HabitInputError, normalizeHabitsData, type HabitAction, type HabitsData } from './habits';

const TODAY = '2026-10-20'; // a Tuesday
let n = 0;
const newId = () => `h${++n}`;
const apply = (data: HabitsData, action: HabitAction, today = TODAY) => applyHabitAction(data, action, today, newId);

test('date keys: validation and calendar math across month, year and DST edges', () => {
  assert.equal(isDateKey('2026-02-29'), false);
  assert.equal(isDateKey('2028-02-29'), true);
  assert.equal(isDateKey('2026-1-05'), false);
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-08', 1), '2026-03-09'); // US DST change
  assert.equal(addDays('2026-11-01', -1), '2026-10-31');
  assert.equal(dayOfWeek(TODAY), 2);
  assert.equal(weekStart(TODAY), '2026-10-19');
  assert.equal(weekStart('2026-10-25'), '2026-10-19'); // Sunday belongs to the week before
  assert.deepEqual(eachDay('2026-10-30', '2026-11-02'), ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
});

test('save: cleans input, picks a free color and keeps the creation day on edits', () => {
  const data = emptyHabitsData();
  apply(data, { type: 'save', habit: { name: '  Water  ', kind: 'count', target: 8.4 as any, unit: 'glasses', color: 0 as any } });
  apply(data, { type: 'save', habit: { name: 'Read', kind: 'duration', target: 9999, schedule: { type: 'weekdays', days: [1, 1, 3, 9] } } });
  const [water, read] = data.habits;
  assert.equal(water.name, 'Water');
  assert.equal(water.target, 8);
  assert.equal(water.color, 1);
  assert.equal(read.color, 2, 'second habit gets the next free color');
  assert.equal(read.target, 1440);
  assert.equal(read.unit, 'min');
  assert.deepEqual(read.schedule, { type: 'weekdays', days: [1, 3] });

  apply(data, { type: 'save', habit: { ...water, name: 'More water' } }, '2026-10-25');
  assert.equal(data.habits[0].name, 'More water');
  assert.equal(data.habits[0].createdOn, TODAY);

  assert.throws(() => apply(data, { type: 'save', habit: { name: '   ' } }), HabitInputError);
  assert.throws(() => apply(data, { type: 'save', habit: { id: 'nope', name: 'X' } }), HabitInputError);
});

test('save: a new habit uses the suggested id only when it is valid and free', () => {
  const data = emptyHabitsData();
  apply(data, { type: 'save', habit: { name: 'A' }, newId: 'client-1' });
  apply(data, { type: 'save', habit: { name: 'B' }, newId: 'client-1' });
  apply(data, { type: 'save', habit: { name: 'C' }, newId: '../etc' });
  const [a, b, c] = data.habits;
  assert.equal(a.id, 'client-1');
  assert.notEqual(b.id, 'client-1');
  assert.ok(/^h\d+$/.test(c.id));
});

test('save: all seven weekdays is just daily; links only stick to check habits', () => {
  const data = emptyHabitsData();
  apply(data, { type: 'save', habit: { name: 'A', schedule: { type: 'weekdays', days: [0, 1, 2, 3, 4, 5, 6] }, link: 'workout' } });
  apply(data, { type: 'save', habit: { name: 'B', kind: 'count', link: 'workout' } });
  apply(data, { type: 'save', habit: { name: 'C', link: 'daily-question' } });
  apply(data, { type: 'save', habit: { name: 'D', link: 'journal' } });
  apply(data, { type: 'save', habit: { name: 'E', link: 'nonsense' as any } });
  assert.deepEqual(data.habits[0].schedule, { type: 'daily' });
  assert.equal(data.habits[0].link, 'workout');
  assert.equal(data.habits[1].link, undefined);
  assert.equal(data.habits[2].link, 'daily-question');
  assert.equal(data.habits[3].link, 'journal');
  assert.equal(data.habits[4].link, undefined);
});

test('log: values per kind, the edit window, and zero clears the day', () => {
  const data = emptyHabitsData();
  apply(data, { type: 'save', habit: { name: 'Check' } });
  apply(data, { type: 'save', habit: { name: 'No soda', kind: 'avoid' } });
  const [check, avoid] = data.habits;

  apply(data, { type: 'log', habitId: check.id, date: TODAY, value: 5 });
  apply(data, { type: 'log', habitId: avoid.id, date: TODAY, value: -3 });
  assert.deepEqual(data.log[TODAY], { [check.id]: 1, [avoid.id]: -1 });

  apply(data, { type: 'log', habitId: check.id, date: TODAY, value: 0 });
  apply(data, { type: 'log', habitId: avoid.id, date: TODAY, value: 0 });
  assert.equal(data.log[TODAY], undefined);

  apply(data, { type: 'log', habitId: check.id, date: addDays(TODAY, -7), value: 1 });
  assert.throws(() => apply(data, { type: 'log', habitId: check.id, date: addDays(TODAY, -8), value: 1 }), HabitInputError);
  assert.throws(() => apply(data, { type: 'log', habitId: check.id, date: addDays(TODAY, 1), value: 1 }), HabitInputError);
  assert.throws(() => apply(data, { type: 'log', habitId: 'missing', date: TODAY, value: 1 }), HabitInputError);
});

test('changing a habit’s kind clears values that no longer mean anything', () => {
  const data = emptyHabitsData();
  apply(data, { type: 'save', habit: { name: 'Water', kind: 'count', target: 8 } });
  const id = data.habits[0].id;
  apply(data, { type: 'log', habitId: id, date: TODAY, value: 6 });
  apply(data, { type: 'save', habit: { ...data.habits[0], target: 10 } });
  assert.equal(data.log[TODAY][id], 6, 'a new target keeps the counts');
  apply(data, { type: 'save', habit: { ...data.habits[0], kind: 'check' } });
  assert.equal(data.log[TODAY], undefined);
});

test('delete, move and archive', () => {
  const data = emptyHabitsData();
  for (const name of ['A', 'B', 'C']) apply(data, { type: 'save', habit: { name } });
  const [a, b] = data.habits;
  apply(data, { type: 'log', habitId: a.id, date: TODAY, value: 1 });
  apply(data, { type: 'move', id: b.id, direction: -1 });
  assert.deepEqual(data.habits.map((h) => h.name), ['B', 'A', 'C']);
  apply(data, { type: 'delete', id: a.id });
  assert.deepEqual(data.habits.map((h) => h.name), ['B', 'C']);
  assert.equal(data.log[TODAY], undefined, 'deleting removes its history');
  apply(data, { type: 'archive', id: b.id, archived: true });
  assert.equal(data.habits[0].archivedOn, TODAY);
  apply(data, { type: 'archive', id: b.id, archived: false });
  assert.equal(data.habits[0].archivedOn, undefined);
});

test('link-done ticks linked habits on recent days, even from before the habit was made', () => {
  const data = emptyHabitsData();
  apply(data, { type: 'save', habit: { name: 'Work out', link: 'workout' } });
  apply(data, { type: 'save', habit: { name: 'Journal', link: 'journal' } });
  apply(data, { type: 'save', habit: { name: 'Other' } });
  const [gym, journal, other] = data.habits;
  apply(data, { type: 'link-done', link: 'workout', dates: ['2026-10-15', TODAY, '2026-10-01', 'junk'] });
  apply(data, { type: 'link-done', link: 'journal', dates: [TODAY] });
  assert.equal(data.log['2026-10-15'][gym.id], 1, 'backfilled inside the edit window');
  assert.equal(data.log[TODAY][gym.id], 1);
  assert.equal(data.log[TODAY][journal.id], 1);
  assert.equal(data.log['2026-10-01'], undefined, 'outside the edit window');
  assert.equal(data.log[TODAY][other.id], undefined);
});

test('import adds device habits with their history and never overwrites account ones', () => {
  const account = emptyHabitsData();
  apply(account, { type: 'save', habit: { name: 'Mine' } });
  const mine = account.habits[0];
  const device = {
    version: 1,
    habits: [
      { id: mine.id, name: 'Clashing id', kind: 'check', createdOn: '2026-10-01', schedule: { type: 'daily' } },
      { id: 'local1', name: 'Stretch', kind: 'check', createdOn: '2026-10-02', schedule: { type: 'daily' } },
      { id: '../bad', name: 'Bad id' },
    ],
    log: { '2026-10-18': { [mine.id]: 1, local1: 1, ghost: 1 } },
  };
  apply(account, { type: 'import', data: device as any });
  assert.deepEqual(account.habits.map((h) => h.name), ['Mine', 'Clashing id', 'Stretch']);
  const clash = account.habits[1];
  assert.notEqual(clash.id, mine.id);
  assert.equal(clash.createdOn, '2026-10-01');
  assert.equal(account.log['2026-10-18'][clash.id], 1);
  assert.equal(account.log['2026-10-18'][mine.id], undefined, 'the account habit keeps its own history');
  assert.equal(account.log['2026-10-18'].local1, 1);
});

test('normalizeHabitsData drops junk and keeps good records', () => {
  const data = normalizeHabitsData({
    habits: [{ id: 'a', name: 'A', kind: 'count', target: 3 }, { id: 'a', name: 'Dupe' }, null, { id: 'b' }],
    log: { '2026-10-19': { a: '2', zz: 1 }, 'not-a-date': { a: 1 }, '2030-01-01': { a: 1 } },
  }, TODAY);
  assert.deepEqual(data.habits.map((h) => h.id), ['a']);
  assert.deepEqual(data.log, { '2026-10-19': { a: 2 } });
  assert.deepEqual(normalizeHabitsData(null, TODAY), emptyHabitsData());
});

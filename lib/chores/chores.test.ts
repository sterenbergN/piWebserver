import test from 'node:test';
import { strict as assert } from 'node:assert';
import { addMonths, applyChoreAction, ChoreInputError, emptyChoresData, nextDue, normalizeChoresData, type ChoreAction, type ChoresData } from './chores';
import { choreStreak, choreXp, chorePlant, CHORE_XP, dueStatus, weekBoard } from './stats';

const TODAY = '2026-10-20'; // a Tuesday
let n = 0;
const newId = () => `c${++n}`;
const apply = (data: ChoresData, action: ChoreAction, today = TODAY) => applyChoreAction(data, action, today, newId);

test('months: held to the end of short months, across years', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2028-01-31', 1), '2028-02-29');
  assert.equal(addMonths('2026-11-15', 3), '2027-02-15');
  assert.equal(addMonths('2026-03-31', -1), '2026-02-28');
});

test('save: cleans input, repeating chores always get a due date, one-offs may have none', () => {
  const data = emptyChoresData();
  apply(data, { type: 'save', chore: { name: '  Vacuum floors ', repeat: { every: 1, unit: 'week' }, effort: 9 as any } });
  apply(data, { type: 'save', chore: { name: 'Vet visit', repeat: null, due: 'nope' } });
  const [vacuum, vet] = data.chores;
  assert.equal(vacuum.name, 'Vacuum floors');
  assert.equal(vacuum.due, TODAY);
  assert.equal(vacuum.effort, 3);
  assert.equal(vacuum.fromDone, true);
  assert.equal(vet.due, null);
  assert.notEqual(vacuum.color, vet.color);
  assert.throws(() => apply(data, { type: 'save', chore: { name: '   ' } }), ChoreInputError);
});

test('done: counts from the day it was done, or keeps a fixed calendar', () => {
  const data = emptyChoresData();
  apply(data, { type: 'save', chore: { name: 'Vacuum', repeat: { every: 1, unit: 'week' }, due: '2026-10-18' } });
  apply(data, { type: 'save', chore: { name: 'Bins', repeat: { every: 1, unit: 'week' }, due: '2026-10-12', fromDone: false } });
  apply(data, { type: 'save', chore: { name: 'Bathroom', repeat: { every: 2, unit: 'week' }, due: '2026-10-25', fromDone: false } });
  const [vacuum, bins, bathroom] = data.chores;
  apply(data, { type: 'done', id: vacuum.id, date: TODAY });
  assert.equal(vacuum.due, '2026-10-27');
  // Bins were due on the 12th and missed a week: the next one is the next Monday on the schedule.
  apply(data, { type: 'done', id: bins.id, date: TODAY });
  assert.equal(bins.due, '2026-10-26');
  // Done early on a fixed schedule still moves on by one repeat.
  apply(data, { type: 'done', id: bathroom.id, date: TODAY });
  assert.equal(bathroom.due, '2026-11-08');
  assert.equal(nextDue({ ...bathroom, due: '2026-01-31', repeat: { every: 1, unit: 'month' } }, '2026-01-31'), '2026-02-28');
});

test('done, skip and undo: one-offs leave the list and come back on undo', () => {
  const data = emptyChoresData();
  apply(data, { type: 'save', chore: { name: 'Vet visit', repeat: null, due: '2026-10-22' } });
  apply(data, { type: 'save', chore: { name: 'Counters', repeat: { every: 1, unit: 'week' }, due: TODAY } });
  const [vet, counters] = data.chores;
  apply(data, { type: 'done', id: vet.id, date: TODAY, by: 'noah', entryId: 'e1' });
  assert.equal(vet.archivedOn, TODAY);
  assert.throws(() => apply(data, { type: 'done', id: vet.id, date: TODAY }), ChoreInputError);
  assert.throws(() => apply(data, { type: 'skip', id: vet.id, date: TODAY }), ChoreInputError);
  apply(data, { type: 'undo', entryId: 'e1' });
  assert.equal(vet.archivedOn, undefined);
  assert.equal(vet.due, '2026-10-22');

  apply(data, { type: 'skip', id: counters.id, date: TODAY, entryId: 's1' });
  assert.equal(counters.due, '2026-10-27');
  apply(data, { type: 'done', id: counters.id, date: TODAY, entryId: 'd1' });
  assert.throws(() => apply(data, { type: 'undo', entryId: 's1' }), /latest/);
  apply(data, { type: 'undo', entryId: 'd1' });
  apply(data, { type: 'undo', entryId: 's1' });
  assert.equal(counters.due, TODAY);
  assert.equal(data.log.length, 0);
  assert.throws(() => apply(data, { type: 'done', id: counters.id, date: '2026-10-01' }), ChoreInputError);
});

test('xp: by effort, on-time bonus, streak milestones, and only for who did it', () => {
  const data = emptyChoresData();
  apply(data, { type: 'save', chore: { name: 'Trash', repeat: { every: 1, unit: 'day' }, due: '2026-10-14', effort: 1 } });
  const trash = data.chores[0];
  // Four days on time by noah (14–17), then jess does it late.
  for (const date of ['2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17']) apply(data, { type: 'done', id: trash.id, date, by: 'noah' });
  apply(data, { type: 'done', id: trash.id, date: TODAY, by: 'jess' }); // was due the 18th
  const perOnTime = CHORE_XP.effort[1] + CHORE_XP.onTime;
  assert.equal(choreXp(data, 'noah'), 4 * perOnTime + CHORE_XP.milestones[0][1]);
  assert.equal(choreXp(data, 'jess'), CHORE_XP.effort[1]);
  assert.equal(choreXp(data, null), choreXp(data, 'noah') + choreXp(data, 'jess'));
  assert.equal(choreStreak(data, trash.id), 0);

  const board = weekBoard(data, TODAY, ['noah', 'jess']);
  // The week starts Monday the 19th, so only jess's one counts this week.
  assert.deepEqual(board.map((r) => [r.member, r.count]), [['jess', 1], ['noah', 0]]);
});

test('plants and status follow how overdue a chore is', () => {
  const data = emptyChoresData();
  apply(data, { type: 'save', chore: { name: 'Bathroom', repeat: { every: 2, unit: 'week' }, due: '2026-10-19' } });
  const bathroom = data.chores[0];
  assert.deepEqual(dueStatus(bathroom, TODAY), { status: 'overdue', days: -1 });
  assert.equal(chorePlant(bathroom, data, TODAY).mood, 'okay');
  assert.equal(chorePlant(bathroom, data, '2026-11-05').mood, 'wilting');
  apply(data, { type: 'done', id: bathroom.id, date: TODAY });
  const plant = chorePlant(bathroom, data, TODAY);
  assert.equal(plant.mood, 'thriving');
  assert.equal(plant.stage, 1);
  assert.equal(plant.wateredToday, true);
});

test('normalize and import: drop malformed data, never overwrite existing chores', () => {
  const raw = {
    chores: [{ id: 'a', name: 'Dust', repeat: { every: 1, unit: 'week' }, due: '2026-10-21' }, { id: 'bad id!', name: 'x' }, { id: 'b', name: '' }],
    log: [{ id: 'l1', choreId: 'a', date: '2026-10-14', by: null, due: '2026-10-14' }, { id: 'l2', choreId: 'zzz', date: '2026-10-14' }, { id: 'l3', choreId: 'a', date: '2027-01-01' }],
  };
  const clean = normalizeChoresData(raw, TODAY);
  assert.deepEqual(clean.chores.map((c) => c.id), ['a']);
  assert.deepEqual(clean.log.map((e) => e.id), ['l1']);

  const account = emptyChoresData();
  apply(account, { type: 'save', chore: { id: undefined, name: 'Mop' }, newId: 'a' });
  apply(account, { type: 'import', data: clean, by: 'noah' });
  assert.equal(account.chores.length, 2);
  assert.equal(new Set(account.chores.map((c) => c.id)).size, 2);
  assert.equal(account.log[0].by, 'noah');
  assert.equal(account.log[0].choreId, account.chores[1].id);
});

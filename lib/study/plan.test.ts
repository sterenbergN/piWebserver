import test from 'node:test';
import { strict as assert } from 'node:assert';
import { addDays } from '../habits/dates';
import { emptyChoresData, type Chore } from '../chores/chores';
import { endHelp, startHelp } from '../chores/exam-help';
import { classifyEvent, parseIcal } from './ical';
import { isGoogleIcalUrl } from './calendar';
import { buildSyllabusPrompt } from './prompt';
import {
  acceptEvent, addDeadline, addSyllabus, addTask, calendarInbox, cleanStreak, dayPlan, eat, eatTest, editDeadline, editTask, emptyPlan, ignoreEvent, isLive, lastWorkDay, noteClean,
  openTasks, parseSyllabusReply, plateView, PlanInputError, recentPace, removeDeadline, removeTask, reviewPancakes, saveSettings, setDayOff, spreadPile, syncCalendar, uneat, upcoming,
  type PlanData, type PlanTask,
} from './plan';

const TODAY = '2026-11-02'; // A Monday.
let counter = 0;
const makeId = () => `p${++counter}`;
const total = (task: PlanTask) => Object.values(task.plate).reduce((n, v) => n + v, 0);
const later = (n: number) => addDays(TODAY, n);

function withExam(days = 10, kind = 'exam'): { plan: PlanData; examId: string } {
  const plan = emptyPlan();
  const exam = addDeadline(plan, { title: 'Cardio exam', kind, dueOn: later(days) }, makeId);
  return { plan, examId: exam.id };
}

test('pancakes spread evenly over study days, leaving the last days before an exam clear', () => {
  const { plan, examId } = withExam(10);
  const task = addTask(plan, { title: 'Heart failure', pancakes: 8, deadlineId: examId }, makeId, TODAY);
  assert.equal(total(task), 8);
  const days = Object.keys(task.plate).sort();
  assert.equal(days[0], TODAY);
  assert.ok(days[days.length - 1] <= lastWorkDay(plan.deadlines[0]));
  assert.equal(lastWorkDay(plan.deadlines[0]), later(8));
  assert.ok(Object.values(task.plate).every((n) => n === 1), 'one a day when there’s room');
});

test('a second task fills the emptier days, and every pancake lands somewhere', () => {
  const { plan, examId } = withExam(5);
  addTask(plan, { title: 'A', pancakes: 3, deadlineId: examId }, makeId, TODAY);
  const b = addTask(plan, { title: 'B', pancakes: 3, deadlineId: examId }, makeId, TODAY);
  assert.equal(total(b), 3);
  const loads = [0, 1, 2, 3].map((n) => dayPlan(plan, later(n), TODAY).items.reduce((sum, i) => sum + i.count, 0));
  assert.equal(loads.reduce((a, b) => a + b), 6);
  assert.ok(Math.max(...loads) - Math.min(...loads) <= 1, `level: ${loads}`);
});

test('a small job on a far-off date is spaced out, starting now', () => {
  const { plan, examId } = withExam(32);
  const task = addTask(plan, { title: 'A', pancakes: 3, deadlineId: examId }, makeId, TODAY);
  assert.deepEqual(Object.keys(task.plate).sort(), [later(0), later(10), later(20)]);
});

test('only study days get pancakes, and running out of time gives up the clear days first', () => {
  const { plan, examId } = withExam(10);
  saveSettings(plan, { studyDays: [1, 3, 5] }, TODAY); // Mon, Wed, Fri.
  const task = addTask(plan, { title: 'A', pancakes: 3, deadlineId: examId }, makeId, TODAY);
  assert.deepEqual(Object.keys(task.plate).sort(), [TODAY, later(2), later(4)]);

  const soon = emptyPlan();
  const tomorrow = addDeadline(soon, { title: 'Quiz', kind: 'exam', dueOn: later(1) }, makeId);
  const rushed = addTask(soon, { title: 'A', pancakes: 2, deadlineId: tomorrow.id }, makeId, TODAY);
  assert.deepEqual(rushed.plate, { [TODAY]: 2 }, 'too late for clear days, so today is what’s left');

  const none = emptyPlan();
  const open = addTask(none, { title: 'Open ended', pancakes: 4 }, makeId, TODAY);
  assert.equal(total(open), 4);
  assert.ok(Object.keys(open.plate).every((d) => d <= later(13)));
});

test('what isn’t eaten becomes the pile, and eating takes the oldest first', () => {
  const { plan, examId } = withExam(10);
  const task = addTask(plan, { title: 'A', pancakes: 9, deadlineId: examId }, makeId, TODAY);

  let view = plateView(plan, TODAY, 0);
  assert.deepEqual([view.pile, view.today, view.total, view.cold], [0, 1, 1, 0]);

  // Two days on, nothing eaten.
  const day = later(2);
  view = plateView(plan, day, 0);
  assert.deepEqual([view.pile, view.today, view.total], [2, 1, 3]);
  assert.equal(view.cold, 1);

  eat(plan, task.id, day);
  assert.equal(task.eaten, 1);
  assert.equal(task.plate[TODAY], undefined, 'the oldest went first');
  assert.equal(plateView(plan, day, 0).pile, 1);
  assert.equal(plan.eatenOn[day], 1);

  uneat(plan, task.id, day);
  assert.equal(task.eaten, 0);
  assert.equal(task.plate[day], 2);
  assert.equal(plan.eatenOn[day], undefined);
  assert.equal(total(task) + task.eaten, task.pancakes);
});

test('a pile goes colder the longer it sits', () => {
  const { plan, examId } = withExam(30);
  addTask(plan, { title: 'A', pancakes: 1, deadlineId: examId }, makeId, TODAY);
  assert.equal(plateView(plan, later(1), 0).cold, 1);
  assert.equal(plateView(plan, later(3), 0).cold, 2);
  assert.equal(plateView(plan, later(5), 0).cold, 3);
});

test('eating ahead of the plan comes off the future, and can’t go past the task', () => {
  const { plan, examId } = withExam(10);
  const task = addTask(plan, { title: 'A', pancakes: 3, deadlineId: examId }, makeId, TODAY);
  assert.equal(eat(plan, task.id, TODAY, 5), 3);
  assert.equal(task.eaten, 3);
  assert.equal(isLive(plan, task, TODAY), false);
  assert.equal(eat(plan, task.id, TODAY), 0);
  assert.throws(() => eat(plan, 'gone', TODAY), PlanInputError);
});

test('Spread the pile sends leftovers back out and empties the stack', () => {
  const { plan, examId } = withExam(12);
  const task = addTask(plan, { title: 'A', pancakes: 11, deadlineId: examId }, makeId, TODAY);
  const day = later(3);
  assert.equal(plateView(plan, day, 0).pile, 3);
  assert.equal(spreadPile(plan, day), 3);
  assert.equal(plateView(plan, day, 0).pile, 0);
  assert.equal(plateView(plan, day, 0).cold, 0);
  assert.equal(total(task), 11);
  assert.ok(Object.keys(task.plate).every((d) => d >= day));
});

test('a day off moves that day’s pancakes along instead of piling them up', () => {
  const { plan, examId } = withExam(10);
  const task = addTask(plan, { title: 'A', pancakes: 3, deadlineId: examId }, makeId, TODAY);
  setDayOff(plan, TODAY, true, TODAY);
  assert.equal(task.plate[TODAY], undefined);
  assert.equal(total(task), 3);
  assert.equal(plateView(plan, TODAY, 0).dayOff, true);
  assert.equal(plateView(plan, later(1), 0).pile, 0, 'nothing piled up');
  assert.ok(!isDayUsed(plan, TODAY));

  // A sick day marked afterward takes its pancakes off the pile.
  const pile = withExam(10);
  const other = addTask(pile.plan, { title: 'B', pancakes: 2, deadlineId: pile.examId }, makeId, TODAY);
  const nextDay = later(1);
  assert.equal(plateView(pile.plan, nextDay, 0).pile, 1);
  setDayOff(pile.plan, TODAY, true, nextDay);
  assert.equal(plateView(pile.plan, nextDay, 0).pile, 0);
  assert.equal(total(other), 2);

  setDayOff(plan, TODAY, false, TODAY);
  assert.equal(plateView(plan, TODAY, 0).dayOff, false);
});

const isDayUsed = (plan: PlanData, day: string) => plan.tasks.some((t) => t.plate[day]);

test('once a deadline passes, its leftovers leave the stack', () => {
  const { plan, examId } = withExam(4);
  const task = addTask(plan, { title: 'A', pancakes: 4, deadlineId: examId }, makeId, TODAY);
  assert.ok(plateView(plan, later(4), 0).pile > 0, 'still there on the day itself');
  assert.equal(plateView(plan, later(5), 0).total, 0, 'gone the day after');
  assert.equal(isLive(plan, task, later(5)), false);
  assert.deepEqual(upcoming(plan, later(5)), []);
  assert.equal(cleanStreak(plan, later(5)), 0);
});

test('reviews cost a pancake per twenty, and are never stored', () => {
  assert.deepEqual([reviewPancakes(0), reviewPancakes(1), reviewPancakes(20), reviewPancakes(21)], [0, 1, 1, 2]);
  const plan = emptyPlan();
  const view = plateView(plan, TODAY, 25);
  assert.deepEqual([view.reviews, view.total, view.items.length], [2, 2, 0]);
});

test('a clean plate takes something done and nothing left, reviews included', () => {
  const { plan, examId } = withExam(10);
  const task = addTask(plan, { title: 'A', pancakes: 1, deadlineId: examId }, makeId, TODAY);
  assert.equal(noteClean(plan, TODAY, 0, false), false);
  eat(plan, task.id, TODAY);
  assert.equal(noteClean(plan, TODAY, 3, false), false, 'reviews still due');
  assert.equal(noteClean(plan, TODAY, 0, false), true);
  assert.equal(noteClean(plan, TODAY, 0, false), false, 'it only fires once');
  assert.deepEqual(plan.cleanDays, [TODAY]);
  assert.equal(plateView(plan, TODAY, 0).clean, true);

  uneat(plan, task.id, TODAY);
  noteClean(plan, TODAY, 0, false);
  assert.deepEqual(plan.cleanDays, [], 'taking it back undoes it');

  const empty = emptyPlan();
  assert.equal(noteClean(empty, TODAY, 0, false), false, 'an empty day isn’t an achievement');
  assert.equal(noteClean(empty, TODAY, 0, true), true, 'clearing reviews is');
});

test('the streak survives days off and empty days, and only leftovers break it', () => {
  const plan = emptyPlan();
  plan.cleanDays = [later(0), later(1), later(3)];
  assert.equal(cleanStreak(plan, later(3)), 3, 'an empty day doesn’t break it');
  assert.equal(cleanStreak(plan, later(4)), 3, 'today isn’t over');

  const { plan: broken, examId } = withExam(20);
  broken.cleanDays = [TODAY, later(2)];
  const task = addTask(broken, { title: 'A', pancakes: 1, deadlineId: examId }, makeId, later(1));
  assert.equal(cleanStreak(broken, later(3)), 1, 'the leftover on day 1 ends the run');
  eat(broken, task.id, later(3));
  assert.equal(cleanStreak(broken, later(3)), 2, 'eating it repairs the run');
});

test('handing in a linked test eats its whole task', () => {
  const { plan, examId } = withExam(10);
  const linked = addTask(plan, { title: 'Take practice test', pancakes: 3, deadlineId: examId, testId: 't1' }, makeId, TODAY);
  const other = addTask(plan, { title: 'Other', pancakes: 2, deadlineId: examId }, makeId, TODAY);
  assert.equal(eatTest(plan, 't1', TODAY), 3);
  assert.equal(linked.eaten, 3);
  assert.equal(other.eaten, 0);
  assert.equal(eatTest(plan, 't1', TODAY), 0);
  assert.equal(eatTest(plan, 'unknown', TODAY), 0);
});

test('editing a task keeps the books straight', () => {
  const { plan, examId } = withExam(20);
  const task = addTask(plan, { title: 'A', pancakes: 4, deadlineId: examId }, makeId, TODAY);
  eat(plan, task.id, TODAY);
  editTask(plan, task.id, { pancakes: 7, title: 'Bigger' }, TODAY);
  assert.deepEqual([task.title, task.pancakes, total(task)], ['Bigger', 7, 6]);
  const lastBefore = Object.keys(task.plate).sort().pop()!;
  editTask(plan, task.id, { pancakes: 3 }, TODAY);
  assert.deepEqual([task.pancakes, total(task)], [3, 2]);
  assert.ok(!Object.keys(task.plate).includes(lastBefore), 'the far end went first');
  editTask(plan, task.id, { pancakes: 1 }, TODAY);
  assert.equal(task.pancakes, 1, 'can’t shrink below what’s eaten');
  assert.equal(total(task), 0);
  assert.throws(() => editTask(plan, task.id, { title: ' ' }, TODAY), PlanInputError);
  assert.throws(() => addTask(plan, { title: 'x', pancakes: 0 }, makeId, TODAY), /how many pancakes/);
  removeTask(plan, task.id);
  assert.equal(plan.tasks.length, 0);
});

test('moving a date moves its upcoming work and leaves the pile alone', () => {
  const { plan, examId } = withExam(10);
  const task = addTask(plan, { title: 'A', pancakes: 8, deadlineId: examId }, makeId, TODAY);
  const day = later(2);
  editDeadline(plan, examId, { dueOn: later(20) }, day);
  assert.equal(plateView(plan, day, 0).pile, 2);
  assert.equal(total(task), 8);
  assert.ok(Object.keys(task.plate).some((d) => d > later(10)));
  assert.throws(() => editDeadline(plan, examId, { dueOn: 'soon' }, day), /Pick a date/);
  removeDeadline(plan, examId);
  assert.deepEqual([plan.deadlines.length, plan.tasks.length], [0, 0]);
});

test('saving her week moves pancakes off days she dropped', () => {
  const { plan, examId } = withExam(14);
  const task = addTask(plan, { title: 'A', pancakes: 14, deadlineId: examId }, makeId, TODAY);
  saveSettings(plan, { studyDays: [1, 2, 3, 4, 5], perDay: 3 }, TODAY);
  assert.equal(total(task), 14);
  assert.ok(Object.keys(task.plate).every((d) => ![0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay())));
  assert.equal(plan.settings.perDay, 3);
  assert.throws(() => saveSettings(plan, { studyDays: [] }, TODAY), /at least one/);
  assert.throws(() => saveSettings(plan, { perDay: 0 }, TODAY), /1 to 40/);
});

test('the early warning speaks up when a plan can’t fit', () => {
  const { plan, examId } = withExam(4); // Two work days before the clear days.
  saveSettings(plan, { perDay: 3 }, TODAY);
  addTask(plan, { title: 'A', pancakes: 12, deadlineId: examId }, makeId, TODAY);
  const [view] = upcoming(plan, TODAY);
  assert.deepEqual([view.daysLeft, view.left], [4, 12]);
  assert.equal(view.needPerDay, 4);
  assert.equal(view.tooMuch, true);
  saveSettings(plan, { perDay: 6 }, TODAY);
  assert.equal(upcoming(plan, TODAY)[0].tooMuch, false);
});

test('an earlier exam’s work counts against the later one', () => {
  const plan = emptyPlan();
  const first = addDeadline(plan, { title: 'First', kind: 'exam', dueOn: later(4) }, makeId);
  const second = addDeadline(plan, { title: 'Second', kind: 'exam', dueOn: later(6) }, makeId);
  addTask(plan, { title: 'A', pancakes: 6, deadlineId: first.id }, makeId, TODAY);
  addTask(plan, { title: 'B', pancakes: 2, deadlineId: second.id }, makeId, TODAY);
  const views = upcoming(plan, TODAY);
  assert.equal(views[0].deadline.id, first.id);
  assert.equal(views[1].needPerDay, 8 / 5);
});

test('the pace check needs real history, then says how late', () => {
  const { plan, examId } = withExam(4);
  addTask(plan, { title: 'A', pancakes: 12, deadlineId: examId }, makeId, TODAY);
  assert.equal(recentPace(plan, TODAY), null);
  assert.equal(upcoming(plan, TODAY)[0].daysLate, null);
  for (let i = 1; i <= 14; i++) plan.eatenOn[later(-i)] = 1;
  assert.equal(recentPace(plan, TODAY), 1);
  // 12 pancakes at 1 a day from today finishes on day 11; the exam is on day 4.
  assert.equal(upcoming(plan, TODAY)[0].daysLate, 7);
  for (let i = 1; i <= 14; i++) plan.eatenOn[later(-i)] = 8;
  assert.equal(upcoming(plan, TODAY)[0].daysLate, null);
});

test('open-ended work is its own list, and the calendar sees each day', () => {
  const plan = emptyPlan();
  const task = addTask(plan, { title: 'Read ahead', pancakes: 2 }, makeId, TODAY);
  assert.deepEqual(openTasks(plan, TODAY).map((t) => t.id), [task.id]);
  const exam = addDeadline(plan, { title: 'Exam', kind: 'exam', dueOn: TODAY }, makeId);
  const day = dayPlan(plan, TODAY, TODAY);
  assert.deepEqual(day.deadlines.map((d) => d.id), [exam.id]);
  assert.equal(day.items[0].count, 1);
  assert.equal(day.studyDay, true);
});

test('a syllabus reply is read, with the bad parts reported', () => {
  const reply = `Here you go:\n\`\`\`json\n${JSON.stringify({
    course: 'Clin Med II',
    deadlines: [
      { title: 'Cardio exam', kind: 'exam', dueOn: later(10) },
      { title: 'Paper', kind: 'nonsense', dueOn: later(12), course: 'Ethics' },
      { title: 'Old quiz', kind: 'quiz', dueOn: later(-3) },
      { title: 'No date', kind: 'quiz', dueOn: 'next week' },
      { kind: 'quiz', dueOn: later(1) },
    ],
    tasks: [
      { title: 'HF lecture', pancakes: 3, for: 'Cardio exam' },
      { title: 'Valves', pancakes: 'lots', for: 'cardio EXAM' },
      { title: 'Lost', pancakes: 1, for: 'Nothing' },
    ],
  })}\n\`\`\``;
  const pack = parseSyllabusReply(reply, TODAY);
  assert.deepEqual(pack.deadlines.map((d) => [d.title, d.kind, d.course]), [['Cardio exam', 'exam', 'Clin Med II'], ['Paper', 'other', 'Ethics']]);
  assert.deepEqual(pack.tasks.map((t) => [t.title, t.pancakes]), [['HF lecture', 3], ['Valves', 2]]);
  assert.equal(pack.problems.length, 4);

  const plan = emptyPlan();
  assert.deepEqual(addSyllabus(plan, pack, makeId, TODAY), { dates: 2, work: 2 });
  assert.deepEqual(addSyllabus(plan, pack, makeId, TODAY), { dates: 0, work: 0 }, 'pasting twice adds nothing');
  assert.equal(plan.tasks[0].deadlineId, plan.deadlines[0].id);

  assert.throws(() => parseSyllabusReply('', TODAY), PlanInputError);
  assert.throws(() => parseSyllabusReply('{"deadlines": []}', TODAY), /no dates/);
  assert.throws(() => parseSyllabusReply('no json here', TODAY), /JSON/);
});

test('the syllabus prompt describes a reply the parser reads, and gives today’s date', () => {
  const prompt = buildSyllabusPrompt({ course: 'Clin Med II', today: TODAY });
  assert.ok(prompt.includes(TODAY));
  assert.ok(prompt.includes('Clin Med II'));
  const example = prompt.match(/```json\n([\s\S]+?)```/)![1];
  const pack = parseSyllabusReply(example, '2020-01-01');
  assert.equal(pack.deadlines.length, 1);
  assert.equal(pack.tasks.length, 1);
  assert.deepEqual(pack.problems, []);
});

const ICS = [
  'BEGIN:VCALENDAR',
  'BEGIN:VEVENT', 'UID:exam-1@google.com', 'SUMMARY:Cardio Exam\\, Part 1', 'DTSTART;VALUE=DATE:20261112', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:quiz-1', 'SUMMARY:Pharm Quiz', 'DTSTART;TZID=America/Chicago:20261105T233000', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:utc-1', 'SUMMARY:OSCE', 'DTSTART:20261106T030000Z', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:class-1', 'SUMMARY:Anatomy lecture', 'DTSTART:20261106T150000Z', 'RRULE:FREQ=WEEKLY', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:dentist', 'SUMMARY:Dentist', 'DTSTART;VALUE=DATE:20261120', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:gone', 'SUMMARY:Cancelled exam', 'STATUS:CANCELLED', 'DTSTART;VALUE=DATE:20261121', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:long', 'SUMMARY:A very long', ' name of a paper due', 'DTSTART;VALUE=DATE:20261122', 'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

test('a calendar file gives one-off events on the right day', () => {
  const events = parseIcal(ICS, 'America/Chicago');
  assert.deepEqual(events.map((e) => [e.uid, e.title, e.on, e.kind]), [
    ['exam-1@google.com', 'Cardio Exam, Part 1', '2026-11-12', 'exam'],
    ['quiz-1', 'Pharm Quiz', '2026-11-05', 'quiz'],
    // 3am UTC on the 6th is still the evening of the 5th in Chicago.
    ['utc-1', 'OSCE', '2026-11-05', 'practical'],
    ['dentist', 'Dentist', '2026-11-20', null],
    ['long', 'A very longname of a paper due', '2026-11-22', 'assignment'],
  ]);
  assert.throws(() => parseIcal('<html>not a calendar</html>'), /not-ical/);
});

test('event names suggest what’s worth tracking', () => {
  const cases: [string, string | null][] = [
    ['Final Exam', 'exam'], ['Midterm', 'exam'], ['Cardio test', 'exam'], ['EOR', 'exam'], ['Quiz 3', 'quiz'], ['OSCE', 'practical'], ['H&P practical', 'practical'],
    ['Paper due', 'assignment'], ['SOAP note', 'assignment'], ['Physical exam lab', null], ['Lecture: exams in pregnancy', null], ['Exam review session', null], ['Dinner', null], ['Attest', null],
  ];
  for (const [title, kind] of cases) assert.equal(classifyEvent(title), kind, title);
});

test('only Google’s secret address form is accepted', () => {
  assert.ok(isGoogleIcalUrl('https://calendar.google.com/calendar/ical/me%40gmail.com/private-abc123/basic.ics'));
  for (const bad of [
    'http://calendar.google.com/calendar/ical/a/b/basic.ics',
    'https://calendar.google.com.evil.example/calendar/ical/a/b/basic.ics',
    'https://evil.example/calendar/ical/a/b/basic.ics',
    'https://user:pw@calendar.google.com/calendar/ical/a/b/basic.ics',
    'https://calendar.google.com:8443/calendar/ical/a/b/basic.ics',
    'https://calendar.google.com/calendar/u/0/r',
    'http://169.254.169.254/latest/meta-data',
    '', 42, null,
  ]) assert.ok(!isGoogleIcalUrl(bad), String(bad));
});

const event = (uid: string, on: string, title = 'Cardio exam', kind: 'exam' | null = 'exam') => ({ uid, title, on, kind });
const sync = (plan: PlanData, events: ReturnType<typeof event>[], today = TODAY, checkGone = true) => syncCalendar(plan, events, today, { source: 'url', checkGone }, `${today}T12:00:00.000Z`);

test('the inbox suggests likely events, and a no sticks', () => {
  const plan = emptyPlan();
  sync(plan, [event('a', later(5)), event('b', later(6), 'Dentist', null), event('old', later(-5))]);
  assert.deepEqual(plan.calendar.events.map((e) => e.uid), ['a', 'b'], 'past events aren’t kept');
  assert.deepEqual(calendarInbox(plan).suggested.map((e) => e.uid), ['a']);
  assert.deepEqual(calendarInbox(plan).others.map((e) => e.uid), ['b']);
  ignoreEvent(plan, 'b');
  assert.deepEqual(calendarInbox(plan).others, []);
  const added = acceptEvent(plan, 'a', undefined, makeId)!;
  assert.deepEqual([added.title, added.kind, added.dueOn, added.calendarUid], ['Cardio exam', 'exam', later(5), 'a']);
  assert.deepEqual(calendarInbox(plan).suggested, []);
  acceptEvent(plan, 'a', undefined, makeId);
  assert.equal(plan.deadlines.length, 1, 'accepting twice adds one');
  assert.throws(() => acceptEvent(plan, 'nope', undefined, makeId), /isn’t on your calendar/);
  removeDeadline(plan, added.id);
  sync(plan, [event('a', later(5))]);
  assert.deepEqual(calendarInbox(plan).suggested, [], 'removing it also says no to it');
});

test('a moved exam moves its countdown and work; a cancelled one only gets asked about', () => {
  const plan = emptyPlan();
  sync(plan, [event('a', later(10))]);
  const deadline = acceptEvent(plan, 'a', undefined, makeId)!;
  const task = addTask(plan, { title: 'A', pancakes: 6, deadlineId: deadline.id }, makeId, TODAY);

  sync(plan, [event('a', later(20), 'Cardio final')]);
  assert.deepEqual([deadline.dueOn, deadline.movedFrom, deadline.title], [later(20), later(10), 'Cardio final']);
  assert.equal(total(task), 6);

  sync(plan, []);
  assert.equal(deadline.gone, true);
  assert.equal(plan.deadlines.length, 1, 'never deleted for her');
  assert.equal(total(task), 6);

  sync(plan, [event('a', later(20))]);
  assert.equal(deadline.gone, undefined, 'back on the calendar');

  sync(plan, [], TODAY, false);
  assert.equal(deadline.gone, undefined, 'a one-off file doesn’t count as gone');
  sync(plan, [], later(30));
  assert.equal(deadline.gone, undefined, 'a date already past doesn’t get asked about');

  editDeadline(plan, deadline.id, { dueOn: later(25) }, TODAY);
  assert.equal(deadline.movedFrom, undefined, 'moving it herself needs no notice');
});

const chore = (id: string, assignee: string | null, due: string | null, archivedOn?: string): Chore => ({ id, name: id, emoji: '🧹', color: 1, repeat: null, due, fromDone: false, effort: 1, assignee, notes: '', createdOn: TODAY, ...(archivedOn ? { archivedOn } : {}) });

test('exam-week help moves only her chores due in time, and puts them back', () => {
  const data = emptyChoresData();
  data.chores = [chore('mine', 'her', later(2)), chore('late', 'her', later(9)), chore('his', 'him', later(1)), chore('any', null, later(1)), chore('done', 'her', later(1), TODAY), chore('whenever', 'her', null)];
  const help = startHelp(data, 'her', ['her', 'him'], 'Cardio exam', later(5));
  assert.deepEqual(help.moved, [{ choreId: 'mine', to: 'him' }]);
  const assignee = (id: string) => data.chores.find((c) => c.id === id)?.assignee;
  assert.equal(assignee('mine'), 'him');
  assert.equal(assignee('late'), 'her');
  assert.equal(assignee('done'), 'her');
  endHelp(data, help);
  assert.equal(assignee('mine'), 'her');

  const three = startHelp(data, 'her', ['her', 'him', 'them'], 'Cardio exam', later(5));
  assert.deepEqual(three.moved, [{ choreId: 'mine', to: null }], 'with several others, it goes to anyone');
  data.chores[0].assignee = 'them';
  endHelp(data, three);
  assert.equal(assignee('mine'), 'them', 'someone’s later choice stands');
});

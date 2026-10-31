// The study planner and its pancakes. Every task costs pancakes, a rough size she
// picks, and each uneaten one sits on the day it's planned for. That one idea does
// most of the work: anything on a day before today is the pile, eating takes the
// oldest first, and nothing has to run overnight. Pure, so the server, the browser
// and the tests share it.

import { addDays, daysBetween, isDateKey, type DateKey } from '@/lib/habits/dates';
import { readReply } from './study';

export const DEADLINE_KINDS = ['exam', 'quiz', 'practical', 'assignment', 'other'] as const;
export type DeadlineKind = (typeof DEADLINE_KINDS)[number];
export const KIND_LABEL: Record<DeadlineKind, string> = { exam: 'Exam', quiz: 'Quiz', practical: 'Practical', assignment: 'Due', other: 'Other' };
export const KIND_ICON: Record<DeadlineKind, string> = { exam: '📝', quiz: '✏️', practical: '🩺', assignment: '📌', other: '📅' };

/** Clear days left before the date, so the last days before an exam aren't spent catching up. */
const BUFFER_DAYS: Record<DeadlineKind, number> = { exam: 2, practical: 2, quiz: 1, assignment: 1, other: 0 };

export type Deadline = {
  id: string;
  title: string;
  kind: DeadlineKind;
  course: string;
  dueOn: DateKey;
  /** The calendar event it came from, which keeps its date up to date. */
  calendarUid?: string;
  /** Its event left the calendar. She decides; it's never deleted for her. */
  gone?: boolean;
  /** Where it was before the calendar moved it, until she's seen that. */
  movedFrom?: DateKey;
};

export type PlanTask = {
  id: string;
  title: string;
  deadlineId?: string;
  /** Handing in this test eats the task. */
  testId?: string;
  pancakes: number;
  eaten: number;
  /** Every uneaten pancake, by the day it's planned for. Always adds up to pancakes − eaten. */
  plate: Record<DateKey, number>;
  createdOn: DateKey;
};

export type CalEvent = { uid: string; title: string; on: DateKey; kind: DeadlineKind | null };
export type CalendarState = {
  /** Whether a secret address is saved. The address itself is never in this file. */
  connected: boolean;
  source?: 'url' | 'file';
  lastFetchedAt?: string;
  lastError?: string;
  events: CalEvent[];
  /** Events she's said no to, which aren't suggested again. */
  ignored: string[];
};

export type PlanSettings = {
  /** Days she studies: 0 is Sunday. */
  studyDays: number[];
  /** Roughly how many pancakes a day she can manage. */
  perDay: number;
  timeZone?: string;
};

export type PlanData = {
  deadlines: Deadline[];
  tasks: PlanTask[];
  settings: PlanSettings;
  daysOff: DateKey[];
  eatenOn: Record<DateKey, number>;
  /** Days she cleaned her plate. */
  cleanDays: DateKey[];
  calendar: CalendarState;
};

export class PlanInputError extends Error {}

export const emptyPlan = (): PlanData => ({
  deadlines: [],
  tasks: [],
  settings: { studyDays: [0, 1, 2, 3, 4, 5, 6], perDay: 6 },
  daysOff: [],
  eatenOn: {},
  cleanDays: [],
  calendar: { connected: false, events: [], ignored: [] },
});

export function normalizePlan(raw: Partial<PlanData> | null | undefined): PlanData {
  const empty = emptyPlan();
  return {
    deadlines: Array.isArray(raw?.deadlines) ? raw.deadlines : [],
    tasks: Array.isArray(raw?.tasks) ? raw.tasks : [],
    settings: { ...empty.settings, ...(raw?.settings ?? {}) },
    daysOff: Array.isArray(raw?.daysOff) ? raw.daysOff : [],
    eatenOn: raw?.eatenOn && typeof raw.eatenOn === 'object' ? raw.eatenOn : {},
    cleanDays: Array.isArray(raw?.cleanDays) ? raw.cleanDays : [],
    calendar: { ...empty.calendar, ...(raw?.calendar ?? {}) },
  };
}

const clip = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const MAX_DEADLINES = 500;
const MAX_TASKS = 2000;
export const MAX_PANCAKES = 40;
const sum = (plate: Record<string, number>) => Object.values(plate).reduce((n, v) => n + v, 0);
const weekday = (day: DateKey) => new Date(`${day}T12:00:00Z`).getUTCDay();

export const isStudyDay = (plan: Pick<PlanData, 'settings' | 'daysOff'>, day: DateKey) => plan.settings.studyDays.includes(weekday(day)) && !plan.daysOff.includes(day);

const deadlineOf = (plan: PlanData, task: PlanTask) => plan.deadlines.find((d) => d.id === task.deadlineId);

/** Past its deadline, a task's leftovers leave the stack: no debt outlives what it was for. */
export function isLive(plan: PlanData, task: PlanTask, today: DateKey) {
  if (task.eaten >= task.pancakes) return false;
  if (!task.deadlineId) return true;
  const deadline = deadlineOf(plan, task);
  return !!deadline && deadline.dueOn >= today;
}

// ── Placing pancakes ─────────────────────────────────────────────────────────

/** Everything planned for each day, for keeping the load level. */
function dayLoads(plan: PlanData, today: DateKey) {
  const loads = new Map<DateKey, number>();
  for (const task of plan.tasks) {
    if (!isLive(plan, task, today)) continue;
    for (const [day, n] of Object.entries(task.plate)) loads.set(day, (loads.get(day) ?? 0) + n);
  }
  return loads;
}

function studyDaysIn(plan: PlanData, from: DateKey, to: DateKey) {
  const days: DateKey[] = [];
  for (let d = from; d <= to && days.length < 800; d = addDays(d, 1)) if (isStudyDay(plan, d)) days.push(d);
  return days;
}

/** The last day worth planning work toward a deadline. */
export const lastWorkDay = (deadline: Pick<Deadline, 'dueOn' | 'kind'>) => addDays(deadline.dueOn, -BUFFER_DAYS[deadline.kind]);

/** With no date to aim for, work lands in the next fortnight. */
const OPEN_ENDED_DAYS = 13;

/** The days to spread onto, giving up the clear days and then the rules if time has run out. */
function candidateDays(plan: PlanData, deadline: Deadline | undefined, from: DateKey) {
  if (!deadline) return studyDaysIn(plan, from, addDays(from, OPEN_ENDED_DAYS));
  const options = [studyDaysIn(plan, from, lastWorkDay(deadline)), studyDaysIn(plan, from, addDays(deadline.dueOn, -1)), studyDaysIn(plan, from, deadline.dueOn)];
  return options.find((days) => days.length) ?? [];
}

/** Put `count` pancakes on the emptiest days available, spaced out across them and starting from the first. */
function place(plan: PlanData, task: PlanTask, count: number, from: DateKey, today: DateKey) {
  if (count <= 0) return;
  const days = candidateDays(plan, deadlineOf(plan, task), from);
  const loads = dayLoads(plan, today);
  // No study day left at all: it goes on the first day it can, so it's never lost.
  const choices = days.length ? days : [from];
  for (let i = 0; i < count; i++) {
    const target = Math.floor((i * choices.length) / count);
    let best = 0;
    for (let d = 1; d < choices.length; d++) {
      const lighter = (loads.get(choices[d]) ?? 0) - (loads.get(choices[best]) ?? 0);
      if (lighter < 0 || (lighter === 0 && Math.abs(d - target) < Math.abs(best - target))) best = d;
    }
    const day = choices[best];
    task.plate[day] = (task.plate[day] ?? 0) + 1;
    loads.set(day, (loads.get(day) ?? 0) + 1);
  }
}

/** Take a task's pancakes planned from `from` on, and spread them again. Its pile stays. */
function replanUpcoming(plan: PlanData, task: PlanTask, today: DateKey) {
  let moved = 0;
  for (const [day, n] of Object.entries(task.plate)) {
    if (day < today) continue;
    moved += n;
    delete task.plate[day];
  }
  place(plan, task, moved, today, today);
}

// ── Deadlines and tasks ──────────────────────────────────────────────────────

const readKind = (value: unknown): DeadlineKind => (DEADLINE_KINDS.includes(value as DeadlineKind) ? (value as DeadlineKind) : 'other');

export function addDeadline(plan: PlanData, input: { title?: unknown; kind?: unknown; course?: unknown; dueOn?: unknown; calendarUid?: string }, makeId: () => string) {
  const title = clip(input.title, 120);
  if (!title) throw new PlanInputError('Give it a name.');
  if (!isDateKey(input.dueOn)) throw new PlanInputError('Pick a date.');
  if (plan.deadlines.length >= MAX_DEADLINES) throw new PlanInputError('That’s as many dates as one account can keep.');
  const deadline: Deadline = { id: makeId(), title, kind: readKind(input.kind), course: clip(input.course, 80), dueOn: input.dueOn, ...(input.calendarUid ? { calendarUid: input.calendarUid } : {}) };
  plan.deadlines.push(deadline);
  return deadline;
}

export function editDeadline(plan: PlanData, id: unknown, input: { title?: unknown; kind?: unknown; course?: unknown; dueOn?: unknown }, today: DateKey) {
  const deadline = plan.deadlines.find((d) => d.id === id);
  if (!deadline) throw new PlanInputError('That date isn’t here any more.');
  if (typeof input.title === 'string') {
    const title = clip(input.title, 120);
    if (!title) throw new PlanInputError('Give it a name.');
    deadline.title = title;
  }
  if (input.kind !== undefined) deadline.kind = readKind(input.kind);
  if (typeof input.course === 'string') deadline.course = clip(input.course, 80);
  if (input.dueOn !== undefined) {
    if (!isDateKey(input.dueOn)) throw new PlanInputError('Pick a date.');
    moveDeadline(plan, deadline, input.dueOn, today);
    delete deadline.movedFrom;
  }
  delete deadline.gone;
  return deadline;
}

function moveDeadline(plan: PlanData, deadline: Deadline, dueOn: DateKey, today: DateKey) {
  if (deadline.dueOn === dueOn) return;
  deadline.dueOn = dueOn;
  for (const task of plan.tasks) if (task.deadlineId === deadline.id) replanUpcoming(plan, task, today);
}

/** A date goes, along with the work planned for it. Its calendar event isn't suggested again. */
export function removeDeadline(plan: PlanData, id: unknown) {
  const deadline = plan.deadlines.find((d) => d.id === id);
  if (!deadline) return;
  plan.deadlines = plan.deadlines.filter((d) => d !== deadline);
  plan.tasks = plan.tasks.filter((t) => t.deadlineId !== id);
  if (deadline.calendarUid && !plan.calendar.ignored.includes(deadline.calendarUid)) plan.calendar.ignored.push(deadline.calendarUid);
}

const readSize = (value: unknown) => {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < 1) throw new PlanInputError('Pick how many pancakes it’s worth.');
  return Math.min(n, MAX_PANCAKES);
};

export function addTask(plan: PlanData, input: { title?: unknown; pancakes?: unknown; deadlineId?: unknown; testId?: unknown }, makeId: () => string, today: DateKey) {
  const title = clip(input.title, 160);
  if (!title) throw new PlanInputError('Say what the work is.');
  if (plan.tasks.length >= MAX_TASKS) throw new PlanInputError('That’s as many tasks as one account can keep.');
  const deadline = plan.deadlines.find((d) => d.id === input.deadlineId);
  const pancakes = readSize(input.pancakes);
  const task: PlanTask = {
    id: makeId(), title, pancakes, eaten: 0, plate: {}, createdOn: today,
    ...(deadline ? { deadlineId: deadline.id } : {}),
    ...(typeof input.testId === 'string' && input.testId ? { testId: input.testId.slice(0, 64) } : {}),
  };
  plan.tasks.push(task);
  place(plan, task, pancakes, today, today);
  return task;
}

/** Change a task's name or size. Growing spreads the extra out; shrinking takes from the far end. */
export function editTask(plan: PlanData, id: unknown, input: { title?: unknown; pancakes?: unknown }, today: DateKey) {
  const task = plan.tasks.find((t) => t.id === id);
  if (!task) throw new PlanInputError('That task isn’t here any more.');
  if (typeof input.title === 'string') {
    const title = clip(input.title, 160);
    if (!title) throw new PlanInputError('Say what the work is.');
    task.title = title;
  }
  if (input.pancakes !== undefined) {
    const size = Math.max(readSize(input.pancakes), task.eaten);
    const change = size - task.pancakes;
    task.pancakes = size;
    if (change > 0) place(plan, task, change, today, today);
    let extra = -change;
    for (const day of Object.keys(task.plate).sort().reverse()) {
      if (extra <= 0) break;
      const take = Math.min(extra, task.plate[day]);
      task.plate[day] -= take;
      extra -= take;
      if (!task.plate[day]) delete task.plate[day];
    }
  }
  return task;
}

export function removeTask(plan: PlanData, id: unknown) {
  plan.tasks = plan.tasks.filter((t) => t.id !== id);
}

// ── Eating ───────────────────────────────────────────────────────────────────

/** Eat one, oldest first, so the pile goes down before today's. */
export function eat(plan: PlanData, id: unknown, today: DateKey, count = 1) {
  const task = plan.tasks.find((t) => t.id === id);
  if (!task) throw new PlanInputError('That task isn’t here any more.');
  let eaten = 0;
  for (const day of Object.keys(task.plate).sort()) {
    while (task.plate[day] > 0 && eaten < count) {
      task.plate[day]--;
      eaten++;
    }
    if (!task.plate[day]) delete task.plate[day];
    if (eaten >= count) break;
  }
  task.eaten += eaten;
  if (eaten) plan.eatenOn[today] = (plan.eatenOn[today] ?? 0) + eaten;
  return eaten;
}

/** Put one back, on today's plate. */
export function uneat(plan: PlanData, id: unknown, today: DateKey) {
  const task = plan.tasks.find((t) => t.id === id);
  if (!task) throw new PlanInputError('That task isn’t here any more.');
  if (task.eaten <= 0) return;
  task.eaten--;
  task.plate[today] = (task.plate[today] ?? 0) + 1;
  if (plan.eatenOn[today]) {
    plan.eatenOn[today]--;
    if (!plan.eatenOn[today]) delete plan.eatenOn[today];
  }
}

/** Handing in a test eats whatever's left of the tasks tied to it. */
export function eatTest(plan: PlanData, testId: string, today: DateKey) {
  let eaten = 0;
  for (const task of plan.tasks) if (task.testId === testId && task.eaten < task.pancakes) eaten += eat(plan, task.id, today, task.pancakes - task.eaten);
  return eaten;
}

/** Reviews due today cost a pancake per this many. They're counted, not stored: the miss bank already keeps them. */
const REVIEWS_PER_PANCAKE = 20;
export const reviewPancakes = (due: number) => (due > 0 ? Math.ceil(due / REVIEWS_PER_PANCAKE) : 0);

export type PlateItem = { task: PlanTask; deadline?: Deadline; pile: number; today: number };
export type PlateView = {
  items: PlateItem[];
  pile: number;
  today: number;
  reviews: number;
  /** Everything on the plate now, reviews included. */
  total: number;
  eatenToday: number;
  /** 0 is fresh; each step is more wobbly and colder. */
  cold: 0 | 1 | 2 | 3;
  clean: boolean;
  dayOff: boolean;
};

export function plateView(plan: PlanData, today: DateKey, reviewsDue: number): PlateView {
  const items: PlateItem[] = [];
  let oldest: DateKey | null = null;
  for (const task of plan.tasks) {
    if (!isLive(plan, task, today)) continue;
    let pile = 0;
    for (const [day, n] of Object.entries(task.plate)) {
      if (day >= today) continue;
      pile += n;
      if (n > 0 && (!oldest || day < oldest)) oldest = day;
    }
    const now = task.plate[today] ?? 0;
    if (pile + now > 0) items.push({ task, deadline: deadlineOf(plan, task), pile, today: now });
  }
  items.sort((a, b) => b.pile - a.pile || (a.deadline?.dueOn ?? '9').localeCompare(b.deadline?.dueOn ?? '9'));
  const pile = items.reduce((n, i) => n + i.pile, 0);
  const onToday = items.reduce((n, i) => n + i.today, 0);
  const reviews = reviewPancakes(reviewsDue);
  const age = oldest ? daysBetween(oldest, today) : 0;
  return {
    items,
    pile,
    today: onToday,
    reviews,
    total: pile + onToday + reviews,
    eatenToday: plan.eatenOn[today] ?? 0,
    cold: !pile ? 0 : age >= 5 ? 3 : age >= 3 ? 2 : 1,
    clean: plan.cleanDays.includes(today),
    dayOff: plan.daysOff.includes(today),
  };
}

/** After eating or reviewing: a day with something done and nothing left is a clean plate. */
export function noteClean(plan: PlanData, today: DateKey, reviewsDue: number, reviewedToday: boolean) {
  const view = plateView(plan, today, reviewsDue);
  const clean = view.total === 0 && (view.eatenToday > 0 || reviewedToday);
  const had = plan.cleanDays.includes(today);
  if (clean && !had) plan.cleanDays.push(today);
  if (!clean && had) plan.cleanDays = plan.cleanDays.filter((d) => d !== today);
  return clean && !had;
}

/**
 * Clean plates in a row. Only a day still holding pancakes breaks it: days off,
 * days with nothing planned and spread-out piles don't, so catching up is always
 * worth doing and the streak can't be lost to a sick day.
 */
export function cleanStreak(plan: PlanData, today: DateKey) {
  const left = new Set<DateKey>();
  for (const task of plan.tasks) {
    if (!isLive(plan, task, today)) continue;
    for (const [day, n] of Object.entries(task.plate)) if (n > 0 && day < today) left.add(day);
  }
  const clean = new Set(plan.cleanDays);
  let streak = 0;
  for (let day = today, i = 0; i < 730; i++, day = addDays(day, -1)) {
    if (day < today && left.has(day)) break;
    if (clean.has(day)) streak++;
  }
  return streak;
}

// ── Limits on the pile ───────────────────────────────────────────────────────

/** One tap: everything left over goes back out over the coming days. */
export function spreadPile(plan: PlanData, today: DateKey) {
  let moved = 0;
  for (const task of plan.tasks) {
    if (!isLive(plan, task, today)) continue;
    let count = 0;
    for (const [day, n] of Object.entries(task.plate)) {
      if (day >= today) continue;
      count += n;
      delete task.plate[day];
    }
    place(plan, task, count, today, today);
    moved += count;
  }
  return moved;
}

/** A day off moves that day's pancakes along, so it doesn't add to the pile. Taking it back moves nothing. */
export function setDayOff(plan: PlanData, day: unknown, on: boolean, today: DateKey) {
  if (!isDateKey(day)) throw new PlanInputError('Pick a day.');
  if (!on) {
    plan.daysOff = plan.daysOff.filter((d) => d !== day);
    return;
  }
  if (!plan.daysOff.includes(day)) plan.daysOff.push(day);
  const from = day >= today ? addDays(day, 1) : today;
  for (const task of plan.tasks) {
    const n = task.plate[day];
    if (!n) continue;
    delete task.plate[day];
    if (isLive(plan, task, today)) place(plan, task, n, from, today);
    else task.plate[from] = (task.plate[from] ?? 0) + n;
  }
}

/** Save her week. Pancakes on a day she no longer studies move to one she does. */
export function saveSettings(plan: PlanData, input: { studyDays?: unknown; perDay?: unknown; timeZone?: unknown }, today: DateKey) {
  if (Array.isArray(input.studyDays)) {
    const days = [0, 1, 2, 3, 4, 5, 6].filter((d) => (input.studyDays as unknown[]).includes(d));
    if (!days.length) throw new PlanInputError('Pick at least one study day.');
    plan.settings.studyDays = days;
  }
  if (input.perDay !== undefined) {
    const perDay = Math.round(Number(input.perDay));
    if (!Number.isFinite(perDay) || perDay < 1 || perDay > 40) throw new PlanInputError('Pick a number from 1 to 40.');
    plan.settings.perDay = perDay;
  }
  if (typeof input.timeZone === 'string' && input.timeZone.length < 60) plan.settings.timeZone = input.timeZone;
  for (const task of plan.tasks) {
    if (!isLive(plan, task, today)) continue;
    let moved = 0;
    for (const [day, n] of Object.entries(task.plate)) {
      if (day < today || isStudyDay(plan, day)) continue;
      moved += n;
      delete task.plate[day];
    }
    place(plan, task, moved, today, today);
  }
}

/** Her real pace: pancakes per study day over the last fortnight, once there's enough to go on. */
export function recentPace(plan: PlanData, today: DateKey) {
  const days = studyDaysIn(plan, addDays(today, -14), addDays(today, -1));
  const worked = days.filter((d) => plan.eatenOn[d]);
  if (worked.length < 3) return null;
  return days.reduce((n, d) => n + (plan.eatenOn[d] ?? 0), 0) / days.length;
}

export type DeadlineView = {
  deadline: Deadline;
  daysLeft: number;
  tasks: PlanTask[];
  pancakes: number;
  eaten: number;
  left: number;
  /** Pancakes a day needed for this and everything due before it. */
  needPerDay: number | null;
  /** "needs 4 a day and you planned 3", while there's still time to change it. */
  tooMuch: boolean;
  /** "At this pace you'll finish 2 days late." */
  daysLate: number | null;
};

/** Upcoming dates, soonest first, with the early warning and pace check for each. */
export function upcoming(plan: PlanData, today: DateKey): DeadlineView[] {
  const pace = recentPace(plan, today);
  const dated = plan.deadlines.filter((d) => d.dueOn >= today).sort((a, b) => a.dueOn.localeCompare(b.dueOn));
  let running = 0;
  return dated.map((deadline) => {
    const tasks = plan.tasks.filter((t) => t.deadlineId === deadline.id);
    const pancakes = tasks.reduce((n, t) => n + t.pancakes, 0);
    const eaten = tasks.reduce((n, t) => n + t.eaten, 0);
    const left = pancakes - eaten;
    running += left;
    const studyDays = candidateDays(plan, deadline, today).length;
    const needPerDay = left > 0 ? running / Math.max(1, studyDays) : null;
    let daysLate: number | null = null;
    if (left > 0 && pace !== null && pace > 0) {
      // Walk her study days at her real pace until everything up to here is eaten.
      let remaining = running;
      let day = today;
      for (let i = 0; i < 800 && remaining > 0; i++, day = addDays(day, 1)) if (isStudyDay(plan, day)) remaining -= pace;
      const finishedOn = addDays(day, -1);
      const late = daysBetween(deadline.dueOn, finishedOn);
      if (late > 0) daysLate = late;
    }
    return {
      deadline, tasks, pancakes, eaten, left,
      daysLeft: daysBetween(today, deadline.dueOn),
      needPerDay,
      tooMuch: needPerDay !== null && needPerDay > plan.settings.perDay,
      daysLate,
    };
  });
}

/** Work with no date, still waiting. */
export const openTasks = (plan: PlanData, today: DateKey) => plan.tasks.filter((t) => !t.deadlineId && isLive(plan, t, today));

/** What each day looks like, for the calendar. */
export function dayPlan(plan: PlanData, day: DateKey, today: DateKey) {
  return {
    day,
    deadlines: plan.deadlines.filter((d) => d.dueOn === day),
    items: plan.tasks.flatMap((task) => {
      const n = task.plate[day] ?? 0;
      return n > 0 && isLive(plan, task, today) ? [{ task, count: n, deadline: deadlineOf(plan, task) }] : [];
    }),
    eaten: plan.eatenOn[day] ?? 0,
    off: plan.daysOff.includes(day),
    studyDay: plan.settings.studyDays.includes(weekday(day)),
    clean: plan.cleanDays.includes(day),
  };
}

// ── From a syllabus ──────────────────────────────────────────────────────────

export type SyllabusPack = {
  deadlines: { title: string; kind: DeadlineKind; course: string; dueOn: DateKey }[];
  tasks: { title: string; pancakes: number; forDeadline: string }[];
  problems: string[];
};

/** Dates and work from an AI's reply. Only a reply with nothing usable is an error. */
export function parseSyllabusReply(text: string, today: DateKey): SyllabusPack {
  if (typeof text !== 'string' || !text.trim()) throw new PlanInputError('Paste the AI’s reply first.');
  let value: unknown;
  try {
    ({ value } = readReply(text));
  } catch (error) {
    throw new PlanInputError(error instanceof Error ? error.message : 'That couldn’t be read.');
  }
  const root = (value && typeof value === 'object' && !Array.isArray(value) ? value : { deadlines: value }) as Record<string, unknown>;
  const list = Array.isArray(root.deadlines) ? root.deadlines : [];
  const course = clip(root.course, 80);
  const problems: string[] = [];
  const deadlines: SyllabusPack['deadlines'] = [];
  list.slice(0, 200).forEach((raw: any, i) => {
    const title = clip(raw?.title, 120);
    const dueOn = raw?.dueOn ?? raw?.date;
    if (!title) { problems.push(`Date ${i + 1}: it has no name.`); return; }
    if (!isDateKey(dueOn)) { problems.push(`${title}: "${String(dueOn).slice(0, 20)}" isn’t a date like 2026-11-05.`); return; }
    if (dueOn < today) { problems.push(`${title}: it’s already past.`); return; }
    deadlines.push({ title, kind: readKind(raw?.kind), course: clip(raw?.course, 80) || course, dueOn });
  });
  const names = new Set(deadlines.map((d) => d.title.toLowerCase()));
  const tasks: SyllabusPack['tasks'] = [];
  (Array.isArray(root.tasks) ? root.tasks : []).slice(0, 400).forEach((raw: any) => {
    const title = clip(raw?.title, 160);
    const forDeadline = clip(raw?.for ?? raw?.deadline, 120);
    const size = Math.round(Number(raw?.pancakes));
    if (!title) return;
    if (!names.has(forDeadline.toLowerCase())) { problems.push(`${title}: "${forDeadline.slice(0, 60)}" isn’t one of the dates.`); return; }
    tasks.push({ title, forDeadline, pancakes: Number.isFinite(size) && size >= 1 ? Math.min(size, MAX_PANCAKES) : 2 });
  });
  if (!deadlines.length) throw new PlanInputError(problems.length ? `None of those dates could be used. ${problems.slice(0, 3).join(' ')}` : 'That reply has no dates in it.');
  return { deadlines, tasks, problems };
}

/** Add what a syllabus gave, skipping anything already here. */
export function addSyllabus(plan: PlanData, pack: SyllabusPack, makeId: () => string, today: DateKey) {
  let dates = 0;
  let work = 0;
  const byTitle = new Map<string, Deadline>();
  for (const d of pack.deadlines) {
    const same = plan.deadlines.find((x) => x.title.toLowerCase() === d.title.toLowerCase() && x.dueOn === d.dueOn);
    const deadline = same ?? addDeadline(plan, d, makeId);
    if (!same) dates++;
    byTitle.set(d.title.toLowerCase(), deadline);
  }
  for (const t of pack.tasks) {
    const deadline = byTitle.get(t.forDeadline.toLowerCase());
    if (!deadline || plan.tasks.some((x) => x.deadlineId === deadline.id && x.title.toLowerCase() === t.title.toLowerCase())) continue;
    addTask(plan, { title: t.title, pancakes: t.pancakes, deadlineId: deadline.id }, makeId, today);
    work++;
  }
  return { dates, work };
}

// ── From a calendar ──────────────────────────────────────────────────────────

/** Bring saved dates into line with the calendar. A moved exam moves its work; one that's gone only gets asked about. */
export function syncCalendar(plan: PlanData, events: CalEvent[], today: DateKey, options: { source: 'url' | 'file'; checkGone: boolean }, now: string) {
  plan.calendar.events = events.filter((e) => e.on >= today).sort((a, b) => a.on.localeCompare(b.on)).slice(0, 500);
  plan.calendar.lastFetchedAt = now;
  plan.calendar.source = options.source;
  delete plan.calendar.lastError;
  const byUid = new Map(events.map((e) => [e.uid, e]));
  for (const deadline of plan.deadlines) {
    if (!deadline.calendarUid) continue;
    const event = byUid.get(deadline.calendarUid);
    if (event) {
      delete deadline.gone;
      deadline.title = event.title.slice(0, 120);
      if (event.on !== deadline.dueOn) {
        const was = deadline.dueOn;
        moveDeadline(plan, deadline, event.on, today);
        deadline.movedFrom = was;
      }
    } else if (options.checkGone && deadline.dueOn >= today) {
      deadline.gone = true;
    }
  }
}

/** Calendar events not decided on yet: ones whose names suggest a date worth tracking, and the rest. */
export function calendarInbox(plan: PlanData) {
  const taken = new Set(plan.deadlines.flatMap((d) => (d.calendarUid ? [d.calendarUid] : [])));
  const waiting = plan.calendar.events.filter((e) => !taken.has(e.uid) && !plan.calendar.ignored.includes(e.uid));
  return { suggested: waiting.filter((e) => e.kind), others: waiting.filter((e) => !e.kind) };
}

export function acceptEvent(plan: PlanData, uid: unknown, kind: unknown, makeId: () => string) {
  const event = plan.calendar.events.find((e) => e.uid === uid);
  if (!event) throw new PlanInputError('That event isn’t on your calendar any more.');
  if (plan.deadlines.some((d) => d.calendarUid === event.uid)) return;
  return addDeadline(plan, { title: event.title, kind: kind ?? event.kind ?? 'other', dueOn: event.on, calendarUid: event.uid }, makeId);
}

export function ignoreEvent(plan: PlanData, uid: unknown) {
  if (typeof uid === 'string' && !plan.calendar.ignored.includes(uid)) plan.calendar.ignored.push(uid.slice(0, 300));
}

import test from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { addDays } from '../habits/dates';
import {
  addInquiry, addProjectLog, addResource, addScheduleTask, addStep, addSubject, addTopic, answerGraded, applyInquiryAnswers,
  applyInterconnectedPlan, applySkillEdit, editInquiry, editProjectLog, editResource, editStep, importInquiries, importPlan,
  importQuestions, itemFeedback, moveStep, parseRunningInquiryList, promoteInquiryToCard, rateCard, rateTopics,
  rebuildScheduleFromSteps, removeInquiry, removeProjectLog, removeScheduleTask, removeStep, removeSubject, removeTopic,
  saveCard, setParents, setSchedule, shiftSchedule, SkillsInputError, toggleInquiry, toggleScheduleTask, toggleStep,
} from './edit';
import { buildKnowledgeGraph } from './links';
import {
  boardSummary, buildQueue, expectedScore, fadedLevel, fitLevel, freeResourceSearchLinks, generateScheduleFromSteps, gradedScore,
  itemSearchText, levelHistory, nextSchedule, nextSteps, parentSkillsOf, retentionAfter, scheduleByDay, shiftScheduleToToday,
  stabilityDays, stepProgress, subjectStats, subskillsOf, summarizeAnswer, tierOf, wouldCreateSkillCycle,
} from './model';
import {
  LIMITS, deckTagCounts, extractInquirySearchTerms, filterAndSortInquiries, formatInquiriesMarkdown, parseBulkQAInput,
  parseInquiryReply, parseInterconnectedPlanReply, parsePlanReply, parseQuestionsReply,
} from './parse';
import { buildInquiryPrompt, buildInterconnectedPlanPrompt, buildPlanPrompt, buildQuestionsPrompt } from './prompts';
import { readSkills, updateSkills } from './store';
import { FRESH_TARGET, WEEKLY_CAP, topUpRequest } from './topup';
import { SKILLS_XP, reviewDays, skillsXp } from './xp';
import { emptyProgress, emptySkills, type ProgressData, type SkillSchedule, type SkillsData, type Subject } from './types';

const TODAY = '2026-11-12';
const NOW = `${TODAY}T15:00:00.000Z`;
let counter = 0;
const makeId = () => `id${++counter}`;

function setup() {
  const data: SkillsData = emptySkills();
  const progress: ProgressData = emptyProgress();
  const subject = addSubject(data, { name: 'Rocket propulsion', area: 'Aerospace', target: 4 }, makeId, NOW);
  const basics = addTopic(subject, { name: 'Rocket equation', stage: 1 }, makeId, NOW);
  const nozzles = addTopic(subject, { name: 'Nozzle flow', stage: 2 }, makeId, NOW);
  return { data, progress, subject, basics, nozzles };
}

const GRADED_REPLY = JSON.stringify({
  questions: [
    {
      type: 'graded', topic: 'Rocket equation', difficulty: 2, title: 'Delta-v', prompt: 'Isp 300 s, mass ratio $e$. Find $\\Delta v$.',
      parts: [{ id: 'a', answer: { type: 'numeric', value: 2942, unit: 'm/s', tolerance: 0.02 } }],
      solution: '$\\Delta v = I_{sp} g_0 \\ln(e) = 2942$ m/s', sources: [{ title: 'Sutton, Rocket Propulsion Elements', detail: 'Ch. 4' }],
    },
    { type: 'card', topic: 'nozzle flow', front: 'Why is a nozzle convergent-divergent?', back: 'To accelerate flow past Mach 1 at the throat.' },
    { type: 'graded', topic: 'Orbital mechanics', difficulty: 3, title: 'Wrong topic', prompt: 'x', parts: [{ id: 'a', answer: { type: 'numeric', value: 1 } }], solution: 'x' },
  ],
});

test('the level model behaves', () => {
  assert.ok(Math.abs(expectedScore(3, 3) - 0.7) < 0.01);
  assert.equal(fitLevel(0, []), 0);
  assert.equal(fitLevel(2, []), 2);
  // Getting hard questions right raises the level; missing easy ones lowers it.
  const up = fitLevel(1, [{ score: 1, difficulty: 4 }, { score: 1, difficulty: 4 }, { score: 1, difficulty: 4 }]);
  assert.ok(up > 2.5, `expected a big rise, got ${up}`);
  const down = fitLevel(4, [{ score: 0, difficulty: 1 }, { score: 0, difficulty: 2 }]);
  assert.ok(down < 3, `expected a drop, got ${down}`);
  assert.ok(fitLevel(5, Array(30).fill({ score: 1, difficulty: 5 })) <= 5);
  assert.equal(gradedScore(1, 1), 1);
  assert.equal(gradedScore(1, 2, 1, 0), 0.5);
  assert.equal(gradedScore(1, 1, 1, 0, true), 0);
  assert.ok(gradedScore(1, 1, 2, 1) < 1);
  // Fading slides toward half, never below.
  assert.equal(fadedLevel(4, 1), 4);
  assert.equal(fadedLevel(4, 0), 2);
  assert.ok(retentionAfter(365, stabilityDays(0)) < 0.01);
  assert.ok(retentionAfter(30, stabilityDays(8)) > 0.9);
});

test('scheduling grows on success and resets on failure', () => {
  let s = nextSchedule(undefined, 1, TODAY);
  assert.equal(s.interval, 2);
  assert.equal(s.due, addDays(TODAY, 2));
  s = nextSchedule(s, 1, s.due);
  assert.equal(s.interval, 6);
  s = nextSchedule(s, 0.9, s.due);
  assert.equal(s.interval, 15);
  const failed = nextSchedule(s, 0, s.due);
  assert.equal(failed.interval, 1);
  assert.equal(failed.reps, 0);
  assert.equal(failed.lapses, 1);
  assert.ok(failed.ease < s.ease);
  assert.equal(nextSchedule(undefined, 1, TODAY, 'easy').interval, 4);
  assert.ok(nextSchedule(undefined, 0.5, TODAY).interval >= 1);
  // Rating 'hard' on a 1-day interval advances to 2 days instead of looping forever at 1.
  const hardFromNew = nextSchedule(undefined, 0.5, TODAY, 'hard');
  assert.equal(hardFromNew.interval, 2);
  const hardFromOne = nextSchedule({ due: TODAY, interval: 1, ease: 2.5, reps: 0, lapses: 1, last: TODAY }, 0.5, TODAY, 'hard');
  assert.equal(hardFromOne.interval, 2);
});

test('subjects, topics and resources are edited safely', () => {
  const { data, subject, basics } = setup();
  assert.throws(() => addSubject(data, { name: 'rocket  PROPULSION' }, makeId, NOW), SkillsInputError);
  assert.throws(() => addTopic(subject, { name: 'Rocket Equation' }, makeId, NOW), SkillsInputError);
  const book = addResource(subject, { title: 'Rocket Propulsion Elements', kind: 'book', topicIds: [basics.id, 'nope'], progress: { done: 50, total: 700, unit: 'pages' } }, makeId, TODAY, NOW);
  assert.deepEqual(book.topicIds, [basics.id]);
  assert.equal(book.status, 'planned');
  editResource(subject, book, { status: 'done' }, TODAY, NOW);
  assert.equal(book.finishedOn, TODAY);
  assert.equal(book.progress?.done, 700);
  rateTopics(subject, { [basics.id]: 3.3, other: 2 }, TODAY, NOW);
  assert.equal(basics.selfRating, 3.5);
  assert.equal(basics.selfRatedOn, TODAY);
  rateTopics(subject, { [basics.id]: null }, TODAY, NOW);
  assert.equal(basics.selfRating, undefined);
});

test('a plan reply is read and imported without doubling', () => {
  const { subject, basics } = setup();
  const reply = '```json\n' + JSON.stringify({
    summary: 'Start with the equation.',
    roadmap: '## Phase 1\n- read',
    topics: [
      { key: 't1', name: 'Rocket equation', stage: 1 },
      { key: 't2', name: 'Combustion chemistry', stage: 'core', core: false, description: 'Flame temperature, products' },
    ],
    resources: [
      { kind: 'Textbook', title: 'Rocket Propulsion Elements', author: 'Sutton', topics: ['t1', 't2'], hours: 40, url: 'not a url' },
      { kind: 'project', title: 'Build a thrust stand', detail: 'Measure a model motor', topics: ['Nozzle flow'] },
    ],
  }, null, 2) + ',\n```';
  const plan = parsePlanReply(reply, subject);
  assert.equal(plan.topics.length, 2);
  assert.equal(plan.topics[0].existingId, basics.id);
  assert.equal(plan.topics[1].stage, 2);
  assert.equal(plan.topics[1].core, false);
  assert.equal(plan.resources[0].kind, 'book');
  assert.equal(plan.resources[0].url, undefined);
  assert.deepEqual(plan.resources[1].topicKeys, [`existing:${subject.topics[1].id}`]);

  const result = importPlan(subject, reply, {}, makeId, NOW);
  assert.deepEqual(result, { topics: 1, resources: 2, roadmap: true });
  assert.equal(subject.topics.length, 3);
  const combustion = subject.topics.find((t) => t.name === 'Combustion chemistry')!;
  assert.deepEqual(subject.resources[0].topicIds, [basics.id, combustion.id]);
  assert.equal(subject.roadmap, '## Phase 1\n- read');
  // Again: everything is already there.
  assert.deepEqual(importPlan(subject, reply, {}, makeId, NOW), { topics: 0, resources: 0, roadmap: true });
  assert.throws(() => parsePlanReply('no json here', subject), SkillsInputError);
});

test('question replies are validated one by one', () => {
  const { subject, basics, nozzles } = setup();
  const parsed = parseQuestionsReply(GRADED_REPLY, subject);
  assert.equal(parsed.questions.length, 3);
  const [graded, card, bad] = parsed.questions;
  assert.ok(graded.ok && graded.item.kind === 'graded' && graded.item.topicId === basics.id);
  assert.ok(card.ok && card.item.kind === 'card' && card.item.topicId === nozzles.id && card.item.difficulty === 2);
  assert.ok(!bad.ok && bad.errors[0].includes('Orbital mechanics'));
  // With a fallback topic, a stray topic name lands there with a warning.
  const fallback = parseQuestionsReply(GRADED_REPLY, subject, { fallbackTopicId: nozzles.id }).questions[2];
  assert.ok(fallback.ok && fallback.item.topicId === nozzles.id && fallback.warning);
  // Slips with one sensible reading are forgiven: an empty unit, a percent tolerance, no part id.
  const slips = parseQuestionsReply(JSON.stringify({ questions: [{ type: 'graded', topic: 'Rocket equation', difficulty: 2, title: 'Ratio', prompt: 'Mass ratio?', parts: [{ answer: { type: 'numeric', value: 2.7, unit: '', tolerance: 2 } }], solution: 'e', sources: [{ title: 'x' }] }] }), subject);
  const slip = slips.questions[0];
  assert.ok(slip.ok && slip.item.kind === 'graded', JSON.stringify(slip));
  assert.deepEqual(slip.item.question.parts[0], { id: 'a', answer: { type: 'numeric', value: 2.7, tolerance: 0.02 } });
  // A missing source is filled in with a warning to double-check, not refused.
  assert.ok(fallback.ok && fallback.item.kind === 'graded' && fallback.item.question.sources[0].title.startsWith('No source'));
});

test('answering, scheduling, feedback and the queue', () => {
  const { data, progress, subject, basics } = setup();
  const result = importQuestions(subject, GRADED_REPLY, {}, makeId, NOW);
  assert.deepEqual(result, { added: 2, failed: 1 });
  const graded = subject.items.find((i) => i.kind === 'graded')!;
  const card = subject.items.find((i) => i.kind === 'card')!;
  assert.equal(graded.kind === 'graded' && graded.question.id, graded.id);

  // Both are new, so they're in today's queue.
  assert.equal(buildQueue(data, progress, TODAY).length, 2);

  // A wrong check with tries left saves nothing.
  const first = answerGraded(subject, graded, progress, { responses: { a: { type: 'numeric', value: 100 } }, tries: 0 }, makeId, TODAY, NOW);
  assert.equal(first.final, false);
  assert.equal(progress.attempts.length, 0);
  // Right on the second check.
  const second = answerGraded(subject, graded, progress, { responses: { a: { type: 'numeric', value: 2950 } }, tries: 1 }, makeId, TODAY, NOW);
  assert.ok(second.final);
  assert.equal(progress.attempts[0].score, 0.85);
  assert.ok(progress.schedule[graded.id].due > TODAY);
  assert.throws(() => answerGraded(subject, graded, progress, { responses: {} }, makeId, TODAY, NOW), SkillsInputError);

  rateCard(subject, card, progress, 'again', makeId, TODAY, NOW);
  assert.equal(progress.schedule[card.id].due, addDays(TODAY, 1));
  assert.throws(() => rateCard(subject, card, progress, 'meh', makeId, TODAY, NOW), SkillsInputError);

  // Answered today: nothing left today; the card is due tomorrow.
  assert.equal(buildQueue(data, progress, TODAY).length, 0);
  const tomorrow = buildQueue(data, progress, addDays(TODAY, 1));
  assert.deepEqual(tomorrow.map((e) => [e.item.id, e.reason]), [[card.id, 'due']]);
  // "Test me on this topic" includes questions that aren't due.
  assert.equal(buildQueue(data, progress, addDays(TODAY, 1), { topicId: basics.id }).length, 1);

  // Reporting retires it: out of the queue and out of the level.
  itemFeedback(subject, graded, { report: { kind: 'wrong-answer', note: 'units' } }, NOW);
  assert.equal(graded.retired, true);
  assert.equal(subjectStats(subject, progress, TODAY).answers, 1);
  itemFeedback(subject, graded, { report: null }, NOW);
  assert.equal(graded.retired, undefined);

  saveCard(subject, { topicId: basics.id, front: 'g0?', back: '9.80665 m/s²' }, makeId, NOW);
  assert.throws(() => saveCard(subject, { topicId: basics.id, front: '', back: 'x' }, makeId, NOW), SkillsInputError);

  // Removing a topic takes its questions and their history with it.
  removeTopic(subject, progress, basics.id, NOW);
  assert.ok(subject.items.every((i) => i.topicId !== basics.id));
  assert.ok(progress.attempts.every((a) => a.topicId !== basics.id));
  assert.equal(progress.schedule[graded.id], undefined);
});

function withHistory(subject: Subject, progress: ProgressData, topicId: string, days: string[], score: number, difficulty: number) {
  for (const day of days) {
    const id = makeId();
    subject.items.push({ id, kind: 'card', topicId, difficulty, front: id, back: id, createdAt: NOW, source: 'manual' });
    progress.attempts.push({ id: makeId(), subjectId: subject.id, topicId, itemId: id, day, at: `${day}T12:00:00.000Z`, score, difficulty });
  }
}

test('stats: strong, weak, fading, gaps and the SME badge', () => {
  const { data, progress, subject, basics, nozzles } = setup();
  const fresh = subjectStats(subject, progress, TODAY);
  assert.equal(fresh.level, 0);
  assert.ok(fresh.topics.every((t) => t.state === 'gap'));
  assert.equal(nextSteps(subject, fresh, TODAY)[0].kind, 'rate');

  // Lots of hard questions right, recently, on both topics: an SME.
  const recent = Array.from({ length: 8 }, (_, i) => addDays(TODAY, -i * 3));
  withHistory(subject, progress, basics.id, recent, 1, 5);
  withHistory(subject, progress, nozzles.id, recent, 1, 5);
  const expert = subjectStats(subject, progress, TODAY);
  assert.ok(expert.level >= 4, `level ${expert.level}`);
  assert.ok(expert.sme);
  assert.equal(tierOf(expert), 'sme');
  assert.ok(expert.topics.every((t) => t.state === 'strong'));

  // A year later without practice: faded, and no longer an SME.
  const later = subjectStats(subject, progress, addDays(TODAY, 400));
  assert.ok(later.level < expert.level);
  assert.ok(!later.sme);
  assert.ok(later.topics.every((t) => t.state === 'fading'));
  assert.ok(nextSteps(subject, later, addDays(TODAY, 400)).some((s) => s.kind === 'refresh'));

  // A weak topic gets a practice step.
  const other = addTopic(subject, { name: 'Turbopumps', stage: 3 }, makeId, NOW);
  withHistory(subject, progress, other.id, recent, 0, 2);
  const mixed = subjectStats(subject, progress, TODAY);
  assert.equal(mixed.topics.find((t) => t.topicId === other.id)!.state, 'weak');
  assert.ok(nextSteps(subject, mixed, TODAY).some((s) => s.kind === 'practice' && s.topicId === other.id));

  const board = boardSummary(data, progress, TODAY);
  assert.equal(board.subjects.length, 1);
  assert.deepEqual(board.areas, ['Aerospace']);
  assert.ok(board.subjects[0].weak.includes('Turbopumps'));
  assert.ok(board.streak >= 1);
  const history = levelHistory(subject, progress, TODAY, 8);
  assert.ok(history.length >= 1 && history[history.length - 1].day === TODAY);
});

test('prompts include where I stand', () => {
  const { subject, progress, basics } = setup();
  rateTopics(subject, { [basics.id]: 2 }, TODAY, NOW);
  const stats = subjectStats(subject, progress, TODAY);
  const plan = buildPlanPrompt({ subject, stats, styles: ['Books', 'Hands-on projects'] });
  assert.ok(plan.includes('Rocket equation (stage 1)'));
  assert.ok(plan.includes('self-rated 2'));
  assert.ok(plan.includes('"resources"'));
  const questions = buildQuestionsPrompt({ subject: { ...subject, items: [] }, topics: stats.topics, count: 6, style: 'mixed', difficulty: 'auto' });
  assert.ok(questions.includes('"Rocket equation"'));
  assert.ok(questions.includes('Aim for difficulty 3'));
  assert.ok(questions.includes('$\\\\frac{a}{b}$'));
});

test('XP: once per question per day, distinct review days, finished resources', () => {
  const { data, progress, subject, basics } = setup();
  saveCard(subject, { topicId: basics.id, front: 'a', back: 'b', difficulty: 3 }, makeId, NOW);
  saveCard(subject, { topicId: basics.id, front: 'c', back: 'd', difficulty: 2 }, makeId, NOW);
  saveCard(subject, { topicId: basics.id, front: 'e', back: 'f', difficulty: 2 }, makeId, NOW);
  const [card, card2, card3] = subject.items;
  assert.equal(skillsXp(data, progress), 0);
  rateCard(subject, card, progress, 'again', makeId, TODAY, NOW);
  rateCard(subject, card, progress, 'good', makeId, TODAY, NOW);
  // Twice on the same card in one day: the better go counts once, and repeated reviews of 1 card do not trigger a review day.
  assert.equal(skillsXp(data, progress), SKILLS_XP.answered + SKILLS_XP.right + 3);
  rateCard(subject, card, progress, 'good', makeId, TODAY, NOW);
  assert.deepEqual(reviewDays(progress), []);
  // Answering 3 distinct items on the same day earns the review-day bonus.
  rateCard(subject, card2, progress, 'good', makeId, TODAY, NOW);
  rateCard(subject, card3, progress, 'good', makeId, TODAY, NOW);
  const xpBeforeReviewDay = (SKILLS_XP.answered + SKILLS_XP.right) * 3 + 3 + 2 + 2;
  assert.deepEqual(reviewDays(progress), [TODAY]);
  assert.equal(skillsXp(data, progress), xpBeforeReviewDay + SKILLS_XP.reviewDay);
  const project = addResource(subject, { title: 'Thrust stand', kind: 'project' }, makeId, TODAY, NOW);
  editResource(subject, project, { status: 'done' }, TODAY, NOW);
  assert.equal(skillsXp(data, progress), xpBeforeReviewDay + SKILLS_XP.reviewDay + SKILLS_XP.resource.project);
});

test('weekly top-up: only switched-on subjects, low topics first, capped', () => {
  const { progress, subject, basics, nozzles } = setup();
  assert.equal(topUpRequest(subject, progress, TODAY), null, 'off by default');
  subject.autoTopUp = true;
  const first = topUpRequest(subject, progress, TODAY)!;
  // Learning, nothing written yet: both early-stage topics want FRESH_TARGET each.
  assert.deepEqual(first.topics.map((t) => [t.topicId, t.need]), [[basics.id, FRESH_TARGET], [nozzles.id, FRESH_TARGET]]);
  assert.equal(first.count, 2 * FRESH_TARGET);
  assert.ok(first.prompt.includes('"Rocket equation"') && first.prompt.includes('How many per topic'));

  // A topic with enough fresh questions drops out; one answered badly comes first.
  for (let i = 0; i < FRESH_TARGET; i++) saveCard(subject, { topicId: basics.id, front: `f${i}`, back: 'b' }, makeId, NOW);
  saveCard(subject, { topicId: nozzles.id, front: 'n', back: 'b' }, makeId, NOW);
  const missed = subject.items.find((i) => i.topicId === nozzles.id)!;
  rateCard(subject, missed, progress, 'again', makeId, TODAY, NOW);
  const second = topUpRequest(subject, progress, TODAY)!;
  assert.deepEqual(second.topics.map((t) => t.topicId), [nozzles.id]);

  // Never more than the weekly cap.
  for (let i = 0; i < 10; i++) addTopic(subject, { name: `Extra ${i}`, stage: 1 }, makeId, NOW);
  assert.equal(topUpRequest(subject, progress, TODAY)!.count, WEEKLY_CAP);
  subject.status = 'paused';
  assert.equal(topUpRequest(subject, progress, TODAY), null);
});

test('shiftScheduleToToday shifts uncompleted queues cleanly and preserves completed tasks', () => {
  const day0 = '2026-11-10';
  const day1 = '2026-11-11';
  const day2 = '2026-11-12';
  const day3 = '2026-11-13';

  const schedule: SkillSchedule = {
    updatedAt: `${day0}T08:00:00.000Z`,
    hoursPerDay: 1,
    tasks: [
      { id: 't0_done', subjectId: 's1', title: 'Done before opening', day: day0, done: true, completedOn: day0, minutes: 20 },
      { id: 't0_a', subjectId: 's1', title: 'Day 0 Task A', day: day0, minutes: 30 },
      { id: 't0_b', subjectId: 's2', title: 'Day 0 Task B', day: day0, minutes: 30 },
      { id: 't1_a', subjectId: 's1', title: 'Day 1 Task A', day: day1, minutes: 30 },
      { id: 't1_b', subjectId: 's2', title: 'Day 1 Task B', day: day1, minutes: 30 },
    ],
  };

  // Opening on Day 1 without finishing Day 0 shifts both Day 0 tasks to Day 1 and Day 1 tasks to Day 2.
  const onDay1 = shiftScheduleToToday(schedule, day1);
  assert.equal(onDay1.shiftedDays, 1);
  assert.equal(onDay1.shiftedFrom, day0);
  const byId1 = new Map(onDay1.schedule.tasks.map((t) => [t.id, t]));
  assert.equal(byId1.get('t0_done')!.day, day0);
  assert.equal(byId1.get('t0_done')!.completedOn, day0);
  assert.equal(byId1.get('t0_a')!.day, day1);
  assert.equal(byId1.get('t0_b')!.day, day1);
  assert.equal(byId1.get('t1_a')!.day, day2);
  assert.equal(byId1.get('t1_b')!.day, day2);
  // Pure function: original input was not mutated.
  assert.equal(schedule.tasks[1].day, day0);

  // Opening on Day 3 (3 days after earliestMissed=day0) shifts everything forward by 3 days.
  const onDay3 = shiftScheduleToToday(schedule, day3);
  assert.equal(onDay3.shiftedDays, 3);
  assert.equal(onDay3.shiftedFrom, day0);
  const byId3 = new Map(onDay3.schedule.tasks.map((t) => [t.id, t]));
  assert.equal(byId3.get('t0_done')!.day, day0);
  assert.equal(byId3.get('t0_a')!.day, day3);
  assert.equal(byId3.get('t0_b')!.day, day3);
  assert.equal(byId3.get('t1_a')!.day, '2026-11-14');
  assert.equal(byId3.get('t1_b')!.day, '2026-11-14');

  // scheduleByDay organizes today, upcomingDays, completedTasks cleanly.
  const view = scheduleByDay(schedule, day1);
  assert.equal(view.shiftedDays, 1);
  assert.deepEqual(view.todayTasks.map((t) => t.id), ['t0_a', 't0_b']);
  assert.equal(view.upcomingDays.length, 1);
  assert.equal(view.upcomingDays[0].day, day2);
  assert.equal(view.upcomingDays[0].totalMinutes, 60);
  assert.deepEqual(view.completedTasks.map((t) => t.id), ['t0_done']);

  // Undefined schedule behaves safely.
  assert.deepEqual(shiftScheduleToToday(undefined, TODAY), { schedule: { updatedAt: '', tasks: [] }, shiftedDays: 0 });
});

test('step CRUD, schedule generation, and bidirectional toggle sync', () => {
  const { data, subject, basics } = setup();
  const s1 = addStep(subject, {
    title: 'Read Ch. 1',
    kind: 'read',
    amount: 'Ch. 1 (pp. 1-30)',
    detail: 'Ideal rocket equation',
    topicId: basics.id,
    minutes: 30,
  }, makeId, TODAY, NOW);
  const s2 = addStep(subject, {
    title: 'Solve nozzle problems',
    kind: 'practice',
    amount: '5 problems',
    minutes: 30,
  }, makeId, TODAY, NOW);
  assert.deepEqual(stepProgress(subject), { done: 0, total: 2 });

  editStep(subject, s2, { amount: '6 problems', minutes: 40 }, TODAY, NOW);
  assert.equal(subject.steps![1].amount, '6 problems');
  moveStep(subject, s2.id, 'up', NOW);
  assert.deepEqual(subject.steps!.map((s) => s.id), [s2.id, s1.id]);
  moveStep(subject, s2.id, 'down', NOW);
  assert.deepEqual(subject.steps!.map((s) => s.id), [s1.id, s2.id]);

  // Build schedule from steps (60 min/day -> s1 30m on TODAY, s2 40m overflows to TODAY+1).
  const sched = rebuildScheduleFromSteps(data, { minutesPerDay: 60, startDay: TODAY }, makeId, TODAY, NOW);
  assert.equal(sched.tasks.length, 2);
  assert.equal(sched.tasks[0].day, TODAY);
  assert.equal(sched.tasks[0].stepId, s1.id);
  assert.equal(sched.tasks[1].day, addDays(TODAY, 1));
  assert.equal(sched.tasks[1].stepId, s2.id);

  // Toggling step marks scheduled task done (and sets completedOn).
  toggleStep(data, subject.id, s1.id, undefined, TODAY, NOW);
  assert.equal(subject.steps![0].done, true);
  assert.equal(subject.steps![0].completedOn, TODAY);
  assert.equal(data.schedule!.tasks[0].done, true);
  assert.equal(data.schedule!.tasks[0].completedOn, TODAY);
  assert.deepEqual(stepProgress(subject), { done: 1, total: 2 });

  // Unchecking via toggleStep unchecks task too.
  toggleStep(data, subject.id, s1.id, false, TODAY, NOW);
  assert.equal(subject.steps![0].done, undefined);
  assert.equal(data.schedule!.tasks[0].done, undefined);

  // Toggling scheduled task on a later day auto-shifts overdue incomplete tasks first, then marks matching SkillStep done!
  const laterDay = addDays(TODAY, 2);
  const toggled = toggleScheduleTask(data, sched.tasks[1].id, true, laterDay, `${laterDay}T10:00:00.000Z`);
  assert.equal(toggled.shiftedDays, 2);
  assert.equal(toggled.shiftedFrom, TODAY);
  assert.equal(toggled.task.done, true);
  assert.equal(toggled.task.day, addDays(TODAY, 3));
  assert.equal(data.schedule!.tasks[0].day, laterDay);
  assert.equal(subject.steps![1].done, true);
  assert.equal(subject.steps![1].completedOn, laterDay);

  // Manual task add/remove and shiftSchedule + removeStep unlink.
  const custom = addScheduleTask(data, { subjectId: subject.id, title: 'Extra drill', day: addDays(laterDay, 1), minutes: 15 }, makeId, laterDay, NOW);
  assert.ok(data.schedule!.tasks.some((t) => t.id === custom.id));
  assert.equal(custom.manual, true);
  // Rebuilding from steps makes the step tasks again but leaves a task added by hand where it was.
  const keptHours = data.schedule!.hoursPerDay;
  rebuildScheduleFromSteps(data, { keepCompleted: true }, makeId, laterDay, NOW);
  assert.ok(data.schedule!.tasks.some((t) => t.id === custom.id && t.day === addDays(laterDay, 1)), 'the hand-added task survives');
  assert.ok(data.schedule!.tasks.some((t) => t.done), 'and so does what was done');
  assert.equal(data.schedule!.hoursPerDay, keptHours, 'with no budget given, the saved one is used');
  removeScheduleTask(data, custom.id, NOW);
  assert.ok(!data.schedule!.tasks.some((t) => t.id === custom.id));

  removeStep(subject, s2.id, NOW, data);
  assert.equal(subject.steps!.length, 1);
  assert.equal(data.schedule!.tasks.find((t) => t.id === sched.tasks[1].id)!.stepId, undefined);
});

test('interconnected subskills, cycle rejection, and dependency-aware schedule generation', () => {
  const data = emptySkills();
  const progress = emptyProgress();
  const math = addSubject(data, {
    name: 'Fluid Mechanics',
    area: 'Engineering',
    steps: [{ id: 'st_m1', title: 'Read compressible flow Ch. 1', kind: 'read', amount: 'pp. 1-25', minutes: 30 }],
  }, makeId, NOW);
  const propulsion = addSubject(data, {
    name: 'Rocket Propulsion',
    area: 'Aerospace',
    parentIds: [math.id],
    steps: [{ id: 'st_p1', title: 'Derive thrust equation', kind: 'practice', amount: '4 derivations', minutes: 30 }],
  }, makeId, NOW);
  const turbopumps = addSubject(data, { name: 'Turbopumps', area: 'Aerospace' }, makeId, NOW);
  const design = addSubject(data, {
    name: 'Industrial Design',
    area: 'Design',
    steps: [{ id: 'st_d1', title: 'Sketch impeller', kind: 'project', minutes: 30 }],
  }, makeId, NOW);

  setParents(data, turbopumps.id, [propulsion.id], NOW);
  assert.deepEqual(parentSkillsOf(data, turbopumps.id).map((s) => s.id), [propulsion.id]);
  assert.deepEqual(subskillsOf(data, math.id).map((s) => s.id), [propulsion.id]);
  assert.deepEqual(subskillsOf(data, propulsion.id).map((s) => s.id), [turbopumps.id]);

  // Cycle detection: self-parenting and transitive cycles must be rejected.
  assert.equal(wouldCreateSkillCycle(data, math.id, math.id), true);
  assert.equal(wouldCreateSkillCycle(data, math.id, turbopumps.id), true);
  assert.equal(wouldCreateSkillCycle(data, design.id, math.id), false);
  assert.throws(() => setParents(data, math.id, [math.id], NOW), SkillsInputError);
  assert.throws(() => setParents(data, math.id, [turbopumps.id], NOW), SkillsInputError);

  // Schedule generation puts parent skill Fluid Mechanics before child Rocket Propulsion while interleaving independent Industrial Design.
  const generated = generateScheduleFromSteps(data, TODAY, 60, [math.id, propulsion.id, design.id], makeId);
  const mathIdx = generated.tasks.findIndex((t) => t.subjectId === math.id);
  const propIdx = generated.tasks.findIndex((t) => t.subjectId === propulsion.id);
  assert.ok(mathIdx >= 0 && propIdx > mathIdx, 'parent skill scheduled before subskill');
  assert.ok(generated.tasks.some((t) => t.subjectId === design.id));

  // Removing a parent subject cleans up child parentIds and schedule tasks.
  removeSubject(data, progress, math.id);
  assert.equal(propulsion.parentIds, undefined);
});

test('freeResourceSearchLinks encodes search URLs and editResource accepts freePdfUrl / youtubeAudioUrl', () => {
  const links = freeResourceSearchLinks({
    title: 'Feedback Control of Dynamic Systems',
    author: 'Gene F. Franklin',
    kind: 'book',
  });
  assert.ok(links.pdfGoogle.includes('filetype%3Apdf'));
  assert.ok(links.pdfGoogle.includes('Feedback%20Control%20of%20Dynamic%20Systems'));
  assert.ok(!('annasArchive' in links), 'no shadow libraries');
  assert.ok(links.internetArchive.startsWith('https://archive.org/search?query='));
  assert.ok(links.openLibrary.startsWith('https://openlibrary.org/search?q='));
  assert.ok(links.googleScholar.startsWith('https://scholar.google.com/scholar?q='));
  assert.ok(links.arxiv.startsWith('https://arxiv.org/search/?query='));
  assert.ok(links.youtubeAudiobook.includes('full%20audiobook'));
  assert.ok(links.youtubeLectures.includes('lectures'));
  assert.ok(links.librivox.startsWith('https://librivox.org/search?q='));

  const { subject } = setup();
  const book = addResource(subject, {
    title: 'Control Systems',
    kind: 'book',
    freePdfUrl: 'https://example.edu/control.pdf',
    youtubeAudioUrl: 'https://youtube.com/watch?v=abc123',
  }, makeId, TODAY, NOW);
  assert.equal(book.freePdfUrl, 'https://example.edu/control.pdf');
  assert.equal(book.youtubeAudioUrl, 'https://youtube.com/watch?v=abc123');
  assert.throws(() => editResource(subject, book, { freePdfUrl: 'javascript:alert(1)' }, TODAY, NOW), SkillsInputError);
  editResource(subject, book, { freePdfUrl: '' }, TODAY, NOW);
  assert.equal(book.freePdfUrl, undefined);
});

test('single-skill plan supports steps and interconnected prompts/parser/apply work in schedule and brainstorm modes', () => {
  const { data, progress, subject, basics } = setup();
  rateTopics(subject, { [basics.id]: 2.5 }, TODAY, NOW);
  const sub = addSubject(data, { name: 'Thermodynamics', area: 'Aerospace', target: 4 }, makeId, NOW);
  setParents(data, subject.id, [sub.id], NOW);

  // Single-skill plan with steps
  const singleReply = JSON.stringify({
    summary: 'Step-by-step propulsion plan.',
    parentSubjects: ['Thermodynamics'],
    topics: [{ key: 't1', name: 'Rocket equation', stage: 1 }],
    resources: [{ kind: 'book', title: 'Sutton Propulsion', author: 'Sutton', topics: ['t1'], freePdfUrl: 'https://example.org/sutton.pdf' }],
    steps: [
      { title: 'Read Sutton Ch. 1', kind: 'read', amount: 'Ch. 1 (pp. 1-26)', detail: 'Classification & definitions', topic: 't1', resource: 'Sutton Propulsion', minutes: 40 },
    ],
  });
  const parsedSingle = parsePlanReply(singleReply, subject);
  assert.equal(parsedSingle.steps.length, 1);
  assert.deepEqual(parsedSingle.parentSubjects, ['Thermodynamics']);
  const importedSingle = importPlan(subject, singleReply, {}, makeId, NOW);
  assert.deepEqual(importedSingle, { topics: 0, resources: 1, roadmap: false, steps: 1 });
  assert.equal(subject.steps![0].amount, 'Ch. 1 (pp. 1-26)');
  assert.equal(subject.steps![0].topicId, basics.id);
  assert.equal(subject.resources[0].freePdfUrl, 'https://example.org/sutton.pdf');

  // Schedule mode prompt & parse & apply
  const schedPrompt = buildInterconnectedPlanPrompt(data, {
    hoursPerDay: 1.5,
    days: 7,
    mode: 'schedule',
    focusSubjectIds: [sub.id, subject.id],
    goals: 'Build a liquid bipropellant test stand',
    progress,
  }, TODAY);
  assert.ok(schedPrompt.includes('subjectLevel:'));
  assert.ok(schedPrompt.includes('Thermodynamics'));
  assert.ok(schedPrompt.includes('Rocket propulsion'));
  assert.ok(schedPrompt.includes('Dreyfus'));

  const schedReply = JSON.stringify({
    summary: 'Thermodynamics fundamentals before propulsion.',
    hoursPerDay: 1.5,
    subjectPlans: [
      {
        subject: 'Thermodynamics',
        steps: [
          { title: 'Read 1st & 2nd Law', kind: 'read', amount: 'Ch. 1-2 (pp. 1-48)', minutes: 45 },
          { title: 'Solve isentropic flow problems', kind: 'practice', amount: '6 problems', minutes: 45 },
        ],
      },
    ],
    schedule: [
      {
        dayIndex: 1,
        tasks: [
          { subject: 'Thermodynamics', title: 'Read 1st & 2nd Law', stepTitle: 'Read 1st & 2nd Law', amount: 'Ch. 1-2 (pp. 1-48)', minutes: 45 },
          { subject: 'Rocket propulsion', title: 'Read Sutton Ch. 1', stepTitle: 'Read Sutton Ch. 1', amount: 'Ch. 1 (pp. 1-26)', minutes: 40 },
        ],
      },
      {
        dayIndex: 2,
        tasks: [
          { subject: 'Thermodynamics', title: 'Solve isentropic flow problems', minutes: 45 },
        ],
      },
    ],
  });
  const parsedSched = parseInterconnectedPlanReply(schedReply, data.subjects, TODAY);
  assert.equal(parsedSched.ok, true);
  if (!parsedSched.ok) return;
  assert.equal(parsedSched.data.schedule.length, 3);
  assert.equal(parsedSched.data.schedule[2].day, addDays(TODAY, 1));

  // A finished task from before survives the plan replacing the schedule; an unfinished one doesn't.
  addScheduleTask(data, { subjectId: data.subjects[0].id, title: 'Old finished task', day: TODAY, done: true }, makeId, TODAY, NOW);
  addScheduleTask(data, { subjectId: data.subjects[0].id, title: 'Old open task', day: TODAY }, makeId, TODAY, NOW);
  const appliedSched = applyInterconnectedPlan(data, { draft: parsedSched.data }, makeId, TODAY, NOW);
  assert.equal(appliedSched.addedSteps, 2);
  assert.equal(appliedSched.scheduledTasks, 3);
  assert.deepEqual(data.schedule!.tasks.filter((t) => t.title.startsWith('Old')).map((t) => t.title), ['Old finished task']);
  data.schedule!.tasks = data.schedule!.tasks.filter((t) => !t.title.startsWith('Old'));
  assert.equal(data.schedule!.tasks.length, 3);
  assert.ok(data.schedule!.tasks[0].stepId, 'schedule task linked to stepId');

  // Brainstorm mode prompt & parse & apply
  const brainPrompt = buildInterconnectedPlanPrompt(data, { hoursPerDay: 1, mode: 'brainstorm', progress }, TODAY);
  assert.ok(brainPrompt.includes('"newSubjects"'));
  assert.ok(brainPrompt.includes('parentSubjectNames'));

  const brainReply = '```json\n' + JSON.stringify({
    summary: 'Extend aerospace stack into controls and data acquisition.',
    newSubjects: [
      {
        name: 'Valve & Sensor Control',
        icon: '🎛️',
        area: 'Controls',
        why: 'Needed to automate hot-fire test stand valves safely.',
        targetLevel: 3,
        parentSubjectNames: ['Rocket propulsion'],
        topics: [{ key: 't1', name: 'PID loops', stage: 1, core: true }],
        resources: [{ kind: 'book', title: 'Feedback Systems', author: 'Astrom & Murray', freePdfUrl: 'https://fbswiki.org/wiki/index.php/Main_Page', topics: ['t1'], hours: 25 }],
        steps: [{ title: 'Read Ch. 1 of Feedback Systems', kind: 'read', amount: 'Ch. 1 (pp. 1-24)', topic: 't1', resource: 'Feedback Systems', minutes: 35 }],
      },
    ],
  }) + '\n```';
  const parsedBrain = parseInterconnectedPlanReply(brainReply, data.subjects, TODAY);
  assert.equal(parsedBrain.ok, true);
  if (!parsedBrain.ok) return;
  assert.equal(parsedBrain.data.newSubjects.length, 1);
  assert.deepEqual(parsedBrain.data.newSubjects[0].parentIds, [subject.id]);

  const appliedBrain = applyInterconnectedPlan(data, { reply: brainReply }, makeId, TODAY, NOW);
  assert.equal(appliedBrain.addedSubjects, 1);
  const created = data.subjects.find((s) => s.name === 'Valve & Sensor Control')!;
  assert.ok(created);
  assert.deepEqual(created.parentIds, [subject.id]);
  assert.equal(created.topics.length, 1);
  assert.equal(created.resources[0].freePdfUrl, 'https://fbswiki.org/wiki/index.php/Main_Page');
  assert.equal(created.steps![0].amount, 'Ch. 1 (pp. 1-24)');

  // Malformed interconnected reply returns { ok: false } gracefully.
  const bad = parseInterconnectedPlanReply('not json', data.subjects, TODAY);
  assert.equal(bad.ok, false);
});

test('project log CRUD and unified applySkillEdit dispatcher', () => {
  const { data, subject } = setup();
  const project = addResource(subject, { title: 'Test stand', kind: 'project' }, makeId, TODAY, NOW);

  const log1 = addProjectLog(subject, project, {
    title: 'Machined injector plate',
    note: 'Drilled 12 coaxial orifices at 1.2 mm.',
    day: TODAY,
    attachments: [
      { kind: 'image', name: 'injector.jpg', url: '/api/media/uploads/injector.jpg', size: 120400, mime: 'image/jpeg' },
      { kind: 'video', name: 'cold-flow.mp4', url: 'https://example.com/cold-flow.mp4' },
      { kind: 'zip', name: 'cad-files.zip', url: '/uploads/cad-files.zip' },
    ],
  }, makeId, TODAY, NOW);
  assert.equal(project.logs!.length, 1);
  assert.equal(log1.attachments.length, 3);

  assert.throws(() => addProjectLog(subject, project, {
    title: 'Bad link',
    attachments: [{ kind: 'link', name: 'xss', url: 'javascript:alert(1)' }],
  }, makeId, TODAY, NOW), SkillsInputError);

  const edited = editProjectLog(subject, project, log1.id, {
    title: 'Machined & tested injector plate',
    note: 'Cold flow passed at 40 bar.',
    day: addDays(TODAY, 1),
  }, NOW, makeId);
  assert.equal(edited.title, 'Machined & tested injector plate');
  assert.equal(edited.day, addDays(TODAY, 1));
  assert.equal(project.logs![0].note, 'Cold flow passed at 40 bar.');

  removeProjectLog(subject, project, log1.id, NOW);
  assert.equal(project.logs, undefined);

  // Also test via applySkillEdit discriminated union
  applySkillEdit(data, {
    op: 'add-project-log',
    subjectId: subject.id,
    resourceId: project.id,
    title: 'Logged via SkillEdit',
    attachments: [{ kind: 'link', name: 'Repo', url: 'https://github.com/example/stand' }],
  }, makeId, TODAY, NOW);
  assert.equal(project.logs!.length, 1);

  applySkillEdit(data, {
    op: 'set-schedule',
    hoursPerDay: 2,
    tasks: [{ subjectId: subject.id, title: 'Review cold flow data', day: addDays(TODAY, -1), minutes: 30 }],
  }, makeId, TODAY, NOW);
  const shifted = shiftSchedule(data, TODAY, NOW);
  assert.equal(shifted.shiftedDays, 1);
  assert.equal(data.schedule!.tasks[0].day, TODAY);
  assert.ok(boardSummary(data, emptyProgress(), TODAY).schedule.todayTasks.length === 1);
});

test('parseRunningInquiryList cleans bullets, checkboxes, numbering, blanks, and case duplicates', () => {
  const raw = [
    '',
    '  - What is MCP?  ',
    '* What is R1 Redundancy?',
    '• What is gRPC?',
    '[ ] How does Raft work?',
    '[x]   Already checked question',
    '- [ ] Nested checklist item',
    '1. First numbered lookup',
    '2) Second numbered lookup',
    '-',
    '1.',
    '   what is mcp? ',
    '--cli-flag',
    '1.5 volt rail',
  ].join('\n');
  assert.deepEqual(parseRunningInquiryList(raw), [
    'What is MCP?',
    'What is R1 Redundancy?',
    'What is gRPC?',
    'How does Raft work?',
    'Already checked question',
    'Nested checklist item',
    'First numbered lookup',
    'Second numbered lookup',
    '--cli-flag',
    '1.5 volt rail',
  ]);
  assert.deepEqual(parseRunningInquiryList('   \n\n  '), []);
});

test('inquiry CRUD, tag/source normalization, subject/topic validation, import dedup, and boardSummary', () => {
  const { data, progress, subject, basics, nozzles } = setup();

  assert.throws(() => addInquiry(data, { question: '   ' }, makeId, NOW), SkillsInputError);
  assert.throws(() => addInquiry(data, { question: 'Q', subjectId: 'missing' }, makeId, NOW), SkillsInputError);
  assert.throws(() => addInquiry(data, { question: 'Q', subjectId: subject.id, topicId: 'missing' }, makeId, NOW), SkillsInputError);
  assert.throws(() => addInquiry(data, { question: 'Q', status: 'bad' }, makeId, NOW), SkillsInputError);

  const q1 = addInquiry(data, {
    question: 'What is MCP?',
    context: 'Heard on a podcast',
    tags: ['#MCP', 'mcp', ' #AI-Protocols ', ''],
    sources: ['https://modelcontextprotocol.io', '  ', 'https://modelcontextprotocol.io'],
    topicId: basics.id,
  }, makeId, NOW);
  assert.equal(q1.status, 'open');
  assert.equal(q1.solvedAt, undefined);
  assert.equal(q1.subjectId, subject.id);
  assert.equal(q1.topicId, basics.id);
  assert.deepEqual(q1.tags, ['mcp', 'ai-protocols']);
  assert.deepEqual(q1.sources, ['https://modelcontextprotocol.io']);

  // Editing inquiry fields, clearing optional links, and status transitions
  editInquiry(data, q1.id, {
    context: '',
    tags: ['#Agents', 'MCP'],
    topicId: nozzles.id,
    status: 'solved',
    answer: 'Model Context Protocol connects hosts to tools via [[JSON-RPC]].',
  }, '2026-11-12T16:00:00.000Z');
  assert.equal(q1.context, undefined);
  assert.deepEqual(q1.tags, ['agents', 'mcp']);
  assert.equal(q1.topicId, nozzles.id);
  assert.equal(q1.status, 'solved');
  assert.equal(q1.solvedAt, '2026-11-12T16:00:00.000Z');

  assert.throws(() => editInquiry(data, q1.id, { question: '' }, NOW), SkillsInputError);
  assert.throws(() => editInquiry(data, 'nope', { question: 'Valid' }, NOW), SkillsInputError);
  assert.throws(() => editInquiry(data, q1.id, { subjectId: '', topicId: nozzles.id }, NOW), SkillsInputError);

  // Toggle flips open <-> solved and manages solvedAt + optional answer
  toggleInquiry(data, q1.id, undefined, undefined, '2026-11-12T17:00:00.000Z');
  assert.equal(q1.status, 'open');
  assert.equal(q1.solvedAt, undefined);
  toggleInquiry(data, q1.id, 'solved', 'Updated MCP explanation.', '2026-11-12T18:00:00.000Z');
  assert.equal(q1.status, 'solved');
  assert.equal(q1.solvedAt, '2026-11-12T18:00:00.000Z');
  assert.equal(q1.answer, 'Updated MCP explanation.');
  assert.throws(() => toggleInquiry(data, q1.id, 'bogus', undefined, NOW), SkillsInputError);

  // Bulk import deduplicates against existing inquiries (? stripped + concept alias)
  const imported = importInquiries(data, {
    text: '- what is mcp\n- MCP\n- What is R1 Redundancy?\n- How does MCP work?',
    items: [{ question: 'What is R1 Redundancy?' }, { question: 'What is BGP anycast?', tags: ['#Networking'] }],
    subjectId: subject.id,
    tags: ['#Lookup'],
  }, makeId, NOW);
  assert.equal(imported.added.length, 3);
  assert.equal(imported.skipped, 3);
  assert.deepEqual(imported.added[2].tags, ['lookup', 'networking']);
  assert.throws(() => importInquiries(data, { text: '  \n-  ' }, makeId, NOW), SkillsInputError);

  // Add 10 more open inquiries with ascending timestamps to verify recentOpen sorting & cap at 10
  for (let i = 1; i <= 10; i++) {
    addInquiry(data, { question: `Open question ${i}` }, makeId, `2026-11-13T${String(i).padStart(2, '0')}:00:00.000Z`);
  }
  const summary = boardSummary(data, progress, TODAY);
  assert.equal(summary.inquiries.total, 14);
  assert.equal(summary.inquiries.open, 13);
  assert.equal(summary.inquiries.solved, 1);
  assert.equal(summary.inquiries.recentOpen.length, 10);
  assert.equal(summary.inquiries.recentOpen[0].question, 'Open question 10');
  assert.equal(summary.inquiries.recentOpen[9].question, 'Open question 1');
  assert.ok(summary.inquiries.recentOpen.every((q) => q.status === 'open'));

  // Remove inquiry and verify subject/topic deletion cleans up inquiry links without deleting the inquiry
  removeInquiry(data, imported.added[2].id);
  assert.throws(() => removeInquiry(data, imported.added[2].id), SkillsInputError);
  applySkillEdit(data, { op: 'remove-topic', subjectId: subject.id, topicId: nozzles.id }, makeId, TODAY, NOW, progress);
  assert.equal(q1.topicId, undefined);
  assert.equal(q1.subjectId, subject.id);
  removeSubject(data, progress, subject.id);
  assert.equal(q1.subjectId, undefined);
});

test('promoteInquiryToCard, buildInquiryPrompt, parseInquiryReply, applyInquiryAnswers, and SkillEdit wiring', () => {
  const { data, subject, basics, nozzles } = setup();

  const qUnlinked = addInquiry(data, { question: 'What is MCP?', context: 'AI tooling' }, makeId, NOW);
  const qLinked = addInquiry(data, {
    question: 'What is R1 Redundancy?',
    tags: ['#infra'],
    sources: ['Existing note'],
    subjectId: subject.id,
    topicId: basics.id,
  }, makeId, NOW);
  const qAlreadySolved = addInquiry(data, {
    question: 'What is Isp?',
    answer: 'Specific impulse.',
    status: 'solved',
    subjectId: subject.id,
    topicId: basics.id,
  }, makeId, NOW);

  // promoteInquiryToCard validation and linking
  assert.throws(() => promoteInquiryToCard(data, { inquiryId: qUnlinked.id }, makeId, NOW), SkillsInputError);
  assert.throws(() => promoteInquiryToCard(data, { inquiryId: qLinked.id }, makeId, NOW), SkillsInputError);
  const promotedDirect = promoteInquiryToCard(data, {
    inquiryId: qAlreadySolved.id,
    difficulty: 3,
  }, makeId, NOW);
  assert.equal(promotedDirect.card.front, 'What is Isp?');
  assert.equal(promotedDirect.card.back, 'Specific impulse.');
  assert.equal(promotedDirect.card.difficulty, 3);
  assert.equal(qAlreadySolved.cardItemId, promotedDirect.cardId);

  // buildInquiryPrompt selects open inquiries by default, or specific inquiryIds when passed
  const openPrompt = buildInquiryPrompt(data);
  assert.ok(openPrompt.includes(qUnlinked.id) && openPrompt.includes('What is MCP?'));
  assert.ok(openPrompt.includes(qLinked.id) && openPrompt.includes('What is R1 Redundancy?'));
  assert.ok(!openPrompt.includes(qAlreadySolved.id));
  assert.ok(openPrompt.includes('Rocket propulsion'));
  assert.ok(openPrompt.includes('[[Wiki-links]]'));
  assert.ok(openPrompt.includes('"answers"'));

  const subsetPrompt = buildInquiryPrompt(data, [qUnlinked.id]);
  assert.ok(subsetPrompt.includes('What is MCP?'));
  assert.ok(!subsetPrompt.includes('What is R1 Redundancy?'));

  // Malformed reply returns ok: false cleanly
  assert.equal(parseInquiryReply('', data).ok, false);
  assert.equal(parseInquiryReply('no json here', data).ok, false);
  assert.equal(parseInquiryReply('{"answers": []}', data).ok, false);

  // Valid reply matching by concept-only ("MCP"), by inquiryId, and an unmatched new lookup
  const reply = '```json\n' + JSON.stringify({
    answers: [
      {
        question: 'MCP',
        answer: 'Model Context Protocol standardizes [[Tool Calling]] over [[JSON-RPC]]. #mcp',
        takeaways: ['- Client-server protocol', 'Separates tools, resources, and prompts'],
        tags: ['#MCP', 'ai-protocols', 'mcp'],
        sources: ['https://modelcontextprotocol.io'],
        suggestedSubject: 'Rocket propulsion',
        suggestedTopic: 'Nozzle flow',
        flashcard: {
          front: 'What are the 3 core MCP server primitives?',
          back: 'Tools, Resources, and Prompts.',
          difficulty: 2,
        },
      },
      {
        inquiryId: qLinked.id,
        question: 'What is R1 Redundancy?',
        answer: 'Redundancy design ensuring single failure tolerance via [[Failover]] paths.',
        takeaways: '- Survives N-1 failure',
        tags: ['#reliability', 'infra'],
        sources: ['Existing note', 'Reliability Engineering Ch. 3'],
        suggestedSubject: 'Rocket propulsion',
        suggestedTopic: 'Nozzle flow',
      },
      {
        question: 'What is gRPC?',
        answer: 'High-performance RPC framework over [[HTTP/2]] using [[Protobuf]].',
        tags: ['rpc'],
        sources: ['https://grpc.io/docs/'],
        suggestedSubject: 'Rocket propulsion',
        suggestedTopic: 'Rocket equation',
        flashcard: {
          front: 'What transport and serialization does gRPC use by default?',
          back: 'HTTP/2 and Protocol Buffers.',
          difficulty: 1,
        },
      },
    ],
  }) + '\n```';

  const parsed = parseInquiryReply(reply, data);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.data.length, 3);
  assert.equal(parsed.data[0].inquiryId, qUnlinked.id);
  assert.equal(parsed.data[0].subjectId, subject.id);
  assert.equal(parsed.data[0].topicId, nozzles.id);
  assert.deepEqual(parsed.data[0].tags, ['mcp', 'ai-protocols']);
  assert.equal(parsed.data[0].takeaways, '- Client-server protocol\n- Separates tools, resources, and prompts');
  assert.equal(parsed.data[1].inquiryId, qLinked.id);
  assert.equal(parsed.data[2].inquiryId, undefined);

  // Apply answers via applySkillEdit with createCards: true
  const applied = applySkillEdit(data, {
    op: 'apply-inquiry-answers',
    reply,
    createCards: true,
  }, makeId, TODAY, NOW) as { updated: number; created: number; cardsCreated: number };
  assert.deepEqual(applied, { updated: 2, created: 1, cardsCreated: 3 });

  assert.equal(qUnlinked.status, 'solved');
  assert.equal(qUnlinked.solvedAt, NOW);
  assert.equal(qUnlinked.subjectId, subject.id);
  assert.equal(qUnlinked.topicId, nozzles.id);
  assert.ok(qUnlinked.cardItemId);

  // Existing subjectId/topicId on qLinked was preserved (not overwritten by suggestedTopic "Nozzle flow")
  assert.equal(qLinked.subjectId, subject.id);
  assert.equal(qLinked.topicId, basics.id);
  assert.deepEqual(qLinked.tags, ['infra', 'reliability']);
  assert.deepEqual(qLinked.sources, ['Existing note', 'Reliability Engineering Ch. 3']);
  assert.ok(qLinked.cardItemId);

  const createdInq = data.inquiries!.find((q) => q.question === 'What is gRPC?')!;
  assert.equal(createdInq.status, 'solved');
  assert.ok(createdInq.cardItemId);

  // Re-applying with createCards: true does not create duplicate cards
  const reapplied = applyInquiryAnswers(data, { answers: parsed.data, createCards: true }, makeId, NOW);
  assert.deepEqual(reapplied, { updated: 3, created: 0, cardsCreated: 0 });

  // Remaining SkillEdit inquiry ops
  const addedViaOp = applySkillEdit(data, {
    op: 'add-inquiry',
    question: 'What is Quic?',
    tags: ['#Networking'],
  }, makeId, TODAY, NOW) as { id: string; tags?: string[] };
  assert.deepEqual(addedViaOp.tags, ['networking']);

  applySkillEdit(data, {
    op: 'edit-inquiry',
    inquiryId: addedViaOp.id,
    changes: { question: 'What is QUIC?', answer: 'UDP-based multiplexed transport.' },
  }, makeId, TODAY, NOW);
  applySkillEdit(data, {
    op: 'toggle-inquiry',
    inquiryId: addedViaOp.id,
    status: 'solved',
  }, makeId, TODAY, NOW);
  applySkillEdit(data, {
    op: 'promote-inquiry-to-card',
    inquiryId: addedViaOp.id,
    subjectId: subject.id,
    topicId: basics.id,
  }, makeId, TODAY, NOW);
  const importedViaOp = applySkillEdit(data, {
    op: 'import-inquiries',
    text: '- What is QUIC?\n- What is eBPF?',
  }, makeId, TODAY, NOW) as { added: Array<{ id: string }>; skipped: number };
  assert.equal(importedViaOp.added.length, 1);
  assert.equal(importedViaOp.skipped, 1);

  applySkillEdit(data, {
    op: 'remove-inquiry',
    inquiryId: importedViaOp.added[0].id,
  }, makeId, TODAY, NOW);
  assert.ok(!data.inquiries!.some((q) => q.id === importedViaOp.added[0].id));
});

test('store.ts preserves inquiries during updateSkills and readSkills', async () => {
  const orig = process.cwd();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'skills-inquiry-store-'));
  try {
    process.chdir(dir);
    await updateSkills('inquiry-store-user', (data) => {
      addInquiry(data, {
        question: 'What is MCP?',
        tags: ['#mcp'],
        sources: ['https://modelcontextprotocol.io'],
      }, makeId, NOW);
    });
    const loaded = await readSkills('inquiry-store-user');
    assert.equal(loaded.inquiries?.length, 1);
    assert.equal(loaded.inquiries![0].question, 'What is MCP?');
    assert.deepEqual(loaded.inquiries![0].tags, ['mcp']);
  } finally {
    process.chdir(orig);
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('LIMITS.name is 80 and importPlan honors stepIndexes', () => {
  assert.equal(LIMITS.name, 80);
  const data = emptySkills();
  const longName = 'A'.repeat(95);
  const sub = addSubject(data, { name: longName, target: 3 }, makeId, NOW);
  assert.equal(sub.name.length, 80);

  const reply = JSON.stringify({
    topics: [{ key: 't1', name: 'Intro', stage: 1 }],
    resources: [],
    steps: [
      { title: 'Step zero', kind: 'read', topic: 't1', minutes: 20 },
      { title: 'Step one', kind: 'practice', topic: 't1', minutes: 25 },
      { title: 'Step two', kind: 'project', topic: 't1', minutes: 30 },
    ],
  });
  const imported = importPlan(sub, reply, { stepIndexes: [0, 2] }, makeId, NOW);
  assert.deepEqual(imported, { topics: 1, resources: 0, roadmap: false, steps: 2 });
  assert.deepEqual(sub.steps?.map((s) => s.title), ['Step zero', 'Step two']);
});

test('addInquiry with answer saves immediately as solved, stores takeaway, and optionally creates a linked card', () => {
  const { data, subject, basics } = setup();

  // Direct Q&A entry without status automatically saves as solved with solvedAt = now
  const direct = addInquiry(data, {
    question: 'What is specific impulse?',
    answer: 'Thrust per unit propellant weight flow rate, in seconds.',
    takeaway: 'Higher Isp means better propellant efficiency.',
    tags: ['#propulsion'],
  }, makeId, NOW);
  assert.equal(direct.status, 'solved');
  assert.equal(direct.solvedAt, NOW);
  assert.equal(direct.answer, 'Thrust per unit propellant weight flow rate, in seconds.');
  assert.equal(direct.takeaways, 'Higher Isp means better propellant efficiency.');
  assert.equal(direct.cardItemId, undefined);

  // createCard: true without topicId does not throw or create a card
  const noTopic = addInquiry(data, {
    question: 'What is ablative cooling?',
    answer: 'Cooling via controlled charring/vaporization of liner material.',
    subjectId: subject.id,
    createCard: true,
  }, makeId, NOW);
  assert.equal(noTopic.status, 'solved');
  assert.equal(noTopic.cardItemId, undefined);
  assert.equal(subject.items.length, 0);

  // Via applySkillEdit with subjectId + topicId + answer + createCard: true -> solved + linked CardItem
  const withCard = applySkillEdit(data, {
    op: 'add-inquiry',
    question: 'What is the Tsiolkovsky rocket equation?',
    answer: '$\\Delta v = v_e \\ln(m_0 / m_f)$ connecting mass ratio and exhaust velocity.',
    takeaway: 'Logarithmic in mass ratio.',
    subjectId: subject.id,
    topicId: basics.id,
    createCard: true,
  }, makeId, TODAY, NOW) as { id: string; status: string; solvedAt?: string; takeaways?: string; cardItemId?: string };

  assert.equal(withCard.status, 'solved');
  assert.equal(withCard.solvedAt, NOW);
  assert.equal(withCard.takeaways, 'Logarithmic in mass ratio.');
  assert.ok(withCard.cardItemId);
  assert.equal(subject.items.length, 1);
  const createdCard = subject.items[0];
  assert.equal(createdCard.kind, 'card');
  if (createdCard.kind === 'card') {
    assert.equal(createdCard.id, withCard.cardItemId);
    assert.equal(createdCard.topicId, basics.id);
    assert.equal(createdCard.front, 'What is the Tsiolkovsky rocket equation?');
    assert.equal(createdCard.back, '$\\Delta v = v_e \\ln(m_0 / m_f)$ connecting mass ratio and exhaust velocity.');
  }
});

test('parseBulkQAInput parses plain bullets, Q:/A: multiline blocks, ::, ->, —, and importInquiries saves solved pairs', () => {
  const raw = [
    '- What is MCP?',
    '1. What is std::vector? :: Dynamic contiguous array in C++',
    'What is a->b in C?',
    'What is Raft? -> Consensus protocol for replicated state machines',
    'What is eBPF? — In-kernel sandboxed bytecode runtime',
    '',
    'Q: How does OAuth 2.0 work?',
    'A: Client -> Auth Server -> Access Token.',
    'Tokens are scoped and short-lived.',
    '',
    'Paragraph two of OAuth answer.',
    '',
    'Q: What is CAP theorem?',
    'A: Pick consistency or availability under network partitions.',
    '- What is gRPC?',
    '   what is mcp? :: Model Context Protocol for tool calls',
  ].join('\n');

  const parsed = parseBulkQAInput(raw);
  assert.deepEqual(parsed, [
    { question: 'What is MCP?', answer: 'Model Context Protocol for tool calls' },
    { question: 'What is std::vector?', answer: 'Dynamic contiguous array in C++' },
    { question: 'What is a->b in C?' },
    { question: 'What is Raft?', answer: 'Consensus protocol for replicated state machines' },
    { question: 'What is eBPF?', answer: 'In-kernel sandboxed bytecode runtime' },
    {
      question: 'How does OAuth 2.0 work?',
      answer: 'Client -> Auth Server -> Access Token.\nTokens are scoped and short-lived.\n\nParagraph two of OAuth answer.',
    },
    {
      question: 'What is CAP theorem?',
      answer: 'Pick consistency or availability under network partitions.',
    },
    { question: 'What is gRPC?' },
  ]);
  assert.deepEqual(parseBulkQAInput('  \n\n '), []);

  const { data, subject, basics } = setup();
  const imported = importInquiries(data, {
    text: [
      '- What is open question one?',
      'What is solved inline? :: Inline answer',
      'Q: Multi-line Q?',
      'A: Line one',
      'Line two',
    ].join('\n'),
    subjectId: subject.id,
    topicId: basics.id,
    tags: ['#bulk'],
  }, makeId, NOW);

  assert.equal(imported.skipped, 0);
  assert.equal(imported.added.length, 3);
  assert.equal(imported.added[0].status, 'open');
  assert.equal(imported.added[0].solvedAt, undefined);
  assert.equal(imported.added[1].status, 'solved');
  assert.equal(imported.added[1].answer, 'Inline answer');
  assert.equal(imported.added[1].solvedAt, NOW);
  assert.equal(imported.added[2].status, 'solved');
  assert.equal(imported.added[2].answer, 'Line one\nLine two');
  assert.deepEqual(imported.added[2].tags, ['bulk']);
});

test('KnowledgeResponse graph/inquiries, KB search/filter/sort/markdown export, and quiz itemSearchText', async () => {
  const orig = process.cwd();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'skills-kb-search-'));
  try {
    process.chdir(dir);
    const { data, subject, basics } = setup();
    const other = addSubject(data, { name: 'Distributed Systems', area: 'CS', target: 4 }, makeId, NOW);

    const q1 = addInquiry(data, {
      question: 'What is Raft consensus?',
      answer: 'Leader election and log replication using [[Quorum]].',
      takeaway: 'Requires majority quorum.',
      sources: ['https://raft.github.io'],
      tags: ['consensus', 'distributed'],
      subjectId: other.id,
    }, makeId, '2026-11-10T10:00:00.000Z');
    const q2 = addInquiry(data, {
      question: 'What is Choked Flow?',
      answer: 'Mass flow rate stops increasing when throat reaches Mach 1.',
      tags: ['aerospace', 'consensus'],
      subjectId: subject.id,
      topicId: basics.id,
    }, makeId, '2026-11-12T10:00:00.000Z');
    const q3 = addInquiry(data, {
      question: 'Alpha Open Question?',
      context: 'From systems lecture',
      tags: ['distributed'],
    }, makeId, '2026-11-11T10:00:00.000Z');

    const kbResp = await buildKnowledgeGraph('kb-search-user', data);
    assert.equal(kbResp.bundle.inquiries.length, 3);
    assert.ok(kbResp.bundle.ownKnowledge.some((m) => m.id === `ok-inq:${q1.id}` && m.sourceKind === 'inquiry-solved'));

    const subjectLookup = new Map(data.subjects.map((s) => [s.id, { name: s.name, topics: s.topics }]));

    // Search across [[concepts]], #tags, sources, and multi-word terms
    assert.deepEqual(
      filterAndSortInquiries(data.inquiries!, { search: '[[Quorum]] raft.github.io', subjectLookup }).map((q) => q.id),
      [q1.id],
    );
    assert.deepEqual(
      filterAndSortInquiries(data.inquiries!, { search: '#aerospace Mach', subjectLookup }).map((q) => q.id),
      [q2.id],
    );
    assert.deepEqual(
      filterAndSortInquiries(data.inquiries!, { skillFilter: '__unassigned__', subjectLookup }).map((q) => q.id),
      [q3.id],
    );
    assert.deepEqual(
      filterAndSortInquiries(data.inquiries!, { tagFilter: 'distributed', sort: 'alphabetical', subjectLookup }).map((q) => q.id),
      [q3.id, q1.id],
    );
    assert.deepEqual(
      filterAndSortInquiries(data.inquiries!, { sort: 'newest', subjectLookup }).map((q) => q.id),
      [q2.id, q3.id, q1.id],
    );
    assert.deepEqual(
      filterAndSortInquiries(data.inquiries!, { sort: 'recently-answered', subjectLookup }).map((q) => q.id),
      [q2.id, q1.id, q3.id],
    );
    assert.deepEqual(
      filterAndSortInquiries(data.inquiries!, { sort: 'open-first', subjectLookup }).map((q) => q.id),
      [q3.id, q2.id, q1.id],
    );

    assert.deepEqual(extractInquirySearchTerms('[[Quorum]] #consensus raft'), ['consensus', 'Quorum', 'raft']);
    assert.deepEqual(deckTagCounts(data.inquiries!), [
      { tag: 'consensus', count: 2 },
      { tag: 'distributed', count: 2 },
      { tag: 'aerospace', count: 1 },
    ]);

    const md = formatInquiriesMarkdown([q2, q3], subjectLookup);
    assert.ok(md.includes('### What is Choked Flow?'));
    assert.ok(md.includes('Mass flow rate stops increasing'));
    assert.ok(md.includes('### Alpha Open Question?'));
    assert.ok(md.includes('_Open lookup (not answered yet)_'));

    // Quiz itemSearchText & summarizeAnswer
    importQuestions(subject, GRADED_REPLY, {}, makeId, NOW);
    const gradedItem = subject.items.find((i) => i.kind === 'graded')!;
    const cardItem = subject.items.find((i) => i.kind === 'card')!;
    const gradedHay = itemSearchText(gradedItem);
    const cardHay = itemSearchText(cardItem);
    assert.ok(gradedHay.includes('2942 m/s') && gradedHay.includes('mass ratio'));
    assert.ok(cardHay.includes('convergent-divergent') && cardHay.includes('Mach 1'));
    assert.equal(summarizeAnswer({ type: 'choice', options: ['A', 'B'], correct: 1 }), 'B');
  } finally {
    process.chdir(orig);
    await fs.rm(dir, { recursive: true, force: true });
  }
});

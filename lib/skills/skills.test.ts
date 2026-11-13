import test from 'node:test';
import { strict as assert } from 'node:assert';
import { addDays } from '../habits/dates';
import {
  addResource, addSubject, addTopic, answerGraded, editResource, importPlan, importQuestions, itemFeedback, rateCard, rateTopics, removeTopic, saveCard, SkillsInputError,
} from './edit';
import {
  boardSummary, buildQueue, expectedScore, fadedLevel, fitLevel, gradedScore, levelHistory, nextSchedule, nextSteps, retentionAfter, stabilityDays, subjectStats, tierOf,
} from './model';
import { parsePlanReply, parseQuestionsReply } from './parse';
import { buildPlanPrompt, buildQuestionsPrompt } from './prompts';
import { emptyProgress, emptySkills, type ProgressData, type SkillsData, type Subject } from './types';

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

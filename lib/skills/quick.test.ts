import test from 'node:test';
import { strict as assert } from 'node:assert';
import type { Answer } from '../daily/types';
import { isQuickItem, quickQueue, QUICK_MAX } from './quick';
import { emptyProgress, type CardItem, type GradedItem, type ProgressData, type SkillsData, type Subject } from './types';

const TODAY = '2026-11-21';
const CREATED = '2026-11-01T00:00:00.000Z';

function graded(id: string, answer: Answer | Answer[], extra: { difficulty?: number; prompt?: string; topicId?: string } = {}): GradedItem {
  const answers = Array.isArray(answer) ? answer : [answer];
  return {
    id, kind: 'graded', topicId: extra.topicId ?? 't1', createdAt: CREATED, source: 'manual',
    question: {
      id, difficulty: extra.difficulty ?? 2, title: id, prompt: extra.prompt ?? 'Which one?',
      parts: answers.map((a, i) => ({ id: `p${i}`, answer: a })), solution: 'Because.', sources: [],
    },
  };
}

const card = (id: string, topicId = 't1'): CardItem => ({ id, kind: 'card', topicId, createdAt: CREATED, source: 'manual', difficulty: 2, front: `${id}?`, back: 'Yes.' });
const CHOICE: Answer = { type: 'choice', options: ['a', 'b'], correct: 0 };
const NUMERIC: Answer = { type: 'numeric', value: 9.81, unit: 'm/s²' };

function subject(items: (GradedItem | CardItem)[], extra: Partial<Subject> = {}): Subject {
  return {
    id: 's1', name: 'Physics', icon: '⚛️', area: 'Science', status: 'learning', target: 3,
    topics: [
      { id: 't1', name: 'Basics', stage: 1, core: true, createdAt: CREATED },
      { id: 't2', name: 'More', stage: 2, core: true, createdAt: CREATED },
    ],
    resources: [], items, createdAt: CREATED, updatedAt: CREATED, ...extra,
  };
}

test('isQuickItem keeps cards, one-part pick/order questions and short easy numeric ones', () => {
  assert.equal(isQuickItem(card('c')), true);
  assert.equal(isQuickItem(graded('choice', CHOICE)), true);
  assert.equal(isQuickItem(graded('multi', { type: 'multi', options: ['a', 'b'], correct: [0, 1] })), true);
  assert.equal(isQuickItem(graded('order', { type: 'order', items: ['a', 'b'] })), true);
  assert.equal(isQuickItem(graded('num', NUMERIC)), true);
  assert.equal(isQuickItem(graded('hard-num', NUMERIC, { difficulty: 3 })), false);
  assert.equal(isQuickItem(graded('long-num', NUMERIC, { prompt: 'x'.repeat(400) })), false);
  assert.equal(isQuickItem(graded('two-parts', [CHOICE, CHOICE])), false);
  assert.equal(isQuickItem(graded('range', { type: 'range', min: 0, max: 6 })), false);
  assert.equal(isQuickItem({ ...card('gone'), retired: true }), false);
});

test('quickQueue: due first, then weak topics, then new, then the rest', () => {
  const items = [
    graded('new-choice', CHOICE),
    graded('due-choice', CHOICE),
    card('later-card', 't2'),
    graded('due-long', [CHOICE, CHOICE]),
    card('weak-card', 't1'),
  ];
  const data: SkillsData = { subjects: [subject(items)] };
  const progress: ProgressData = emptyProgress();
  const sched = (due: string, last: string) => ({ due, interval: 3, ease: 2.5, reps: 2, lapses: 0, last });
  progress.schedule['due-choice'] = sched('2026-11-19', '2026-11-16');
  progress.schedule['due-long'] = sched('2026-11-18', '2026-11-15');
  progress.schedule['later-card'] = sched('2026-11-30', '2026-11-20');
  progress.schedule['weak-card'] = sched('2026-11-29', '2026-11-19');
  // Topic t1 has gone badly lately (weak); t2 is fine.
  const attempt = (itemId: string, topicId: string, day: string, score: number) => ({
    id: `${itemId}-${day}`, subjectId: 's1', topicId, itemId, day, at: `${day}T10:00:00.000Z`, score, difficulty: 2,
  });
  progress.attempts.push(
    ...['2026-11-15', '2026-11-16', '2026-11-17', '2026-11-19'].map((d) => attempt('weak-card', 't1', d, 0)),
    ...['2026-11-14', '2026-11-17', '2026-11-20'].map((d) => attempt('later-card', 't2', d, 1)),
  );

  const queue = quickQueue(data, progress, TODAY);
  assert.deepEqual(queue.map((e) => [e.item.id, e.quickReason]), [
    ['due-choice', 'due'],
    ['weak-card', 'weak'],
    ['new-choice', 'new'],
    ['later-card', 'practice'],
  ]);
  assert.equal(quickQueue(data, progress, TODAY, 2).length, 2);
});

test('quickQueue skips paused subjects, answered-today items, and caps at five', () => {
  const many = Array.from({ length: 9 }, (_, i) => card(`c${i}`));
  const progress = emptyProgress();
  progress.attempts.push({ id: 'a', subjectId: 's1', topicId: 't1', itemId: 'c0', day: TODAY, at: `${TODAY}T08:00:00.000Z`, score: 1, difficulty: 2, rating: 'easy' });
  progress.schedule.c0 = { due: '2026-11-25', interval: 4, ease: 2.5, reps: 1, lapses: 0, last: TODAY };
  const queue = quickQueue({ subjects: [subject(many)] }, progress, TODAY, 50);
  assert.equal(queue.length, QUICK_MAX);
  assert.ok(!queue.some((e) => e.item.id === 'c0'));
  assert.deepEqual(quickQueue({ subjects: [subject(many, { status: 'paused' })] }, emptyProgress(), TODAY), []);
  assert.deepEqual(quickQueue({ subjects: [] }, emptyProgress(), TODAY), []);
});

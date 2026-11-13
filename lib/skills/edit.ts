// Every change to the skills data, from untrusted input. Each function cleans
// what it's given, changes the data in place and says what it did, or throws a
// SkillsInputError with a message worth showing.

import { gradeQuestion, parseResponses } from '@/lib/daily/grade';
import type { PartResponse, Question } from '@/lib/daily/types';
import type { DateKey } from '@/lib/habits/dates';
import { cardScore, gradedScore, nextSchedule } from './model';
import { LIMITS, SkillsInputError, parsePlanReply, parseQuestionsReply, sameName } from './parse';
import {
  CARD_RATINGS, MAX_LEVEL, RESOURCE_KINDS, RESOURCE_STATUSES, SUBJECT_STATUSES, itemDifficulty,
  type CardItem, type CardRating, type Item, type ProgressData, type Resource, type ResourceKind, type ResourceStatus, type SkillAttempt,
  type SkillQuestion, type SkillsData, type Stage, type Subject, type SubjectStatus, type Topic,
} from './types';

export { SkillsInputError };

type Input = Record<string, unknown>;
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const has = (input: Input, key: string) => Object.prototype.hasOwnProperty.call(input, key);
const isId = (v: unknown): v is string => typeof v === 'string' && /^[\w-]{1,64}$/.test(v);

/** Set an optional text field: '' or null removes it. */
function setText<T extends object>(target: T, key: keyof T & string, value: unknown, max: number) {
  const t = text(value, max);
  if (t) (target as Record<string, unknown>)[key] = t;
  else delete (target as Record<string, unknown>)[key];
}

function intIn(v: unknown, min: number, max: number): number | undefined {
  const n = typeof v === 'string' && v.trim() ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : undefined;
}

function levelIn(v: unknown): number | undefined {
  const n = typeof v === 'string' && v.trim() ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? Math.min(MAX_LEVEL, Math.max(0, Math.round(n * 2) / 2)) : undefined;
}

export const DEFAULT_ICON = '🎯';
const icon = (v: unknown) => {
  const t = text(v, 16);
  return t && [...t].length <= 4 ? t : DEFAULT_ICON;
};

// ── Finding things ───────────────────────────────────────────────────────────

export function findSubject(data: SkillsData, id: unknown) {
  const subject = isId(id) ? data.subjects.find((s) => s.id === id) : undefined;
  if (!subject) throw new SkillsInputError('That subject isn’t here any more.');
  return subject;
}

export function findTopic(subject: Subject, id: unknown) {
  const topic = isId(id) ? subject.topics.find((t) => t.id === id) : undefined;
  if (!topic) throw new SkillsInputError('That topic isn’t here any more.');
  return topic;
}

function findResource(subject: Subject, id: unknown) {
  const resource = isId(id) ? subject.resources.find((r) => r.id === id) : undefined;
  if (!resource) throw new SkillsInputError('That resource isn’t here any more.');
  return resource;
}

export function findItem(subject: Subject, id: unknown) {
  const item = isId(id) ? subject.items.find((i) => i.id === id) : undefined;
  if (!item) throw new SkillsInputError('That question isn’t here any more.');
  return item;
}

/** The subject holding a question, wherever it is. */
export function findItemAnywhere(data: SkillsData, id: unknown) {
  for (const subject of data.subjects) {
    const item = isId(id) ? subject.items.find((i) => i.id === id) : undefined;
    if (item) return { subject, item };
  }
  throw new SkillsInputError('That question isn’t here any more.');
}

const touch = (subject: Subject, now: string) => { subject.updatedAt = now; };

// ── Subjects ─────────────────────────────────────────────────────────────────

export function addSubject(data: SkillsData, input: Input, makeId: () => string, now: string) {
  const name = text(input.name, LIMITS.name);
  if (!name) throw new SkillsInputError('Give the subject a name.');
  if (data.subjects.some((s) => sameName(s.name, name))) throw new SkillsInputError(`You already have ${name}.`);
  if (data.subjects.length >= 300) throw new SkillsInputError('That’s a lot of subjects. Remove some first.');
  const subject: Subject = {
    id: makeId(), name, icon: icon(input.icon), area: text(input.area, 60) || 'General',
    status: SUBJECT_STATUSES.includes(input.status as SubjectStatus) ? input.status as SubjectStatus : 'learning',
    target: intIn(input.target, 1, MAX_LEVEL) ?? 4,
    topics: [], resources: [], items: [], createdAt: now, updatedAt: now,
  };
  editSubject(subject, { goal: input.goal, background: input.background, hoursPerWeek: input.hoursPerWeek }, now);
  data.subjects.push(subject);
  return subject;
}

export function editSubject(subject: Subject, input: Input, now: string) {
  if (has(input, 'name')) {
    const name = text(input.name, LIMITS.name);
    if (!name) throw new SkillsInputError('A subject needs a name.');
    subject.name = name;
  }
  if (has(input, 'icon')) subject.icon = icon(input.icon);
  if (has(input, 'area')) subject.area = text(input.area, 60) || 'General';
  if (has(input, 'status') && SUBJECT_STATUSES.includes(input.status as SubjectStatus)) subject.status = input.status as SubjectStatus;
  if (has(input, 'target')) subject.target = intIn(input.target, 1, MAX_LEVEL) ?? subject.target;
  if (has(input, 'goal')) setText(subject, 'goal', input.goal, 1000);
  if (has(input, 'background')) setText(subject, 'background', input.background, 2000);
  if (has(input, 'roadmap')) setText(subject, 'roadmap', input.roadmap, LIMITS.roadmap);
  if (has(input, 'hoursPerWeek')) {
    const hours = intIn(input.hoursPerWeek, 0, 80);
    if (hours) subject.hoursPerWeek = hours;
    else delete subject.hoursPerWeek;
  }
  touch(subject, now);
  return subject;
}

/** Remove a subject and everything recorded against it. */
export function removeSubject(data: SkillsData, progress: ProgressData, id: unknown) {
  const subject = findSubject(data, id);
  data.subjects = data.subjects.filter((s) => s !== subject);
  forgetItems(progress, subject.items.map((i) => i.id));
  progress.attempts = progress.attempts.filter((a) => a.subjectId !== subject.id);
}

function forgetItems(progress: ProgressData, ids: string[]) {
  const gone = new Set(ids);
  progress.attempts = progress.attempts.filter((a) => !gone.has(a.itemId));
  for (const id of ids) delete progress.schedule[id];
}

// ── Topics ───────────────────────────────────────────────────────────────────

const stage = (v: unknown, fallback: Stage): Stage => (intIn(v, 1, 4) ?? fallback) as Stage;

export function addTopic(subject: Subject, input: Input, makeId: () => string, now: string) {
  const name = text(input.name, LIMITS.name);
  if (!name) throw new SkillsInputError('Give the topic a name.');
  if (subject.topics.some((t) => sameName(t.name, name))) throw new SkillsInputError(`${subject.name} already has ${name}.`);
  if (subject.topics.length >= 150) throw new SkillsInputError('That’s a lot of topics for one subject. Split it into two subjects.');
  const topic: Topic = { id: makeId(), name, stage: stage(input.stage, 2), core: input.core !== false, createdAt: now };
  subject.topics.push(topic);
  editTopic(subject, topic, { description: input.description, notes: input.notes, ...(has(input, 'selfRating') ? { selfRating: input.selfRating } : {}) }, now.slice(0, 10), now);
  return topic;
}

export function editTopic(subject: Subject, topic: Topic, input: Input, today: DateKey, now: string) {
  if (has(input, 'name')) {
    const name = text(input.name, LIMITS.name);
    if (!name) throw new SkillsInputError('A topic needs a name.');
    if (subject.topics.some((t) => t !== topic && sameName(t.name, name))) throw new SkillsInputError(`${subject.name} already has ${name}.`);
    topic.name = name;
  }
  if (has(input, 'stage')) topic.stage = stage(input.stage, topic.stage);
  if (has(input, 'core')) topic.core = input.core !== false;
  if (has(input, 'description')) setText(topic, 'description', input.description, LIMITS.description);
  if (has(input, 'notes')) setText(topic, 'notes', input.notes, 4000);
  if (has(input, 'selfRating')) {
    const rating = input.selfRating === null || input.selfRating === '' ? undefined : levelIn(input.selfRating);
    if (rating === undefined) { delete topic.selfRating; delete topic.selfRatedOn; }
    else if (rating !== topic.selfRating) { topic.selfRating = rating; topic.selfRatedOn = today; }
  }
  touch(subject, now);
  return topic;
}

/** Self-ratings for many topics at once: { topicId: 0–5 | null }. */
export function rateTopics(subject: Subject, ratings: unknown, today: DateKey, now: string) {
  if (!ratings || typeof ratings !== 'object') throw new SkillsInputError('No ratings were sent.');
  for (const [id, value] of Object.entries(ratings)) {
    const topic = subject.topics.find((t) => t.id === id);
    if (topic) editTopic(subject, topic, { selfRating: value }, today, now);
  }
}

/** Move a topic up or down within the subject's list. */
export function moveTopic(subject: Subject, topicId: unknown, direction: unknown) {
  const topic = findTopic(subject, topicId);
  const from = subject.topics.indexOf(topic);
  const to = from + (direction === 'up' ? -1 : 1);
  if (to < 0 || to >= subject.topics.length) return;
  subject.topics.splice(from, 1);
  subject.topics.splice(to, 0, topic);
}

/** Remove a topic, its questions and their history, and untie it from resources. */
export function removeTopic(subject: Subject, progress: ProgressData, topicId: unknown, now: string) {
  const topic = findTopic(subject, topicId);
  subject.topics = subject.topics.filter((t) => t !== topic);
  const gone = subject.items.filter((i) => i.topicId === topic.id);
  subject.items = subject.items.filter((i) => i.topicId !== topic.id);
  forgetItems(progress, gone.map((i) => i.id));
  for (const r of subject.resources) r.topicIds = r.topicIds.filter((id) => id !== topic.id);
  touch(subject, now);
}

// ── Resources ────────────────────────────────────────────────────────────────

function cleanTopicIds(subject: Subject, value: unknown) {
  return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === 'string' && subject.topics.some((t) => t.id === id)))] : [];
}

export function addResource(subject: Subject, input: Input, makeId: () => string, today: DateKey, now: string) {
  const title = text(input.title, LIMITS.title);
  if (!title) throw new SkillsInputError('Give it a title.');
  if (subject.resources.length >= 300) throw new SkillsInputError('That’s a lot of resources for one subject.');
  const resource: Resource = {
    id: makeId(), title, kind: RESOURCE_KINDS.includes(input.kind as ResourceKind) ? input.kind as ResourceKind : 'book',
    topicIds: cleanTopicIds(subject, input.topicIds), status: 'planned', createdAt: now,
  };
  subject.resources.push(resource);
  editResource(subject, resource, { ...input, title: undefined }, today, now);
  return resource;
}

export function editResource(subject: Subject, resource: Resource, input: Input, today: DateKey, now: string) {
  if (has(input, 'title') && input.title !== undefined) {
    const title = text(input.title, LIMITS.title);
    if (!title) throw new SkillsInputError('A resource needs a title.');
    resource.title = title;
  }
  if (has(input, 'kind') && RESOURCE_KINDS.includes(input.kind as ResourceKind)) resource.kind = input.kind as ResourceKind;
  if (has(input, 'author')) setText(resource, 'author', input.author, LIMITS.author);
  if (has(input, 'detail')) setText(resource, 'detail', input.detail, LIMITS.detail);
  if (has(input, 'takeaways')) setText(resource, 'takeaways', input.takeaways, 6000);
  if (has(input, 'url')) {
    const url = text(input.url, 600);
    if (url && !/^https?:\/\/[^\s"<>]+$/.test(url)) throw new SkillsInputError('The link should start with https://');
    setText(resource, 'url', url, 600);
  }
  if (has(input, 'topicIds')) resource.topicIds = cleanTopicIds(subject, input.topicIds);
  if (has(input, 'hours')) {
    const hours = intIn(input.hours, 0, 5000);
    if (hours) resource.hours = hours;
    else delete resource.hours;
  }
  if (has(input, 'progress')) {
    const p = input.progress as Input | null;
    const done = intIn(p?.done, 0, 100000);
    const total = intIn(p?.total, 1, 100000);
    if (p && total !== undefined) resource.progress = { done: Math.min(done ?? 0, total), total, unit: text(p.unit, 20) || 'pages' };
    else delete resource.progress;
  }
  if (has(input, 'status') && RESOURCE_STATUSES.includes(input.status as ResourceStatus)) {
    const status = input.status as ResourceStatus;
    if (status !== resource.status) {
      if (status === 'doing' && !resource.startedOn) resource.startedOn = today;
      if (status === 'done') {
        resource.finishedOn = today;
        if (!resource.startedOn) resource.startedOn = today;
        if (resource.progress) resource.progress.done = resource.progress.total;
      } else delete resource.finishedOn;
      resource.status = status;
    }
  }
  touch(subject, now);
  return resource;
}

export function removeResource(subject: Subject, resourceId: unknown, now: string) {
  const resource = findResource(subject, resourceId);
  subject.resources = subject.resources.filter((r) => r !== resource);
  touch(subject, now);
}

export const resourceOf = findResource;

// ── Plans from an AI ─────────────────────────────────────────────────────────

/**
 * Add the chosen parts of a plan reply: topics (by key) and resources (by index),
 * and the roadmap if asked. Topics that already exist are reused, never doubled.
 */
export function importPlan(subject: Subject, reply: unknown, input: { topicKeys?: unknown; resourceIndexes?: unknown; roadmap?: unknown }, makeId: () => string, now: string) {
  const plan = parsePlanReply(typeof reply === 'string' ? reply : '', subject);
  const wantedTopics = Array.isArray(input.topicKeys) ? new Set(input.topicKeys) : null;
  const wantedResources = Array.isArray(input.resourceIndexes) ? new Set(input.resourceIndexes) : null;
  const ids = new Map<string, string>();
  let topics = 0;
  let resources = 0;
  for (const draft of plan.topics) {
    if (draft.existingId) { ids.set(draft.key, draft.existingId); continue; }
    if (wantedTopics && !wantedTopics.has(draft.key)) continue;
    const topic = addTopic(subject, { name: draft.name, stage: draft.stage, core: draft.core, description: draft.description }, makeId, now);
    ids.set(draft.key, topic.id);
    topics++;
  }
  plan.resources.forEach((draft, index) => {
    if (draft.existingId || (wantedResources && !wantedResources.has(index))) return;
    const topicIds = draft.topicKeys.map((k) => (k.startsWith('existing:') ? k.slice(9) : ids.get(k))).filter((id): id is string => !!id);
    addResource(subject, { ...draft, topicIds }, makeId, now.slice(0, 10), now);
    resources++;
  });
  if (input.roadmap !== false && plan.roadmap) {
    subject.roadmap = subject.roadmap && input.roadmap === 'append'
      ? `${subject.roadmap}\n\n---\n\n_Updated ${now.slice(0, 10)}_\n\n${plan.roadmap}`.slice(0, LIMITS.roadmap)
      : plan.roadmap;
  }
  touch(subject, now);
  return { topics, resources, roadmap: !!plan.roadmap && input.roadmap !== false };
}

// ── Questions ────────────────────────────────────────────────────────────────

/** Add the questions from an AI reply that read cleanly (skipping any indexes asked). */
export function importQuestions(subject: Subject, reply: unknown, input: { skip?: unknown; fallbackTopicId?: unknown }, makeId: () => string, now: string) {
  const parsed = parseQuestionsReply(typeof reply === 'string' ? reply : '', subject, { fallbackTopicId: isId(input.fallbackTopicId) ? input.fallbackTopicId : undefined });
  const skip = new Set(Array.isArray(input.skip) ? input.skip : []);
  if (subject.items.length >= 3000) throw new SkillsInputError('This subject has 3000 questions already. Retire or delete some first.');
  let added = 0;
  parsed.questions.forEach((q, index) => {
    if (!q.ok || skip.has(index)) return;
    const id = makeId();
    const base = { id, topicId: q.item.topicId, createdAt: now, source: 'ai' as const };
    subject.items.push(q.item.kind === 'graded' ? { ...base, kind: 'graded', question: { ...q.item.question, id } } : { ...base, kind: 'card', difficulty: q.item.difficulty, front: q.item.front, back: q.item.back });
    added++;
  });
  if (!added) throw new SkillsInputError('None of those questions could be added.');
  touch(subject, now);
  return { added, failed: parsed.questions.filter((q) => !q.ok).length };
}

/** A recall card written by hand (also how cards are edited). */
export function saveCard(subject: Subject, input: Input, makeId: () => string, now: string) {
  const topic = findTopic(subject, input.topicId);
  const front = text(input.front, LIMITS.front);
  const back = text(input.back, LIMITS.back);
  if (!front || !back) throw new SkillsInputError('A card needs a front and a back.');
  const difficulty = intIn(input.difficulty, 1, 5) ?? 2;
  if (input.itemId !== undefined) {
    const item = findItem(subject, input.itemId);
    if (item.kind !== 'card') throw new SkillsInputError('Only cards can be edited here.');
    Object.assign(item, { topicId: topic.id, front, back, difficulty });
    touch(subject, now);
    return item;
  }
  const card: CardItem = { id: makeId(), kind: 'card', topicId: topic.id, front, back, difficulty, createdAt: now, source: 'manual' };
  subject.items.push(card);
  touch(subject, now);
  return card;
}

export function moveItem(subject: Subject, item: Item, topicId: unknown, now: string) {
  item.topicId = findTopic(subject, topicId).id;
  touch(subject, now);
}

export function retireItem(subject: Subject, item: Item, retired: boolean, now: string) {
  if (retired) item.retired = true;
  else delete item.retired;
  touch(subject, now);
}

export function removeItem(subject: Subject, progress: ProgressData, item: Item, now: string) {
  subject.items = subject.items.filter((i) => i !== item);
  forgetItems(progress, [item.id]);
  touch(subject, now);
}

/** Votes and reports. Reporting a question retires it; withdrawing the report brings it back. */
export function itemFeedback(subject: Subject, item: Item, input: Input, now: string) {
  const fb = { ...item.feedback };
  if (has(input, 'rating')) { if (input.rating === 'up' || input.rating === 'down') fb.rating = input.rating; else delete fb.rating; }
  if (has(input, 'difficulty')) { if (['easy', 'right', 'hard'].includes(input.difficulty as string)) fb.difficulty = input.difficulty as 'easy'; else delete fb.difficulty; }
  if (has(input, 'report')) {
    const r = input.report as Input | null;
    if (r && typeof r === 'object') {
      fb.report = { kind: text(r.kind, 40) || 'other', note: text(r.note, 1000) };
      item.retired = true;
    } else if (fb.report) {
      delete fb.report;
      delete item.retired;
    }
  }
  if (Object.keys(fb).length) item.feedback = fb;
  else delete item.feedback;
  touch(subject, now);
  return item.feedback ?? {};
}

// ── Answering ────────────────────────────────────────────────────────────────

export const MAX_TRIES = 3;

/** A graded question as the daily grader wants it. */
export const asDailyQuestion = (q: SkillQuestion, topic: string): Question => ({ ...q, track: 'mechanical', topic });

function record(progress: ProgressData, attempt: SkillAttempt, rating?: CardRating) {
  progress.attempts.push(attempt);
  progress.schedule[attempt.itemId] = nextSchedule(progress.schedule[attempt.itemId], attempt.score, attempt.day, rating);
  return attempt;
}

/**
 * Check a graded answer, or open the solution (`responses` null). Not all right
 * with checks left: returns the marks only and saves nothing. Otherwise the go is
 * recorded and the answer key comes back.
 */
export function answerGraded(subject: Subject, item: Item, progress: ProgressData, input: { responses?: unknown; hints?: unknown; tries?: unknown }, makeId: () => string, today: DateKey, now: string) {
  if (item.kind !== 'graded') throw new SkillsInputError('That one is a card.');
  const question = asDailyQuestion(item.question, '');
  const reveal = input.responses === null || input.responses === undefined;
  const responses: Record<string, PartResponse> | null = reveal ? null : parseResponses(question, input.responses);
  if (!reveal && Object.keys(responses!).length !== question.parts.length) throw new SkillsInputError('Answer every part first.');
  const hints = intIn(input.hints, 0, question.hints?.length ?? 0) ?? 0;
  const tries = (intIn(input.tries, 0, MAX_TRIES - 1) ?? 0) + (reveal ? 0 : 1);
  const result = gradeQuestion(question, responses);
  if (!reveal && result.status !== 'solved' && tries < MAX_TRIES) {
    return { final: false as const, tries, triesLeft: MAX_TRIES - tries, parts: result.parts, correct: result.correct, total: result.total };
  }
  const attempt = record(progress, {
    id: makeId(), subjectId: subject.id, topicId: item.topicId, itemId: item.id, day: today, at: now,
    score: gradedScore(result.correct, result.total, Math.max(1, tries), hints, reveal), difficulty: item.question.difficulty,
    status: result.status, responses, hints, tries: Math.max(1, tries),
  });
  return { final: true as const, attempt, result, question: item.question };
}

export function rateCard(subject: Subject, item: Item, progress: ProgressData, rating: unknown, makeId: () => string, today: DateKey, now: string) {
  if (item.kind !== 'card') throw new SkillsInputError('That one is a graded question.');
  if (!CARD_RATINGS.includes(rating as CardRating)) throw new SkillsInputError('Rate it again, hard, good or easy.');
  return record(progress, {
    id: makeId(), subjectId: subject.id, topicId: item.topicId, itemId: item.id, day: today, at: now,
    score: cardScore(rating as CardRating), difficulty: itemDifficulty(item), rating: rating as CardRating,
  }, rating as CardRating);
}

// Every change to the skills data, from untrusted input. Each function cleans
// what it's given, updates the data and says what it did, or throws a
// SkillsInputError with a message worth showing.

import { gradeQuestion, parseResponses } from '@/lib/daily/grade';
import type { PartResponse, Question } from '@/lib/daily/types';
import { isDateKey, type DateKey } from '@/lib/habits/dates';
import { cardScore, generateScheduleFromSteps, gradedScore, nextSchedule, shiftScheduleToToday, wouldCreateSkillCycle } from './model';
import {
  LIMITS, SkillsInputError, inquiryConceptAlias, normalizeInquiryQuestionKey, normalizeInquirySources,
  normalizeInquiryTags, parseInquiryReply, parseInterconnectedPlanReply, parsePlanReply, parseQuestionsReply, sameName,
} from './parse';
import {
  CARD_RATINGS, INQUIRY_STATUSES, MAX_LEVEL, PROJECT_ATTACHMENT_KINDS, RESOURCE_KINDS, RESOURCE_STATUSES,
  SKILL_STEP_KINDS, SUBJECT_STATUSES, itemDifficulty,
  type CardItem, type CardRating, type DraftInquiryAnswer, type DraftResource, type DraftStep, type DraftTopic,
  type InquiryStatus, type InterconnectedPlanDraft, type Item, type KnowledgeInquiry, type ProgressData,
  type ProjectAttachment, type ProjectAttachmentKind, type ProjectLogEntry, type Resource, type ResourceKind,
  type ResourceStatus, type ScheduledSkillTask, type SkillAttempt, type SkillEdit, type SkillQuestion,
  type SkillSchedule, type SkillStep, type SkillStepKind, type SkillsData, type Stage, type Subject,
  type SubjectStatus, type Topic,
} from './types';

export { SkillsInputError };

type Input = Record<string, unknown>;
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const has = (input: Input, key: string) => Object.prototype.hasOwnProperty.call(input, key);
const isId = (v: unknown): v is string => typeof v === 'string' && /^[\w-]{1,64}$/.test(v);
const isWebUrl = (v: string) => /^https?:\/\/[^\s"<>]+$/.test(v);
const isAttachmentUrl = (v: string) => isWebUrl(v) || /^\/(?!\/)[^\s"<>]*$/.test(v);

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

export function findStep(subject: Subject, id: unknown) {
  const step = isId(id) ? (subject.steps ?? []).find((s) => s.id === id) : undefined;
  if (!step) throw new SkillsInputError('That step isn’t here any more.');
  return step;
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

function cleanStepRecord(
  subject: Pick<Subject, 'topics' | 'resources'>,
  raw: Input,
  makeId: () => string,
  today: DateKey,
): SkillStep {
  const title = text(raw.title, LIMITS.title);
  if (!title) throw new SkillsInputError('Give the step a title.');
  const kind: SkillStepKind = SKILL_STEP_KINDS.includes(raw.kind as SkillStepKind) ? raw.kind as SkillStepKind : 'other';
  const amount = text(raw.amount, LIMITS.amount);
  const detail = text(raw.detail, LIMITS.detail);
  const topicId = isId(raw.topicId) && subject.topics.some((t) => t.id === raw.topicId) ? raw.topicId : undefined;
  const resourceId = isId(raw.resourceId) && subject.resources.some((r) => r.id === raw.resourceId) ? raw.resourceId : undefined;
  const minutes = intIn(raw.minutes, 1, 600);
  const done = raw.done === true;
  const completedOn = done ? (isDateKey(raw.completedOn) ? raw.completedOn : today) : undefined;
  return {
    id: isId(raw.id) ? raw.id : makeId(),
    title,
    kind,
    ...(amount ? { amount } : {}),
    ...(detail ? { detail } : {}),
    ...(topicId ? { topicId } : {}),
    ...(resourceId ? { resourceId } : {}),
    ...(minutes ? { minutes } : {}),
    ...(done ? { done: true, completedOn } : {}),
  };
}

export function addSubject(data: SkillsData, input: Input, makeId: () => string, now: string) {
  const name = text(input.name, LIMITS.name);
  if (!name) throw new SkillsInputError('Give the subject a name.');
  if (data.subjects.some((s) => sameName(s.name, name))) throw new SkillsInputError(`You already have ${name}.`);
  if (data.subjects.length >= 300) throw new SkillsInputError('That’s a lot of subjects. Remove some first.');

  let parentIds: string[] | undefined;
  if (has(input, 'parentIds') && input.parentIds !== undefined) {
    if (!Array.isArray(input.parentIds)) throw new SkillsInputError('Parent skills must be a list.');
    const seen = new Set<string>();
    const clean: string[] = [];
    for (const pid of input.parentIds) {
      const parent = findSubject(data, pid);
      if (!seen.has(parent.id)) {
        seen.add(parent.id);
        clean.push(parent.id);
      }
    }
    if (clean.length) parentIds = clean;
  }

  const subject: Subject = {
    id: makeId(), name, icon: icon(input.icon), area: text(input.area, 60) || 'General',
    status: SUBJECT_STATUSES.includes(input.status as SubjectStatus) ? input.status as SubjectStatus : 'learning',
    target: intIn(input.target, 1, MAX_LEVEL) ?? 4,
    ...(parentIds ? { parentIds } : {}),
    topics: [], resources: [], items: [], createdAt: now, updatedAt: now,
  };
  if (has(input, 'steps') && Array.isArray(input.steps)) {
    const steps = input.steps
      .slice(0, 300)
      .filter((s): s is Input => !!s && typeof s === 'object')
      .map((s) => cleanStepRecord(subject, s, makeId, now.slice(0, 10)));
    if (steps.length) subject.steps = steps;
  }
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
  if (has(input, 'autoTopUp')) {
    if (input.autoTopUp === true) subject.autoTopUp = true;
    else delete subject.autoTopUp;
  }
  if (has(input, 'hoursPerWeek')) {
    const hours = intIn(input.hoursPerWeek, 0, 80);
    if (hours) subject.hoursPerWeek = hours;
    else delete subject.hoursPerWeek;
  }
  if (has(input, 'parentIds')) {
    if (Array.isArray(input.parentIds)) {
      const clean = [...new Set(input.parentIds.filter((pid): pid is string => isId(pid) && pid !== subject.id))];
      if (clean.length) subject.parentIds = clean;
      else delete subject.parentIds;
    } else if (input.parentIds === null) {
      delete subject.parentIds;
    }
  }
  if (has(input, 'steps')) {
    if (Array.isArray(input.steps)) {
      const today = now.slice(0, 10);
      subject.steps = input.steps
        .slice(0, 300)
        .filter((s): s is Input => !!s && typeof s === 'object' && isId((s as Input).id))
        .map((s) => cleanStepRecord(subject, s, () => String(s.id), today));
    } else if (input.steps === null) {
      delete subject.steps;
    }
  }
  touch(subject, now);
  return subject;
}

/** Set parent/prerequisite links for a subject, rejecting self-links and cycles. */
export function setParents(data: SkillsData, subjectId: unknown, parentIdsInput: unknown, now: string): Subject {
  const subject = findSubject(data, subjectId);
  if (!Array.isArray(parentIdsInput)) throw new SkillsInputError('Parent skills must be a list.');
  const clean: string[] = [];
  const seen = new Set<string>();
  for (const rawPid of parentIdsInput) {
    const parent = findSubject(data, rawPid);
    if (parent.id === subject.id) throw new SkillsInputError('A skill cannot be its own parent.');
    if (wouldCreateSkillCycle(data, subject.id, parent.id)) {
      throw new SkillsInputError(`Linking "${parent.name}" as a parent of "${subject.name}" would create a cycle.`);
    }
    if (!seen.has(parent.id)) {
      seen.add(parent.id);
      clean.push(parent.id);
    }
  }
  if (clean.length) subject.parentIds = clean;
  else delete subject.parentIds;
  touch(subject, now);
  return subject;
}

/** Remove a subject and everything recorded against it. */
export function removeSubject(data: SkillsData, progress: ProgressData, id: unknown) {
  const subject = findSubject(data, id);
  data.subjects = data.subjects.filter((s) => s !== subject);
  for (const s of data.subjects) {
    if (s.parentIds?.includes(subject.id)) {
      const next = s.parentIds.filter((pid) => pid !== subject.id);
      if (next.length) s.parentIds = next;
      else delete s.parentIds;
    }
  }
  if (data.schedule) {
    data.schedule = {
      ...data.schedule,
      tasks: data.schedule.tasks.filter((t) => t.subjectId !== subject.id),
    };
  }
  if (data.inquiries) {
    for (const q of data.inquiries) {
      if (q.subjectId === subject.id) {
        delete q.subjectId;
        delete q.topicId;
      }
    }
  }
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

/** Remove a topic, its questions and their history, and untie it from resources and steps. */
export function removeTopic(subject: Subject, progress: ProgressData, topicId: unknown, now: string, data?: SkillsData) {
  const topic = findTopic(subject, topicId);
  subject.topics = subject.topics.filter((t) => t !== topic);
  const gone = subject.items.filter((i) => i.topicId === topic.id);
  subject.items = subject.items.filter((i) => i.topicId !== topic.id);
  forgetItems(progress, gone.map((i) => i.id));
  for (const r of subject.resources) r.topicIds = r.topicIds.filter((id) => id !== topic.id);
  if (subject.steps) {
    subject.steps = subject.steps.map((st) => {
      if (st.topicId !== topic.id) return st;
      const { topicId: _t, ...rest } = st;
      return rest;
    });
  }
  if (data?.inquiries) {
    for (const q of data.inquiries) {
      if (q.topicId === topic.id) delete q.topicId;
    }
  }
  touch(subject, now);
}

// ── Resources & project logs ─────────────────────────────────────────────────

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
    if (url && !isWebUrl(url)) throw new SkillsInputError('The link should start with https://');
    setText(resource, 'url', url, 600);
  }
  if (has(input, 'freePdfUrl')) {
    const freePdfUrl = text(input.freePdfUrl, 600);
    if (freePdfUrl && !isWebUrl(freePdfUrl)) throw new SkillsInputError('The free PDF link should start with https://');
    setText(resource, 'freePdfUrl', freePdfUrl, 600);
  }
  if (has(input, 'youtubeAudioUrl')) {
    const youtubeAudioUrl = text(input.youtubeAudioUrl, 600);
    if (youtubeAudioUrl && !isWebUrl(youtubeAudioUrl)) throw new SkillsInputError('The YouTube link should start with https://');
    setText(resource, 'youtubeAudioUrl', youtubeAudioUrl, 600);
  }
  if (has(input, 'topicIds')) resource.topicIds = cleanTopicIds(subject, input.topicIds);
  if (has(input, 'readerBookId')) {
    if (isId(input.readerBookId)) resource.readerBookId = input.readerBookId;
    else delete resource.readerBookId;
  }
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
  if (subject.steps) {
    subject.steps = subject.steps.map((st) => {
      if (st.resourceId !== resource.id) return st;
      const { resourceId: _r, ...rest } = st;
      return rest;
    });
  }
  touch(subject, now);
}

export const resourceOf = findResource;

function cleanAttachments(value: unknown, makeId: () => string): ProjectAttachment[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new SkillsInputError('Attachments must be a list.');
  return value.slice(0, 20).map((raw) => {
    if (!raw || typeof raw !== 'object') throw new SkillsInputError('Invalid attachment.');
    const a = raw as Input;
    const url = text(a.url, 1000);
    if (!url || !isAttachmentUrl(url)) throw new SkillsInputError('Each attachment needs a valid https:// or site-relative / URL.');
    const name = text(a.name, 200) || 'Attachment';
    const kind: ProjectAttachmentKind = PROJECT_ATTACHMENT_KINDS.includes(a.kind as ProjectAttachmentKind)
      ? a.kind as ProjectAttachmentKind
      : 'file';
    const size = intIn(a.size, 0, 2_000_000_000);
    const mime = text(a.mime, 120);
    return {
      id: isId(a.id) ? a.id : makeId(),
      kind,
      name,
      url,
      ...(size !== undefined ? { size } : {}),
      ...(mime ? { mime } : {}),
    };
  });
}

export function addProjectLog(
  subject: Subject,
  resource: Resource,
  input: Input,
  makeId: () => string,
  today: DateKey,
  now: string,
): ProjectLogEntry {
  const title = text(input.title, LIMITS.title);
  if (!title) throw new SkillsInputError('Give the log entry a title.');
  const existing = resource.logs ?? [];
  if (existing.length >= 500) throw new SkillsInputError('This resource already has 500 log entries.');
  const note = text(input.note, 6000);
  const day = input.day !== undefined && input.day !== '' ? (isDateKey(input.day) ? input.day : (() => { throw new SkillsInputError('Pick a valid YYYY-MM-DD day.'); })()) : today;
  const attachments = cleanAttachments(input.attachments, makeId);
  const entry: ProjectLogEntry = {
    id: makeId(),
    title,
    ...(note ? { note } : {}),
    day,
    createdAt: now,
    attachments,
  };
  resource.logs = [...existing, entry];
  touch(subject, now);
  return entry;
}

export function editProjectLog(
  subject: Subject,
  resource: Resource,
  logId: unknown,
  input: Input,
  now: string,
  makeId: () => string = () => `${Date.now()}`,
): ProjectLogEntry {
  const logs = resource.logs ?? [];
  const idx = isId(logId) ? logs.findIndex((l) => l.id === logId) : -1;
  if (idx < 0) throw new SkillsInputError('That log entry isn’t here any more.');
  const prev = logs[idx];
  const next: ProjectLogEntry = { ...prev, attachments: [...prev.attachments] };

  if (has(input, 'title')) {
    const title = text(input.title, LIMITS.title);
    if (!title) throw new SkillsInputError('A log entry needs a title.');
    next.title = title;
  }
  if (has(input, 'note')) setText(next, 'note', input.note, 6000);
  if (has(input, 'day')) {
    if (!isDateKey(input.day)) throw new SkillsInputError('Pick a valid YYYY-MM-DD day.');
    next.day = input.day;
  }
  if (has(input, 'attachments')) {
    next.attachments = cleanAttachments(input.attachments, makeId);
  }
  resource.logs = logs.map((l, i) => (i === idx ? next : l));
  touch(subject, now);
  return next;
}

export function removeProjectLog(subject: Subject, resource: Resource, logId: unknown, now: string) {
  const logs = resource.logs ?? [];
  const target = isId(logId) ? logs.find((l) => l.id === logId) : undefined;
  if (!target) throw new SkillsInputError('That log entry isn’t here any more.');
  const next = logs.filter((l) => l.id !== target.id);
  if (next.length) resource.logs = next;
  else delete resource.logs;
  touch(subject, now);
}

// ── Explicit study steps ─────────────────────────────────────────────────────

export function addStep(subject: Subject, input: Input, makeId: () => string, today: DateKey, now: string): SkillStep {
  const existing = subject.steps ?? [];
  if (existing.length >= 300) throw new SkillsInputError('That’s a lot of steps for one subject.');
  const step = cleanStepRecord(subject, input, makeId, today);
  subject.steps = [...existing, step];
  touch(subject, now);
  return step;
}

export function editStep(subject: Subject, step: SkillStep, input: Input, today: DateKey, now: string): SkillStep {
  const steps = subject.steps ?? [];
  const idx = steps.indexOf(step);
  if (idx < 0) throw new SkillsInputError('That step isn’t here any more.');
  const next: SkillStep = { ...step };

  if (has(input, 'title') && input.title !== undefined) {
    const title = text(input.title, LIMITS.title);
    if (!title) throw new SkillsInputError('A step needs a title.');
    next.title = title;
  }
  if (has(input, 'kind') && SKILL_STEP_KINDS.includes(input.kind as SkillStepKind)) {
    next.kind = input.kind as SkillStepKind;
  }
  if (has(input, 'amount')) setText(next, 'amount', input.amount, LIMITS.amount);
  if (has(input, 'detail')) setText(next, 'detail', input.detail, LIMITS.detail);
  if (has(input, 'topicId')) {
    if (isId(input.topicId) && subject.topics.some((t) => t.id === input.topicId)) next.topicId = input.topicId;
    else delete next.topicId;
  }
  if (has(input, 'resourceId')) {
    if (isId(input.resourceId) && subject.resources.some((r) => r.id === input.resourceId)) next.resourceId = input.resourceId;
    else delete next.resourceId;
  }
  if (has(input, 'minutes')) {
    const mins = intIn(input.minutes, 1, 600);
    if (mins) next.minutes = mins;
    else delete next.minutes;
  }
  if (has(input, 'done')) {
    if (input.done === true) {
      next.done = true;
      next.completedOn = isDateKey(input.completedOn) ? input.completedOn : (next.completedOn ?? today);
    } else {
      delete next.done;
      delete next.completedOn;
    }
  } else if (has(input, 'completedOn') && next.done && isDateKey(input.completedOn)) {
    next.completedOn = input.completedOn;
  }

  subject.steps = steps.map((s, i) => (i === idx ? next : s));
  touch(subject, now);
  return next;
}

function syncScheduleTasksForStep(data: SkillsData, stepId: string, done: boolean, today: DateKey, now: string) {
  if (!data.schedule) return;
  let changed = false;
  const tasks = data.schedule.tasks.map((t) => {
    if (t.stepId !== stepId) return t;
    changed = true;
    if (done) return { ...t, done: true, completedOn: today };
    const { done: _d, completedOn: _c, ...rest } = t;
    return rest;
  });
  if (changed) {
    data.schedule = { ...data.schedule, updatedAt: now, tasks };
  }
}

/** Flip or set `step.done` (with `completedOn`) and sync any linked scheduled tasks. */
export function toggleStep(
  data: SkillsData,
  subjectId: unknown,
  stepId: unknown,
  done: unknown,
  today: DateKey,
  now: string,
): SkillStep {
  const subject = findSubject(data, subjectId);
  const step = findStep(subject, stepId);
  const nextDone = typeof done === 'boolean' ? done : !step.done;
  const updated = editStep(subject, step, { done: nextDone }, today, now);
  syncScheduleTasksForStep(data, updated.id, nextDone, today, now);
  return updated;
}

export function moveStep(subject: Subject, stepId: unknown, direction: unknown, now?: string) {
  const steps = [...(subject.steps ?? [])];
  const step = findStep(subject, stepId);
  const from = steps.indexOf(step);
  const to = from + (direction === 'up' ? -1 : 1);
  if (to < 0 || to >= steps.length) return;
  steps.splice(from, 1);
  steps.splice(to, 0, step);
  subject.steps = steps;
  if (now) touch(subject, now);
}

export function removeStep(subject: Subject, stepId: unknown, now: string, data?: SkillsData) {
  const step = findStep(subject, stepId);
  subject.steps = (subject.steps ?? []).filter((s) => s.id !== step.id);
  if (data?.schedule) {
    data.schedule = {
      ...data.schedule,
      updatedAt: now,
      tasks: data.schedule.tasks.map((t) => {
        if (t.stepId !== step.id) return t;
        const { stepId: _s, ...rest } = t;
        return rest;
      }),
    };
  }
  touch(subject, now);
}

// ── Skill schedule CRUD ──────────────────────────────────────────────────────

function cleanScheduledTask(
  data: SkillsData,
  raw: Input,
  makeId: () => string,
  today: DateKey,
): ScheduledSkillTask {
  const subject = findSubject(data, raw.subjectId);
  const title = text(raw.title, LIMITS.title);
  if (!title) throw new SkillsInputError('Each scheduled task needs a title.');
  if (!isDateKey(raw.day)) throw new SkillsInputError('Each scheduled task needs a valid YYYY-MM-DD day.');
  const stepId = isId(raw.stepId) && (subject.steps ?? []).some((s) => s.id === raw.stepId) ? raw.stepId : undefined;
  const topicId = isId(raw.topicId) && subject.topics.some((t) => t.id === raw.topicId) ? raw.topicId : undefined;
  const resourceId = isId(raw.resourceId) && subject.resources.some((r) => r.id === raw.resourceId) ? raw.resourceId : undefined;
  const amount = text(raw.amount, LIMITS.amount);
  const detail = text(raw.detail, LIMITS.detail);
  const minutes = intIn(raw.minutes, 1, 600);
  const done = raw.done === true;
  const completedOn = done ? (isDateKey(raw.completedOn) ? raw.completedOn : today) : undefined;
  const manual = raw.manual === true;
  return {
    id: isId(raw.id) ? raw.id : makeId(),
    subjectId: subject.id,
    ...(stepId ? { stepId } : {}),
    ...(topicId ? { topicId } : {}),
    ...(resourceId ? { resourceId } : {}),
    title,
    ...(amount ? { amount } : {}),
    ...(detail ? { detail } : {}),
    ...(minutes ? { minutes } : {}),
    day: raw.day,
    ...(done ? { done: true, completedOn } : {}),
    ...(manual ? { manual: true as const } : {}),
  };
}

export function setSchedule(data: SkillsData, input: Input, makeId: () => string, today: DateKey, now: string): SkillSchedule {
  const source = input.schedule && typeof input.schedule === 'object' && !Array.isArray(input.schedule)
    ? (input.schedule as Input)
    : input;
  const rawTasks = Array.isArray(source.tasks) ? source.tasks : null;
  if (!rawTasks) throw new SkillsInputError('Provide a list of scheduled tasks.');
  const hoursRaw = Number(source.hoursPerDay ?? input.hoursPerDay);
  const hoursPerDay = Number.isFinite(hoursRaw) && hoursRaw > 0 && hoursRaw <= 24 ? Math.round(hoursRaw * 100) / 100 : undefined;
  const tasks = rawTasks
    .slice(0, 1000)
    .filter((t): t is Input => !!t && typeof t === 'object')
    .map((t) => cleanScheduledTask(data, t, makeId, today));
  data.schedule = {
    updatedAt: now,
    ...(hoursPerDay ? { hoursPerDay } : {}),
    tasks,
  };
  return data.schedule;
}

export function shiftSchedule(data: SkillsData, today: DateKey, now: string) {
  const res = shiftScheduleToToday(data.schedule, today);
  if (res.shiftedDays > 0) {
    data.schedule = { ...res.schedule, updatedAt: now };
  }
  return res;
}

/**
 * Shift any overdue schedule forward first, toggle the target task's completion
 * state, and if `task.stepId` is set, sync the corresponding `SkillStep`.
 */
export function toggleScheduleTask(
  data: SkillsData,
  taskId: unknown,
  done: unknown,
  today: DateKey,
  now: string,
) {
  if (!data.schedule) throw new SkillsInputError('There is no schedule yet.');
  const shifted = shiftScheduleToToday(data.schedule, today);
  const baseSchedule: SkillSchedule = shifted.shiftedDays > 0
    ? { ...shifted.schedule, updatedAt: now }
    : data.schedule;

  const idx = isId(taskId) ? baseSchedule.tasks.findIndex((t) => t.id === taskId) : -1;
  if (idx < 0) throw new SkillsInputError('That scheduled task isn’t here any more.');
  const prev = baseSchedule.tasks[idx];
  const nextDone = typeof done === 'boolean' ? done : !prev.done;

  let updatedTask: ScheduledSkillTask;
  if (nextDone) {
    updatedTask = { ...prev, done: true, completedOn: today };
  } else {
    const { done: _d, completedOn: _c, ...rest } = prev;
    updatedTask = rest;
  }

  let tasks = baseSchedule.tasks.map((t, i) => (i === idx ? updatedTask : t));
  if (prev.stepId) {
    tasks = tasks.map((t) => {
      if (t.id === prev.id || t.stepId !== prev.stepId) return t;
      if (nextDone) return { ...t, done: true, completedOn: today };
      const { done: _d, completedOn: _c, ...rest } = t;
      return rest;
    });
    const subject = data.subjects.find((s) => s.id === prev.subjectId)
      ?? data.subjects.find((s) => s.steps?.some((st) => st.id === prev.stepId));
    const step = subject?.steps?.find((st) => st.id === prev.stepId);
    if (subject && step) {
      editStep(subject, step, { done: nextDone }, today, now);
    }
  }

  data.schedule = {
    ...baseSchedule,
    updatedAt: now,
    tasks,
  };

  return {
    task: updatedTask,
    shiftedDays: shifted.shiftedDays,
    ...(shifted.shiftedFrom ? { shiftedFrom: shifted.shiftedFrom } : {}),
  };
}

export function addScheduleTask(
  data: SkillsData,
  input: Input,
  makeId: () => string,
  today: DateKey,
  now: string,
): ScheduledSkillTask {
  const day = input.day === undefined || input.day === '' ? today : input.day;
  const task = cleanScheduledTask(data, { ...input, day, manual: true }, makeId, today);
  const prev = data.schedule;
  data.schedule = {
    updatedAt: now,
    ...(prev?.hoursPerDay ? { hoursPerDay: prev.hoursPerDay } : {}),
    tasks: [...(prev?.tasks ?? []), task],
  };
  return task;
}

export function removeScheduleTask(data: SkillsData, taskId: unknown, now: string) {
  if (!data.schedule) throw new SkillsInputError('There is no schedule yet.');
  const exists = isId(taskId) && data.schedule.tasks.some((t) => t.id === taskId);
  if (!exists) throw new SkillsInputError('That scheduled task isn’t here any more.');
  data.schedule = {
    ...data.schedule,
    updatedAt: now,
    tasks: data.schedule.tasks.filter((t) => t.id !== taskId),
  };
}

export function rebuildScheduleFromSteps(
  data: SkillsData,
  input: Input,
  makeId: () => string,
  today: DateKey,
  now: string,
): SkillSchedule {
  const hoursRaw = Number(input.hoursPerDay);
  const minsRaw = Number(input.minutesPerDay);
  const minutesPerDay = Number.isFinite(minsRaw) && minsRaw > 0
    ? Math.min(960, Math.max(15, Math.round(minsRaw)))
    : Number.isFinite(hoursRaw) && hoursRaw > 0
      ? Math.min(960, Math.max(15, Math.round(hoursRaw * 60)))
      : data.schedule?.hoursPerDay
        ? Math.min(960, Math.max(15, Math.round(data.schedule.hoursPerDay * 60)))
        : 60;
  const startDay = isDateKey(input.startDay) ? input.startDay : today;
  const subjectIds = Array.isArray(input.subjectIds) ? input.subjectIds.filter((id): id is string => isId(id)) : undefined;
  const generated = generateScheduleFromSteps(data, startDay, minutesPerDay, subjectIds, makeId);
  const previous = data.schedule?.tasks ?? [];
  const completed = input.keepCompleted === true ? previous.filter((t) => !!t.done).map((t) => ({ ...t })) : [];
  // Tasks added by hand aren't made from steps, so making the rest again leaves them where they were.
  const handAdded = previous.filter((t) => t.manual && !t.done).map((t) => ({ ...t }));
  data.schedule = {
    ...generated,
    updatedAt: now,
    tasks: [...completed, ...handAdded, ...generated.tasks],
  };
  return data.schedule;
}

// ── Notes pages on topics ────────────────────────────────────────────────────

/** Most pages tied to one topic. */
export const MAX_TOPIC_PAGES = 30;

export function tiePage(subject: Subject, topic: Topic, ref: { notebook?: unknown; page?: unknown }, now: string) {
  if (!isId(ref.notebook) || !isId(ref.page)) throw new SkillsInputError('Which page?');
  const pages = topic.notePages ?? [];
  if (pages.some((p) => p.page === ref.page)) return;
  if (pages.length >= MAX_TOPIC_PAGES) throw new SkillsInputError(`A topic can have ${MAX_TOPIC_PAGES} pages tied to it.`);
  topic.notePages = [...pages, { notebook: ref.notebook, page: ref.page }];
  touch(subject, now);
}

export function untiePage(subject: Subject, topic: Topic, page: unknown, now: string) {
  topic.notePages = (topic.notePages ?? []).filter((p) => p.page !== page);
  if (!topic.notePages.length) delete topic.notePages;
  touch(subject, now);
}

// ── Plans from an AI ─────────────────────────────────────────────────────────

function applyDraftContent(
  subject: Subject,
  topicsDraft: DraftTopic[],
  resourcesDraft: DraftResource[],
  stepsDraft: DraftStep[],
  options: {
    topicKeys?: Set<string> | null;
    resourceIndexes?: Set<number> | null;
    replaceSteps?: boolean;
    includeSteps?: boolean;
  },
  makeId: () => string,
  today: DateKey,
  now: string,
) {
  const ids = new Map<string, string>();
  let topics = 0;
  let resources = 0;
  let steps = 0;

  for (const draft of topicsDraft) {
    const existing = draft.existingId
      ? subject.topics.find((t) => t.id === draft.existingId)
      : subject.topics.find((t) => sameName(t.name, draft.name));
    if (existing) {
      ids.set(draft.key, existing.id);
      continue;
    }
    if (options.topicKeys && !options.topicKeys.has(draft.key)) continue;
    const topic = addTopic(subject, { name: draft.name, stage: draft.stage, core: draft.core, description: draft.description }, makeId, now);
    ids.set(draft.key, topic.id);
    topics++;
  }

  resourcesDraft.forEach((draft, index) => {
    const existing = draft.existingId
      ? subject.resources.find((r) => r.id === draft.existingId)
      : subject.resources.find((r) => sameName(r.title, draft.title));
    if (existing || (options.resourceIndexes && !options.resourceIndexes.has(index))) return;
    const topicIds = draft.topicKeys
      .map((k) => (k.startsWith('existing:') ? k.slice(9) : ids.get(k)))
      .filter((id): id is string => !!id);
    addResource(subject, { ...draft, topicIds }, makeId, today, now);
    resources++;
  });

  if (options.includeSteps !== false && stepsDraft.length > 0) {
    const built: SkillStep[] = [];
    for (const draft of stepsDraft) {
      let topicId: string | undefined;
      if (draft.topicKey) {
        topicId = draft.topicKey.startsWith('existing:') ? draft.topicKey.slice(9) : ids.get(draft.topicKey);
      }
      if (!topicId && draft.topic) {
        topicId = subject.topics.find((t) => sameName(t.name, draft.topic!))?.id;
      }
      const resourceTitle = draft.resource ?? draft.resourceTitle;
      const resourceId = resourceTitle ? subject.resources.find((r) => sameName(r.title, resourceTitle))?.id : undefined;
      built.push(cleanStepRecord(subject, {
        title: draft.title,
        kind: draft.kind,
        amount: draft.amount,
        detail: draft.detail,
        topicId,
        resourceId,
        minutes: draft.minutes,
      }, makeId, today));
    }

    if (options.replaceSteps) {
      subject.steps = built;
      steps = built.length;
    } else {
      const existingSteps = subject.steps ?? [];
      const toAdd = built.filter((b) => !existingSteps.some((e) => sameName(e.title, b.title)));
      if (toAdd.length) {
        subject.steps = [...existingSteps, ...toAdd];
        steps = toAdd.length;
      }
    }
  }

  return { topics, resources, steps };
}

/**
 * Add the chosen parts of a plan reply: topics (by key), resources (by index),
 * optional explicit steps, and the roadmap if asked. Existing items are reused.
 */
export function importPlan(
  subject: Subject,
  reply: unknown,
  input: { topicKeys?: unknown; resourceIndexes?: unknown; roadmap?: unknown; includeSteps?: unknown; replaceSteps?: unknown },
  makeId: () => string,
  now: string,
) {
  const plan = parsePlanReply(typeof reply === 'string' ? reply : '', subject);
  const wantedTopics = Array.isArray(input.topicKeys) ? new Set(input.topicKeys.map(String)) : null;
  const wantedResources = Array.isArray(input.resourceIndexes) ? new Set(input.resourceIndexes.map(Number)) : null;
  const today = now.slice(0, 10);

  const counts = applyDraftContent(
    subject,
    plan.topics,
    plan.resources,
    plan.steps,
    {
      topicKeys: wantedTopics,
      resourceIndexes: wantedResources,
      includeSteps: input.includeSteps !== false,
      replaceSteps: input.replaceSteps === true,
    },
    makeId,
    today,
    now,
  );

  if (input.roadmap !== false && plan.roadmap) {
    subject.roadmap = subject.roadmap && input.roadmap === 'append'
      ? `${subject.roadmap}\n\n---\n\n_Updated ${today}_\n\n${plan.roadmap}`.slice(0, LIMITS.roadmap)
      : plan.roadmap;
  }
  touch(subject, now);
  const base = { topics: counts.topics, resources: counts.resources, roadmap: !!plan.roadmap && input.roadmap !== false };
  return plan.steps.length > 0 || input.includeSteps === true ? { ...base, steps: counts.steps } : base;
}

/**
 * Apply an interconnected plan / brainstorm draft (or raw AI reply): creates
 * suggested new subjects, links parent/subskill edges without cycles, adds or
 * replaces explicit steps on subjects, and sets/replaces the multi-day schedule.
 */
export function applyInterconnectedPlan(
  data: SkillsData,
  input: Input,
  makeId: () => string,
  today: DateKey,
  now: string,
) {
  const startDay = isDateKey(input.startDay) ? input.startDay : today;
  let draft: InterconnectedPlanDraft;

  if (typeof input.reply === 'string' && input.reply.trim()) {
    const parsed = parseInterconnectedPlanReply(input.reply, data.subjects, startDay);
    if (!parsed.ok) throw new SkillsInputError(parsed.error);
    draft = parsed.data;
  } else if (input.draft && typeof input.draft === 'object') {
    draft = input.draft as InterconnectedPlanDraft;
  } else {
    throw new SkillsInputError('Provide an interconnected plan draft or AI reply.');
  }

  const resolveSubject = (ref: string | undefined): Subject | undefined => {
    if (!ref) return undefined;
    return data.subjects.find((s) => s.id === ref || sameName(s.name, ref));
  };

  let addedSubjects = 0;
  let updatedSubjects = 0;
  let addedTopics = 0;
  let addedResources = 0;
  let addedSteps = 0;
  const pendingParentRefs = new Map<string, string[]>();
  const queueParentRefs = (subjectId: string, refs: string[]) => {
    if (!refs.length) return;
    pendingParentRefs.set(subjectId, [...(pendingParentRefs.get(subjectId) ?? []), ...refs]);
  };

  // 1. Add brainstormed new subjects
  if (input.includeNewSubjects !== false) {
    for (const ns of draft.newSubjects ?? []) {
      let subject = resolveSubject(ns.name);
      if (!subject) {
        subject = addSubject(data, {
          name: ns.name,
          icon: ns.icon,
          area: ns.area,
          status: ns.status,
          target: ns.target,
          goal: ns.goal ?? ns.why,
        }, makeId, now);
        addedSubjects++;
      } else {
        updatedSubjects++;
      }
      const counts = applyDraftContent(
        subject,
        ns.topics ?? [],
        ns.resources ?? [],
        ns.steps ?? [],
        { replaceSteps: input.replaceSteps === true },
        makeId,
        today,
        now,
      );
      addedTopics += counts.topics;
      addedResources += counts.resources;
      addedSteps += counts.steps;
      queueParentRefs(subject.id, [...(ns.parentIds ?? []), ...(ns.parentSubjectRefs ?? [])]);
    }
  }

  // 2. Apply subject plans (steps, topics, resources)
  if (input.includeSubjectPlans !== false) {
    for (const sp of draft.subjectPlans ?? []) {
      const subject = resolveSubject(sp.existingSubjectId) ?? resolveSubject(sp.subjectRef) ?? resolveSubject(sp.subjectName);
      if (!subject) continue;
      const counts = applyDraftContent(
        subject,
        sp.topics ?? [],
        sp.resources ?? [],
        sp.steps ?? [],
        { replaceSteps: input.replaceSteps === true },
        makeId,
        today,
        now,
      );
      if (counts.topics || counts.resources || counts.steps) updatedSubjects++;
      addedTopics += counts.topics;
      addedResources += counts.resources;
      addedSteps += counts.steps;
      queueParentRefs(subject.id, [...(sp.parentIds ?? []), ...(sp.parentRefs ?? [])]);
    }
  }

  // 3. Collect explicit parentLinks
  for (const link of draft.parentLinks ?? []) {
    const subject = resolveSubject(link.subjectId) ?? resolveSubject(link.subjectRef) ?? resolveSubject(link.subjectName);
    if (!subject) continue;
    queueParentRefs(subject.id, [...(link.parentIds ?? []), ...(link.parentRefs ?? [])]);
  }

  // 4. Resolve & apply all parent links safely (preventing cycles & self-links)
  for (const [subjectId, refs] of pendingParentRefs.entries()) {
    const subject = data.subjects.find((s) => s.id === subjectId);
    if (!subject) continue;
    const base = input.replaceParents === true ? [] : [...(subject.parentIds ?? [])];
    let changed = input.replaceParents === true && (subject.parentIds?.length ?? 0) > 0;
    for (const ref of refs) {
      const parent = resolveSubject(ref);
      if (!parent || parent.id === subject.id) continue;
      if (base.includes(parent.id)) continue;
      if (wouldCreateSkillCycle(data, subject.id, parent.id)) continue;
      base.push(parent.id);
      // Update immediately so subsequent edges see this link for cycle checks.
      subject.parentIds = [...base];
      changed = true;
    }
    if (base.length) subject.parentIds = base;
    else delete subject.parentIds;
    if (changed) touch(subject, now);
  }

  // 5. Apply multi-day schedule
  let scheduledTasks = 0;
  if (input.includeSchedule !== false && (draft.schedule?.length ?? 0) > 0) {
    const builtTasks: ScheduledSkillTask[] = [];
    for (const t of draft.schedule) {
      const subject = resolveSubject(t.subjectId) ?? resolveSubject(t.subjectRef) ?? resolveSubject(t.subjectName);
      if (!subject) continue;
      if (!isDateKey(t.day)) continue;
      const stepMatch = (subject.steps ?? []).find((st) => sameName(st.title, t.stepTitle ?? t.title))
        ?? (subject.steps ?? []).find((st) => sameName(st.title, t.title));
      const topicMatch = t.topicName ? subject.topics.find((tp) => sameName(tp.name, t.topicName!)) : undefined;
      const resMatch = t.resourceTitle ? subject.resources.find((r) => sameName(r.title, t.resourceTitle!)) : undefined;
      builtTasks.push({
        id: makeId(),
        subjectId: subject.id,
        ...(stepMatch ? { stepId: stepMatch.id } : {}),
        ...(topicMatch ? { topicId: topicMatch.id } : stepMatch?.topicId ? { topicId: stepMatch.topicId } : {}),
        ...(resMatch ? { resourceId: resMatch.id } : stepMatch?.resourceId ? { resourceId: stepMatch.resourceId } : {}),
        title: text(t.title, LIMITS.title) || stepMatch?.title || 'Study',
        ...(t.amount ? { amount: text(t.amount, LIMITS.amount) } : stepMatch?.amount ? { amount: stepMatch.amount } : {}),
        ...(t.detail ? { detail: text(t.detail, LIMITS.detail) } : stepMatch?.detail ? { detail: stepMatch.detail } : {}),
        ...(t.minutes ? { minutes: intIn(t.minutes, 1, 600) } : stepMatch?.minutes ? { minutes: stepMatch.minutes } : {}),
        day: t.day,
      });
    }
    if (builtTasks.length) {
      const replace = input.replaceSchedule !== false;
      // Replacing the plan still keeps what's been done: it's the record of the work.
      const prevTasks = replace ? (data.schedule?.tasks ?? []).filter((t) => t.done) : (data.schedule?.tasks ?? []);
      const hoursRaw = Number(input.hoursPerDay ?? draft.hoursPerDay ?? data.schedule?.hoursPerDay);
      const hoursPerDay = Number.isFinite(hoursRaw) && hoursRaw > 0 && hoursRaw <= 24 ? Math.round(hoursRaw * 100) / 100 : undefined;
      data.schedule = {
        updatedAt: now,
        ...(hoursPerDay ? { hoursPerDay } : {}),
        tasks: [...prevTasks, ...builtTasks],
      };
      scheduledTasks = builtTasks.length;
    }
  }

  return { addedSubjects, updatedSubjects, addedTopics, addedResources, addedSteps, scheduledTasks };
}

// ── Questions ────────────────────────────────────────────────────────────────

/** Add the questions from an AI reply that read cleanly (skipping any indexes asked). */
export function importQuestions(subject: Subject, reply: unknown, input: { skip?: unknown; fallbackTopicId?: unknown }, makeId: () => string, now: string, source: 'ai' | 'weekly' = 'ai') {
  const parsed = parseQuestionsReply(typeof reply === 'string' ? reply : '', subject, { fallbackTopicId: isId(input.fallbackTopicId) ? input.fallbackTopicId : undefined });
  const skip = new Set(Array.isArray(input.skip) ? input.skip : []);
  if (subject.items.length >= 3000) throw new SkillsInputError('This subject has 3000 questions already. Retire or delete some first.');
  let added = 0;
  parsed.questions.forEach((q, index) => {
    if (!q.ok || skip.has(index)) return;
    const id = makeId();
    const base = { id, topicId: q.item.topicId, createdAt: now, source };
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

// ── Lookups & Knowledge Inquiries ────────────────────────────────────────────

export function findInquiry(data: SkillsData, id: unknown): KnowledgeInquiry {
  const inquiry = isId(id) ? (data.inquiries ?? []).find((q) => q.id === id) : undefined;
  if (!inquiry) throw new SkillsInputError('That lookup isn’t here any more.');
  return inquiry;
}

/**
 * Parse a pasted running list of questions/lookups: strips bullets (`- `, `* `,
 * `• `, `[ ] `, `[x] `, `1. `, `1) `), drops blanks, and deduplicates
 * case-insensitively while preserving the first spelling.
 */
export function parseRunningInquiryList(rawText: string): string[] {
  if (typeof rawText !== 'string' || !rawText.trim()) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const rawLine of rawText.split(/\r?\n/)) {
    let line = rawLine.trim();
    while (line) {
      const next = line
        .replace(/^(?:[-*•◦▪‣]|\d+[.)])(?:\s+|$)/, '')
        .replace(/^\[(?: |x|X)?\](?:\s+|$)/, '')
        .trim();
      if (next === line) break;
      line = next;
    }
    if (!line) continue;
    const clipped = line.slice(0, LIMITS.question).trim();
    if (!clipped) continue;
    const key = clipped.replace(/\s+/g, ' ').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clipped);
  }
  return out;
}

function resolveNewInquiryLink(
  data: SkillsData,
  rawSubjectId: unknown,
  rawTopicId: unknown,
): { subjectId?: string; topicId?: string } {
  const hasSubject = rawSubjectId !== undefined && rawSubjectId !== null && rawSubjectId !== '';
  const hasTopic = rawTopicId !== undefined && rawTopicId !== null && rawTopicId !== '';
  if (hasSubject) {
    const subject = findSubject(data, rawSubjectId);
    if (!hasTopic) return { subjectId: subject.id };
    const topic = findTopic(subject, rawTopicId);
    return { subjectId: subject.id, topicId: topic.id };
  }
  if (hasTopic) {
    if (!isId(rawTopicId)) throw new SkillsInputError('That topic isn’t here any more.');
    const owner = data.subjects.find((s) => s.topics.some((t) => t.id === rawTopicId));
    if (!owner) throw new SkillsInputError('That topic isn’t here any more.');
    return { subjectId: owner.id, topicId: rawTopicId };
  }
  return {};
}

export function addInquiry(
  data: SkillsData,
  input: Input,
  makeId: () => string,
  now: string,
): KnowledgeInquiry {
  const question = text(input.question, LIMITS.question);
  if (!question) throw new SkillsInputError('Write the question or lookup first.');
  const existing = data.inquiries ?? [];
  if (existing.length >= 5000) throw new SkillsInputError('That’s a lot of lookups. Remove some first.');

  let status: InquiryStatus = 'open';
  if (has(input, 'status') && input.status !== undefined && input.status !== '') {
    if (!INQUIRY_STATUSES.includes(input.status as InquiryStatus)) {
      throw new SkillsInputError('Status must be open or solved.');
    }
    status = input.status as InquiryStatus;
  }

  const context = text(input.context, LIMITS.context);
  const answer = text(input.answer, LIMITS.answer);
  const takeaways = text(input.takeaways, LIMITS.takeaways);
  const sources = normalizeInquirySources(input.sources);
  const tags = normalizeInquiryTags(input.tags);
  const link = resolveNewInquiryLink(data, input.subjectId, input.topicId);

  const inquiry: KnowledgeInquiry = {
    id: makeId(),
    question,
    ...(context ? { context } : {}),
    ...(answer ? { answer } : {}),
    ...(takeaways ? { takeaways } : {}),
    ...(sources.length ? { sources } : {}),
    ...(tags.length ? { tags } : {}),
    status,
    ...(link.subjectId ? { subjectId: link.subjectId } : {}),
    ...(link.topicId ? { topicId: link.topicId } : {}),
    createdAt: now,
    updatedAt: now,
    ...(status === 'solved' ? { solvedAt: now } : {}),
  };

  data.inquiries = [...existing, inquiry];
  return inquiry;
}

export function importInquiries(
  data: SkillsData,
  input: Input,
  makeId: () => string,
  now: string,
): { added: KnowledgeInquiry[]; skipped: number } {
  const defaultLink = resolveNewInquiryLink(data, input.subjectId, input.topicId);
  const defaultTags = normalizeInquiryTags(input.tags);

  type Candidate = {
    question: string;
    context?: unknown;
    answer?: unknown;
    takeaways?: unknown;
    sources?: unknown;
    tags?: unknown;
    subjectId?: unknown;
    topicId?: unknown;
    status?: unknown;
  };
  const candidates: Candidate[] = [];

  if (typeof input.text === 'string' && input.text.trim()) {
    for (const q of parseRunningInquiryList(input.text)) {
      candidates.push({ question: q });
    }
  }
  if (Array.isArray(input.items)) {
    for (const rawItem of input.items.slice(0, 500)) {
      if (!rawItem || typeof rawItem !== 'object') continue;
      const item = rawItem as Input;
      candidates.push({
        question: text(item.question, LIMITS.question),
        context: item.context,
        answer: item.answer,
        takeaways: item.takeaways,
        sources: item.sources,
        tags: item.tags,
        subjectId: item.subjectId,
        topicId: item.topicId,
        status: item.status,
      });
    }
  }

  if (!candidates.length) {
    throw new SkillsInputError('Paste at least one question or lookup to import.');
  }

  const existing = data.inquiries ?? [];
  const seenExact = new Set<string>();
  const seenAlias = new Set<string>();
  for (const q of existing) {
    const k = normalizeInquiryQuestionKey(q.question);
    if (k) seenExact.add(k);
    const a = normalizeInquiryQuestionKey(inquiryConceptAlias(q.question));
    if (a) seenAlias.add(a);
  }

  const added: KnowledgeInquiry[] = [];
  let skipped = 0;

  for (const c of candidates) {
    const q = c.question.trim();
    if (!q) {
      skipped++;
      continue;
    }
    const qKey = normalizeInquiryQuestionKey(q);
    const qAlias = normalizeInquiryQuestionKey(inquiryConceptAlias(q));
    const duplicate = seenExact.has(qKey)
      || (qAlias && seenExact.has(qAlias))
      || (qKey && qKey === qAlias && seenAlias.has(qKey));
    if (duplicate) {
      skipped++;
      continue;
    }

    const mergedTags = normalizeInquiryTags([
      ...defaultTags,
      ...normalizeInquiryTags(c.tags),
    ]);
    const useSubject = c.subjectId !== undefined && c.subjectId !== null && c.subjectId !== ''
      ? c.subjectId
      : defaultLink.subjectId;
    const useTopic = c.topicId !== undefined && c.topicId !== null && c.topicId !== ''
      ? c.topicId
      : (!c.subjectId || c.subjectId === defaultLink.subjectId ? defaultLink.topicId : undefined);

    const created = addInquiry(data, {
      question: q,
      context: c.context,
      answer: c.answer,
      takeaways: c.takeaways,
      sources: c.sources,
      tags: mergedTags,
      subjectId: useSubject,
      topicId: useTopic,
      status: c.status,
    }, makeId, now);

    seenExact.add(qKey);
    if (qAlias) seenAlias.add(qAlias);
    added.push(created);
  }

  return { added, skipped };
}

export function editInquiry(
  data: SkillsData,
  inquiryId: unknown,
  input: Input,
  now: string,
): KnowledgeInquiry {
  const inquiry = findInquiry(data, inquiryId);

  if (has(input, 'question')) {
    const question = text(input.question, LIMITS.question);
    if (!question) throw new SkillsInputError('A lookup needs a question.');
    inquiry.question = question;
  }
  if (has(input, 'context')) setText(inquiry, 'context', input.context, LIMITS.context);
  if (has(input, 'answer')) setText(inquiry, 'answer', input.answer, LIMITS.answer);
  if (has(input, 'takeaways')) setText(inquiry, 'takeaways', input.takeaways, LIMITS.takeaways);
  if (has(input, 'sources')) {
    const sources = normalizeInquirySources(input.sources);
    if (sources.length) inquiry.sources = sources;
    else delete inquiry.sources;
  }
  if (has(input, 'tags')) {
    const tags = normalizeInquiryTags(input.tags);
    if (tags.length) inquiry.tags = tags;
    else delete inquiry.tags;
  }

  if (has(input, 'subjectId')) {
    const rawSub = input.subjectId;
    if (rawSub === undefined || rawSub === null || rawSub === '') {
      if (has(input, 'topicId') && input.topicId !== undefined && input.topicId !== null && input.topicId !== '') {
        throw new SkillsInputError('Pick a subject for that topic.');
      }
      delete inquiry.subjectId;
      delete inquiry.topicId;
    } else {
      const subject = findSubject(data, rawSub);
      inquiry.subjectId = subject.id;
      if (has(input, 'topicId')) {
        const rawTop = input.topicId;
        if (rawTop === undefined || rawTop === null || rawTop === '') delete inquiry.topicId;
        else inquiry.topicId = findTopic(subject, rawTop).id;
      } else if (inquiry.topicId && !subject.topics.some((t) => t.id === inquiry.topicId)) {
        delete inquiry.topicId;
      }
    }
  } else if (has(input, 'topicId')) {
    const rawTop = input.topicId;
    if (rawTop === undefined || rawTop === null || rawTop === '') {
      delete inquiry.topicId;
    } else if (inquiry.subjectId) {
      const subject = findSubject(data, inquiry.subjectId);
      inquiry.topicId = findTopic(subject, rawTop).id;
    } else {
      const link = resolveNewInquiryLink(data, undefined, rawTop);
      inquiry.subjectId = link.subjectId;
      inquiry.topicId = link.topicId;
    }
  }

  if (has(input, 'status') && input.status !== undefined) {
    if (!INQUIRY_STATUSES.includes(input.status as InquiryStatus)) {
      throw new SkillsInputError('Status must be open or solved.');
    }
    const nextStatus = input.status as InquiryStatus;
    inquiry.status = nextStatus;
    if (nextStatus === 'solved') inquiry.solvedAt = inquiry.solvedAt ?? now;
    else delete inquiry.solvedAt;
  }

  inquiry.updatedAt = now;
  return inquiry;
}

export function toggleInquiry(
  data: SkillsData,
  inquiryId: unknown,
  status: unknown,
  answer: unknown,
  now: string,
): KnowledgeInquiry {
  const inquiry = findInquiry(data, inquiryId);
  let nextStatus: InquiryStatus;
  if (status === undefined || status === null || status === '') {
    nextStatus = inquiry.status === 'solved' ? 'open' : 'solved';
  } else if (INQUIRY_STATUSES.includes(status as InquiryStatus)) {
    nextStatus = status as InquiryStatus;
  } else {
    throw new SkillsInputError('Status must be open or solved.');
  }

  if (answer !== undefined) {
    setText(inquiry, 'answer', answer, LIMITS.answer);
  }
  inquiry.status = nextStatus;
  if (nextStatus === 'solved') inquiry.solvedAt = inquiry.solvedAt ?? now;
  else delete inquiry.solvedAt;
  inquiry.updatedAt = now;
  return inquiry;
}

export function removeInquiry(data: SkillsData, inquiryId: unknown) {
  const inquiry = findInquiry(data, inquiryId);
  data.inquiries = (data.inquiries ?? []).filter((q) => q !== inquiry);
}

export function promoteInquiryToCard(
  data: SkillsData,
  input: Input,
  makeId: () => string,
  now: string,
): { inquiry: KnowledgeInquiry; card: CardItem; cardId: string } {
  const inquiry = findInquiry(data, input.inquiryId);
  const rawSubjectId = input.subjectId !== undefined && input.subjectId !== null && input.subjectId !== ''
    ? input.subjectId
    : inquiry.subjectId;
  if (!rawSubjectId) {
    throw new SkillsInputError('Pick a skill and topic before creating a flashcard.');
  }
  const subject = findSubject(data, rawSubjectId);
  const rawTopicId = input.topicId !== undefined && input.topicId !== null && input.topicId !== ''
    ? input.topicId
    : (inquiry.subjectId === subject.id ? inquiry.topicId : undefined);
  if (!rawTopicId) {
    throw new SkillsInputError('Pick a topic before creating a flashcard.');
  }
  const topic = findTopic(subject, rawTopicId);

  const front = text(input.front, LIMITS.front) || inquiry.question;
  const back = text(input.back, LIMITS.back) || inquiry.answer || inquiry.takeaways || '';
  if (!front || !back) {
    throw new SkillsInputError('Add an answer or back text before creating a flashcard.');
  }

  const existingCard = inquiry.cardItemId
    ? subject.items.find((i): i is CardItem => i.id === inquiry.cardItemId && i.kind === 'card')
    : undefined;

  const card = saveCard(subject, {
    ...(existingCard ? { itemId: existingCard.id } : {}),
    topicId: topic.id,
    front,
    back,
    difficulty: input.difficulty,
  }, makeId, now) as CardItem;

  inquiry.subjectId = subject.id;
  inquiry.topicId = topic.id;
  inquiry.cardItemId = card.id;
  inquiry.updatedAt = now;

  return { inquiry, card, cardId: card.id };
}

function findMatchingInquiryForAnswer(inquiries: KnowledgeInquiry[], ans: DraftInquiryAnswer): KnowledgeInquiry | undefined {
  if (ans.inquiryId) {
    const byId = inquiries.find((q) => q.id === ans.inquiryId);
    if (byId) return byId;
  }
  const qKey = normalizeInquiryQuestionKey(ans.question);
  if (!qKey) return undefined;
  const exact = inquiries.find((q) => normalizeInquiryQuestionKey(q.question) === qKey);
  if (exact) return exact;
  const aliasKey = normalizeInquiryQuestionKey(inquiryConceptAlias(ans.question));
  if (!aliasKey) return undefined;
  return inquiries.find((q) => normalizeInquiryQuestionKey(inquiryConceptAlias(q.question)) === aliasKey);
}

export function applyInquiryAnswers(
  data: SkillsData,
  input: Input,
  makeId: () => string,
  now: string,
): { updated: number; created: number; cardsCreated: number } {
  let answers: DraftInquiryAnswer[];
  if (typeof input.reply === 'string' && input.reply.trim()) {
    const parsed = parseInquiryReply(input.reply, data);
    if (!parsed.ok) throw new SkillsInputError(parsed.error);
    answers = parsed.data;
  } else if (Array.isArray(input.answers)) {
    answers = input.answers
      .filter((a): a is DraftInquiryAnswer => !!a && typeof a === 'object')
      .map((a) => ({
        ...(typeof a.inquiryId === 'string' && a.inquiryId.trim() ? { inquiryId: a.inquiryId.trim() } : {}),
        question: text(a.question, LIMITS.question),
        answer: text(a.answer, LIMITS.answer),
        ...(text(a.takeaways, LIMITS.takeaways) ? { takeaways: text(a.takeaways, LIMITS.takeaways) } : {}),
        tags: normalizeInquiryTags(a.tags),
        sources: normalizeInquirySources(a.sources),
        ...(text(a.suggestedSubject, LIMITS.name) ? { suggestedSubject: text(a.suggestedSubject, LIMITS.name) } : {}),
        ...(text(a.suggestedTopic, LIMITS.name) ? { suggestedTopic: text(a.suggestedTopic, LIMITS.name) } : {}),
        ...(typeof a.subjectId === 'string' && a.subjectId.trim() ? { subjectId: a.subjectId.trim() } : {}),
        ...(typeof a.topicId === 'string' && a.topicId.trim() ? { topicId: a.topicId.trim() } : {}),
        ...(a.flashcard && typeof a.flashcard === 'object' ? { flashcard: a.flashcard } : {}),
      }))
      .filter((a) => !!a.question && (!!a.answer || !!a.takeaways));
    if (!answers.length) {
      throw new SkillsInputError('Provide at least one inquiry answer to apply.');
    }
  } else {
    throw new SkillsInputError('Provide an AI reply or inquiry answers to apply.');
  }

  data.inquiries ??= [];
  const createCards = input.createCards === true;
  let updated = 0;
  let created = 0;
  let cardsCreated = 0;

  for (const ans of answers) {
    const ansQuestion = text(ans.question, LIMITS.question);
    const ansAnswer = text(ans.answer, LIMITS.answer);
    const ansTakeaways = text(ans.takeaways, LIMITS.takeaways);
    if (!ansQuestion || (!ansAnswer && !ansTakeaways)) continue;

    const ansTags = normalizeInquiryTags(ans.tags);
    const ansSources = normalizeInquirySources(ans.sources);

    const ansSubject = ans.subjectId
      ? data.subjects.find((s) => s.id === ans.subjectId)
      : ans.suggestedSubject
        ? data.subjects.find((s) => sameName(s.name, ans.suggestedSubject!))
        : undefined;
    const ansTopic = ansSubject
      ? (ans.topicId
          ? ansSubject.topics.find((t) => t.id === ans.topicId)
          : ans.suggestedTopic
            ? ansSubject.topics.find((t) => sameName(t.name, ans.suggestedTopic!))
            : undefined)
      : undefined;

    let targetInquiry = findMatchingInquiryForAnswer(data.inquiries, ans);

    if (targetInquiry) {
      if (ansAnswer) targetInquiry.answer = ansAnswer;
      if (ansTakeaways) targetInquiry.takeaways = ansTakeaways;
      const mergedTags = normalizeInquiryTags([...(targetInquiry.tags ?? []), ...ansTags]);
      if (mergedTags.length) targetInquiry.tags = mergedTags;
      const mergedSources = normalizeInquirySources([...(targetInquiry.sources ?? []), ...ansSources]);
      if (mergedSources.length) targetInquiry.sources = mergedSources;

      if (!targetInquiry.subjectId && ansSubject) {
        targetInquiry.subjectId = ansSubject.id;
      }
      if (!targetInquiry.topicId && targetInquiry.subjectId) {
        const linkedSub = data.subjects.find((s) => s.id === targetInquiry!.subjectId);
        const matchingTop = linkedSub && ansTopic && linkedSub.id === ansSubject?.id
          ? ansTopic
          : linkedSub && ans.suggestedTopic
            ? linkedSub.topics.find((t) => sameName(t.name, ans.suggestedTopic!))
            : undefined;
        if (matchingTop) targetInquiry.topicId = matchingTop.id;
      }

      targetInquiry.status = 'solved';
      targetInquiry.solvedAt = targetInquiry.solvedAt ?? now;
      targetInquiry.updatedAt = now;
      updated++;
    } else {
      targetInquiry = addInquiry(data, {
        question: ansQuestion,
        answer: ansAnswer || ansTakeaways,
        ...(ansTakeaways ? { takeaways: ansTakeaways } : {}),
        tags: ansTags,
        sources: ansSources,
        status: 'solved',
        ...(ansSubject ? { subjectId: ansSubject.id } : {}),
        ...(ansSubject && ansTopic ? { topicId: ansTopic.id } : {}),
      }, makeId, now);
      created++;
    }

    if (createCards) {
      const cardSubject = targetInquiry.subjectId
        ? data.subjects.find((s) => s.id === targetInquiry!.subjectId)
        : ansSubject;
      const cardTopic = cardSubject && targetInquiry.topicId
        ? cardSubject.topics.find((t) => t.id === targetInquiry!.topicId)
        : (cardSubject && ansTopic ? cardSubject.topics.find((t) => t.id === ansTopic.id) : undefined);

      if (cardSubject && cardTopic) {
        const alreadyLinked = !!targetInquiry.cardItemId
          && cardSubject.items.some((i) => i.id === targetInquiry!.cardItemId);
        if (!alreadyLinked) {
          const front = text(ans.flashcard?.front, LIMITS.front) || targetInquiry.question;
          const back = text(ans.flashcard?.back, LIMITS.back) || targetInquiry.answer || targetInquiry.takeaways || '';
          if (front && back) {
            promoteInquiryToCard(data, {
              inquiryId: targetInquiry.id,
              subjectId: cardSubject.id,
              topicId: cardTopic.id,
              front,
              back,
              difficulty: ans.flashcard?.difficulty,
            }, makeId, now);
            cardsCreated++;
          }
        }
      }
    }
  }

  return { updated, created, cardsCreated };
}

// ── Unified SkillEdit dispatcher ─────────────────────────────────────────────

/** Apply any synchronous `SkillEdit` op cleanly. */
export function applySkillEdit(
  data: SkillsData,
  edit: SkillEdit,
  makeId: () => string,
  today: DateKey,
  now: string,
  progress?: ProgressData,
): unknown {
  switch (edit.op) {
    case 'add-subject':
      return addSubject(data, edit as unknown as Input, makeId, now);
    case 'edit-subject':
      return editSubject(findSubject(data, edit.subjectId), edit.changes as Input, now);
    case 'remove-subject':
      if (!progress) throw new SkillsInputError('Progress data is required to remove a subject.');
      return removeSubject(data, progress, edit.subjectId);
    case 'add-topic':
      return addTopic(findSubject(data, edit.subjectId), edit as unknown as Input, makeId, now);
    case 'edit-topic': {
      const subject = findSubject(data, edit.subjectId);
      return editTopic(subject, findTopic(subject, edit.topicId), edit.changes as Input, today, now);
    }
    case 'rate-topics':
      return rateTopics(findSubject(data, edit.subjectId), edit.ratings, today, now);
    case 'move-topic':
      return moveTopic(findSubject(data, edit.subjectId), edit.topicId, edit.direction);
    case 'remove-topic':
      if (!progress) throw new SkillsInputError('Progress data is required to remove a topic.');
      return removeTopic(findSubject(data, edit.subjectId), progress, edit.topicId, now, data);
    case 'topic-notes-new':
      throw new SkillsInputError('Creating a new Notes page must be handled through the async Notes link helper.');
    case 'topic-notes-tie': {
      const subject = findSubject(data, edit.subjectId);
      return tiePage(subject, findTopic(subject, edit.topicId), edit, now);
    }
    case 'topic-notes-untie': {
      const subject = findSubject(data, edit.subjectId);
      return untiePage(subject, findTopic(subject, edit.topicId), edit.page, now);
    }
    case 'add-resource':
      return addResource(findSubject(data, edit.subjectId), edit as unknown as Input, makeId, today, now);
    case 'edit-resource': {
      const subject = findSubject(data, edit.subjectId);
      return editResource(subject, findResource(subject, edit.resourceId), edit.changes as Input, today, now);
    }
    case 'remove-resource':
      return removeResource(findSubject(data, edit.subjectId), edit.resourceId, now);
    case 'import-plan':
      return importPlan(findSubject(data, edit.subjectId), edit.reply, edit, makeId, now);
    case 'import-questions':
      return importQuestions(findSubject(data, edit.subjectId), edit.reply, edit, makeId, now);
    case 'save-card':
      return saveCard(findSubject(data, edit.subjectId), edit as unknown as Input, makeId, now);
    case 'move-item': {
      const subject = findSubject(data, edit.subjectId);
      return moveItem(subject, findItem(subject, edit.itemId), edit.topicId, now);
    }
    case 'retire-item': {
      const subject = findSubject(data, edit.subjectId);
      return retireItem(subject, findItem(subject, edit.itemId), edit.retired !== false, now);
    }
    case 'remove-item': {
      if (!progress) throw new SkillsInputError('Progress data is required to remove an item.');
      const subject = findSubject(data, edit.subjectId);
      return removeItem(subject, progress, findItem(subject, edit.itemId), now);
    }
    case 'feedback': {
      const { subject, item } = findItemAnywhere(data, edit.itemId);
      return itemFeedback(subject, item, edit.changes as Input, now);
    }
    case 'answer': {
      if (!progress) throw new SkillsInputError('Progress data is required to record an answer.');
      const { subject, item } = findItemAnywhere(data, edit.itemId);
      return answerGraded(subject, item, progress, edit, makeId, today, now);
    }
    case 'rate-card': {
      if (!progress) throw new SkillsInputError('Progress data is required to rate a card.');
      const { subject, item } = findItemAnywhere(data, edit.itemId);
      return rateCard(subject, item, progress, edit.rating, makeId, today, now);
    }
    case 'add-step':
      return addStep(findSubject(data, edit.subjectId), edit as unknown as Input, makeId, today, now);
    case 'edit-step': {
      const subject = findSubject(data, edit.subjectId);
      const updated = editStep(subject, findStep(subject, edit.stepId), edit.changes as Input, today, now);
      if (has(edit.changes as Input, 'done')) {
        syncScheduleTasksForStep(data, updated.id, !!updated.done, today, now);
      }
      return updated;
    }
    case 'toggle-step':
      return toggleStep(data, edit.subjectId, edit.stepId, edit.done, today, now);
    case 'move-step':
      return moveStep(findSubject(data, edit.subjectId), edit.stepId, edit.direction, now);
    case 'remove-step':
      return removeStep(findSubject(data, edit.subjectId), edit.stepId, now, data);
    case 'set-parents':
      return setParents(data, edit.subjectId, edit.parentIds, now);
    case 'set-schedule':
      return setSchedule(data, edit as unknown as Input, makeId, today, now);
    case 'shift-schedule':
      return shiftSchedule(data, today, now);
    case 'toggle-schedule-task':
      return toggleScheduleTask(data, edit.taskId, edit.done, today, now);
    case 'add-schedule-task':
      return addScheduleTask(data, edit as unknown as Input, makeId, today, now);
    case 'remove-schedule-task':
      return removeScheduleTask(data, edit.taskId, now);
    case 'rebuild-schedule-from-steps':
      return rebuildScheduleFromSteps(data, edit as unknown as Input, makeId, today, now);
    case 'apply-interconnected-plan':
      return applyInterconnectedPlan(data, edit as unknown as Input, makeId, today, now);
    case 'add-project-log': {
      const subject = findSubject(data, edit.subjectId);
      return addProjectLog(subject, findResource(subject, edit.resourceId), edit as unknown as Input, makeId, today, now);
    }
    case 'edit-project-log': {
      const subject = findSubject(data, edit.subjectId);
      return editProjectLog(subject, findResource(subject, edit.resourceId), edit.logId, edit.changes as Input, now, makeId);
    }
    case 'remove-project-log': {
      const subject = findSubject(data, edit.subjectId);
      return removeProjectLog(subject, findResource(subject, edit.resourceId), edit.logId, now);
    }
    case 'add-inquiry':
      return addInquiry(data, edit as unknown as Input, makeId, now);
    case 'import-inquiries':
      return importInquiries(data, edit as unknown as Input, makeId, now);
    case 'edit-inquiry':
      return editInquiry(data, edit.inquiryId, edit.changes as Input, now);
    case 'toggle-inquiry':
      return toggleInquiry(data, edit.inquiryId, edit.status, edit.answer, now);
    case 'remove-inquiry':
      return removeInquiry(data, edit.inquiryId);
    case 'promote-inquiry-to-card':
      return promoteInquiryToCard(data, edit as unknown as Input, makeId, now);
    case 'apply-inquiry-answers':
      return applyInquiryAnswers(data, edit as unknown as Input, makeId, now);
  }
}

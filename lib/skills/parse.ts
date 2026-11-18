// Reading what an AI wrote back: a single-subject plan (topics, resources,
// roadmap, explicit steps), an interconnected multi-skill plan/brainstorm, or a
// batch of questions. Pure, so pages can preview before saving and the server
// can validate again when saving.

import { checkMath, checkQuestion } from '@/lib/daily/validate';
import { addDays, isDateKey, type DateKey } from '@/lib/habits/dates';
import { readReply } from '@/lib/study/study';
import {
  MAX_LEVEL, RESOURCE_KINDS, SKILL_STEP_KINDS, SUBJECT_STATUSES,
  type DraftInquiryAnswer, type DraftNewSubject, type DraftParentLink, type DraftResource,
  type DraftScheduledTask, type DraftStep, type DraftSubjectPlan, type DraftTopic,
  type InquiryStatus, type InterconnectedPlanDraft, type KnowledgeInquiry, type ParseResult, type Resource,
  type ResourceKind, type SkillQuestion, type SkillStepKind, type SkillsData, type Stage,
  type Subject, type SubjectStatus, type Topic,
} from './types';

export type {
  DraftInquiryAnswer, DraftNewSubject, DraftParentLink, DraftResource, DraftScheduledTask,
  DraftStep, DraftSubjectPlan, DraftTopic, InterconnectedPlanDraft, ParseResult,
};

export class SkillsInputError extends Error {}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
export const sameName = (a: string, b: string) => a.trim().toLowerCase().replace(/\s+/g, ' ') === b.trim().toLowerCase().replace(/\s+/g, ' ');

function reply(raw: string) {
  try {
    return readReply(raw);
  } catch (error) {
    throw new SkillsInputError(error instanceof Error ? error.message : 'That reply couldn’t be read.');
  }
}

export const LIMITS = {
  name: 80, description: 600, title: 200, author: 160, amount: 160,
  detail: 1200, roadmap: 20000, summary: 2000, front: 3000, back: 6000,
  question: 500, context: 2000, answer: 20000, takeaways: 6000, source: 500, tag: 64,
};

// ── Shared field parsers ─────────────────────────────────────────────────────

const stageOf = (v: unknown): Stage => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? ({ foundations: 1, core: 2, applied: 3, mastery: 4 } as Record<string, number>)[v.trim().toLowerCase()] ?? Number(v) : NaN;
  return (Number.isInteger(n) && n >= 1 && n <= 4 ? n : 2) as Stage;
};

const kindOf = (v: unknown): ResourceKind => {
  const k = text(v, 30).toLowerCase();
  if ((RESOURCE_KINDS as readonly string[]).includes(k)) return k as ResourceKind;
  if (/textbook|handbook|book/.test(k)) return 'book';
  if (/mooc|class|lecture|course/.test(k)) return 'course';
  if (/youtube|video|talk/.test(k)) return 'video';
  if (/paper|standard|spec/.test(k)) return 'paper';
  if (/blog|article|post|tutorial|guide/.test(k)) return 'article';
  if (/build|project|lab/.test(k)) return 'project';
  if (/exercise|practice|activity|teach/.test(k)) return 'activity';
  return 'other';
};

const stepKindOf = (v: unknown): SkillStepKind => {
  const k = text(v, 30).toLowerCase();
  if ((SKILL_STEP_KINDS as readonly string[]).includes(k)) return k as SkillStepKind;
  if (/read|book|chapter|paper|article|listen|audio|watch|video|lecture/.test(k)) return 'read';
  if (/practice|exercise|problem|drill|quiz|solve|review|test/.test(k)) return 'practice';
  if (/project|build|lab|code|implement|prototype|design/.test(k)) return 'project';
  if (/note|summar|teach|write|explain|card|flashcard/.test(k)) return 'note';
  return 'other';
};

const httpsUrl = (v: unknown) => {
  const url = text(v, 600);
  return /^https?:\/\/[^\s"<>]+$/.test(url) ? url : undefined;
};

const minutesOf = (mins: unknown, hrs?: unknown): number | undefined => {
  if (typeof mins === 'number' && Number.isFinite(mins) && mins > 0) return Math.min(600, Math.round(mins));
  if (typeof hrs === 'number' && Number.isFinite(hrs) && hrs > 0) return Math.min(600, Math.round(hrs * 60));
  return undefined;
};

const stringList = (v: unknown, maxLen = LIMITS.name, cap = 30): string[] => {
  const arr = Array.isArray(v) ? v : typeof v === 'string' && v.trim() ? [v] : [];
  const out: string[] = [];
  for (const item of arr.slice(0, cap)) {
    const s = text(item, maxLen);
    if (s && !out.some((x) => sameName(x, s))) out.push(s);
  }
  return out;
};

function parseTopicsList(raw: unknown, existingTopics: Pick<Topic, 'id' | 'name'>[], warnings: string[], labelPrefix = ''): DraftTopic[] {
  const topics: DraftTopic[] = [];
  const list = Array.isArray(raw) ? raw : [];
  list.slice(0, 60).forEach((entry, i) => {
    const t = typeof entry === 'string' ? { name: entry } : entry;
    if (!isRecord(t)) return;
    const name = text(t.name, LIMITS.name);
    if (!name) { warnings.push(`${labelPrefix}Topic ${i + 1} has no name, so it was left out.`); return; }
    if (topics.some((d) => sameName(d.name, name))) return;
    const key = text(t.key, 40) || `t${i + 1}`;
    const existing = existingTopics.find((x) => sameName(x.name, name));
    const description = text(t.description, LIMITS.description);
    topics.push({ key, name, stage: stageOf(t.stage), core: t.core !== false, ...(description ? { description } : {}), ...(existing ? { existingId: existing.id } : {}) });
  });
  return topics;
}

function makeTopicKeyResolver(draftTopics: DraftTopic[], existingTopics: Pick<Topic, 'id' | 'name'>[]) {
  return (ref: unknown): string | undefined => {
    const r = text(ref, LIMITS.name);
    if (!r) return undefined;
    const draft = draftTopics.find((d) => d.key === r || sameName(d.name, r));
    if (draft) return draft.key;
    const existing = existingTopics.find((x) => sameName(x.name, r) || x.id === r);
    return existing ? `existing:${existing.id}` : undefined;
  };
}

function parseResourcesList(
  raw: unknown,
  draftTopics: DraftTopic[],
  existingTopics: Pick<Topic, 'id' | 'name'>[],
  existingResources: Pick<Resource, 'id' | 'title'>[],
  warnings: string[],
  labelPrefix = '',
): DraftResource[] {
  const keyFor = makeTopicKeyResolver(draftTopics, existingTopics);
  const resources: DraftResource[] = [];
  const list = Array.isArray(raw) ? raw : [];
  list.slice(0, 80).forEach((r, i) => {
    if (!isRecord(r)) return;
    const title = text(r.title, LIMITS.title);
    if (!title) { warnings.push(`${labelPrefix}Resource ${i + 1} has no title, so it was left out.`); return; }
    if (resources.some((d) => sameName(d.title, title))) return;
    const refs = Array.isArray(r.topics) ? r.topics : r.topics !== undefined ? [r.topics] : [];
    const topicKeys = [...new Set(refs.map(keyFor).filter((k): k is string => !!k))];
    const existing = existingResources.find((x) => sameName(x.title, title));
    const hours = typeof r.hours === 'number' && Number.isFinite(r.hours) && r.hours > 0 && r.hours < 5000 ? Math.round(r.hours) : undefined;
    const author = text(r.author, LIMITS.author);
    const detail = text(r.detail ?? r.why ?? r.description, LIMITS.detail);
    const url = httpsUrl(r.url);
    const freePdfUrl = httpsUrl(r.freePdfUrl ?? r.pdfUrl);
    const youtubeAudioUrl = httpsUrl(r.youtubeAudioUrl ?? r.youtubeUrl);
    resources.push({
      kind: kindOf(r.kind ?? r.type), title, topicKeys,
      ...(author ? { author } : {}),
      ...(url ? { url } : {}),
      ...(freePdfUrl ? { freePdfUrl } : {}),
      ...(youtubeAudioUrl ? { youtubeAudioUrl } : {}),
      ...(detail ? { detail } : {}),
      ...(hours ? { hours } : {}),
      ...(existing ? { existingId: existing.id } : {}),
    });
  });
  return resources;
}

function parseStepsList(
  raw: unknown,
  draftTopics: DraftTopic[],
  existingTopics: Pick<Topic, 'id' | 'name'>[],
  warnings: string[],
  labelPrefix = '',
): DraftStep[] {
  const keyFor = makeTopicKeyResolver(draftTopics, existingTopics);
  const steps: DraftStep[] = [];
  const list = Array.isArray(raw) ? raw : [];
  list.slice(0, 120).forEach((entry, i) => {
    const s = typeof entry === 'string' ? { title: entry } : entry;
    if (!isRecord(s)) return;
    const title = text(s.title ?? s.name ?? s.step, LIMITS.title);
    if (!title) { warnings.push(`${labelPrefix}Step ${i + 1} has no title, so it was left out.`); return; }
    const amount = text(s.amount ?? s.pages ?? s.chapters ?? s.scope, LIMITS.amount);
    const detail = text(s.detail ?? s.description ?? s.why ?? s.notes, LIMITS.detail);
    const topicRaw = text(s.topic ?? s.topicName, LIMITS.name);
    const topicKey = keyFor(s.topicKey ?? s.topic ?? s.topicName);
    const topicName = topicRaw
      || (topicKey?.startsWith('existing:')
        ? existingTopics.find((t) => t.id === topicKey.slice(9))?.name
        : draftTopics.find((t) => t.key === topicKey)?.name)
      || undefined;
    const resource = text(s.resource ?? s.resourceTitle, LIMITS.title);
    const minutes = minutesOf(s.minutes, s.hours);
    steps.push({
      title,
      kind: stepKindOf(s.kind ?? s.type),
      ...(amount ? { amount } : {}),
      ...(detail ? { detail } : {}),
      ...(topicKey ? { topicKey } : {}),
      ...(topicName ? { topic: topicName } : {}),
      ...(resource ? { resource } : {}),
      ...(minutes ? { minutes } : {}),
    });
  });
  return steps;
}

// ── Single-subject Plans ─────────────────────────────────────────────────────

export type ParsedPlan = {
  summary?: string;
  roadmap?: string;
  topics: DraftTopic[];
  resources: DraftResource[];
  steps: DraftStep[];
  parentSubjects: string[];
  warnings: string[];
};

/** A plan reply, matched against what the subject already has so nothing is added twice. */
export function parsePlanReply(raw: string, subject: Pick<Subject, 'topics' | 'resources'>): ParsedPlan {
  const { value, cutOff } = reply(raw);
  if (!isRecord(value)) throw new SkillsInputError('That doesn’t look like a plan. It should be one JSON object with "topics" and "resources".');
  const warnings: string[] = cutOff ? ['The reply looks cut off; only the parts that came through were read.'] : [];

  const topics = parseTopicsList(value.topics, subject.topics, warnings);
  const resources = parseResourcesList(value.resources, topics, subject.topics, subject.resources, warnings);
  const steps = parseStepsList(value.steps, topics, subject.topics, warnings);
  const parentSubjects = stringList(value.parentSubjects ?? value.parents);

  const summary = text(value.summary, LIMITS.summary);
  const roadmap = text(value.roadmap, LIMITS.roadmap);
  if (!topics.length && !resources.length && !roadmap && !steps.length) {
    throw new SkillsInputError('There were no topics, resources, steps or roadmap in that reply.');
  }
  return { ...(summary ? { summary } : {}), ...(roadmap ? { roadmap } : {}), topics, resources, steps, parentSubjects, warnings };
}

// ── Interconnected multi-skill Plans & Brainstorming ─────────────────────────

function findSubjectMatch(ref: string, existingSubjects: Subject[]): Subject | undefined {
  return existingSubjects.find((s) => s.id === ref || sameName(s.name, ref));
}

function resolveExistingParentIds(refs: string[], existingSubjects: Subject[]): string[] {
  const ids: string[] = [];
  for (const ref of refs) {
    const match = findSubjectMatch(ref, existingSubjects);
    if (match && !ids.includes(match.id)) ids.push(match.id);
  }
  return ids;
}

/**
 * Parse an interconnected AI plan or brainstorm reply without throwing on malformed input.
 */
export function parseInterconnectedPlanReply(
  raw: string,
  existingSubjects: Subject[],
  startDay: DateKey,
): ParseResult<InterconnectedPlanDraft> {
  if (!isDateKey(startDay)) {
    return { ok: false, error: 'Start day must be a valid YYYY-MM-DD date.', warnings: [] };
  }
  if (typeof raw !== 'string' || !raw.trim()) {
    return { ok: false, error: 'Paste the AI’s reply first.', warnings: [] };
  }
  let parsedReply: { value: unknown; cutOff: boolean };
  try {
    parsedReply = readReply(raw);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'That reply couldn’t be read.', warnings: [] };
  }
  const { value, cutOff } = parsedReply;
  if (!isRecord(value)) {
    return { ok: false, error: 'That doesn’t look like an interconnected skill plan. Expected one JSON object.', warnings: [] };
  }
  const warnings: string[] = cutOff ? ['The reply looks cut off; only the parts that came through were read.'] : [];

  // 1. New brainstormed subjects
  const newSubjects: DraftNewSubject[] = [];
  const rawNew = Array.isArray(value.newSubjects)
    ? value.newSubjects
    : Array.isArray(value.brainstormedSubjects)
      ? value.brainstormedSubjects
      : Array.isArray(value.suggestedSubjects)
        ? value.suggestedSubjects
        : [];
  rawNew.slice(0, 40).forEach((entry, i) => {
    if (!isRecord(entry)) return;
    const name = text(entry.name, LIMITS.name);
    if (!name) { warnings.push(`Suggested skill ${i + 1} has no name, so it was left out.`); return; }
    if (newSubjects.some((s) => sameName(s.name, name))) return;
    const prefix = `${name}: `;
    const topics = parseTopicsList(entry.topics, [], warnings, prefix);
    const resources = parseResourcesList(entry.resources, topics, [], [], warnings, prefix);
    const steps = parseStepsList(entry.steps, topics, [], warnings, prefix);
    const parentSubjectRefs = stringList(
      entry.parentSubjectNames ?? entry.parentSubjects ?? entry.parentIds ?? entry.parents,
    );
    const parentIds = resolveExistingParentIds(parentSubjectRefs, existingSubjects);
    const rawTarget = Number(entry.targetLevel ?? entry.target);
    const target = Number.isFinite(rawTarget) ? Math.min(MAX_LEVEL, Math.max(1, Math.round(rawTarget))) : 3;
    const status: SubjectStatus = SUBJECT_STATUSES.includes(entry.status as SubjectStatus) ? entry.status as SubjectStatus : 'want';
    const icon = text(entry.icon, 16);
    const why = text(entry.why ?? entry.rationale ?? entry.reason, 1000);
    const goal = text(entry.goal, 1000) || why;
    newSubjects.push({
      name,
      ...(icon ? { icon } : {}),
      area: text(entry.area, 60) || 'General',
      ...(why ? { why } : {}),
      ...(goal ? { goal } : {}),
      target,
      status,
      parentSubjectRefs,
      parentIds,
      topics,
      resources,
      steps,
    });
  });

  // 2. Subject plans (steps/topics/resources for existing or newly proposed subjects)
  const subjectPlans: DraftSubjectPlan[] = [];
  const rawPlans = Array.isArray(value.subjectPlans)
    ? value.subjectPlans
    : Array.isArray(value.plans)
      ? value.plans
      : [];
  rawPlans.slice(0, 80).forEach((entry, i) => {
    if (!isRecord(entry)) return;
    const subjectRef = text(entry.subjectId ?? entry.subject ?? entry.name, LIMITS.name);
    if (!subjectRef) { warnings.push(`Subject plan ${i + 1} did not name a subject.`); return; }
    const existing = findSubjectMatch(subjectRef, existingSubjects);
    const proposed = !existing ? newSubjects.find((s) => sameName(s.name, subjectRef)) : undefined;
    if (!existing && !proposed) {
      warnings.push(`Subject plan for "${subjectRef}" did not match any existing or suggested skill.`);
    }
    const existingTopics = existing?.topics ?? [];
    const existingResources = existing?.resources ?? [];
    const prefix = `${existing?.name ?? subjectRef}: `;
    const topics = parseTopicsList(entry.topics, existingTopics, warnings, prefix);
    const resources = parseResourcesList(entry.resources, topics, existingTopics, existingResources, warnings, prefix);
    const steps = parseStepsList(entry.steps, topics, existingTopics, warnings, prefix);
    const parentRefs = stringList(entry.parentSubjects ?? entry.parentSubjectNames ?? entry.parentIds ?? entry.parents);
    const parentIds = resolveExistingParentIds(parentRefs, existingSubjects);
    subjectPlans.push({
      subjectRef,
      ...(existing ? { existingSubjectId: existing.id } : {}),
      subjectName: existing?.name ?? proposed?.name ?? subjectRef,
      parentRefs,
      parentIds,
      topics,
      resources,
      steps,
    });
  });

  // 3. Explicit parent links
  const parentLinks: DraftParentLink[] = [];
  const rawLinks = Array.isArray(value.parentLinks) ? value.parentLinks : [];
  rawLinks.slice(0, 80).forEach((entry) => {
    if (!isRecord(entry)) return;
    const subjectRef = text(entry.subjectId ?? entry.subject ?? entry.name, LIMITS.name);
    if (!subjectRef) return;
    const parentRefs = stringList(entry.parents ?? entry.parentSubjects ?? entry.parentSubjectNames ?? entry.parentIds);
    if (!parentRefs.length) return;
    const existing = findSubjectMatch(subjectRef, existingSubjects);
    const proposed = !existing ? newSubjects.find((s) => sameName(s.name, subjectRef)) : undefined;
    parentLinks.push({
      subjectRef,
      ...(existing ? { subjectId: existing.id } : {}),
      subjectName: existing?.name ?? proposed?.name ?? subjectRef,
      parentRefs,
      parentIds: resolveExistingParentIds(parentRefs, existingSubjects),
    });
  });

  // 4. Multi-day schedule
  const schedule: DraftScheduledTask[] = [];
  const schedSource = isRecord(value.schedule) ? value.schedule : null;
  const rawScheduleList = Array.isArray(value.schedule)
    ? value.schedule
    : schedSource && Array.isArray(schedSource.days)
      ? schedSource.days
      : schedSource && Array.isArray(schedSource.tasks)
        ? schedSource.tasks
        : [];

  const pushTask = (taskObj: unknown, fallbackDayIndex: number, fallbackDay?: DateKey) => {
    if (!isRecord(taskObj)) return;
    const subjectRef = text(taskObj.subjectId ?? taskObj.subject ?? taskObj.skill, LIMITS.name);
    const title = text(taskObj.title ?? taskObj.stepTitle ?? taskObj.step ?? taskObj.task, LIMITS.title);
    if (!subjectRef || !title) {
      warnings.push('A scheduled task was missing its skill name or title, so it was skipped.');
      return;
    }
    const existing = findSubjectMatch(subjectRef, existingSubjects);
    const proposed = !existing ? newSubjects.find((s) => sameName(s.name, subjectRef)) : undefined;
    const rawIdx = Number(taskObj.dayIndex ?? taskObj.dayNumber ?? fallbackDayIndex);
    const dayIndex = Number.isFinite(rawIdx) && rawIdx >= 1 ? Math.min(365, Math.round(rawIdx)) : Math.max(1, fallbackDayIndex);
    const day = isDateKey(taskObj.day)
      ? taskObj.day
      : fallbackDay && isDateKey(fallbackDay)
        ? fallbackDay
        : addDays(startDay, dayIndex - 1);
    const stepTitle = text(taskObj.stepTitle ?? taskObj.step, LIMITS.title) || undefined;
    const topicName = text(taskObj.topic ?? taskObj.topicName, LIMITS.name) || undefined;
    const resourceTitle = text(taskObj.resource ?? taskObj.resourceTitle, LIMITS.title) || undefined;
    const amount = text(taskObj.amount ?? taskObj.pages ?? taskObj.chapters, LIMITS.amount) || undefined;
    const detail = text(taskObj.detail ?? taskObj.description ?? taskObj.notes, LIMITS.detail) || undefined;
    const minutes = minutesOf(taskObj.minutes, taskObj.hours);
    schedule.push({
      subjectRef,
      ...(existing ? { subjectId: existing.id } : {}),
      subjectName: existing?.name ?? proposed?.name ?? subjectRef,
      ...(stepTitle ? { stepTitle } : {}),
      ...(topicName ? { topicName } : {}),
      ...(resourceTitle ? { resourceTitle } : {}),
      title,
      ...(amount ? { amount } : {}),
      ...(detail ? { detail } : {}),
      ...(minutes ? { minutes } : {}),
      day,
      dayIndex,
    });
  };

  rawScheduleList.slice(0, 365).forEach((entry, idx) => {
    if (!isRecord(entry)) return;
    if (Array.isArray(entry.tasks)) {
      const groupIdx = typeof entry.dayIndex === 'number' && Number.isFinite(entry.dayIndex) && entry.dayIndex >= 1 ? Math.round(entry.dayIndex) : idx + 1;
      const groupDay = isDateKey(entry.day) ? entry.day : undefined;
      for (const taskObj of entry.tasks.slice(0, 40)) {
        pushTask(taskObj, groupIdx, groupDay);
      }
    } else {
      pushTask(entry, idx + 1);
    }
  });

  const rawHours = Number(value.hoursPerDay ?? schedSource?.hoursPerDay);
  const hoursPerDay = Number.isFinite(rawHours) && rawHours > 0 && rawHours <= 24 ? Math.round(rawHours * 100) / 100 : undefined;
  const summary = text(value.summary, LIMITS.summary) || undefined;

  if (!newSubjects.length && !subjectPlans.length && !parentLinks.length && !schedule.length) {
    return {
      ok: false,
      error: 'That reply did not contain any new subjects, skill steps, parent links, or scheduled tasks.',
      warnings,
    };
  }

  return {
    ok: true,
    data: {
      ...(summary ? { summary } : {}),
      ...(hoursPerDay ? { hoursPerDay } : {}),
      newSubjects,
      parentLinks,
      subjectPlans,
      schedule,
    },
    warnings,
  };
}

// ── Questions ────────────────────────────────────────────────────────────────

export type DraftItem =
  | { kind: 'graded'; topicId: string; question: SkillQuestion }
  | { kind: 'card'; topicId: string; difficulty: number; front: string; back: string };
export type ParsedQuestion = { ok: true; item: DraftItem; title: string; topicName: string; warning?: string } | { ok: false; title: string; errors: string[] };
export type ParsedQuestions = { questions: ParsedQuestion[]; cutOff: boolean };

/** The topic a question names: exact, then a close match, then the fallback (if it was asked about one topic). */
function matchTopic(topics: Topic[], name: string, fallbackId?: string): { topic?: Topic; guessed: boolean } {
  const exact = topics.find((t) => sameName(t.name, name));
  if (exact) return { topic: exact, guessed: false };
  const lower = name.toLowerCase();
  const close = name && topics.filter((t) => t.name.toLowerCase().includes(lower) || lower.includes(t.name.toLowerCase()));
  if (close && close.length === 1) return { topic: close[0], guessed: true };
  const fallback = topics.find((t) => t.id === fallbackId);
  return { topic: fallback, guessed: !!fallback };
}

/**
 * Slips AIs often make that have only one sensible reading: an empty unit for a
 * unitless answer, a tolerance written as a percent (2 for 2 %), a missing part id.
 */
function forgivePart(part: unknown, index: number) {
  if (!isRecord(part)) return part;
  const out: Record<string, unknown> = { ...part };
  if (out.id === undefined) out.id = String.fromCharCode(97 + index);
  if (isRecord(out.answer)) {
    const answer: Record<string, unknown> = { ...out.answer };
    if (answer.unit === '' || answer.unit === null) delete answer.unit;
    if (typeof answer.tolerance === 'number' && answer.tolerance > 0.5 && answer.tolerance <= 50) answer.tolerance /= 100;
    out.answer = answer;
  }
  return out;
}

export function parseQuestionsReply(raw: string, subject: Pick<Subject, 'topics'>, options: { fallbackTopicId?: string } = {}): ParsedQuestions {
  const { value, cutOff } = reply(raw);
  const list = Array.isArray(value) ? value : isRecord(value) && Array.isArray(value.questions) ? value.questions : null;
  if (!list) throw new SkillsInputError('That doesn’t look like questions. It should be one JSON object with a "questions" list.');
  if (!list.length) throw new SkillsInputError('The reply had an empty list of questions.');

  const questions = list.slice(0, 100).map((rawQ, i): ParsedQuestion => {
    const where = `Question ${i + 1}`;
    if (!isRecord(rawQ)) return { ok: false, title: where, errors: ['isn’t an object'] };
    const isCard = rawQ.type === 'card' || rawQ.kind === 'card' || (rawQ.front !== undefined && rawQ.parts === undefined);
    const title = text(isCard ? rawQ.front : rawQ.title, 120) || where;
    const topicName = text(rawQ.topic, LIMITS.name);
    const { topic, guessed } = matchTopic(subject.topics, topicName, options.fallbackTopicId);
    if (!topic) return { ok: false, title, errors: [`its topic "${topicName || 'none'}" isn’t one of this subject’s topics`] };
    const warning = guessed ? `Topic "${topicName}" was read as "${topic.name}".` : undefined;
    const difficulty = Number.isInteger(rawQ.difficulty) && (rawQ.difficulty as number) >= 1 && (rawQ.difficulty as number) <= 5 ? rawQ.difficulty as number : null;

    if (isCard) {
      const front = text(rawQ.front, LIMITS.front);
      const back = text(rawQ.back, LIMITS.back);
      const errors: string[] = [];
      if (!front) errors.push('the card has no front');
      if (!back) errors.push('the card has no back');
      if (front) checkMath(front, 'front', errors);
      if (back) checkMath(back, 'back', errors);
      if (errors.length) return { ok: false, title, errors };
      return { ok: true, title, topicName: topic.name, ...(warning ? { warning } : {}), item: { kind: 'card', topicId: topic.id, difficulty: difficulty ?? 2, front, back } };
    }

    const errors: string[] = [];
    const sources = Array.isArray(rawQ.sources) && rawQ.sources.length ? rawQ.sources : [{ title: 'No source given (written by an AI; double-check it)' }];
    const parts = Array.isArray(rawQ.parts) ? rawQ.parts.map(forgivePart) : rawQ.parts;
    const checked = checkQuestion({ ...rawQ, id: 'q', track: 'mechanical', topic: topic.name, formulas: undefined, sources, parts, check: undefined }, where, new Set(), errors);
    if (!checked) return { ok: false, title, errors: errors.map((e) => e.replace(`${where}: `, '').replace(`${where}.`, '')) };
    const { track: _track, topic: _topic, id: _id, ...question } = checked;
    return { ok: true, title: question.title, topicName: topic.name, ...(warning ? { warning } : {}), item: { kind: 'graded', topicId: topic.id, question: { id: '', ...question } } };
  });
  return { questions, cutOff };
}

// ── Lookups & Knowledge Inquiries ────────────────────────────────────────────

export function normalizeInquiryQuestionKey(q: string): string {
  return q.trim().replace(/\s+/g, ' ').replace(/\?+$/, '').trim().toLowerCase();
}

export function inquiryConceptAlias(question: string): string {
  let s = question.trim().replace(/\s+/g, ' ').replace(/\?+$/, '').trim();
  s = s.replace(
    /^(?:what(?:'s|\u2019s|\s+(?:is|are|was|were))|who(?:'s|\u2019s|\s+(?:is|are|was|were))|how\s+(?:does|do|did|to|is|are)|why\s+(?:is|are|does|do)|when\s+(?:is|are|does|do)|where\s+(?:is|are)|which\s+(?:is|are)|can\s+you\s+explain|explain|define|describe|tell\s+me\s+about)\s+(?:(?:a|an|the)\s+)?/i,
    '',
  );
  return s.replace(/\?+$/, '').trim();
}

export function normalizeInquiryTags(raw: unknown): string[] {
  const items = Array.isArray(raw)
    ? raw
    : typeof raw === 'string' && raw.trim()
      ? raw.split(/[\s,]+/)
      : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items.slice(0, 50)) {
    if (typeof item !== 'string') continue;
    const tag = item.trim().replace(/^#+/, '').trim().toLowerCase().slice(0, LIMITS.tag).trim();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length >= 30) break;
  }
  return out;
}

export function normalizeInquirySources(raw: unknown): string[] {
  const items = Array.isArray(raw)
    ? raw
    : typeof raw === 'string' && raw.trim()
      ? raw.split(/\r?\n/)
      : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items.slice(0, 50)) {
    let val = '';
    if (typeof item === 'string') {
      val = item.trim();
    } else if (isRecord(item)) {
      const title = text(item.title ?? item.name ?? item.label, 300);
      const url = text(item.url ?? item.href, 400);
      val = title && url ? `${title} (${url})` : title || url;
    }
    val = val.slice(0, LIMITS.source).trim();
    if (!val) continue;
    const key = val.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(val);
    if (out.length >= 30) break;
  }
  return out;
}

function normalizeTakeaways(raw: unknown): string {
  if (typeof raw === 'string') return raw.trim().slice(0, LIMITS.takeaways);
  if (Array.isArray(raw)) {
    return raw
      .filter((x): x is string => typeof x === 'string' && !!x.trim())
      .map((x) => {
        const t = x.trim();
        return /^[-*•]/.test(t) ? t : `- ${t}`;
      })
      .join('\n')
      .slice(0, LIMITS.takeaways)
      .trim();
  }
  return '';
}

function completeTopObjects(slice: string): unknown[] {
  const found: unknown[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  for (let i = 0; i < slice.length; i++) {
    const c = slice[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
    } else if (c === '{') {
      if (depth++ === 0) start = i;
    } else if (c === '}' && depth > 0 && --depth === 0) {
      try {
        found.push(JSON.parse(slice.slice(start, i + 1).replace(/,(\s*[}\]])/g, '$1')));
      } catch {
        /* skip malformed object */
      }
    }
  }
  return found;
}

function readInquiryJson(raw: string): { value: unknown; cutOff: boolean } {
  try {
    return readReply(raw);
  } catch (err) {
    const unfenced = raw.replace(/```[a-z]*\s*\n?/gi, '').replace(/```/g, '');
    const marker = unfenced.search(/"(?:answers|items|lookups)"\s*:\s*\[/);
    if (marker >= 0) {
      const objects = completeTopObjects(unfenced.slice(unfenced.indexOf('[', marker))).filter(isRecord);
      if (objects.length) return { value: { answers: objects }, cutOff: true };
    }
    throw err;
  }
}

function matchInquiryInData(inquiries: KnowledgeInquiry[], rawId: unknown, question: string): KnowledgeInquiry | undefined {
  const id = typeof rawId === 'string' ? rawId.trim() : '';
  if (id) {
    const byId = inquiries.find((q) => q.id === id);
    if (byId) return byId;
  }
  if (!question) return undefined;
  const qKey = normalizeInquiryQuestionKey(question);
  const byQuestion = inquiries.find((q) => normalizeInquiryQuestionKey(q.question) === qKey);
  if (byQuestion) return byQuestion;
  const aliasKey = normalizeInquiryQuestionKey(inquiryConceptAlias(question));
  if (!aliasKey) return undefined;
  return inquiries.find((q) => {
    const existingAlias = normalizeInquiryQuestionKey(inquiryConceptAlias(q.question));
    return existingAlias === aliasKey;
  });
}

function resolveTopicInSubject(topics: Topic[], rawTopicId: unknown, suggestedTopic: string | undefined): Topic | undefined {
  const id = typeof rawTopicId === 'string' ? rawTopicId.trim() : '';
  if (id) {
    const byId = topics.find((t) => t.id === id);
    if (byId) return byId;
  }
  if (!suggestedTopic) return undefined;
  const exact = topics.find((t) => sameName(t.name, suggestedTopic));
  if (exact) return exact;
  const lower = suggestedTopic.toLowerCase();
  if (lower.length >= 3) {
    const close = topics.filter((t) => t.name.toLowerCase().includes(lower) || lower.includes(t.name.toLowerCase()));
    if (close.length === 1) return close[0];
  }
  return undefined;
}

export function parseInquiryReply(raw: string, data: SkillsData): ParseResult<DraftInquiryAnswer[]> {
  if (typeof raw !== 'string' || !raw.trim()) {
    return { ok: false, error: 'Paste the AI’s reply first.', warnings: [] };
  }
  let parsedReply: { value: unknown; cutOff: boolean };
  try {
    parsedReply = readInquiryJson(raw);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'That reply couldn’t be read.', warnings: [] };
  }
  const { value, cutOff } = parsedReply;
  const list = Array.isArray(value)
    ? value
    : isRecord(value)
      ? (Array.isArray(value.answers)
          ? value.answers
          : Array.isArray(value.items)
            ? value.items
            : Array.isArray(value.lookups)
              ? value.lookups
              : Array.isArray(value.questions)
                ? value.questions
                : null)
      : null;

  if (!list) {
    return { ok: false, error: 'That doesn’t look like inquiry answers. Expected JSON with an "answers" list.', warnings: [] };
  }
  if (!list.length) {
    return { ok: false, error: 'The reply had an empty list of answers.', warnings: [] };
  }

  const warnings: string[] = cutOff ? ['The reply looks cut off; only the answers that came through were read.'] : [];
  const inquiries = data.inquiries ?? [];
  const out: DraftInquiryAnswer[] = [];

  list.slice(0, 100).forEach((entry, i) => {
    if (!isRecord(entry)) {
      warnings.push(`Answer ${i + 1} wasn’t an object and was skipped.`);
      return;
    }
    const rawQuestion = text(entry.question ?? entry.title ?? entry.concept ?? entry.term, LIMITS.question);
    const matchedInquiry = matchInquiryInData(inquiries, entry.inquiryId, rawQuestion);
    const question = rawQuestion || matchedInquiry?.question || '';
    if (!question) {
      warnings.push(`Answer ${i + 1} had no question or matching inquiryId and was skipped.`);
      return;
    }
    const takeaways = normalizeTakeaways(entry.takeaways ?? entry.keyTakeaways);
    const rawAnswer = text(entry.answer ?? entry.explanation ?? entry.summary, LIMITS.answer);
    const answer = rawAnswer || takeaways;
    if (!answer) {
      warnings.push(`Answer for "${question}" had no explanation and was skipped.`);
      return;
    }
    if (!rawAnswer && takeaways) {
      warnings.push(`Answer for "${question}" used takeaways because "answer" was empty.`);
    }

    const tags = normalizeInquiryTags(entry.tags);
    const sources = normalizeInquirySources(entry.sources);
    const suggestedSubject = text(entry.suggestedSubject ?? entry.subject ?? entry.skill, LIMITS.name) || undefined;
    const suggestedTopic = text(entry.suggestedTopic ?? entry.topic, LIMITS.name) || undefined;

    let subject: Subject | undefined;
    const rawSubjectId = typeof entry.subjectId === 'string' ? entry.subjectId.trim() : '';
    if (rawSubjectId) subject = data.subjects.find((s) => s.id === rawSubjectId);
    if (!subject && suggestedSubject) {
      subject = data.subjects.find((s) => s.id === suggestedSubject || sameName(s.name, suggestedSubject));
    }
    if (!subject && matchedInquiry?.subjectId) {
      subject = data.subjects.find((s) => s.id === matchedInquiry.subjectId);
    }

    let topic: Topic | undefined;
    if (subject) {
      topic = resolveTopicInSubject(subject.topics, entry.topicId, suggestedTopic);
      if (!topic && matchedInquiry?.subjectId === subject.id && matchedInquiry.topicId) {
        topic = subject.topics.find((t) => t.id === matchedInquiry.topicId);
      }
    } else if (suggestedTopic) {
      const topicMatches: { subject: Subject; topic: Topic }[] = [];
      for (const s of data.subjects) {
        const t = s.topics.find((tp) => sameName(tp.name, suggestedTopic));
        if (t) topicMatches.push({ subject: s, topic: t });
      }
      if (topicMatches.length === 1) {
        subject = topicMatches[0].subject;
        topic = topicMatches[0].topic;
      }
    }

    let flashcard: DraftInquiryAnswer['flashcard'];
    if (isRecord(entry.flashcard)) {
      const front = text(entry.flashcard.front, LIMITS.front);
      const back = text(entry.flashcard.back, LIMITS.back);
      if (front && back) {
        const diffRaw = Number(entry.flashcard.difficulty);
        const difficulty = Number.isFinite(diffRaw) ? Math.min(5, Math.max(1, Math.round(diffRaw))) : undefined;
        flashcard = { front, back, ...(difficulty !== undefined ? { difficulty } : {}) };
      }
    }

    out.push({
      ...(matchedInquiry ? { inquiryId: matchedInquiry.id } : {}),
      question,
      answer,
      ...(takeaways ? { takeaways } : {}),
      tags,
      sources,
      ...(suggestedSubject ? { suggestedSubject } : {}),
      ...(suggestedTopic ? { suggestedTopic } : {}),
      ...(subject ? { subjectId: subject.id } : {}),
      ...(topic ? { topicId: topic.id } : {}),
      ...(flashcard ? { flashcard } : {}),
    });
  });

  if (!out.length) {
    return { ok: false, error: 'None of the inquiry answers in that reply could be read.', warnings };
  }

  return { ok: true, data: out, warnings };
}

// ── Bulk Q&A Pair Parsing & Knowledge Base Search / Export ───────────────────

export type ParsedBulkQAItem = {
  question: string;
  answer?: string;
};

const Q_LINE_RE = /^(?:Q\d*|Question\s*\d*)\s*:\s*(.*)$/i;
const A_LINE_RE = /^(?:A\d*|Answer\s*\d*)\s*:\s*(.*)$/i;
const INLINE_QA_SINGLE_RE = /^(?:Q\d*|Question\s*\d*)\s*:\s*(.+?)\s+(?:A\d*|Answer\s*\d*)\s*:\s*(.+)$/i;

function stripListPrefix(rawLine: string): { line: string; hadBullet: boolean } {
  let line = rawLine.trim();
  let hadBullet = false;
  while (line) {
    const next = line
      .replace(/^(?:[-*•◦▪‣]|\d+[.)])(?:\s+|$)/, '')
      .replace(/^\[(?: |x|X)?\](?:\s+|$)/, '')
      .trim();
    if (next === line) break;
    hadBullet = true;
    line = next;
  }
  return { line, hadBullet };
}

function cleanQuestionPiece(raw: string): string {
  const m = Q_LINE_RE.exec(raw.trim());
  const unwrapped = m ? m[1] : raw;
  return unwrapped.replace(/\s+/g, ' ').trim().slice(0, LIMITS.question).trim();
}

function cleanAnswerPiece(raw: string): string {
  const m = A_LINE_RE.exec(raw.trim());
  const unwrapped = m ? m[1] : raw;
  return unwrapped.trim().slice(0, LIMITS.answer).trim();
}

function splitInlineQA(line: string): ParsedBulkQAItem | null {
  const inlineQA = INLINE_QA_SINGLE_RE.exec(line);
  if (inlineQA) {
    const question = cleanQuestionPiece(inlineQA[1]);
    const answer = cleanAnswerPiece(inlineQA[2]);
    if (question && answer) return { question, answer };
  }
  for (const sepRe of [/^(.*?)\s+::\s+(.+)$/, /^(.*?)\s+(?:->|→)\s+(.+)$/, /^(.*?)\s+—\s+(.+)$/]) {
    const m = sepRe.exec(line);
    if (!m) continue;
    const question = cleanQuestionPiece(m[1]);
    const answer = cleanAnswerPiece(m[2]);
    if (question && answer) return { question, answer };
  }
  return null;
}

/**
 * Parse pasted bulk lookups / Q&A pairs. Supports:
 * - Plain list lines (`- What is MCP?`, `* ...`, `1. ...`, `[ ] ...`)
 * - `Q: ...` / `A: ...` blocks (including multi-line answers)
 * - Inline Q&A pairs (`Question :: Answer`, `Question -> Answer`, `Question — Answer`)
 */
export function parseBulkQAInput(rawText: string): ParsedBulkQAItem[] {
  if (typeof rawText !== 'string' || !rawText.trim()) return [];
  const lines = rawText.split(/\r?\n/);
  const rawItems: ParsedBulkQAItem[] = [];

  type PendingBlock = { qLines: string[]; aLines: string[]; mode: 'q' | 'a'; pendingBlank: boolean };
  let current: PendingBlock | null = null;
  let lastWasPlainQuestion = false;

  const flushCurrent = () => {
    if (!current) return;
    const question = current.qLines.join(' ').replace(/\s+/g, ' ').trim().slice(0, LIMITS.question).trim();
    const answer = current.aLines.join('\n').trim().slice(0, LIMITS.answer).trim();
    if (question) {
      rawItems.push({ question, ...(answer ? { answer } : {}) });
    }
    current = null;
  };

  const nextNonBlankAfter = (startIdx: number): string | null => {
    for (let j = startIdx + 1; j < lines.length; j++) {
      const t = lines[j].trim();
      if (t) return t;
    }
    return null;
  };

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) {
      if (current) {
        const nextRaw = nextNonBlankAfter(i);
        if (!nextRaw) {
          flushCurrent();
        } else {
          const nextStripped = stripListPrefix(nextRaw);
          if (current.mode === 'a') {
            if (
              !nextStripped.line
              || nextStripped.hadBullet
              || Q_LINE_RE.test(nextStripped.line)
              || !!splitInlineQA(nextStripped.line)
              || nextStripped.line.endsWith('?')
            ) {
              flushCurrent();
            } else {
              current.pendingBlank = true;
            }
          } else if (A_LINE_RE.test(nextStripped.line)) {
            // Keep open while awaiting A:
          } else {
            flushCurrent();
          }
        }
      }
      lastWasPlainQuestion = false;
      continue;
    }

    const { line, hadBullet } = stripListPrefix(trimmed);
    if (!line) {
      flushCurrent();
      lastWasPlainQuestion = false;
      continue;
    }

    const qMatch = Q_LINE_RE.exec(line);
    if (qMatch) {
      flushCurrent();
      const inline = splitInlineQA(line);
      if (inline) {
        rawItems.push(inline);
        lastWasPlainQuestion = false;
      } else {
        current = {
          qLines: qMatch[1].trim() ? [qMatch[1].trim()] : [],
          aLines: [],
          mode: 'q',
          pendingBlank: false,
        };
        lastWasPlainQuestion = false;
      }
      continue;
    }

    const aMatch = A_LINE_RE.exec(line);
    if (aMatch) {
      const rest = aMatch[1].trim();
      if (current) {
        current.mode = 'a';
        current.pendingBlank = false;
        if (rest) current.aLines.push(rest);
      } else if (lastWasPlainQuestion && rawItems.length > 0 && !rawItems[rawItems.length - 1].answer) {
        const prev = rawItems.pop()!;
        current = {
          qLines: [prev.question],
          aLines: rest ? [rest] : [],
          mode: 'a',
          pendingBlank: false,
        };
      }
      lastWasPlainQuestion = false;
      continue;
    }

    if (current) {
      if (current.mode === 'a') {
        if (hadBullet && (current.aLines.length > 0 || line.endsWith('?'))) {
          flushCurrent();
          // Re-process this bulleted line below as a new entry.
        } else {
          const inline = splitInlineQA(line);
          const strongSep = inline && (/\s+::\s+/.test(line) || /\?\s+(?:->|→|—)\s+/.test(line));
          if (strongSep && inline) {
            flushCurrent();
            rawItems.push(inline);
            lastWasPlainQuestion = false;
            continue;
          }
          if (current.pendingBlank) {
            current.aLines.push('');
            current.pendingBlank = false;
          }
          current.aLines.push(line);
          lastWasPlainQuestion = false;
          continue;
        }
      } else {
        const inline = splitInlineQA(line);
        if (hadBullet || inline) {
          flushCurrent();
          // Re-process below
        } else {
          current.qLines.push(line);
          lastWasPlainQuestion = false;
          continue;
        }
      }
    }

    const inline = splitInlineQA(line);
    if (inline) {
      rawItems.push(inline);
      lastWasPlainQuestion = false;
      continue;
    }

    const clipped = line.replace(/\s+/g, ' ').trim().slice(0, LIMITS.question).trim();
    if (clipped) {
      rawItems.push({ question: clipped });
      lastWasPlainQuestion = true;
    } else {
      lastWasPlainQuestion = false;
    }
  }

  flushCurrent();

  const seen = new Map<string, number>();
  const out: ParsedBulkQAItem[] = [];
  for (const item of rawItems) {
    const key = item.question.replace(/\s+/g, ' ').toLowerCase();
    const existingIdx = seen.get(key);
    if (existingIdx !== undefined) {
      if (!out[existingIdx].answer && item.answer) {
        out[existingIdx] = { ...out[existingIdx], answer: item.answer };
      }
      continue;
    }
    seen.set(key, out.length);
    out.push(item);
  }
  return out;
}

export type InquirySortMode = 'open-first' | 'newest' | 'recently-answered' | 'alphabetical';

export type InquirySubjectMeta = { name: string; topics?: { id: string; name: string }[] };

export type InquiryFilterOptions = {
  statusTab?: 'all' | InquiryStatus;
  search?: string;
  tagFilter?: string | null;
  skillFilter?: string;
  fixedSubjectId?: string;
  sort?: InquirySortMode;
  subjectLookup?: Map<string, InquirySubjectMeta>;
};

export function extractInquirySearchTerms(search: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of search.trim().split(/\s+/)) {
    if (!raw) continue;
    let term = raw;
    if (term.startsWith('[[') && term.endsWith(']]') && term.length > 4) {
      term = term.slice(2, -2).trim();
    } else if (term.startsWith('#') && term.length > 1) {
      term = term.slice(1);
    }
    if (!term) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(term);
  }
  return out.sort((a, b) => b.length - a.length);
}

export function inquiryMatchesSearch(
  item: KnowledgeInquiry,
  search: string,
  subjectLookup?: Map<string, InquirySubjectMeta>,
): boolean {
  const tokens = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  const sub = item.subjectId ? subjectLookup?.get(item.subjectId) : undefined;
  const topic = sub && item.topicId ? sub.topics?.find((t) => t.id === item.topicId) : undefined;
  const tagsText = (item.tags ?? []).map((t) => `#${t} ${t}`).join(' ');
  const haystack = [
    item.question,
    item.context ?? '',
    item.answer ?? '',
    item.takeaways ?? '',
    ...(item.sources ?? []),
    tagsText,
    sub?.name ?? '',
    topic?.name ?? '',
  ]
    .join('\n')
    .toLowerCase();

  return tokens.every((tok) => {
    if (haystack.includes(tok)) return true;
    if (tok.startsWith('[[') && tok.endsWith(']]') && tok.length > 4) {
      return haystack.includes(tok.slice(2, -2));
    }
    return false;
  });
}

export function filterAndSortInquiries(
  inquiries: KnowledgeInquiry[],
  options: InquiryFilterOptions = {},
): KnowledgeInquiry[] {
  const {
    statusTab = 'all',
    search = '',
    tagFilter = null,
    skillFilter = 'all',
    fixedSubjectId,
    sort = 'open-first',
    subjectLookup,
  } = options;

  const normalizedTag = tagFilter ? tagFilter.trim().replace(/^#+/, '').toLowerCase() : null;

  const filtered = inquiries.filter((item) => {
    if (fixedSubjectId) {
      if (item.subjectId !== fixedSubjectId) return false;
    } else if (skillFilter === '__unassigned__') {
      if (item.subjectId) return false;
    } else if (skillFilter && skillFilter !== 'all') {
      if (item.subjectId !== skillFilter) return false;
    }
    if (statusTab !== 'all' && item.status !== statusTab) return false;
    if (normalizedTag && !(item.tags ?? []).some((t) => t.toLowerCase() === normalizedTag)) return false;
    return inquiryMatchesSearch(item, search, subjectLookup);
  });

  return [...filtered].sort((a, b) => {
    if (sort === 'alphabetical') {
      return a.question.localeCompare(b.question, undefined, { sensitivity: 'base' });
    }
    if (sort === 'newest') {
      return (b.createdAt || b.updatedAt).localeCompare(a.createdAt || a.updatedAt)
        || (b.updatedAt || '').localeCompare(a.updatedAt || '');
    }
    if (sort === 'recently-answered') {
      if (a.status !== b.status) return a.status === 'solved' ? -1 : 1;
      if (a.status === 'solved') {
        return (b.solvedAt || b.updatedAt || b.createdAt).localeCompare(a.solvedAt || a.updatedAt || a.createdAt);
      }
      return (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt);
    }
    // 'open-first'
    if (a.status !== b.status) return a.status === 'open' ? -1 : 1;
    return (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt);
  });
}

export function deckTagCounts(inquiries: KnowledgeInquiry[]): Array<{ tag: string; count: number }> {
  const counts = new Map<string, number>();
  for (const inq of inquiries) {
    for (const raw of inq.tags ?? []) {
      const tag = raw.trim().replace(/^#+/, '').toLowerCase();
      if (!tag) continue;
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

export function formatInquiriesMarkdown(
  inquiries: KnowledgeInquiry[],
  subjectLookup?: Map<string, InquirySubjectMeta>,
): string {
  return inquiries
    .map((inq) => {
      const sub = inq.subjectId ? subjectLookup?.get(inq.subjectId) : undefined;
      const topic = sub && inq.topicId ? sub.topics?.find((t) => t.id === inq.topicId) : undefined;
      const meta: string[] = [];
      if (sub) meta.push(`Skill: ${sub.name}${topic ? ` · ${topic.name}` : ''}`);
      meta.push(`Status: ${inq.status === 'solved' ? 'Solved' : 'Open'}`);
      if (inq.tags?.length) meta.push(`Tags: ${inq.tags.map((t) => `#${t}`).join(', ')}`);

      const sections: string[] = [`### ${inq.question}`, `*${meta.join(' · ')}*`];
      if (inq.context?.trim()) sections.push(`> Context: ${inq.context.trim()}`);
      if (inq.answer?.trim()) sections.push(inq.answer.trim());
      else sections.push('_Open lookup (not answered yet)_');
      if (inq.takeaways?.trim()) sections.push(`**Key Takeaways:**\n${inq.takeaways.trim()}`);
      if (inq.sources?.length) {
        sections.push(`**Sources:**\n${inq.sources.map((s) => `- ${s}`).join('\n')}`);
      }
      return sections.join('\n\n');
    })
    .join('\n\n---\n\n');
}

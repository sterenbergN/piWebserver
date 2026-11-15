// Reading what an AI wrote back: a single-subject plan (topics, resources,
// roadmap, explicit steps), an interconnected multi-skill plan/brainstorm, or a
// batch of questions. Pure, so pages can preview before saving and the server
// can validate again when saving.

import { checkMath, checkQuestion } from '@/lib/daily/validate';
import { addDays, isDateKey, type DateKey } from '@/lib/habits/dates';
import { readReply } from '@/lib/study/study';
import {
  MAX_LEVEL, RESOURCE_KINDS, SKILL_STEP_KINDS, SUBJECT_STATUSES,
  type DraftNewSubject, type DraftParentLink, type DraftResource, type DraftScheduledTask,
  type DraftStep, type DraftSubjectPlan, type DraftTopic, type InterconnectedPlanDraft,
  type ParseResult, type Resource, type ResourceKind, type SkillQuestion, type SkillStepKind,
  type Stage, type Subject, type SubjectStatus, type Topic,
} from './types';

export type {
  DraftNewSubject, DraftParentLink, DraftResource, DraftScheduledTask, DraftStep,
  DraftSubjectPlan, DraftTopic, InterconnectedPlanDraft, ParseResult,
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
  name: 100, description: 600, title: 200, author: 160, amount: 160,
  detail: 1200, roadmap: 20000, summary: 2000, front: 3000, back: 6000,
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

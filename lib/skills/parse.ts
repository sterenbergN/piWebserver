// Reading what an AI wrote back: a plan (topics, resources, roadmap) or a batch
// of questions. Pure, so the page can preview a reply before it's saved and the
// server can check it again when it is.

import { checkMath, checkQuestion } from '@/lib/daily/validate';
import { readReply } from '@/lib/study/study';
import { RESOURCE_KINDS, type ResourceKind, type SkillQuestion, type Stage, type Subject, type Topic } from './types';

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

export const LIMITS = { name: 100, description: 600, title: 200, author: 160, detail: 1200, roadmap: 20000, summary: 2000, front: 3000, back: 6000 };

// ── Plans ────────────────────────────────────────────────────────────────────

export type DraftTopic = { key: string; name: string; stage: Stage; core: boolean; description?: string; existingId?: string };
export type DraftResource = { kind: ResourceKind; title: string; author?: string; url?: string; detail?: string; hours?: number; topicKeys: string[]; existingId?: string };
export type ParsedPlan = { summary?: string; roadmap?: string; topics: DraftTopic[]; resources: DraftResource[]; warnings: string[] };

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

const httpsUrl = (v: unknown) => {
  const url = text(v, 600);
  return /^https?:\/\/[^\s"<>]+$/.test(url) ? url : undefined;
};

/** A plan reply, matched against what the subject already has so nothing is added twice. */
export function parsePlanReply(raw: string, subject: Pick<Subject, 'topics' | 'resources'>): ParsedPlan {
  const { value, cutOff } = reply(raw);
  if (!isRecord(value)) throw new SkillsInputError('That doesn’t look like a plan. It should be one JSON object with "topics" and "resources".');
  const warnings: string[] = cutOff ? ['The reply looks cut off; only the parts that came through were read.'] : [];

  const topics: DraftTopic[] = [];
  const rawTopics = Array.isArray(value.topics) ? value.topics : [];
  rawTopics.slice(0, 60).forEach((t, i) => {
    if (!isRecord(t)) return;
    const name = text(t.name, LIMITS.name);
    if (!name) { warnings.push(`Topic ${i + 1} has no name, so it was left out.`); return; }
    if (topics.some((d) => sameName(d.name, name))) return;
    const key = text(t.key, 40) || `t${i + 1}`;
    const existing = subject.topics.find((x) => sameName(x.name, name));
    const description = text(t.description, LIMITS.description);
    topics.push({ key, name, stage: stageOf(t.stage), core: t.core !== false, ...(description ? { description } : {}), ...(existing ? { existingId: existing.id } : {}) });
  });

  const keyFor = (ref: unknown): string | undefined => {
    const r = text(ref, LIMITS.name);
    if (!r) return undefined;
    const draft = topics.find((d) => d.key === r || sameName(d.name, r));
    if (draft) return draft.key;
    const existing = subject.topics.find((x) => sameName(x.name, r) || x.id === r);
    return existing ? `existing:${existing.id}` : undefined;
  };

  const resources: DraftResource[] = [];
  const rawResources = Array.isArray(value.resources) ? value.resources : [];
  rawResources.slice(0, 80).forEach((r, i) => {
    if (!isRecord(r)) return;
    const title = text(r.title, LIMITS.title);
    if (!title) { warnings.push(`Resource ${i + 1} has no title, so it was left out.`); return; }
    if (resources.some((d) => sameName(d.title, title))) return;
    const refs = Array.isArray(r.topics) ? r.topics : r.topics !== undefined ? [r.topics] : [];
    const topicKeys = [...new Set(refs.map(keyFor).filter((k): k is string => !!k))];
    const existing = subject.resources.find((x) => sameName(x.title, title));
    const hours = typeof r.hours === 'number' && r.hours > 0 && r.hours < 5000 ? Math.round(r.hours) : undefined;
    const author = text(r.author, LIMITS.author);
    const detail = text(r.detail ?? r.why ?? r.description, LIMITS.detail);
    const url = httpsUrl(r.url);
    resources.push({
      kind: kindOf(r.kind ?? r.type), title, topicKeys,
      ...(author ? { author } : {}), ...(url ? { url } : {}), ...(detail ? { detail } : {}), ...(hours ? { hours } : {}), ...(existing ? { existingId: existing.id } : {}),
    });
  });

  const summary = text(value.summary, LIMITS.summary);
  const roadmap = text(value.roadmap, LIMITS.roadmap);
  if (!topics.length && !resources.length && !roadmap) throw new SkillsInputError('There were no topics, resources or roadmap in that reply.');
  return { ...(summary ? { summary } : {}), ...(roadmap ? { roadmap } : {}), topics, resources, warnings };
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

// Grading, and the public view of a question (everything except answers and
// the worked solution, which are only sent once you've answered or given up).

import type { Answer, DailyDay, Formula, Part, PartResponse, Question } from './types';

const DEFAULT_TOLERANCE = 0.02;

function close(given: number, expected: number, rel = DEFAULT_TOLERANCE, abs = 1e-9) {
  return Math.abs(given - expected) <= Math.max(abs, rel * Math.abs(expected));
}

/** Highest power first; strip leading zeros, then scale so `scaleBy` leads with 1. */
function normalizePoly(numerator: number[], denominator: number[]) {
  const trim = (p: number[]) => { const i = p.findIndex((c) => c !== 0); return i < 0 ? [0] : p.slice(i); };
  const num = trim(numerator);
  const den = trim(denominator);
  const lead = den[0];
  if (!lead) return null;
  return { num: num.map((c) => c / lead), den: den.map((c) => c / lead) };
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Turn untrusted input into a response for this answer type (or undefined if it isn't one). */
export function parseResponse(answer: Answer, raw: any): PartResponse | undefined {
  if (!raw || typeof raw !== 'object' || raw.type !== answer.type) return undefined;
  switch (answer.type) {
    case 'numeric':
      return finite(raw.value) ? { type: 'numeric', value: raw.value } : undefined;
    case 'choice':
      return Number.isInteger(raw.option) && raw.option >= 0 && raw.option < answer.options.length ? { type: 'choice', option: raw.option } : undefined;
    case 'multi': {
      if (!Array.isArray(raw.options)) return undefined;
      const options = [...new Set(raw.options)].filter((o): o is number => Number.isInteger(o) && (o as number) >= 0 && (o as number) < answer.options.length);
      return { type: 'multi', options: options.sort((a, b) => a - b) };
    }
    case 'range': {
      const ok = (v: unknown) => v === null || finite(v);
      return ok(raw.min) && ok(raw.max) ? { type: 'range', min: raw.min, max: raw.max } : undefined;
    }
    case 'coefficients': {
      const poly = (v: unknown) => Array.isArray(v) && v.length >= 1 && v.length <= 12 && v.every(finite);
      return poly(raw.numerator) && poly(raw.denominator) ? { type: 'coefficients', numerator: raw.numerator, denominator: raw.denominator } : undefined;
    }
    case 'order': {
      const items = Array.isArray(raw.items) ? raw.items : [];
      const same = items.length === answer.items.length && answer.items.every((i) => items.includes(i));
      return same ? { type: 'order', items } : undefined;
    }
  }
}

export function isPartCorrect(answer: Answer, response: PartResponse | undefined): boolean {
  if (!response || response.type !== answer.type) return false;
  switch (answer.type) {
    case 'numeric':
      return close((response as { value: number }).value, answer.value, answer.tolerance, answer.abs);
    case 'choice':
      return (response as { option: number }).option === answer.correct;
    case 'multi': {
      const given = (response as { options: number[] }).options;
      return given.length === answer.correct.length && answer.correct.every((c) => given.includes(c));
    }
    case 'range': {
      const r = response as { min: number | null; max: number | null };
      const side = (given: number | null, expected: number | null) =>
        expected === null ? given === null : given !== null && close(given, expected, answer.tolerance, answer.abs ?? 1e-6);
      return side(r.min, answer.min) && side(r.max, answer.max);
    }
    case 'coefficients': {
      const r = response as { numerator: number[]; denominator: number[] };
      const given = normalizePoly(r.numerator, r.denominator);
      const expected = normalizePoly(answer.numerator, answer.denominator);
      if (!given || !expected || given.num.length !== expected.num.length || given.den.length !== expected.den.length) return false;
      const match = (a: number[], b: number[]) => a.every((c, i) => close(c, b[i], answer.tolerance, 1e-6));
      return match(given.num, expected.num) && match(given.den, expected.den);
    }
    case 'order':
      return (response as { items: string[] }).items.every((item, i) => item === answer.items[i]);
  }
}

/** The note for a known mistake this response matches, if any. */
function mistakeNote(part: Part, response: PartResponse | undefined) {
  if (!response || !part.mistakes) return undefined;
  return part.mistakes.find((m) =>
    (response.type === 'numeric' && m.value !== undefined && close(response.value, m.value))
    || (response.type === 'choice' && m.option === response.option))?.note;
}

export type QuestionStatus = 'solved' | 'partial' | 'wrong' | 'studied';
export type PartResult = { id: string; correct: boolean; mistake?: string };
export type QuestionResult = { parts: PartResult[]; correct: number; total: number; status: QuestionStatus };

export function gradeQuestion(question: Question, responses: Record<string, PartResponse | undefined> | null): QuestionResult {
  const total = question.parts.length;
  if (!responses) return { parts: [], correct: 0, total, status: 'studied' };
  const parts = question.parts.map((part) => {
    const response = responses[part.id];
    const correct = isPartCorrect(part.answer, response);
    const mistake = correct ? undefined : mistakeNote(part, response);
    return { id: part.id, correct, ...(mistake ? { mistake } : {}) };
  });
  const correct = parts.filter((p) => p.correct).length;
  return { parts, correct, total, status: correct === total ? 'solved' : correct > 0 ? 'partial' : 'wrong' };
}

/** Clean up a whole set of responses for a question. */
export function parseResponses(question: Question, raw: unknown): Record<string, PartResponse> {
  const out: Record<string, PartResponse> = {};
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  for (const part of question.parts) {
    const response = parseResponse(part.answer, source[part.id]);
    if (response) out[part.id] = response;
  }
  return out;
}

/* ── Public view ─────────────────────────────────────────────────────────── */

/** What the answer box needs to know, without the answer. */
export type PublicInput =
  | { type: 'numeric'; unit?: string }
  | { type: 'choice'; options: string[] }
  | { type: 'multi'; options: string[] }
  | { type: 'range' }
  | { type: 'coefficients' }
  | { type: 'order'; items: string[] };

export type PublicQuestion = Omit<Question, 'parts' | 'solution' | 'check'> & {
  parts: { id: string; prompt?: string; input: PublicInput }[];
};

/** A stable shuffle (same order every time for the same question), never the answer order. */
function shuffled(items: string[], seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const rand = () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0) / 4294967296;
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  if (out.every((item, i) => item === items[i])) out.push(out.shift()!);
  return out;
}

function publicInput(answer: Answer, seed: string): PublicInput {
  switch (answer.type) {
    case 'numeric': return { type: 'numeric', ...(answer.unit ? { unit: answer.unit } : {}) };
    case 'choice': return { type: 'choice', options: answer.options };
    case 'multi': return { type: 'multi', options: answer.options };
    case 'range': return { type: 'range' };
    case 'coefficients': return { type: 'coefficients' };
    case 'order': return { type: 'order', items: shuffled(answer.items, seed) };
  }
}

export function publicQuestion(q: Question): PublicQuestion {
  const { parts, solution, check, ...rest } = q;
  return { ...rest, parts: parts.map((p) => ({ id: p.id, ...(p.prompt ? { prompt: p.prompt } : {}), input: publicInput(p.answer, `${q.id}/${p.id}`) })) };
}

/** A day as anyone may see it before answering. */
export type PublicDay = { date: string; boss?: boolean; core: PublicQuestion; bonus: PublicQuestion[]; formulas: Formula[]; formulaOfTheDay?: Formula };

export function publicDay(day: DailyDay): PublicDay {
  return {
    date: day.date,
    ...(day.boss ? { boss: true } : {}),
    core: publicQuestion(day.core),
    bonus: day.bonus.map(publicQuestion),
    formulas: day.formulas,
    ...(day.formulaOfTheDay ? { formulaOfTheDay: day.formulaOfTheDay } : {}),
  };
}

/** The answer key as shown after answering (no admin check notes). */
export function revealedQuestion(q: Question): Omit<Question, 'check'> {
  const { check, ...rest } = q;
  return rest;
}

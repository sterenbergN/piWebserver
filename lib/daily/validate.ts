// Checks an uploaded pack before anything is saved: structure, answer keys,
// references between questions and formulas, and that every bit of math
// actually renders. Returns clean copies (unknown fields dropped) or the list
// of problems, each pointing at where it is.

import katex from 'katex';
import { isDateKey } from '@/lib/habits/dates';
import { TRACKS, type Answer, type DailyDay, type DailyPack, type Formula, type Mistake, type Part, type PracticeSet, type Question, type Source } from './types';

type Errors = string[];

const isText = (v: unknown, max: number, min = 1): v is string => typeof v === 'string' && v.trim().length >= min && v.length <= max;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isIndex = (v: unknown, length: number): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) < length;
const ID = /^[\w-]{1,80}$/;

/** Every $…$ and $$…$$ in a markdown string must render. */
function checkMath(text: string, where: string, errors: Errors) {
  // An escaped \$ is a literal dollar sign (currency), never a math delimiter.
  const pattern = /\$\$([\s\S]+?)\$\$|(?<![\\$])\$(?!\s)((?:\\\$|[^$\n])+?)(?<![\s\\])\$/g;
  for (const match of text.matchAll(pattern)) {
    const tex = match[1] ?? match[2];
    try {
      katex.renderToString(tex, { throwOnError: true, displayMode: !!match[1] });
    } catch (error) {
      errors.push(`${where}: math doesn't render ($${tex.slice(0, 40)}…$): ${(error as Error).message.split('\n')[0]}`);
    }
  }
}

function checkAnswer(raw: any, where: string, errors: Errors): Answer | null {
  const tol = (v: unknown) => v === undefined || (isNum(v) && v >= 0 && v <= 0.5);
  const abs = (v: unknown) => v === undefined || (isNum(v) && v >= 0);
  const options = (list: unknown, min: number, max: number) =>
    Array.isArray(list) && list.length >= min && list.length <= max && list.every((o) => isText(o, 400));
  switch (raw?.type) {
    case 'numeric':
      if (!isNum(raw.value) || !tol(raw.tolerance) || !abs(raw.abs) || (raw.unit !== undefined && !isText(raw.unit, 30))) break;
      if (raw.value === 0 && !raw.abs) { errors.push(`${where}: an answer of 0 needs an absolute tolerance (abs)`); return null; }
      return { type: 'numeric', value: raw.value, ...(raw.unit ? { unit: raw.unit } : {}), ...(raw.tolerance !== undefined ? { tolerance: raw.tolerance } : {}), ...(raw.abs !== undefined ? { abs: raw.abs } : {}) };
    case 'choice':
      if (!options(raw.options, 2, 8) || !isIndex(raw.correct, raw.options.length)) break;
      return { type: 'choice', options: raw.options, correct: raw.correct };
    case 'multi':
      if (!options(raw.options, 2, 10) || !Array.isArray(raw.correct) || !raw.correct.length
        || !raw.correct.every((i: unknown) => isIndex(i, raw.options.length)) || new Set(raw.correct).size !== raw.correct.length) break;
      return { type: 'multi', options: raw.options, correct: [...raw.correct].sort((a, b) => a - b) };
    case 'range': {
      const ok = (v: unknown) => v === null || isNum(v);
      if (!ok(raw.min) || !ok(raw.max) || (raw.min === null && raw.max === null) || !tol(raw.tolerance) || !abs(raw.abs)) break;
      if (raw.min !== null && raw.max !== null && raw.min >= raw.max) break;
      return { type: 'range', min: raw.min, max: raw.max, ...(raw.tolerance !== undefined ? { tolerance: raw.tolerance } : {}), ...(raw.abs !== undefined ? { abs: raw.abs } : {}) };
    }
    case 'coefficients': {
      const poly = (v: unknown) => Array.isArray(v) && v.length >= 1 && v.length <= 10 && v.every(isNum);
      if (!poly(raw.numerator) || !poly(raw.denominator) || raw.denominator[0] === 0 || !tol(raw.tolerance)) break;
      return { type: 'coefficients', numerator: raw.numerator, denominator: raw.denominator, ...(raw.tolerance !== undefined ? { tolerance: raw.tolerance } : {}) };
    }
    case 'order':
      if (!options(raw.items, 2, 10) || new Set(raw.items).size !== raw.items.length) break;
      return { type: 'order', items: raw.items };
  }
  errors.push(`${where}: invalid answer (${raw?.type ?? 'no type'})`);
  return null;
}

function checkMistakes(raw: unknown, answer: Answer, where: string, errors: Errors): Mistake[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.length > 10) { errors.push(`${where}: mistakes must be a list of up to 10`); return undefined; }
  return raw.flatMap((m: any, i) => {
    const ok = isText(m?.note, 600) && (answer.type === 'numeric' ? isNum(m.value)
      : answer.type === 'choice' ? isIndex(m.option, answer.options.length) : false);
    if (!ok) { errors.push(`${where}.mistakes[${i}]: needs a note and a value (numeric) or option (choice)`); return []; }
    checkMath(m.note, `${where}.mistakes[${i}]`, errors);
    return [{ ...(isNum(m.value) ? { value: m.value } : {}), ...(Number.isInteger(m.option) ? { option: m.option } : {}), note: m.note }];
  });
}

function checkFormula(raw: any, where: string, errors: Errors): Formula | null {
  if (!ID.test(raw?.id ?? '') || !isText(raw.name, 120) || !isText(raw.latex, 2000) || !isText(raw.source, 300) || (raw.note !== undefined && !isText(raw.note, 600))) {
    errors.push(`${where}: a formula needs an id, name, latex and source`);
    return null;
  }
  try { katex.renderToString(raw.latex, { throwOnError: true, displayMode: true }); } catch (error) {
    errors.push(`${where} (${raw.id}): latex doesn't render: ${(error as Error).message.split('\n')[0]}`);
  }
  if (raw.note) checkMath(raw.note, where, errors);
  return { id: raw.id, name: raw.name, latex: raw.latex, source: raw.source, ...(raw.note ? { note: raw.note } : {}) };
}

function checkQuestion(raw: any, where: string, formulaIds: Set<string>, errors: Errors): Question | null {
  const before = errors.length;
  const fail = (msg: string) => errors.push(`${where}: ${msg}`);
  if (!ID.test(raw?.id ?? '')) fail('id must be letters, digits, - or _');
  if (!TRACKS.includes(raw?.track)) fail(`track must be one of ${TRACKS.join(', ')}`);
  if (!isText(raw?.topic, 80)) fail('needs a topic');
  if (!Number.isInteger(raw?.difficulty) || raw.difficulty < 1 || raw.difficulty > 5) fail('difficulty must be 1–5');
  if (!isText(raw?.title, 160)) fail('needs a title');
  if (!isText(raw?.prompt, 10000)) fail('needs a prompt');
  if (!isText(raw?.solution, 30000)) fail('needs a worked solution');
  if (raw?.figure !== undefined && (!isText(raw.figure, 80000) || !/^\s*<svg[\s>]/.test(raw.figure) || !isText(raw.figureAlt, 400))) {
    fail('figure must be SVG markup with a figureAlt description');
  }
  const hints = raw?.hints ?? [];
  if (!Array.isArray(hints) || hints.length > 5 || !hints.every((h: unknown) => isText(h, 1500))) fail('hints must be up to 5 strings');
  const sources: Source[] = Array.isArray(raw?.sources) ? raw.sources.flatMap((s: any, i: number) => {
    if (!isText(s?.title, 300) || (s.detail !== undefined && !isText(s.detail, 300)) || (s.url !== undefined && !/^https:\/\/[^\s"<>]+$/.test(s.url))) {
      fail(`sources[${i}] needs a title (and an https url, if any)`);
      return [];
    }
    return [{ title: s.title, ...(s.detail ? { detail: s.detail } : {}), ...(s.url ? { url: s.url } : {}) }];
  }) : [];
  if (!sources.length || sources.length > 8) fail('needs 1–8 sources');
  const formulas = raw?.formulas ?? [];
  if (!Array.isArray(formulas) || !formulas.every((f: unknown) => typeof f === 'string' && formulaIds.has(f))) {
    fail(`formulas must be ids from the day's formula sheet (${[...formulaIds].join(', ') || 'none'})`);
  }

  const partIds = new Set<string>();
  const parts: Part[] = Array.isArray(raw?.parts) && raw.parts.length >= 1 && raw.parts.length <= 8 ? raw.parts.flatMap((p: any, i: number) => {
    const at = `${where}.parts[${i}]`;
    if (!ID.test(p?.id ?? '') || partIds.has(p.id)) { errors.push(`${at}: needs a unique id`); return []; }
    partIds.add(p.id);
    if (p.prompt !== undefined && !isText(p.prompt, 3000)) { errors.push(`${at}: prompt too long`); return []; }
    const answer = checkAnswer(p.answer, at, errors);
    if (!answer) return [];
    if (p.prompt) checkMath(p.prompt, at, errors);
    const mistakes = checkMistakes(p.mistakes, answer, at, errors);
    return [{ id: p.id, ...(p.prompt ? { prompt: p.prompt } : {}), answer, ...(mistakes?.length ? { mistakes } : {}) }];
  }) : (fail('needs 1–8 parts'), []);

  for (const [field, text] of [['prompt', raw?.prompt], ['solution', raw?.solution], ...hints.map((h: string, i: number) => [`hints[${i}]`, h])] as [string, unknown][]) {
    if (typeof text === 'string') checkMath(text, `${where}.${field}`, errors);
  }
  if (errors.length > before) return null;
  return {
    id: raw.id, track: raw.track, topic: raw.topic.trim(), difficulty: raw.difficulty, title: raw.title.trim(), prompt: raw.prompt,
    ...(raw.figure ? { figure: raw.figure, figureAlt: raw.figureAlt } : {}),
    parts, ...(hints.length ? { hints } : {}), solution: raw.solution, sources,
    ...(formulas.length ? { formulas } : {}), ...(isText(raw.check, 4000) ? { check: raw.check } : {}),
  };
}

export function validateDay(raw: any, where = 'day'): { day: DailyDay | null; errors: string[] } {
  const errors: Errors = [];
  const at = isDateKey(raw?.date) ? raw.date : where;
  if (!isDateKey(raw?.date)) errors.push(`${where}: date must be YYYY-MM-DD`);

  const formulaIds = new Set<string>();
  const formulas = Array.isArray(raw?.formulas) ? raw.formulas.flatMap((f: unknown, i: number) => {
    const formula = checkFormula(f, `${at}.formulas[${i}]`, errors);
    if (!formula) return [];
    if (formulaIds.has(formula.id)) { errors.push(`${at}.formulas[${i}]: duplicate id ${formula.id}`); return []; }
    formulaIds.add(formula.id);
    return [formula];
  }) : (errors.push(`${at}: needs a formulas list (may be empty)`), []);
  const formulaOfTheDay = raw?.formulaOfTheDay ? checkFormula(raw.formulaOfTheDay, `${at}.formulaOfTheDay`, errors) : undefined;

  const core = checkQuestion(raw?.core, `${at}.core`, formulaIds, errors);
  const bonusRaw = raw?.bonus ?? [];
  if (!Array.isArray(bonusRaw) || bonusRaw.length > 4) errors.push(`${at}: bonus must be a list of up to 4`);
  const bonus = (Array.isArray(bonusRaw) ? bonusRaw : []).map((q: unknown, i: number) => checkQuestion(q, `${at}.bonus[${i}]`, formulaIds, errors));

  const ids = [core?.id, ...bonus.map((q) => q?.id)].filter(Boolean);
  if (new Set(ids).size !== ids.length) errors.push(`${at}: question ids must be unique`);
  if (errors.length || !core) return { day: null, errors };
  return {
    day: { date: raw.date, ...(raw.boss ? { boss: true } : {}), core, bonus: bonus as Question[], formulas, ...(formulaOfTheDay ? { formulaOfTheDay } : {}) },
    errors,
  };
}

/** Practice-only questions: { formulas, questions }, each question's formulas from that list. */
export function validatePractice(raw: any, where = 'practice'): { practice: PracticeSet | null; errors: string[] } {
  const errors: Errors = [];
  if (!Array.isArray(raw?.questions) || !raw.questions.length || raw.questions.length > 300) {
    return { practice: null, errors: [`${where}: needs a questions list (1–300)`] };
  }
  const formulaIds = new Set<string>();
  const formulas = (Array.isArray(raw.formulas) ? raw.formulas : []).flatMap((f: unknown, i: number) => {
    const formula = checkFormula(f, `${where}.formulas[${i}]`, errors);
    if (!formula) return [];
    if (formulaIds.has(formula.id)) { errors.push(`${where}.formulas[${i}]: duplicate id ${formula.id}`); return []; }
    formulaIds.add(formula.id);
    return [formula];
  });
  const ids = new Set<string>();
  const questions = raw.questions.flatMap((q: unknown, i: number) => {
    const question = checkQuestion(q, `${where}.questions[${i}]`, formulaIds, errors);
    if (!question) return [];
    if (question.id.startsWith('gen-')) { errors.push(`${where}.questions[${i}]: ids starting gen- are reserved for generated questions`); return []; }
    if (ids.has(question.id)) { errors.push(`${where}.questions[${i}]: duplicate id ${question.id}`); return []; }
    ids.add(question.id);
    return [question];
  });
  return errors.length ? { practice: null, errors } : { practice: { formulas, questions }, errors };
}

export function validatePack(raw: any): { pack: DailyPack | null; errors: string[] } {
  const hasPractice = raw?.practice !== undefined;
  if (raw?.version !== 1 || !Array.isArray(raw?.days) || (!raw.days.length && !hasPractice) || raw.days.length > 400) {
    return { pack: null, errors: ['pack must be { version: 1, days: [...] } with 1–400 days (or no days and a practice set)'] };
  }
  const errors: Errors = [];
  const days: DailyDay[] = [];
  const dates = new Set<string>();
  const questionIds = new Set<string>();
  raw.days.forEach((d: unknown, i: number) => {
    const { day, errors: dayErrors } = validateDay(d, `days[${i}]`);
    errors.push(...dayErrors);
    if (!day) return;
    if (dates.has(day.date)) errors.push(`${day.date}: appears twice in the pack`);
    dates.add(day.date);
    for (const q of [day.core, ...day.bonus]) {
      if (questionIds.has(q.id)) errors.push(`${day.date}: question id ${q.id} is used on another day`);
      questionIds.add(q.id);
    }
    days.push(day);
  });
  let practice: PracticeSet | undefined;
  if (hasPractice) {
    const checked = validatePractice(raw.practice);
    errors.push(...checked.errors);
    for (const q of checked.practice?.questions ?? []) {
      if (questionIds.has(q.id)) errors.push(`practice: question id ${q.id} is also used on a day`);
    }
    practice = checked.practice ?? undefined;
  }
  return errors.length ? { pack: null, errors } : { pack: { version: 1, days, ...(practice ? { practice } : {}) }, errors };
}

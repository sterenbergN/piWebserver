// The study room's tests and miss bank. A test is pasted in from whatever AI
// wrote it; attempts keep the answers you gave and are graded against the
// current question, so fixing a wrong answer key regrades them. Questions you
// miss come back on a widening schedule until you've shown you know them. Pure,
// so the server, the browser and the tests share it.

import { addDays, type DateKey } from '@/lib/habits/dates';

/** The PANCE blueprint's organ systems. A question names one so the coverage map can count it. */
export const PANCE_SYSTEMS = [
  'Cardiovascular', 'Dermatologic', 'EENT', 'Endocrine', 'Gastrointestinal/Nutritional', 'Genitourinary',
  'Hematologic', 'Infectious Diseases', 'Musculoskeletal', 'Neurologic', 'Psychiatric/Behavioral', 'Pulmonary',
  'Renal', 'Reproductive',
] as const;
export type PanceSystem = (typeof PANCE_SYSTEMS)[number];

export type StudyQuestion = {
  id: string;
  /** Markdown with $math$. */
  stem: string;
  choices: string[];
  /** Indexes into `choices`: more than one means "select all that apply". */
  correct: number[];
  explanation: string;
  /** Why each choice is wrong, by index ('' where there's nothing to say). */
  whyWrong?: string[];
  /** The line of her notes this came from, so a made-up "fact" is easy to catch. */
  quote?: string;
  topic: string;
  system?: PanceSystem;
};

export type StudyTest = { id: string; title: string; course: string; createdAt: string; questions: StudyQuestion[] };
export type TestsData = { tests: StudyTest[] };

export type AttemptMode = 'exam' | 'tutor';
export type Attempt = {
  id: string;
  testId: string;
  mode: AttemptMode;
  questionIds: string[];
  /** Shuffles the choices, the same way each time this attempt is opened. */
  seed: number;
  startedAt: string;
  /** Unset while it's still being taken. */
  finishedAt?: string;
  /** Your local day when you handed it in. */
  finishedOn?: DateKey;
  elapsed: number;
  answers: Record<string, number[]>;
  /** "Not sure" marks: a lucky guess still comes back for another look. */
  flagged: string[];
};

export type MissState = 'active' | 'cleared' | 'anki';
export type Miss = {
  questionId: string;
  testId: string;
  /** How far along the schedule it is: an index into REVIEW_DAYS. */
  box: number;
  dueOn: DateKey;
  firstOn: DateKey;
  lastSeen: DateKey;
  misses: number;
  rights: number;
  state: MissState;
  exportedAt?: string;
};

export type ProgressData = {
  attempts: Attempt[];
  misses: Record<string, Miss>;
  /** The days you answered reviews. */
  reviewDays: DateKey[];
};

export type StudyErrorKind = 'input' | 'missing';
export class StudyInputError extends Error {
  constructor(message: string, public kind: StudyErrorKind = 'input') { super(message); }
}

/** Days until a miss comes back: tomorrow, then wider each time you get it right. Right on the last one clears it. */
export const REVIEW_DAYS = [1, 3, 7, 14, 30];
/** A correct answer you marked "not sure" starts here instead. */
const UNSURE_BOX = 1;

const LIMITS = { questions: 300, tests: 2000, stem: 6000, choice: 1500, explanation: 8000, quote: 2000, topic: 80, title: 120, course: 80, choices: 8 };

export const emptyTests = (): TestsData => ({ tests: [] });
export const emptyProgress = (): ProgressData => ({ attempts: [], misses: {}, reviewDays: [] });

export function normalizeTests(raw: Partial<TestsData> | null | undefined): TestsData {
  return { tests: Array.isArray(raw?.tests) ? raw.tests : [] };
}

export function normalizeProgress(raw: Partial<ProgressData> | null | undefined): ProgressData {
  return {
    attempts: Array.isArray(raw?.attempts) ? raw.attempts : [],
    misses: raw?.misses && typeof raw.misses === 'object' ? raw.misses : {},
    reviewDays: Array.isArray(raw?.reviewDays) ? raw.reviewDays : [],
  };
}

const clip = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const letter = (i: number) => String.fromCharCode(65 + i);
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export const choiceLetter = letter;

// ── Reading what an AI wrote ─────────────────────────────────────────────────

/** Whatever complete `{…}` objects start in `text`: what's left of a reply that was cut off. */
function completeObjects(text: string) {
  const found: unknown[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '{') {
      if (depth++ === 0) start = i;
    } else if (c === '}' && depth > 0 && --depth === 0) {
      try { found.push(JSON.parse(text.slice(start, i + 1).replace(/,(\s*[}\]])/g, '$1'))); } catch { /* skip that one */ }
    }
  }
  return found;
}

/** The JSON in an AI's reply: code fences, chatter around it and trailing commas are all forgiven. */
function readReply(text: string): { value: unknown; cutOff: boolean } {
  const unfenced = text.replace(/```[a-z]*\s*\n?/gi, '').replace(/```/g, '');
  const start = unfenced.search(/[{[]/);
  if (start < 0) throw new StudyInputError('I couldn’t find any JSON in that. Paste the whole reply, including the part in the code block.');
  const end = Math.max(unfenced.lastIndexOf('}'), unfenced.lastIndexOf(']'));
  const body = unfenced.slice(start, end + 1);
  for (const candidate of [body, body.replace(/,(\s*[}\]])/g, '$1')]) {
    try { return { value: JSON.parse(candidate), cutOff: false }; } catch { /* try the next */ }
  }
  // Long replies get cut off part way: keep every question that made it through.
  const marker = unfenced.search(/"questions"\s*:\s*\[/);
  const objects = completeObjects(marker >= 0 ? unfenced.slice(unfenced.indexOf('[', marker)) : unfenced.slice(start)).filter(isRecord);
  if (objects.length) return { value: { questions: objects }, cutOff: true };
  throw new StudyInputError('That isn’t valid JSON, and no whole questions could be read from it. Ask the AI to send it again as one JSON code block.');
}

/** The answer key as indexes: letters ("B", "A, C", ["A","C"]) or a choice's exact text. Bare numbers are ambiguous, so they're refused. */
function readCorrect(value: unknown, choices: string[]): number[] | string {
  const items = Array.isArray(value) ? value : [value];
  const picked = new Set<number>();
  for (const item of items) {
    if (typeof item === 'number') return 'the answer is a number; it needs the choice’s letter';
    if (typeof item !== 'string' || !item.trim()) return 'it has no answer';
    const text = item.trim();
    const exact = choices.findIndex((c) => c.toLowerCase() === stripLabel(text).toLowerCase());
    if (exact >= 0) { picked.add(exact); continue; }
    const letters = text.match(/^[A-Za-z](\s*(,|and|&)\s*[A-Za-z])*$/) ? text.split(/\s*(?:,|and|&)\s*/) : /^[A-Za-z][.):]/.test(text) ? [text[0]] : null;
    if (!letters) return `its answer "${text.slice(0, 40)}" isn’t one of the choices`;
    for (const l of letters) {
      const index = l.toUpperCase().charCodeAt(0) - 65;
      if (index < 0 || index >= choices.length) return `its answer "${l}" is past the last choice`;
      picked.add(index);
    }
  }
  return picked.size ? [...picked].sort((a, b) => a - b) : 'it has no answer';
}

const stripLabel = (text: string) => text.replace(/^\(?[A-Ha-h][.):]\s+/, '').trim();

function readChoices(value: unknown): string[] {
  const list = isRecord(value) ? Object.values(value) : Array.isArray(value) ? value : [];
  return list.map((c) => clip(typeof c === 'string' ? stripLabel(c) : isRecord(c) ? stripLabel(String(c.text ?? '')) : '', LIMITS.choice)).filter(Boolean);
}

function readWhyWrong(value: unknown, count: number): string[] | undefined {
  const notes = Array.from({ length: count }, () => '');
  if (Array.isArray(value)) value.slice(0, count).forEach((v, i) => { notes[i] = clip(v, LIMITS.explanation); });
  else if (isRecord(value)) {
    for (const [key, v] of Object.entries(value)) {
      const i = key.trim().toUpperCase().charCodeAt(0) - 65;
      if (i >= 0 && i < count) notes[i] = clip(v, LIMITS.explanation);
    }
  } else return undefined;
  return notes.some(Boolean) ? notes : undefined;
}

export function readSystem(value: unknown): PanceSystem | undefined {
  const text = clip(value, LIMITS.topic).toLowerCase();
  if (!text) return undefined;
  const first = (s: string) => s.toLowerCase().split('/')[0].split(' ')[0];
  return PANCE_SYSTEMS.find((s) => s.toLowerCase() === text) ?? PANCE_SYSTEMS.find((s) => text.startsWith(first(s).slice(0, 5)));
}

export type DraftQuestion = Omit<StudyQuestion, 'id'>;
export type ParsedPack = {
  title: string;
  course: string;
  questions: DraftQuestion[];
  /** Questions that couldn't be used, and why. */
  problems: string[];
  /** Fine to keep, but worth knowing about. */
  warnings: string[];
};

/** Everything usable in an AI's reply. Only a reply with nothing usable at all is an error. */
export function parseTestReply(text: string): ParsedPack {
  if (typeof text !== 'string' || !text.trim()) throw new StudyInputError('Paste the AI’s reply first.');
  const { value, cutOff } = readReply(text);
  const root = isRecord(value) ? value : { questions: value };
  const list = Array.isArray(root.questions) ? root.questions : isRecord(value) && Array.isArray(root.items) ? root.items : [];
  if (!list.length) throw new StudyInputError('That JSON doesn’t have a "questions" list.');

  const problems: string[] = [];
  const questions: DraftQuestion[] = [];
  const stems = new Map<string, number>();
  let noExplanation = 0;
  let noQuote = 0;
  list.slice(0, LIMITS.questions).forEach((raw: unknown, i) => {
    const n = i + 1;
    if (!isRecord(raw)) { problems.push(`Question ${n}: not a question.`); return; }
    const stem = clip(raw.stem ?? raw.question ?? raw.prompt, LIMITS.stem);
    if (!stem) { problems.push(`Question ${n}: it has no question text.`); return; }
    const choices = readChoices(raw.choices ?? raw.options);
    if (choices.length < 2 || choices.length > LIMITS.choices) { problems.push(`Question ${n}: it has ${choices.length} choices (needs 2 to ${LIMITS.choices}).`); return; }
    if (new Set(choices.map((c) => c.toLowerCase())).size !== choices.length) { problems.push(`Question ${n}: two of its choices are the same.`); return; }
    const correct = readCorrect(raw.correct ?? raw.answer, choices);
    if (typeof correct === 'string') { problems.push(`Question ${n}: ${correct}.`); return; }
    const key = stem.toLowerCase().replace(/\s+/g, ' ');
    if (stems.has(key)) { problems.push(`Question ${n}: repeats question ${stems.get(key)}.`); return; }
    stems.set(key, n);
    const explanation = clip(raw.explanation ?? raw.rationale, LIMITS.explanation);
    const quote = clip(raw.quote ?? raw.source, LIMITS.quote);
    if (!explanation) noExplanation++;
    if (!quote) noQuote++;
    const whyWrong = readWhyWrong(raw.whyWrong ?? raw.why_wrong, choices.length);
    const system = readSystem(raw.system);
    questions.push({
      stem, choices, correct, explanation,
      topic: clip(raw.topic, LIMITS.topic) || 'General',
      ...(whyWrong ? { whyWrong } : {}),
      ...(quote ? { quote } : {}),
      ...(system ? { system } : {}),
    });
  });
  if (list.length > LIMITS.questions) problems.push(`Only the first ${LIMITS.questions} questions were read.`);
  if (!questions.length) throw new StudyInputError(`None of those questions could be used. ${problems.slice(0, 3).join(' ')}`);

  const warnings: string[] = [];
  if (cutOff) warnings.push('The reply looks cut off. Every whole question was kept; ask the AI to continue if you want the rest.');
  if (noQuote) warnings.push(`${noQuote} question${noQuote === 1 ? ' doesn’t' : 's don’t'} quote your notes, so check ${noQuote === 1 ? 'it' : 'them'} with extra care.`);
  if (noExplanation) warnings.push(`${noExplanation} question${noExplanation === 1 ? ' has' : 's have'} no explanation.`);
  return { title: clip(root.title, LIMITS.title), course: clip(root.course, LIMITS.course), questions, problems, warnings };
}

export function addTest(data: TestsData, pack: ParsedPack, input: { title?: unknown; course?: unknown }, makeId: () => string, now: string) {
  if (data.tests.length >= LIMITS.tests) throw new StudyInputError('That’s as many tests as one account can keep. Delete some old ones first.');
  const title = clip(input.title, LIMITS.title) || pack.title || `Test from ${now.slice(0, 10)}`;
  const course = clip(input.course, LIMITS.course) || pack.course;
  const test: StudyTest = { id: makeId(), title, course, createdAt: now, questions: pack.questions.map((q) => ({ ...q, id: makeId() })) };
  data.tests.unshift(test);
  return test;
}

// ── Grading ──────────────────────────────────────────────────────────────────

const sameSet = (a: number[], b: number[]) => a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);
export const isRight = (question: Pick<StudyQuestion, 'correct'>, answer: number[] | undefined) => !!answer?.length && sameSet(question.correct, answer);

/** A clean answer: real choices only, each once. */
export function cleanAnswer(question: Pick<StudyQuestion, 'choices'>, value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((v): v is number => Number.isInteger(v) && v >= 0 && v < question.choices.length))].sort((a, b) => a - b);
}

export type QuestionResult = { question: StudyQuestion; answer: number[]; right: boolean; flagged: boolean };
export type AttemptScore = { right: number; total: number; unanswered: number; results: QuestionResult[]; byTopic: { topic: string; right: number; total: number }[] };

/** An attempt graded against the test as it stands now. Removed questions drop out. */
export function scoreAttempt(attempt: Attempt, test: StudyTest): AttemptScore {
  const byId = new Map(test.questions.map((q) => [q.id, q]));
  const results = attempt.questionIds.flatMap((id) => {
    const question = byId.get(id);
    if (!question) return [];
    const answer = attempt.answers[id] ?? [];
    return [{ question, answer, right: isRight(question, answer), flagged: attempt.flagged.includes(id) }];
  });
  const topics = new Map<string, { topic: string; right: number; total: number }>();
  for (const r of results) {
    const t = topics.get(r.question.topic) ?? { topic: r.question.topic, right: 0, total: 0 };
    t.total++;
    if (r.right) t.right++;
    topics.set(r.question.topic, t);
  }
  return {
    right: results.filter((r) => r.right).length,
    total: results.length,
    unanswered: results.filter((r) => !r.answer.length).length,
    results,
    byTopic: [...topics.values()].sort((a, b) => a.right / a.total - b.right / b.total),
  };
}

// ── Shuffling ────────────────────────────────────────────────────────────────

function hash(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Choices that only make sense where they were written. */
const KEEP_IN_PLACE = /\b(all|none|both|neither)\s+of\s+(the\s+)?(above|these)\b|\b[a-h]\s+(and|or)\s+[a-h]\b|\bboth\b/i;

/** The order to show a question's choices in, as original indexes: AIs lean on certain letters, so shuffle them. */
export function choiceOrder(question: Pick<StudyQuestion, 'id' | 'choices'>, seed: number) {
  const order = question.choices.map((_, i) => i);
  if (question.choices.some((c) => KEEP_IN_PLACE.test(c))) return order;
  let state = hash(`${question.id}:${seed}`);
  for (let i = order.length - 1; i > 0; i--) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const j = state % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

// ── Attempts ─────────────────────────────────────────────────────────────────

export function startAttempt(progress: ProgressData, test: StudyTest, input: { mode?: unknown; questionIds?: unknown; fresh?: unknown }, makeId: () => string, seed: number, now: string) {
  if (input.fresh !== true) {
    const open = progress.attempts.find((a) => a.testId === test.id && !a.finishedAt);
    if (open) return open;
  } else {
    progress.attempts = progress.attempts.filter((a) => a.testId !== test.id || a.finishedAt);
  }
  const known = new Set(test.questions.map((q) => q.id));
  const chosen = Array.isArray(input.questionIds) ? input.questionIds.filter((id): id is string => known.has(id as string)) : [];
  const attempt: Attempt = {
    id: makeId(),
    testId: test.id,
    mode: input.mode === 'tutor' ? 'tutor' : 'exam',
    questionIds: chosen.length ? [...new Set(chosen)] : test.questions.map((q) => q.id),
    seed,
    startedAt: now,
    elapsed: 0,
    answers: {},
    flagged: [],
  };
  progress.attempts.push(attempt);
  return attempt;
}

/** Keep where you are in a test: answers, marks and time. */
export function saveAttempt(attempt: Attempt, test: StudyTest, input: { answers?: unknown; flagged?: unknown; elapsed?: unknown }) {
  if (attempt.finishedAt) throw new StudyInputError('That test is already finished.');
  if (isRecord(input.answers)) {
    const byId = new Map(test.questions.map((q) => [q.id, q]));
    const answers: Record<string, number[]> = {};
    for (const id of attempt.questionIds) {
      const question = byId.get(id);
      const answer = question ? cleanAnswer(question, input.answers[id]) : [];
      if (answer.length) answers[id] = answer;
    }
    attempt.answers = answers;
  }
  if (Array.isArray(input.flagged)) attempt.flagged = attempt.questionIds.filter((id) => (input.flagged as unknown[]).includes(id));
  const elapsed = Number(input.elapsed);
  if (Number.isFinite(elapsed) && elapsed >= 0) attempt.elapsed = Math.min(Math.round(elapsed), 7 * 24 * 3600);
}

function recordMiss(progress: ProgressData, testId: string, questionId: string, today: DateKey, box = 0) {
  const existing = progress.misses[questionId];
  if (existing) {
    // It's slipped again, wherever it had got to: back to the start, and Anki doesn't get to keep it quiet.
    existing.box = 0;
    existing.dueOn = addDays(today, REVIEW_DAYS[0]);
    existing.lastSeen = today;
    existing.misses++;
    existing.state = 'active';
    return;
  }
  progress.misses[questionId] = { questionId, testId, box, dueOn: addDays(today, REVIEW_DAYS[box]), firstOn: today, lastSeen: today, misses: box === 0 ? 1 : 0, rights: 0, state: 'active' };
}

function moveAlong(miss: Miss, today: DateKey) {
  miss.rights++;
  miss.lastSeen = today;
  miss.box++;
  if (miss.box >= REVIEW_DAYS.length) {
    miss.box = REVIEW_DAYS.length - 1;
    miss.state = 'cleared';
    return;
  }
  miss.dueOn = addDays(today, REVIEW_DAYS[miss.box]);
}

/** Hand in a test: wrong and blank answers go in the miss bank, and so do right answers marked "not sure". */
export function finishAttempt(progress: ProgressData, attempt: Attempt, test: StudyTest, today: DateKey, now: string) {
  if (attempt.finishedAt) return scoreAttempt(attempt, test);
  attempt.finishedAt = now;
  attempt.finishedOn = today;
  const score = scoreAttempt(attempt, test);
  for (const { question, right, flagged } of score.results) {
    const existing = progress.misses[question.id];
    if (!right) recordMiss(progress, test.id, question.id, today);
    else if (existing?.state === 'active' && existing.dueOn <= today) {
      moveAlong(existing, today);
      noteReviewDay(progress, today);
    } else if (flagged && !existing) recordMiss(progress, test.id, question.id, today, UNSURE_BOX);
  }
  return score;
}

const noteReviewDay = (progress: ProgressData, today: DateKey) => {
  if (!progress.reviewDays.includes(today)) progress.reviewDays.push(today);
};

/** The days you handed in a test or answered reviews: what a linked habit ticks itself off from. */
export function studyDays(progress: ProgressData) {
  const finished = progress.attempts.flatMap((a) => (a.finishedOn ? [a.finishedOn] : []));
  return [...new Set([...progress.reviewDays, ...finished])];
}

// ── The miss bank ────────────────────────────────────────────────────────────

/** What's due today, longest-waiting first, then whatever's been missed most. */
export function dueMisses(progress: ProgressData, today: DateKey) {
  return Object.values(progress.misses)
    .filter((m) => m.state === 'active' && m.dueOn <= today)
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn) || b.misses - a.misses || a.questionId.localeCompare(b.questionId));
}

/** Answer one review. A second answer on the same day (another tab, a double tap) doesn't count twice. */
export function answerReview(progress: ProgressData, question: StudyQuestion, answer: number[], today: DateKey) {
  const miss = progress.misses[question.id];
  if (!miss || miss.state !== 'active') throw new StudyInputError('That question isn’t waiting for review.', 'missing');
  const right = isRight(question, answer);
  if (miss.dueOn > today) return { right, miss, counted: false };
  if (right) moveAlong(miss, today);
  else recordMiss(progress, miss.testId, question.id, today);
  noteReviewDay(progress, today);
  return { right, miss, counted: true };
}

// ── Mending a question the AI got wrong ──────────────────────────────────────

/** The answer you gave the last time you finished this question, if you ever have. */
function lastAnswer(progress: ProgressData, questionId: string) {
  const done = progress.attempts.filter((a) => a.finishedAt && a.questionIds.includes(questionId));
  done.sort((a, b) => String(b.finishedAt).localeCompare(String(a.finishedAt)));
  return done.length ? done[0].answers[questionId] ?? [] : null;
}

/** Fix a question's key. Past attempts regrade on their own; this brings the miss bank into line with them. */
export function fixQuestion(test: StudyTest, progress: ProgressData, questionId: string, input: { correct?: unknown; explanation?: unknown }, today: DateKey) {
  const question = test.questions.find((q) => q.id === questionId);
  if (!question) throw new StudyInputError('That question isn’t in this test any more.', 'missing');
  const correct = cleanAnswer(question, input.correct);
  if (!correct.length) throw new StudyInputError('Pick at least one correct answer.');
  question.correct = correct;
  if (typeof input.explanation === 'string') question.explanation = clip(input.explanation, LIMITS.explanation);
  const last = lastAnswer(progress, questionId);
  if (last === null) return question;
  if (isRight(question, last)) delete progress.misses[questionId];
  else if (!progress.misses[questionId]) recordMiss(progress, test.id, questionId, today);
  return question;
}

export function removeQuestion(test: StudyTest, progress: ProgressData, questionId: string) {
  test.questions = test.questions.filter((q) => q.id !== questionId);
  delete progress.misses[questionId];
  for (const attempt of progress.attempts) {
    if (attempt.finishedAt) continue;
    attempt.questionIds = attempt.questionIds.filter((id) => id !== questionId);
    delete attempt.answers[questionId];
    attempt.flagged = attempt.flagged.filter((id) => id !== questionId);
  }
}

export function removeTest(tests: TestsData, progress: ProgressData, testId: string) {
  tests.tests = tests.tests.filter((t) => t.id !== testId);
  progress.attempts = progress.attempts.filter((a) => a.testId !== testId);
  for (const [id, miss] of Object.entries(progress.misses)) if (miss.testId === testId) delete progress.misses[id];
}

export function renameTest(test: StudyTest, input: { title?: unknown; course?: unknown }) {
  const title = clip(input.title, LIMITS.title);
  if (typeof input.title === 'string' && !title) throw new StudyInputError('Give the test a name.');
  if (title) test.title = title;
  if (typeof input.course === 'string') test.course = clip(input.course, LIMITS.course);
}

// ── The overview ─────────────────────────────────────────────────────────────

export type TestSummary = {
  id: string;
  title: string;
  course: string;
  createdAt: string;
  count: number;
  taken: number;
  last: { right: number; total: number; on: string } | null;
  best: { right: number; total: number } | null;
  /** How far an unfinished attempt has got. */
  open: { answered: number; total: number } | null;
};

export type TopicStat = { topic: string; system?: PanceSystem; right: number; total: number };

export type StudySummary = {
  tests: TestSummary[];
  courses: string[];
  review: { due: number; active: number; cleared: number; anki: number; forAnki: number; doneToday: boolean; nextOn: DateKey | null };
  /** Topics with enough answers to judge, weakest first. */
  weakTopics: TopicStat[];
  totals: { tests: number; questions: number; taken: number; answered: number; right: number };
};

const percent = (s: { right: number; total: number }) => (s.total ? s.right / s.total : 0);
/** Too few answers says nothing about a topic. */
const MIN_FOR_WEAK = 3;

export function studySummary(tests: TestsData, progress: ProgressData, today: DateKey): StudySummary {
  const byTest = new Map<string, Attempt[]>();
  for (const attempt of progress.attempts) byTest.set(attempt.testId, [...(byTest.get(attempt.testId) ?? []), attempt]);

  const topics = new Map<string, TopicStat>();
  let answered = 0;
  let right = 0;
  let taken = 0;
  const summaries = tests.tests.map((test): TestSummary => {
    const attempts = byTest.get(test.id) ?? [];
    const open = attempts.find((a) => !a.finishedAt);
    const finished = attempts.filter((a) => a.finishedAt).sort((a, b) => String(a.finishedAt).localeCompare(String(b.finishedAt)));
    taken += finished.length;
    const scores = finished.map((attempt) => {
      const score = scoreAttempt(attempt, test);
      for (const r of score.results) {
        const t = topics.get(r.question.topic) ?? { topic: r.question.topic, ...(r.question.system ? { system: r.question.system } : {}), right: 0, total: 0 };
        t.total++;
        if (r.right) t.right++;
        topics.set(r.question.topic, t);
        answered++;
        if (r.right) right++;
      }
      return { right: score.right, total: score.total, on: String(attempt.finishedAt) };
    });
    const whole = scores.filter((s) => s.total === test.questions.length);
    const best = (whole.length ? whole : scores).reduce<{ right: number; total: number } | null>((top, s) => (!top || percent(s) > percent(top) ? { right: s.right, total: s.total } : top), null);
    return {
      id: test.id,
      title: test.title,
      course: test.course,
      createdAt: test.createdAt,
      count: test.questions.length,
      taken: finished.length,
      last: scores.length ? scores[scores.length - 1] : null,
      best,
      open: open ? { answered: Object.keys(open.answers).length, total: open.questionIds.length } : null,
    };
  });

  const misses = Object.values(progress.misses);
  const active = misses.filter((m) => m.state === 'active');
  const due = dueMisses(progress, today).length;
  const upcoming = active.filter((m) => m.dueOn > today).map((m) => m.dueOn).sort();
  return {
    tests: summaries,
    courses: [...new Set(tests.tests.map((t) => t.course).filter(Boolean))].sort(),
    review: {
      due,
      active: active.length,
      cleared: misses.filter((m) => m.state === 'cleared').length,
      anki: misses.filter((m) => m.state === 'anki').length,
      forAnki: active.filter((m) => !m.exportedAt).length,
      doneToday: due === 0 && progress.reviewDays.includes(today),
      nextOn: upcoming[0] ?? null,
    },
    weakTopics: [...topics.values()].filter((t) => t.total >= MIN_FOR_WEAK && t.right < t.total).sort((a, b) => percent(a) - percent(b) || b.total - a.total),
    totals: { tests: tests.tests.length, questions: tests.tests.reduce((n, t) => n + t.questions.length, 0), taken, answered, right },
  };
}

/**
 * What PA Today asks of her: reviews due and tests left part way. Clear when
 * neither is waiting, which is the "you can stop here." A test she hasn't taken
 * is only ever a suggestion, so it never stands in the way of being clear.
 */
export function todaySteps(summary: Pick<StudySummary, 'tests' | 'review'>) {
  const open = summary.tests.filter((t) => t.open);
  return {
    review: summary.review.due,
    open,
    next: summary.tests.find((t) => !t.open && t.taken === 0) ?? null,
    clear: summary.review.due === 0 && open.length === 0,
  };
}

/** The question behind each miss, for the review page and the Anki file. A miss whose question has gone is left out. */
export function withQuestions(tests: TestsData, misses: Miss[]) {
  const tests_ = new Map(tests.tests.map((t) => [t.id, t]));
  return misses.flatMap((miss) => {
    const test = tests_.get(miss.testId);
    const question = test?.questions.find((q) => q.id === miss.questionId);
    return test && question ? [{ miss, question, testTitle: test.title, course: test.course }] : [];
  });
}

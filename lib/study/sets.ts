// Test sets: several tests on one subject, kept together and each aware of the
// last. A set remembers how its prompt was made, and its brief is what the next
// prompt tells the AI: what's already been asked, and how she did on it. Pure, so
// the server, the browser and the tests share it.

import {
  isRight, MAX_DIFFICULTY, scoreAttempt, StudyInputError, type ParsedPack, type PromptStyle, type ProgressData, type StudySet, type StudyTest, type TestsData, type TestSummary,
} from './study';

const clip = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const STYLES: PromptStyle[] = ['vignette', 'recall', 'mixed'];
const MAX_SETS = 300;

export const readDifficulty = (value: unknown, fallback = 3) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n >= 1 && n <= MAX_DIFFICULTY ? n : fallback;
};

function setFields(input: Record<string, unknown>, base?: StudySet) {
  const count = Math.round(Number(input.count));
  return {
    course: typeof input.course === 'string' ? clip(input.course, 80) : base?.course ?? '',
    focus: typeof input.focus === 'string' ? clip(input.focus, 200) : base?.focus ?? '',
    style: STYLES.includes(input.style as PromptStyle) ? (input.style as PromptStyle) : base?.style ?? 'vignette',
    count: Number.isFinite(count) && count >= 1 && count <= 200 ? count : base?.count ?? 25,
    difficulty: readDifficulty(input.difficulty, base?.difficulty ?? 3),
  };
}

export function createSet(data: TestsData, input: Record<string, unknown>, makeId: () => string, now: string): StudySet {
  const title = clip(input.title, 120);
  if (!title) throw new StudyInputError('Give the set a name, like the subject it covers.');
  if (data.sets.length >= MAX_SETS) throw new StudyInputError('That’s as many sets as one account can keep.');
  const same = data.sets.find((s) => s.title.toLowerCase() === title.toLowerCase());
  if (same) return same;
  const set: StudySet = { id: makeId(), title, createdAt: now, ...setFields(input) };
  data.sets.unshift(set);
  return set;
}

export function editSet(data: TestsData, id: unknown, input: Record<string, unknown>) {
  const set = data.sets.find((s) => s.id === id);
  if (!set) throw new StudyInputError('That set isn’t here any more.', 'missing');
  if (typeof input.title === 'string') {
    const title = clip(input.title, 120);
    if (!title) throw new StudyInputError('Give the set a name.');
    set.title = title;
  }
  Object.assign(set, setFields(input, set));
  return set;
}

/** The set goes, and its tests stay, just not grouped any more. */
export function removeSet(data: TestsData, id: unknown) {
  data.sets = data.sets.filter((s) => s.id !== id);
  for (const test of data.tests) if (test.setId === id) delete test.setId;
}

export function moveTest(data: TestsData, testId: unknown, setId: unknown) {
  const test = data.tests.find((t) => t.id === testId);
  if (!test) throw new StudyInputError('That test isn’t here any more.', 'missing');
  if (!setId) {
    delete test.setId;
    return test;
  }
  if (!data.sets.some((s) => s.id === setId)) throw new StudyInputError('That set isn’t here any more.', 'missing');
  test.setId = setId as string;
  return test;
}

/** A set's tests, oldest first, so they read as Test 1, Test 2 and on. */
export const testsInSet = (data: TestsData, setId: string) =>
  data.tests.filter((t) => t.setId === setId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));

export const nextTestTitle = (data: TestsData, setId: string) => `Test ${testsInSet(data, setId).length + 1}`;

// ── Not repeating ────────────────────────────────────────────────────────────

const STOP_WORDS = new Set(['a', 'an', 'the', 'of', 'in', 'on', 'is', 'are', 'was', 'with', 'and', 'or', 'to', 'for', 'what', 'which', 'most', 'likely', 'patient', 'year', 'old']);
const wordsOf = (stem: string) => new Set(stem.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && !STOP_WORDS.has(w) && !/^\d+$/.test(w)));

/** The same question reworded shares nearly all its words. Numbers are ignored, so a new age doesn't make it new. */
const NEAR_REPEAT = 0.85;
/** Too few words to judge: a short stem only counts when it's identical. */
const MIN_WORDS = 6;

export function isRepeat(stem: string, earlier: string) {
  const a = wordsOf(stem);
  const b = wordsOf(earlier);
  if (stem.trim().toLowerCase() === earlier.trim().toLowerCase()) return true;
  if (a.size < MIN_WORDS || b.size < MIN_WORDS) return false;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared++;
  return shared / (a.size + b.size - shared) >= NEAR_REPEAT;
}

/** Take out anything the set has already asked. Her list of what was dropped goes in the pack's problems. */
export function dropRepeats(pack: ParsedPack, earlierStems: string[]): ParsedPack {
  const problems = [...pack.problems];
  const questions = pack.questions.filter((q) => {
    const repeat = earlierStems.some((stem) => isRepeat(q.stem, stem));
    if (repeat) problems.push(`“${q.stem.slice(0, 70)}${q.stem.length > 70 ? '…' : ''}” repeats a question already in this set.`);
    return !repeat;
  });
  if (!questions.length) throw new StudyInputError('Every question in that reply repeats one already in this set. Ask the AI for new ones.');
  return { ...pack, questions, problems };
}

// ── What the next prompt says ────────────────────────────────────────────────

/** Her latest answer to each question, from tests or games, whichever came last. */
function latestAnswers(tests: StudyTest[], progress: ProgressData) {
  const inSet = new Set(tests.map((t) => t.id));
  const attempts = progress.attempts.filter((a) => a.finishedAt && inSet.has(a.testId)).sort((a, b) => String(a.finishedAt).localeCompare(String(b.finishedAt)));
  const latest = new Map<string, { answer: number[]; at: string; flagged: boolean }>();
  for (const attempt of attempts) {
    for (const id of attempt.questionIds) latest.set(id, { answer: attempt.answers[id] ?? [], at: String(attempt.finishedAt), flagged: attempt.flagged.includes(id) });
  }
  for (const [id, game] of Object.entries(progress.gameAnswers)) {
    if (!inSet.has(game.testId)) continue;
    const seen = latest.get(id);
    if (!seen || seen.at <= game.at) latest.set(id, { answer: game.answer, at: game.at, flagged: false });
  }
  return latest;
}

export type TopicResult = { topic: string; right: number; total: number };
export type SetBrief = {
  set: StudySet;
  testCount: number;
  /** Every question so far, in full, for catching repeats in a reply. */
  stems: string[];
  /** Enough of each question for the AI to steer clear of it. */
  asked: { topic: string; stem: string; answer: string }[];
  /** Earlier questions left out to keep the prompt a sensible length. */
  askedLeftOut: number;
  scores: { title: string; right: number; total: number; difficulty?: number }[];
  weak: TopicResult[];
  strong: TopicResult[];
  missed: { topic: string; stem: string; yours: string; answer: string }[];
  unsure: { topic: string; stem: string }[];
  answered: number;
};

const MAX_ASKED = 120;
const MAX_MISSED = 15;
const MAX_UNSURE = 8;
const short = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

export function setBrief(data: TestsData, progress: ProgressData, setId: string): SetBrief | null {
  const set = data.sets.find((s) => s.id === setId);
  if (!set) return null;
  const tests = testsInSet(data, setId);
  const latest = latestAnswers(tests, progress);
  const questions = tests.flatMap((test) => test.questions);

  const topics = new Map<string, TopicResult>();
  const missed: SetBrief['missed'] = [];
  const unsure: SetBrief['unsure'] = [];
  let answered = 0;
  for (const q of questions) {
    const seen = latest.get(q.id);
    if (!seen) continue;
    answered++;
    const t = topics.get(q.topic) ?? { topic: q.topic, right: 0, total: 0 };
    t.total++;
    const right = isRight(q, seen.answer);
    if (right) t.right++;
    topics.set(q.topic, t);
    const stem = short(oneLine(q.stem), 160);
    if (!right) {
      missed.push({
        topic: q.topic,
        stem,
        yours: seen.answer.length ? seen.answer.map((i) => q.choices[i]).filter(Boolean).join(', ') : '(left blank)',
        answer: q.correct.map((i) => q.choices[i]).join(', '),
      });
    } else if (seen.flagged) unsure.push({ topic: q.topic, stem });
  }
  const all = [...topics.values()];
  const share = (t: TopicResult) => t.right / t.total;

  const scores = tests.flatMap((test) => {
    const done = progress.attempts.filter((a) => a.testId === test.id && a.finishedAt).sort((a, b) => String(a.finishedAt).localeCompare(String(b.finishedAt)));
    if (!done.length) return [];
    const score = scoreAttempt(done[done.length - 1], test);
    return [{ title: test.title, right: score.right, total: score.total, ...(test.difficulty ? { difficulty: test.difficulty } : {}) }];
  });

  const asked = questions.map((q) => ({
    topic: q.topic,
    stem: short(oneLine(q.stem), 110),
    answer: short(oneLine(q.correct.map((i) => q.choices[i]).join(', ')), 50),
  }));
  return {
    set,
    testCount: tests.length,
    stems: questions.map((q) => q.stem),
    // The newest matter most if a long set has to be cut short.
    asked: asked.slice(-MAX_ASKED),
    askedLeftOut: Math.max(0, asked.length - MAX_ASKED),
    scores,
    weak: all.filter((t) => t.total >= 2 && share(t) < 0.7).sort((a, b) => share(a) - share(b) || b.total - a.total),
    strong: all.filter((t) => t.total >= 3 && share(t) >= 0.9).sort((a, b) => b.total - a.total),
    missed: missed.slice(-MAX_MISSED),
    unsure: unsure.slice(-MAX_UNSURE),
    answered,
  };
}

/** A nudge from her last score, which she's free to ignore. Null means leave it where it is. */
export function suggestDifficulty(brief: SetBrief, current: number) {
  const last = brief.scores[brief.scores.length - 1];
  if (!last?.total) return null;
  const share = last.right / last.total;
  if (share >= 0.85 && current < MAX_DIFFICULTY) return { level: current + 1, why: `You got ${Math.round(share * 100)}% on ${last.title}, so a harder one might be worth it.` };
  if (share < 0.5 && current > 1) return { level: current - 1, why: `You got ${Math.round(share * 100)}% on ${last.title}, so an easier one might help the basics stick.` };
  return null;
}

export type SetSummary = StudySet & {
  tests: number;
  taken: number;
  questions: number;
  /** Across the latest try at each test taken. */
  score: { right: number; total: number } | null;
  /** Each test's latest score, oldest first. */
  trend: number[];
  lastOn: string;
};

export function setSummaries(data: TestsData, summaries: TestSummary[]): SetSummary[] {
  return data.sets.map((set) => {
    const rows = summaries.filter((t) => t.setId === set.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const taken = rows.filter((t) => t.last);
    const right = taken.reduce((n, t) => n + (t.last?.right ?? 0), 0);
    const total = taken.reduce((n, t) => n + (t.last?.total ?? 0), 0);
    return {
      ...set,
      tests: rows.length,
      taken: taken.length,
      questions: rows.reduce((n, t) => n + t.count, 0),
      score: total ? { right, total } : null,
      trend: taken.map((t) => Math.round(((t.last?.right ?? 0) / Math.max(1, t.last?.total ?? 1)) * 100)),
      lastOn: rows[rows.length - 1]?.createdAt ?? set.createdAt,
    };
  }).sort((a, b) => b.lastOn.localeCompare(a.lastOn));
}

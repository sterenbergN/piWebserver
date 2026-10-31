import test from 'node:test';
import { strict as assert } from 'node:assert';
import { triviaDeck, gamePool, recordGameAnswer } from './games';
import { mathToPlain, repairMathEscapes, repairStoredMath, splitMath } from './math';
import { buildTestPrompt, DIFFICULTIES } from './prompt';
import { createSet, dropRepeats, editSet, isRepeat, moveTest, nextTestTitle, readDifficulty, removeSet, setBrief, setSummaries, suggestDifficulty, testsInSet } from './sets';
import {
  addTest, emptyProgress, emptyTests, finishAttempt, normalizeTests, parseTestReply, saveAttempt, startAttempt, studySummary, type ProgressData, type StudyTest,
} from './study';

const NOW = '2026-11-02T15:00:00.000Z';
const TODAY = '2026-11-02';
let counter = 0;
const makeId = () => `s${++counter}`;

const q = (stem: string, topic: string, over: Record<string, unknown> = {}) => ({ stem, choices: ['Right one', 'Wrong one', 'Other one'], correct: 'A', explanation: 'Why.', topic, ...over });
const pack = (...questions: unknown[]) => parseTestReply(JSON.stringify({ title: 'From the AI', questions }));

function setWithTests() {
  const data = emptyTests();
  const set = createSet(data, { title: 'Heart failure', course: 'Clin Med', focus: 'HFrEF', style: 'mixed', count: 10, difficulty: 2 }, makeId, NOW);
  const first = addTest(data, pack(
    q('A 60-year-old has orthopnea and an S3 gallop on exam. What is the most likely diagnosis today?', 'Diagnosis'),
    q('Which drug class reduces mortality in reduced ejection fraction heart failure patients?', 'Treatment'),
    q('Which finding best separates systolic from diastolic heart failure on imaging studies?', 'Diagnosis'),
  ), { setId: set.id, difficulty: 2 }, makeId, NOW);
  const second = addTest(data, pack(
    q('What is the first-line diuretic for acute decompensated heart failure with volume overload?', 'Treatment'),
    q('Which electrolyte should be watched most closely when starting spironolactone therapy here?', 'Monitoring'),
  ), { setId: set.id, difficulty: 3 }, makeId, '2026-11-03T15:00:00.000Z');
  return { data, set, first, second };
}

function take(progress: ProgressData, t: StudyTest, answers: number[], flagged: number[] = [], at = NOW) {
  const attempt = startAttempt(progress, t, { fresh: true }, makeId, 1, NOW);
  saveAttempt(attempt, t, {
    answers: Object.fromEntries(t.questions.map((question, i) => [question.id, answers[i] === -1 ? [] : [answers[i]]])),
    flagged: flagged.map((i) => t.questions[i].id),
  });
  finishAttempt(progress, attempt, t, TODAY, at);
}

// ── Math ─────────────────────────────────────────────────────────────────────

test('LaTeX survives an AI forgetting to double its backslashes', () => {
  const raw = String.raw`{"a": "$\frac{1}{2}$", "b": "$\times$ and $\alpha$ and $\text{x}$", "c": "line one\nline two\ttabbed", "d": "\"quoted\" \\frac{a}{b}", "e": "é \uparrow"}`;
  const parsed = JSON.parse(repairMathEscapes(raw));
  assert.equal(parsed.a, String.raw`$\frac{1}{2}$`);
  assert.equal(parsed.b, String.raw`$\times$ and $\alpha$ and $\text{x}$`);
  assert.equal(parsed.c, 'line one\nline two\ttabbed', 'real escapes are left alone');
  assert.equal(parsed.d, String.raw`"quoted" \frac{a}{b}`, 'already doubled stays right');
  assert.equal(parsed.e, String.raw`é \uparrow`);
});

test('a whole reply with single backslashes reads properly', () => {
  const reply = String.raw`{"questions":[{"stem":"What is $P_{O_2}$ at $\frac{1}{2}$ atm?","choices":["$P_{O_2}=40$ mmHg","$\beta$ blockade","$100 \times 2$"],"correct":"A","topic":"Gas"}]}`;
  const [question] = parseTestReply(reply).questions;
  assert.equal(question.stem, String.raw`What is $P_{O_2}$ at $\frac{1}{2}$ atm?`);
  assert.deepEqual(question.choices, ['$P_{O_2}=40$ mmHg', String.raw`$\beta$ blockade`, String.raw`$100 \times 2$`]);
});

test('tests saved before the repair get mended when they’re read', () => {
  assert.equal(repairStoredMath('$\frac{1}{2}$ and $\beta$'), String.raw`$\frac{1}{2}$ and $\beta$`);
  assert.equal(repairStoredMath('$5 \times 2$'), String.raw`$5 \times 2$`);
  assert.equal(repairStoredMath('First line\nSecond line\ttabbed'), 'First line\nSecond line\ttabbed', 'real text stays');
  const data = normalizeTests({ tests: [{ id: 't', title: 'T', course: '', createdAt: NOW, questions: [{ id: 'q', stem: '$\frac{1}{2}$', choices: ['$\beta$', 'b'], correct: [0], explanation: '$\times$', whyWrong: ['', '$\rho$'], quote: 'x', topic: 'T' }] }] });
  const [saved] = data.tests[0].questions;
  assert.equal(saved.stem, String.raw`$\frac{1}{2}$`);
  assert.equal(saved.choices[0], String.raw`$\beta$`);
  assert.equal(saved.explanation, String.raw`$\times$`);
  assert.equal(saved.whyWrong?.[1], String.raw`$\rho$`);
  assert.deepEqual(data.sets, [], 'older files have no sets yet');
});

test('text splits into words and math', () => {
  assert.deepEqual(splitMath('$P_{O_2}=40$ mmHg'), [{ math: true, text: 'P_{O_2}=40' }, { math: false, text: ' mmHg' }]);
  assert.deepEqual(splitMath('Plain text'), [{ math: false, text: 'Plain text' }]);
  assert.deepEqual(splitMath(String.raw`\(x^2\) and \[y\]`), [{ math: true, text: 'x^2' }, { math: false, text: ' and ' }, { math: true, text: 'y', display: true }]);
  assert.deepEqual(splitMath('$$a+b$$'), [{ math: true, text: 'a+b', display: true }]);
});

test('money isn’t math, but a forgotten closing dollar on real math still is', () => {
  assert.deepEqual(splitMath('It costs $5 and $10 today'), [{ math: false, text: 'It costs $5 and $10 today' }]);
  assert.deepEqual(splitMath('A $ sign'), [{ math: false, text: 'A $ sign' }]);
  assert.deepEqual(splitMath('Save $20 now'), [{ math: false, text: 'Save $20 now' }]);
  assert.deepEqual(splitMath('$P_{O_2}=40 mmHg'), [{ math: true, text: 'P_{O_2}=40 mmHg' }]);
});

test('math flattens to readable text where it can’t be typeset', () => {
  assert.equal(mathToPlain('$P_{O_2}=40$ mmHg'), 'PO₂=40 mmHg');
  assert.equal(mathToPlain(String.raw`$\frac{a}{b}$`), 'a/b');
  assert.equal(mathToPlain(String.raw`$\beta_1$ and $CO_2$ at $10^{3}$`), 'β₁ and CO₂ at 10³');
  assert.equal(mathToPlain(String.raw`$\text{Na}^{+}$ $\leq$ 135`), 'Na⁺ ≤ 135');
  assert.equal(mathToPlain('No math here, $5'), 'No math here, $5');
});

test('Trivia Death shows readable math on the TV', () => {
  const data = emptyTests();
  addTest(data, pack(q('What is $P_{O_2}$?', 'Gas', { choices: ['$P_{O_2}=40$', 'b', 'c'], explanation: 'It’s $CO_2$.' })), {}, makeId, NOW);
  const [card] = triviaDeck(gamePool(data, emptyProgress(), {}, TODAY));
  assert.equal(card.question, 'What is PO₂?');
  assert.ok(card.choices.includes('PO₂=40'));
  assert.equal(card.explanation, 'It’s CO₂.');
});

// ── Sets ─────────────────────────────────────────────────────────────────────

test('a set remembers its prompt, and the same name finds the same set', () => {
  const data = emptyTests();
  const set = createSet(data, { title: ' Heart failure ', course: 'Clin Med', focus: 'HFrEF', style: 'recall', count: 40, difficulty: 4 }, makeId, NOW);
  assert.deepEqual([set.title, set.course, set.focus, set.style, set.count, set.difficulty], ['Heart failure', 'Clin Med', 'HFrEF', 'recall', 40, 4]);
  assert.equal(createSet(data, { title: 'heart FAILURE' }, makeId, NOW), set);
  assert.equal(data.sets.length, 1);
  assert.throws(() => createSet(data, { title: '  ' }, makeId, NOW), /name/);
  editSet(data, set.id, { title: 'HF', difficulty: 9, style: 'nonsense' });
  assert.deepEqual([set.title, set.difficulty, set.style, set.count], ['HF', 4, 'recall', 40], 'bad values keep what was there');
  assert.throws(() => editSet(data, 'gone', {}), /isn’t here/);
  assert.deepEqual([readDifficulty(1), readDifficulty(5), readDifficulty(0), readDifficulty('x', 2)], [1, 5, 3, 2]);
});

test('tests number themselves within a set, and keep their difficulty', () => {
  const { data, set, first, second } = setWithTests();
  assert.equal(nextTestTitle(data, set.id), 'Test 3');
  assert.deepEqual(testsInSet(data, set.id).map((t) => t.id), [first.id, second.id], 'oldest first');
  assert.equal(first.title, 'Test 1');
  assert.equal(second.title, 'Test 2');
  assert.deepEqual([first.setId, first.difficulty, second.difficulty], [set.id, 2, 3]);
  const named = addTest(data, pack(q('A named question about something else entirely in medicine?', 'T')), { setId: set.id, title: 'My name' }, makeId, NOW);
  assert.equal(named.title, 'My name');
  const loose = addTest(data, pack(q('A loose question?', 'T')), {}, makeId, NOW);
  assert.equal(loose.title, 'From the AI', 'outside a set, the AI’s name is fine');
  assert.equal(loose.setId, undefined);
});

test('tests can move in and out, and removing a set keeps its tests', () => {
  const { data, set, first } = setWithTests();
  const other = createSet(data, { title: 'Other' }, makeId, NOW);
  moveTest(data, first.id, other.id);
  assert.equal(first.setId, other.id);
  moveTest(data, first.id, '');
  assert.equal(first.setId, undefined);
  assert.throws(() => moveTest(data, first.id, 'gone'), /set isn’t here/);
  assert.throws(() => moveTest(data, 'gone', set.id), /test isn’t here/);
  moveTest(data, first.id, set.id);
  removeSet(data, set.id);
  assert.equal(data.tests.length, 2);
  assert.ok(data.tests.every((t) => !t.setId));
  assert.ok(!data.sets.some((s) => s.id === set.id));
});

test('repeats are caught, reworded or not, and new angles aren’t', () => {
  const earlier = 'A 60-year-old has orthopnea and an S3 gallop on exam. What is the most likely diagnosis today?';
  assert.ok(isRepeat(earlier, earlier));
  assert.ok(isRepeat('A 45-year-old has orthopnea and an S3 gallop on exam. What is the most likely diagnosis today?', earlier), 'a new age isn’t a new question');
  assert.ok(isRepeat('  a 60-year-old has orthopnea and an s3 gallop on exam. what is the most likely diagnosis today? ', earlier));
  assert.ok(!isRepeat('A 60-year-old on lisinopril develops a dry cough and angioedema. Which drug should replace it?', earlier));
  assert.ok(!isRepeat('Short one?', 'Short two?'), 'too few words to judge');
  assert.ok(isRepeat('Short one?', 'short one?'));
});

test('a reply loses what the set already asked, and says so', () => {
  const { data, set } = setWithTests();
  const stems = testsInSet(data, set.id).flatMap((t) => t.questions.map((x) => x.stem));
  const reply = pack(q(stems[0], 'Diagnosis'), q('A completely new scenario about digoxin toxicity with yellow vision and nausea present?', 'Toxicity'));
  const kept = dropRepeats(reply, stems);
  assert.equal(kept.questions.length, 1);
  assert.equal(kept.questions[0].topic, 'Toxicity');
  assert.match(kept.problems[0], /repeats a question already in this set/);
  assert.throws(() => dropRepeats(pack(q(stems[0], 'D')), stems), /Every question/);
});

test('the brief knows what was asked and how it went', () => {
  const { data, set, first, second } = setWithTests();
  const progress = emptyProgress();
  take(progress, first, [1, 0, 1], []);
  take(progress, second, [0, -1], [0]);
  const brief = setBrief(data, progress, set.id)!;
  assert.equal(brief.testCount, 2);
  assert.equal(brief.stems.length, 5);
  assert.equal(brief.asked.length, 5);
  assert.deepEqual(brief.asked[0], { topic: 'Diagnosis', stem: first.questions[0].stem.slice(0, 109).trimEnd() + (first.questions[0].stem.length > 110 ? '…' : first.questions[0].stem.slice(109)), answer: 'Right one' });
  assert.deepEqual(brief.scores.map((s) => [s.title, s.right, s.total, s.difficulty]), [['Test 1', 1, 3, 2], ['Test 2', 1, 2, 3]]);
  assert.deepEqual(brief.weak.map((t) => [t.topic, t.right, t.total]), [['Diagnosis', 0, 2]]);
  assert.equal(brief.answered, 5);
  assert.equal(brief.missed.length, 3);
  assert.equal(brief.missed[0].yours, 'Wrong one');
  assert.equal(brief.missed[0].answer, 'Right one');
  assert.equal(brief.missed[2].yours, '(left blank)');
  assert.deepEqual(brief.unsure.map((u) => u.topic), ['Treatment']);
  assert.equal(setBrief(data, progress, 'gone'), null);
});

test('getting better shows: the latest answer decides, from a test or a game', () => {
  const { data, set, first } = setWithTests();
  const progress = emptyProgress();
  take(progress, first, [1, 1, 1], [], '2026-11-02T10:00:00.000Z');
  assert.equal(setBrief(data, progress, set.id)!.missed.length, 3);
  take(progress, first, [0, 1, 1], [], '2026-11-02T11:00:00.000Z');
  assert.equal(setBrief(data, progress, set.id)!.missed.length, 2);
  recordGameAnswer(progress, first.questions[1], first.id, [0], TODAY, '2026-11-02T12:00:00.000Z');
  assert.equal(setBrief(data, progress, set.id)!.missed.length, 1);
});

test('a strong topic is called out, and a fixed answer key changes the feedback', () => {
  const data = emptyTests();
  const set = createSet(data, { title: 'X' }, makeId, NOW);
  const t = addTest(data, pack(...['one', 'two', 'three'].map((n) => q(`Question ${n} about the same strong topic for this test?`, 'Strong'))), { setId: set.id }, makeId, NOW);
  const progress = emptyProgress();
  take(progress, t, [0, 0, 0]);
  assert.deepEqual(setBrief(data, progress, set.id)!.strong.map((s) => s.topic), ['Strong']);
  assert.deepEqual(setBrief(data, progress, set.id)!.missed, []);
  t.questions[0].correct = [1];
  assert.equal(setBrief(data, progress, set.id)!.missed.length, 1);
});

test('a long set still makes a sensible prompt', () => {
  const data = emptyTests();
  const set = createSet(data, { title: 'Long' }, makeId, NOW);
  const questions = Array.from({ length: 200 }, (_, i) => q(`Question number ${i} ${'with a long stem that goes on and on '.repeat(10)}`, 'T'));
  addTest(data, pack(...questions), { setId: set.id }, makeId, NOW);
  const brief = setBrief(data, emptyProgress(), set.id)!;
  assert.equal(brief.asked.length, 120);
  assert.equal(brief.askedLeftOut, 80);
  assert.equal(brief.stems.length, 200, 'repeat checks still see everything');
  assert.ok(brief.asked.every((a) => a.stem.length <= 110));
  const prompt = buildTestPrompt({ source: 'notes', count: 25, style: 'mixed', difficulty: 3, brief });
  assert.ok(prompt.length < 30000, `${prompt.length} characters`);
  assert.match(prompt, /and 80 earlier questions/);
});

test('difficulty nudges follow the last score', () => {
  const { data, set, first, second } = setWithTests();
  const progress = emptyProgress();
  assert.equal(suggestDifficulty(setBrief(data, progress, set.id)!, 3), null, 'nothing taken yet');
  take(progress, first, [0, 0, 0]);
  assert.equal(suggestDifficulty(setBrief(data, progress, set.id)!, 3)?.level, 4);
  assert.equal(suggestDifficulty(setBrief(data, progress, set.id)!, 5), null, 'already at the top');
  take(progress, second, [1, 1]);
  const low = suggestDifficulty(setBrief(data, progress, set.id)!, 3);
  assert.equal(low?.level, 2);
  assert.match(low?.why ?? '', /0% on Test 2/);
  assert.equal(suggestDifficulty(setBrief(data, progress, set.id)!, 1), null, 'already at the bottom');
});

test('the overview groups tests by set', () => {
  const { data, set, first } = setWithTests();
  addTest(data, pack(q('A loose question?', 'T')), {}, makeId, NOW);
  const progress = emptyProgress();
  take(progress, first, [0, 0, 1]);
  const summary = studySummary(data, progress, TODAY);
  assert.equal(summary.tests.filter((t) => t.setId === set.id).length, 2);
  assert.equal(summary.tests.find((t) => t.id === first.id)?.difficulty, 2);
  const [row] = setSummaries(data, summary.tests);
  assert.deepEqual([row.title, row.tests, row.taken, row.questions, row.trend], ['Heart failure', 2, 1, 5, [67]]);
  assert.deepEqual(row.score, { right: 2, total: 3 });
});

// ── The prompt ───────────────────────────────────────────────────────────────

const baseOptions = { source: 'notes' as const, count: 10, style: 'vignette' as const };

test('difficulty changes what’s asked for, across five levels', () => {
  assert.equal(DIFFICULTIES.length, 5);
  const easy = buildTestPrompt({ ...baseOptions, difficulty: 1 });
  const hard = buildTestPrompt({ ...baseOptions, difficulty: 5 });
  assert.notEqual(easy, hard);
  assert.ok(easy.includes(DIFFICULTIES[0].prompt));
  assert.ok(hard.includes(DIFFICULTIES[4].prompt));
  assert.ok(buildTestPrompt({ ...baseOptions, difficulty: 99 }).includes(DIFFICULTIES[2].prompt), 'nonsense falls back to the middle');
});

test('a fresh prompt doesn’t mention earlier tests', () => {
  assert.doesNotMatch(buildTestPrompt(baseOptions), /already been tested|Already asked/);
});

test('the next prompt in a set steers away from repeats and toward what’s needed', () => {
  const { data, set, first, second } = setWithTests();
  const progress = emptyProgress();
  take(progress, first, [1, 0, 1]);
  take(progress, second, [0, -1], [0]);
  const brief = setBrief(data, progress, set.id)!;
  const prompt = buildTestPrompt({ ...baseOptions, difficulty: 3, brief });
  assert.match(prompt, /test 3 in a series on Heart failure/);
  assert.match(prompt, /Do not repeat/);
  assert.ok(prompt.includes(first.questions[1].stem.slice(0, 40)), 'lists what’s been asked');
  assert.match(prompt, /Test 1: 1 of 3/);
  assert.match(prompt, /Diagnosis \(0 of 2 right\)/);
  assert.match(prompt, /I answered "Wrong one", but it’s "Right one"/);
  assert.match(prompt, /I left it blank/);
  assert.match(prompt, /I got these right but wasn’t sure/);
  assert.match(prompt, /fewer questions/, 'better to come up short than repeat');
  // Still a reply the parser reads.
  assert.equal(parseTestReply(prompt.match(/```json\n([\s\S]+?)```/)![1]).questions.length, 1);
});

test('a set with nothing taken yet still avoids repeats, and doesn’t invent feedback', () => {
  const { data, set } = setWithTests();
  const prompt = buildTestPrompt({ ...baseOptions, brief: setBrief(data, emptyProgress(), set.id)! });
  assert.match(prompt, /Do not repeat/);
  assert.doesNotMatch(prompt, /How I’ve done/);
});

test('the prompt asks for math the site can show', () => {
  const prompt = buildTestPrompt(baseOptions);
  assert.ok(prompt.includes('$P_{O_2}$'));
  assert.match(prompt, /double every backslash/i);
  assert.match(prompt, /closing \$/);
});


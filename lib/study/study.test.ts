import test from 'node:test';
import { strict as assert } from 'node:assert';
import { ankiFile } from './anki';
import { buildTestPrompt } from './prompt';
import {
  addTest, answerReview, choiceOrder, cleanAnswer, dueMisses, emptyProgress, emptyTests, addQuestion, editQuestion, finishAttempt, parseTestReply,
  PANCE_SYSTEMS, readSystem, removeQuestion, removeTest, REVIEW_DAYS, saveAttempt, scoreAttempt, startAttempt, studyDays, studySummary,
  StudyInputError, todaySteps, type ProgressData, type StudyTest,
} from './study';
import { addDays } from '../habits/dates';

const TODAY = '2026-10-31';
const NOW = '2026-10-31T15:00:00.000Z';

let counter = 0;
const makeId = () => `id${++counter}`;

const question = (over: Record<string, unknown> = {}) => ({
  stem: 'A 54-year-old has crushing chest pain. Most likely diagnosis?',
  choices: ['Myocardial infarction', 'GERD', 'Costochondritis', 'Panic attack'],
  correct: 'A',
  explanation: 'Crushing pain suggests MI.',
  whyWrong: { B: 'GERD burns.' },
  quote: 'MI classically presents with crushing chest pain.',
  topic: 'ACS',
  system: 'Cardiovascular',
  ...over,
});
const reply = (questions: unknown[], over: Record<string, unknown> = {}) => JSON.stringify({ title: 'Cardio 1', course: 'Clin Med', questions, ...over });

function makeTest(n = 3): StudyTest {
  const data = emptyTests();
  const pack = parseTestReply(reply(Array.from({ length: n }, (_, i) => question({ stem: `Question number ${i}`, topic: i === 0 ? 'ACS' : 'Heart failure' }))));
  return addTest(data, pack, {}, makeId, NOW);
}

function takeAndFinish(progress: ProgressData, t: StudyTest, answers: Record<string, number[]>, flagged: string[] = [], day = TODAY) {
  const attempt = startAttempt(progress, t, { fresh: true }, makeId, 7, NOW);
  saveAttempt(attempt, t, { answers, flagged, elapsed: 90 });
  finishAttempt(progress, attempt, t, day, `${day}T15:00:00.000Z`);
  return attempt;
}

test('a normal AI reply is read, in or out of a code block', () => {
  const body = reply([question(), question({ stem: 'Second', correct: ['A', 'C'] })]);
  for (const text of [body, `Sure! Here's your test:\n\n\`\`\`json\n${body}\n\`\`\`\n\nGood luck!`]) {
    const pack = parseTestReply(text);
    assert.equal(pack.title, 'Cardio 1');
    assert.equal(pack.course, 'Clin Med');
    assert.equal(pack.questions.length, 2);
    assert.deepEqual(pack.questions[0].correct, [0]);
    assert.deepEqual(pack.questions[1].correct, [0, 2]);
    assert.equal(pack.questions[0].whyWrong?.[1], 'GERD burns.');
    assert.equal(pack.questions[0].system, 'Cardiovascular');
    assert.deepEqual(pack.problems, []);
  }
});

test('the usual AI slips are forgiven', () => {
  const pack = parseTestReply(`{"questions":[${JSON.stringify(question({ choices: ['A. One', 'B) Two', '(C) Three'], correct: 'B. Two' }))},]}`);
  assert.deepEqual(pack.questions[0].choices, ['One', 'Two', 'Three']);
  assert.deepEqual(pack.questions[0].correct, [1]);
  const byText = parseTestReply(reply([question({ correct: 'gerd' }), question({ stem: 'Two', correct: 'a, c' }), question({ stem: 'Three', answer: 'C', correct: undefined, choices: { A: 'x', B: 'y', C: 'z' } })]));
  assert.deepEqual(byText.questions.map((q) => q.correct), [[1], [0, 2], [2]]);
});

test('a bad question is reported and the rest are kept', () => {
  const pack = parseTestReply(reply([
    question(),
    question({ stem: '' }),
    question({ stem: 'Too few', choices: ['Only one'] }),
    question({ stem: 'Past the end', correct: 'F' }),
    question({ stem: 'A number is ambiguous', correct: 1 }),
    question({ stem: 'Same choices', choices: ['x', 'X'] }),
    question({ stem: 'Not a choice', correct: 'Aspirin' }),
    question(),
  ]));
  assert.equal(pack.questions.length, 1);
  assert.equal(pack.problems.length, 7);
  assert.match(pack.problems[3], /Question 5: .*letter/);
  assert.match(pack.problems[6], /repeats question 1/);
});

test('a reply cut off part way keeps every whole question', () => {
  const whole = reply([question(), question({ stem: 'Second' }), question({ stem: 'Third' })]);
  const pack = parseTestReply(whole.slice(0, whole.lastIndexOf('{') + 30));
  assert.equal(pack.questions.length, 2);
  assert.match(pack.warnings[0], /cut off/);
});

test('missing quotes and explanations are worth a warning, not a refusal', () => {
  const pack = parseTestReply(reply([question({ quote: undefined, explanation: undefined })]));
  assert.equal(pack.questions.length, 1);
  assert.equal(pack.warnings.length, 2);
});

test('a reply with nothing usable says why', () => {
  assert.throws(() => parseTestReply(''), StudyInputError);
  assert.throws(() => parseTestReply('Sorry, I can’t do that.'), /couldn’t find any JSON/);
  assert.throws(() => parseTestReply('{"nope": 1}'), /"questions"/);
  assert.throws(() => parseTestReply(reply([question({ stem: '' })])), /None of those/);
  assert.throws(() => parseTestReply('{"questions": [ {"stem": "unfinished'), /isn’t valid JSON/);
});

test('the prompt describes a reply the parser reads', () => {
  const prompt = buildTestPrompt({ source: 'notes', count: 25, style: 'vignette', course: 'Clin Med', focus: 'Heart failure', weakTopics: ['ACS'] });
  assert.match(prompt, /25 multiple-choice/);
  assert.match(prompt, /Clin Med/);
  assert.match(prompt, /Focus on: Heart failure/);
  assert.match(prompt, /ACS/);
  for (const system of PANCE_SYSTEMS) assert.ok(prompt.includes(system), system);
  const example = prompt.match(/```json\n([\s\S]+?)```/)![1];
  const pack = parseTestReply(example);
  assert.equal(pack.questions.length, 1);
  assert.deepEqual(pack.questions[0].correct, [1]);
  assert.equal(pack.questions[0].whyWrong?.[4], 'Why this one is wrong.');
  assert.deepEqual(pack.problems, []);
  assert.match(buildTestPrompt({ source: 'old-test', count: 1, style: 'mixed' }), /Convert it/);
});

test('organ systems match loosely, or not at all', () => {
  assert.equal(readSystem('cardiology'), 'Cardiovascular');
  assert.equal(readSystem('Psychiatry'), 'Psychiatric/Behavioral');
  assert.equal(readSystem('GI'), undefined);
  assert.equal(readSystem(''), undefined);
});

test('choices shuffle the same way each time, and the ones that depend on order stay put', () => {
  const q = { id: 'q1', choices: ['a', 'b', 'c', 'd', 'e'] };
  assert.deepEqual(choiceOrder(q, 5), choiceOrder(q, 5));
  assert.deepEqual([...choiceOrder(q, 5)].sort(), [0, 1, 2, 3, 4]);
  const orders = new Set(Array.from({ length: 12 }, (_, seed) => choiceOrder(q, seed).join()));
  assert.ok(orders.size > 3);
  const fixed = { id: 'q2', choices: ['a', 'b', 'All of the above'] };
  assert.deepEqual(choiceOrder(fixed, 5), [0, 1, 2]);
});

test('select-all needs exactly the right set, and answers are cleaned', () => {
  const data = emptyTests();
  const t = addTest(data, parseTestReply(reply([question({ correct: ['A', 'C'] })])), {}, makeId, NOW);
  const q = t.questions[0];
  const progress = emptyProgress();
  const attempt = startAttempt(progress, t, {}, makeId, 1, NOW);
  saveAttempt(attempt, t, { answers: { [q.id]: [2, 0, 0, 99, 'x'] } });
  assert.deepEqual(attempt.answers[q.id], [0, 2]);
  assert.equal(scoreAttempt(attempt, t).right, 1);
  assert.deepEqual(cleanAnswer(q, 'nope'), []);
  saveAttempt(attempt, t, { answers: { [q.id]: [0] } });
  assert.equal(scoreAttempt(attempt, t).right, 0);
});

test('starting picks up an unfinished try, unless you ask for a fresh one', () => {
  const t = makeTest();
  const progress = emptyProgress();
  const first = startAttempt(progress, t, { mode: 'tutor' }, makeId, 1, NOW);
  assert.equal(startAttempt(progress, t, { mode: 'exam' }, makeId, 2, NOW).id, first.id);
  const fresh = startAttempt(progress, t, { fresh: true, questionIds: [t.questions[1].id, 'not-mine'] }, makeId, 3, NOW);
  assert.notEqual(fresh.id, first.id);
  assert.deepEqual(fresh.questionIds, [t.questions[1].id]);
  assert.equal(progress.attempts.length, 1);
});

test('wrong and blank answers go in the bank, and so does a lucky guess', () => {
  const t = makeTest(4);
  const [a, b, c, d] = t.questions.map((q) => q.id);
  const progress = emptyProgress();
  const attempt = takeAndFinish(progress, t, { [a]: [0], [b]: [1], [d]: [0] }, [d]);
  assert.equal(scoreAttempt(attempt, t).right, 2);
  assert.equal(scoreAttempt(attempt, t).unanswered, 1);
  assert.equal(progress.misses[a], undefined);
  assert.equal(progress.misses[b].dueOn, addDays(TODAY, 1));
  assert.equal(progress.misses[b].misses, 1);
  assert.equal(progress.misses[c].dueOn, addDays(TODAY, 1));
  // Right but "not sure": comes back later, and isn't counted as a miss.
  assert.equal(progress.misses[d].dueOn, addDays(TODAY, 3));
  assert.equal(progress.misses[d].misses, 0);
  assert.deepEqual(dueMisses(progress, TODAY), []);
  assert.equal(dueMisses(progress, addDays(TODAY, 1)).length, 2);
  assert.deepEqual(studyDays(progress), [TODAY]);
});

test('handing in twice changes nothing', () => {
  const t = makeTest();
  const progress = emptyProgress();
  const attempt = takeAndFinish(progress, t, {});
  const before = JSON.stringify(progress);
  finishAttempt(progress, attempt, t, addDays(TODAY, 5), NOW);
  assert.equal(JSON.stringify(progress), before);
  assert.throws(() => saveAttempt(attempt, t, { answers: {} }), /already finished/);
});

test('a miss climbs the schedule and clears, and a slip starts it over', () => {
  const t = makeTest(1);
  const q = t.questions[0];
  const progress = emptyProgress();
  takeAndFinish(progress, t, { [q.id]: [1] });
  let day = addDays(TODAY, 1);
  for (let i = 0; i < REVIEW_DAYS.length - 1; i++) {
    const { right, miss } = answerReview(progress, q, [0], day);
    assert.ok(right);
    assert.equal(miss.dueOn, addDays(day, REVIEW_DAYS[i + 1]));
    day = miss.dueOn;
  }
  // A slip near the end goes right back to tomorrow.
  const slipped = answerReview(progress, q, [2], day).miss;
  assert.equal(slipped.dueOn, addDays(day, 1));
  assert.equal(slipped.box, 0);
  assert.equal(slipped.misses, 2);
  day = slipped.dueOn;
  for (let i = 0; i < REVIEW_DAYS.length; i++) {
    const { miss } = answerReview(progress, q, [0], day);
    day = miss.dueOn;
  }
  assert.equal(progress.misses[q.id].state, 'cleared');
  assert.deepEqual(dueMisses(progress, addDays(day, 100)), []);
  assert.throws(() => answerReview(progress, q, [0], addDays(day, 100)), /isn’t waiting/);
});

test('answering twice in a day only counts once', () => {
  const t = makeTest(1);
  const q = t.questions[0];
  const progress = emptyProgress();
  takeAndFinish(progress, t, { [q.id]: [1] });
  const day = addDays(TODAY, 1);
  assert.ok(answerReview(progress, q, [0], day).counted);
  const again = answerReview(progress, q, [0], day);
  assert.equal(again.counted, false);
  assert.equal(progress.misses[q.id].box, 1);
  assert.equal(progress.misses[q.id].rights, 1);
});

test('getting a due question right on a later test moves it along', () => {
  const t = makeTest(1);
  const q = t.questions[0];
  const progress = emptyProgress();
  takeAndFinish(progress, t, { [q.id]: [1] });
  takeAndFinish(progress, t, { [q.id]: [0] }, [], addDays(TODAY, 1));
  assert.equal(progress.misses[q.id].box, 1);
});

test('missing a question handed to Anki brings it back here', () => {
  const t = makeTest(1);
  const q = t.questions[0];
  const progress = emptyProgress();
  takeAndFinish(progress, t, { [q.id]: [1] });
  progress.misses[q.id].state = 'anki';
  takeAndFinish(progress, t, { [q.id]: [1] }, [], addDays(TODAY, 3));
  assert.equal(progress.misses[q.id].state, 'active');
  assert.equal(progress.misses[q.id].misses, 2);
});

test('fixing a wrong answer key regrades attempts and squares up the bank', () => {
  const t = makeTest(2);
  const [a, b] = t.questions.map((q) => q.id);
  const progress = emptyProgress();
  const attempt = takeAndFinish(progress, t, { [a]: [1], [b]: [0] });
  assert.equal(scoreAttempt(attempt, t).right, 1);
  assert.ok(progress.misses[a]);
  // Her answer to a was right all along; b's key was wrong the other way.
  const fix = (id: string, input: Record<string, unknown>) => {
    const q = t.questions.find((x) => x.id === id);
    return editQuestion(t, progress, id, { stem: q?.stem ?? 'Gone', choices: (q?.choices ?? ['a', 'b']).map((text, from) => ({ text, from })), correct: q?.correct, explanation: q?.explanation, topic: q?.topic, ...input }, TODAY);
  };
  fix(a, { correct: [1], explanation: 'Fixed.' });
  fix(b, { correct: [3] });
  assert.equal(t.questions[0].explanation, 'Fixed.');
  assert.equal(progress.misses[a], undefined);
  assert.ok(progress.misses[b]);
  assert.equal(scoreAttempt(attempt, t).right, 1);
  assert.throws(() => fix(a, { correct: [] }), /at least one/);
  assert.throws(() => fix('gone', { correct: [0] }), /isn’t in this test/);
});

test('a past answer follows its choice when choices are moved, removed or added', () => {
  const data = emptyTests();
  const t = addTest(data, parseTestReply(reply([question()])), {}, makeId, NOW);
  const id = t.questions[0].id;
  const progress = emptyProgress();
  const done = takeAndFinish(progress, t, { [id]: [1] });
  progress.gameAnswers[id] = { testId: t.id, answer: [1], at: NOW };
  const open = startAttempt(progress, t, { fresh: true }, makeId, 1, NOW);
  saveAttempt(open, t, { answers: { [id]: [3] } });
  // Drop A, put D first, keep B and C, and add a new one.
  const [a, b, c, d] = t.questions[0].choices;
  assert.ok(a);
  editQuestion(t, progress, id, { stem: 'New stem', choices: [{ text: d, from: 3 }, { text: b, from: 1 }, { text: `${c} (reworded)`, from: 2 }, { text: 'Brand new' }], correct: [1], explanation: 'Now B', topic: 'T' }, TODAY);
  assert.deepEqual(t.questions[0].choices, [d, b, `${c} (reworded)`, 'Brand new']);
  assert.deepEqual(done.answers[id], [1], 'B is still what she picked');
  assert.deepEqual(open.answers[id], [0], 'D moved to the front');
  assert.deepEqual(progress.gameAnswers[id].answer, [1]);
  assert.equal(scoreAttempt(done, t).right, 1, 'and it’s the right answer now');
});

test('an answer whose choice is removed counts as blank, not as some other choice', () => {
  const data = emptyTests();
  const t = addTest(data, parseTestReply(reply([question()])), {}, makeId, NOW);
  const id = t.questions[0].id;
  const progress = emptyProgress();
  const done = takeAndFinish(progress, t, { [id]: [3] });
  const open = startAttempt(progress, t, { fresh: true }, makeId, 1, NOW);
  saveAttempt(open, t, { answers: { [id]: [3] } });
  const q = t.questions[0];
  editQuestion(t, progress, id, { stem: q.stem, choices: q.choices.slice(0, 3).map((text, from) => ({ text, from })), correct: [0], explanation: '', topic: 'T' }, TODAY);
  assert.deepEqual(done.answers[id], []);
  assert.equal(open.answers[id], undefined);
  assert.equal(scoreAttempt(done, t).right, 0);
});

test('fixing a typo leaves the review schedule alone', () => {
  const data = emptyTests();
  const t = addTest(data, parseTestReply(reply([question()])), {}, makeId, NOW);
  const id = t.questions[0].id;
  const progress = emptyProgress();
  takeAndFinish(progress, t, { [id]: [1] });
  const before = { ...progress.misses[id] };
  assert.ok(before.dueOn);
  const q = t.questions[0];
  // The right answer moves position, but it's still the same answer.
  const order = [1, 0, 2, 3];
  editQuestion(t, progress, id, { stem: 'A typo fixed', choices: order.map((from) => ({ text: q.choices[from], from })), correct: [order.indexOf(q.correct[0])], explanation: q.explanation, topic: q.topic }, addDays(TODAY, 3));
  assert.deepEqual(progress.misses[id], before);
});

test('optional details can be set and cleared', () => {
  const data = emptyTests();
  const t = addTest(data, parseTestReply(reply([question()])), {}, makeId, NOW);
  const id = t.questions[0].id;
  const progress = emptyProgress();
  const base = { stem: 'S', choices: [{ text: 'a', from: 0, why: '' }, { text: 'b', from: 1, why: 'Because' }], correct: [0], explanation: 'E' };
  const q = editQuestion(t, progress, id, { ...base, topic: 'Asthma', system: 'Pulmonary', quote: 'A line' }, TODAY);
  assert.deepEqual([q.topic, q.system, q.quote, q.whyWrong], ['Asthma', 'Pulmonary', 'A line', ['', 'Because']]);
  const cleared = editQuestion(t, progress, id, { ...base, choices: [{ text: 'a', from: 0 }, { text: 'b', from: 1 }], topic: '', system: '', quote: '' }, TODAY);
  assert.deepEqual([cleared.topic, 'system' in cleared, 'quote' in cleared, 'whyWrong' in cleared], ['General', false, false, false]);
});

test('a question has to make sense before it’s saved', () => {
  const data = emptyTests();
  const t = addTest(data, parseTestReply(reply([question()])), {}, makeId, NOW);
  const id = t.questions[0].id;
  const progress = emptyProgress();
  const ok = { stem: 'S', choices: [{ text: 'a' }, { text: 'b' }], correct: [0], explanation: '', topic: '' };
  assert.throws(() => editQuestion(t, progress, id, { ...ok, stem: ' ' }, TODAY), /Write the question/);
  assert.throws(() => editQuestion(t, progress, id, { ...ok, choices: [{ text: 'a' }] }, TODAY), /at least two/);
  assert.throws(() => editQuestion(t, progress, id, { ...ok, choices: [{ text: 'a' }, { text: ' ' }] }, TODAY), /empty choice/);
  assert.throws(() => editQuestion(t, progress, id, { ...ok, choices: [{ text: 'a' }, { text: 'A' }] }, TODAY), /same thing/);
  assert.throws(() => editQuestion(t, progress, id, { ...ok, correct: [] }, TODAY), /at least one/);
  assert.equal(t.questions[0].choices.length, 4, 'a refused edit changes nothing');
});

test('she can write her own question', () => {
  const data = emptyTests();
  const t = addTest(data, parseTestReply(reply([question()])), {}, makeId, NOW);
  const q = addQuestion(t, { stem: 'Mine?', choices: [{ text: 'Yes' }, { text: 'No' }, { text: 'Both' }], correct: [0, 2], explanation: '', topic: 'Mine' }, makeId);
  assert.equal(t.questions.length, 2);
  assert.deepEqual([q.stem, q.correct, q.topic], ['Mine?', [0, 2], 'Mine']);
  assert.ok(q.id);
});

test('removing a question or a test takes its misses and tries with it', () => {
  const data = emptyTests();
  const t = addTest(data, parseTestReply(reply([question(), question({ stem: 'Second' })])), {}, makeId, NOW);
  const [a, b] = t.questions.map((q) => q.id);
  const progress = emptyProgress();
  const done = takeAndFinish(progress, t, {});
  const open = startAttempt(progress, t, {}, makeId, 1, NOW);
  saveAttempt(open, t, { answers: { [a]: [0] }, flagged: [a] });
  removeQuestion(t, progress, a);
  assert.equal(progress.misses[a], undefined);
  assert.deepEqual(open.questionIds, [b]);
  assert.deepEqual(open.flagged, []);
  assert.equal(scoreAttempt(done, t).total, 1);
  removeTest(data, progress, t.id);
  assert.deepEqual(data.tests, []);
  assert.deepEqual(progress.attempts, []);
  assert.deepEqual(progress.misses, {});
});

test('the overview adds it all up', () => {
  const data = emptyTests();
  const pack = parseTestReply(reply(['ACS', 'ACS', 'ACS', 'HF', 'HF', 'HF'].map((topic, i) => question({ stem: `Q${i}`, topic }))));
  const t = addTest(data, pack, { course: 'Cardio' }, makeId, NOW);
  const answers = Object.fromEntries(t.questions.map((q, i) => [q.id, [i < 4 ? 0 : 1]]));
  const progress = emptyProgress();
  takeAndFinish(progress, t, answers);
  startAttempt(progress, t, {}, makeId, 1, NOW);

  const summary = studySummary(data, progress, TODAY);
  assert.equal(summary.tests[0].taken, 1);
  assert.deepEqual(summary.tests[0].best, { right: 4, total: 6 });
  assert.deepEqual(summary.tests[0].open, { answered: 0, total: 6 });
  assert.deepEqual(summary.courses, ['Cardio']);
  assert.deepEqual(summary.totals, { tests: 1, questions: 6, taken: 1, answered: 6, right: 4 });
  assert.equal(summary.weakTopics[0].topic, 'HF');
  assert.equal(summary.weakTopics.length, 1);
  assert.equal(summary.review.due, 0);
  assert.equal(summary.review.active, 2);
  assert.equal(summary.review.forAnki, 2);
  assert.equal(summary.review.nextOn, addDays(TODAY, 1));
  assert.equal(studySummary(data, progress, addDays(TODAY, 1)).review.due, 2);
});

test('PA Today asks for reviews and unfinished tests, and says when she can stop', () => {
  const data = emptyTests();
  const untaken = addTest(data, parseTestReply(reply([question()])), { title: 'Untaken' }, makeId, NOW);
  const taken = addTest(data, parseTestReply(reply([question()])), { title: 'Taken' }, makeId, NOW);
  const progress = emptyProgress();

  // Only a test she hasn't taken: a suggestion, and she's still clear.
  let steps = todaySteps(studySummary(data, progress, TODAY));
  assert.equal(steps.clear, true);
  assert.equal(steps.next?.id, taken.id, 'the newest one she hasn’t taken');

  // A miss comes due, and a test is left part way.
  takeAndFinish(progress, taken, { [taken.questions[0].id]: [1] });
  startAttempt(progress, untaken, {}, makeId, 1, NOW);
  steps = todaySteps(studySummary(data, progress, addDays(TODAY, 1)));
  assert.equal(steps.clear, false);
  assert.equal(steps.review, 1);
  assert.deepEqual(steps.open.map((t) => t.id), [untaken.id]);
  assert.equal(steps.next, null, 'neither is waiting to be started');

  // Nothing due until tomorrow, once the open one is gone.
  progress.attempts = progress.attempts.filter((a) => a.finishedAt);
  assert.equal(todaySteps(studySummary(data, progress, TODAY)).clear, true);
});

test('the prompt can ask for long tests, up to a limit', () => {
  assert.match(buildTestPrompt({ source: 'notes', count: 200, style: 'mixed' }), /200 multiple-choice/);
  assert.match(buildTestPrompt({ source: 'notes', count: 5000, style: 'mixed' }), /200 multiple-choice/);
  assert.match(buildTestPrompt({ source: 'notes', count: 5, style: 'mixed' }), /5 multiple-choice/);
});

test('the Anki file has one safe row per question', () => {
  const pack = parseTestReply(reply([question({
    stem: 'Dose <5 mg/kg & "tab\tinside"\nfor $x^2$?',
    choices: ['Low', 'High'],
    correct: 'B',
    explanation: '**Bold** reason',
    whyWrong: { A: 'Too low' },
    topic: 'Heart failure',
  })]));
  const t = addTest(emptyTests(), pack, { course: 'Clin Med II' }, () => 'q1', NOW);
  const lines = ankiFile([{ question: t.questions[0], course: t.course }]).trim().split('\n');
  assert.deepEqual(lines.slice(0, 6), ['#separator:tab', '#html:true', '#notetype:Basic', '#deck:PA School::Missed questions', '#guid column:1', '#tags column:4']);
  assert.equal(lines.length, 7);
  const [guid, front, back, tags] = lines[6].split('\t');
  assert.equal(lines[6].split('\t').length, 4);
  assert.equal(guid, 'study-q1');
  assert.ok(front.startsWith('Dose &lt;5 mg/kg &amp; &quot;tab inside&quot;<br>for \\(x^2\\)?'));
  assert.ok(front.includes('A. Low<br>B. High'));
  assert.ok(back.startsWith('<b>B. High</b>'));
  assert.ok(back.includes('<b>Bold</b> reason'));
  assert.ok(back.includes('A: Too low'));
  assert.ok(back.includes('From your notes'));
  assert.equal(tags, 'missed course::Clin-Med-II topic::Heart-failure system::Cardiovascular');
});

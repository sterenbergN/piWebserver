import test from 'node:test';
import { strict as assert } from 'node:assert';
import { addDays } from '../habits/dates';
import { coverageMap, emptyMap, type AnkiData } from './coverage';
import { ankiQuestions, gamePool, isShort, MIN_TRIVIA_QUESTIONS, rankFor, recordGameAnswer, recordRun, SHORT_STEM, triviaDeck, triviaUsable, weakestSystem, type GameQuestion } from './games';
import {
  answerQuestion, clockFor, defibResult, defibZone, enterDoor, MAX_COFFEE, proceed, questionOf, SECOND_OPINION, SHIFT_ROOMS, startRun, spendConsult, spendOpinion, type Run,
} from './night-shift';
import { addTask, eat, emptyPlan, eatGame, GAME_TASK } from './plan';
import { createSet } from './sets';
import {
  addTest, dueMisses, emptyProgress, emptyTests, finishAttempt, parseTestReply, saveAttempt, startAttempt, studyDays, type ProgressData, type StudyTest, type TestsData,
} from './study';

const NOW = '2026-11-02T15:00:00.000Z';
const TODAY = '2026-11-02';
let counter = 0;
const makeId = () => `g${++counter}`;

function makeTests(rows: { system?: string; course?: string; n?: number; choices?: number; correct?: string }[]): { data: TestsData; tests: StudyTest[] } {
  const data = emptyTests();
  const tests = rows.map(({ system, course = '', n = 5, choices = 4, correct = 'A' }, r) => addTest(data, parseTestReply(JSON.stringify({
    questions: Array.from({ length: n }, (_, i) => ({
      stem: `Row ${r} question ${i} ${'detail '.repeat(i)}`,
      choices: Array.from({ length: choices }, (_, c) => `Choice ${c}`),
      correct,
      explanation: 'Because.',
      topic: `Topic ${r}`,
      ...(system ? { system } : {}),
    })),
  })), { course }, makeId, NOW));
  return { data, tests };
}

function missOne(progress: ProgressData, test: StudyTest, index = 0) {
  const attempt = startAttempt(progress, test, { fresh: true }, makeId, 1, NOW);
  saveAttempt(attempt, test, { answers: Object.fromEntries(test.questions.map((q, i) => [q.id, [i === index ? 1 : 0]])) });
  finishAttempt(progress, attempt, test, TODAY, NOW);
}

test('the pool filters by class, system and misses, and knows what’s urgent', () => {
  const { data, tests } = makeTests([{ system: 'Renal', course: 'A' }, { system: 'Pulmonary', course: 'B' }]);
  const progress = emptyProgress();
  missOne(progress, tests[0]);
  assert.equal(gamePool(data, progress, {}, TODAY).length, 10);
  assert.equal(gamePool(data, progress, { course: 'B' }, TODAY).length, 5);
  assert.equal(gamePool(data, progress, { system: 'Renal' }, TODAY).length, 5);
  const misses = gamePool(data, progress, { missesOnly: true }, TODAY);
  assert.deepEqual(misses.map((q) => q.id), [tests[0].questions[0].id]);
  assert.equal(misses[0].priority, 2, 'in the bank, due tomorrow');
  assert.equal(gamePool(data, progress, { missesOnly: true }, addDays(TODAY, 1))[0].priority, 3, 'due now');
  assert.equal(gamePool(data, progress, {}, TODAY).filter((q) => q.priority === 1).length, 9);
});

test('a wrong game answer goes in the bank, and a right one moves a due miss along', () => {
  const { tests } = makeTests([{ system: 'Renal' }]);
  const [q] = tests[0].questions;
  const progress = emptyProgress();
  assert.equal(recordGameAnswer(progress, q, tests[0].id, [1], TODAY, NOW), false);
  assert.equal(progress.misses[q.id].state, 'active');
  assert.equal(progress.misses[q.id].dueOn, addDays(TODAY, 1));

  // Right before it's due changes nothing.
  assert.equal(recordGameAnswer(progress, q, tests[0].id, [0], TODAY, NOW), true);
  assert.equal(progress.misses[q.id].box, 0);
  // Right once due moves it along, and counts as a study day.
  const day = addDays(TODAY, 1);
  recordGameAnswer(progress, q, tests[0].id, [0], day, NOW);
  assert.equal(progress.misses[q.id].box, 1);
  assert.deepEqual(studyDays(progress), [day]);
  assert.deepEqual(dueMisses(progress, day), []);
});

test('game answers count as proven, and the latest answer wins', () => {
  const { data, tests } = makeTests([{ system: 'Renal', n: 1 }]);
  const [q] = tests[0].questions;
  const progress = emptyProgress();
  const at = (p: ProgressData) => coverageMap(data, p, emptyMap(), null).systems.find((s) => s.system === 'Renal')!.proven;
  recordGameAnswer(progress, q, tests[0].id, [1], TODAY, '2026-11-02T10:00:00.000Z');
  assert.deepEqual([at(progress).right, at(progress).total], [0, 1]);
  recordGameAnswer(progress, q, tests[0].id, [0], TODAY, '2026-11-02T11:00:00.000Z');
  assert.deepEqual([at(progress).right, at(progress).total], [1, 1]);

  // A test taken after the game wins, and one before it doesn't.
  const attempt = startAttempt(progress, tests[0], { fresh: true }, makeId, 1, NOW);
  saveAttempt(attempt, tests[0], { answers: { [q.id]: [1] } });
  finishAttempt(progress, attempt, tests[0], TODAY, '2026-11-02T12:00:00.000Z');
  assert.deepEqual([at(progress).right, at(progress).total], [0, 1]);
  recordGameAnswer(progress, q, tests[0].id, [0], TODAY, '2026-11-02T13:00:00.000Z');
  assert.deepEqual([at(progress).right, at(progress).total], [1, 1]);
});

test('the boss goes after her weakest system with enough questions to fill it', () => {
  const { data, tests } = makeTests([{ system: 'Renal' }, { system: 'Pulmonary' }, { system: 'Dermatologic', n: 2 }]);
  const progress = emptyProgress();
  const attempt = startAttempt(progress, tests[0], { fresh: true }, makeId, 1, NOW);
  saveAttempt(attempt, tests[0], { answers: Object.fromEntries(tests[0].questions.map((q) => [q.id, [1]])) });
  finishAttempt(progress, attempt, tests[0], TODAY, NOW);
  const other = startAttempt(progress, tests[1], { fresh: true }, makeId, 1, NOW);
  saveAttempt(other, tests[1], { answers: Object.fromEntries(tests[1].questions.map((q) => [q.id, [0]])) });
  finishAttempt(progress, other, tests[1], TODAY, NOW);
  assert.equal(weakestSystem(gamePool(data, progress, {}, TODAY), data, progress), 'Renal');
  assert.equal(weakestSystem([], data, progress), null);
});

const fixedRandom = () => 0.5;

test('Anki leeches become questions with borrowed wrong answers', () => {
  const anki: AnkiData = {
    importedAt: NOW, fileName: 'x', format: 'legacy', hasHistory: true, decks: ['Cardio', 'Pulm'], tags: [], groups: [],
    leeches: [
      { deck: 0, tags: [], front: 'First-line in HFrEF', back: 'ARNI', lapses: 5 },
      { deck: 0, tags: [], front: 'Rate control drug', back: 'Metoprolol', lapses: 5 },
      { deck: 0, tags: [], front: '[Furosemide] is a loop diuretic', back: '', lapses: 4 },
      { deck: 1, tags: [], front: 'Rescue inhaler', back: 'Albuterol', lapses: 4 },
      { deck: 1, tags: [], front: 'No answer anywhere', back: '', lapses: 3 },
    ],
  };
  const questions = ankiQuestions(anki, fixedRandom);
  assert.equal(questions.length, 4, 'a card with no answer is left out');
  for (const q of questions) {
    assert.equal(q.choices.length, 4);
    assert.equal(new Set(q.choices).size, 4);
    assert.equal(q.testId, undefined, 'never saved, since it isn’t a test question');
  }
  const cloze = questions.find((q) => q.stem.includes('_____'))!;
  assert.equal(cloze.stem, '_____ is a loop diuretic');
  assert.equal(cloze.choices[cloze.correct[0]], 'Furosemide');
  assert.deepEqual(ankiQuestions(null), []);
  assert.deepEqual(ankiQuestions({ ...anki, leeches: anki.leeches.slice(0, 2) }), [], 'too few to fill the choices');
});

test('a game can draw from one set', () => {
  const { data, tests } = makeTests([{ n: 4 }, { n: 6 }]);
  const set = createSet(data, { title: 'Cardio' }, makeId, NOW);
  tests[1].setId = set.id;
  const pool = gamePool(data, emptyProgress(), { setId: set.id }, TODAY);
  assert.equal(pool.length, 6);
  assert.ok(pool.every((q) => q.testId === tests[1].id));
  assert.equal(gamePool(data, emptyProgress(), { setId: '' }, TODAY).length, 10, 'no set means every test');
});

test('short questions only leaves out patient cases and long answers', () => {
  const quick = { stem: 'First-line drug for absence seizures?', choices: ['Ethosuximide', 'Phenytoin'] };
  const vignette = { stem: `A 24-year-old woman ${'with a long history and an exam that goes on '.repeat(5)}presents. What next?`, choices: ['A', 'B'] };
  const longChoice = { stem: 'Which is true?', choices: ['Short', 'x'.repeat(120)] };
  assert.ok(isShort(quick));
  assert.ok(vignette.stem.length > SHORT_STEM && !isShort(vignette));
  assert.ok(!isShort(longChoice));
  assert.ok(isShort({ stem: `What is $${'\frac{1}{2}'.repeat(3)}$?`, choices: ['$x$', '$y$'] }), 'math is measured as it reads');

  const { data, tests } = makeTests([{ n: 12 }, { n: 3 }]);
  tests[1].questions.forEach((q) => { q.stem = vignette.stem; });
  const pool = gamePool(data, emptyProgress(), {}, TODAY);
  assert.equal(triviaUsable(pool).length, 15);
  assert.equal(triviaUsable(pool, true).length, 12);
  const deck = triviaDeck(pool, Math.random, true);
  assert.ok(deck.every((card) => tests[0].questions.some((q) => q.id === card.studyId)), 'only short ones in the deck');
});

test('the trivia deck has one right answer, four choices at most, and a way back', () => {
  const { data } = makeTests([{ n: 8, choices: 5, correct: 'C' }, { n: 3, choices: 4, correct: 'A, B' }, { n: 4, choices: 3 }]);
  const pool = gamePool(data, emptyProgress(), {}, TODAY);
  const deck = triviaDeck(pool);
  assert.equal(deck.length, 31, 'always a full deck, repeating if it must');
  assert.equal(new Set(deck.map((c) => c.studyId)).size, 12, 'select-all questions stay out');
  for (const card of deck) {
    assert.ok(card.choices.length <= 4 && card.choices.length >= 2);
    assert.equal(card.choiceMap.length, card.choices.length);
    const original = pool.find((q) => q.id === card.studyId)!;
    assert.equal(card.choiceMap[card.answer], original.correct[0], 'the answer maps back to the real choice');
    card.choiceMap.forEach((source, shown) => assert.equal(card.choices[shown], original.choices[source]));
  }
  assert.deepEqual(triviaDeck([]), []);
  assert.equal(MIN_TRIVIA_QUESTIONS, 11);
});

test('runs are tallied, and ranks go up', () => {
  const progress = emptyProgress();
  assert.equal(recordRun(progress, { score: 500, hours: 4, survived: false }, TODAY).isBest, true);
  assert.equal(recordRun(progress, { score: 200, hours: 12, survived: true }, TODAY).isBest, false);
  assert.deepEqual(progress.games, { runs: 2, survived: 1, best: 500, bestHours: 12, lastOn: TODAY });
  assert.deepEqual([rankFor(0), rankFor(1500), rankFor(11000), rankFor(1e6)], ['Student', 'Intern', 'Attending', 'Legend of the Night Shift']);
});

test('a played game can eat one pancake of a task planned for it', () => {
  const plan = emptyPlan();
  const task = addTask(plan, { title: 'Play', pancakes: 3, testId: GAME_TASK }, makeId, TODAY);
  const other = addTask(plan, { title: 'Other', pancakes: 2 }, makeId, TODAY);
  assert.equal(eatGame(plan, TODAY), 1);
  assert.equal(task.eaten, 1);
  assert.equal(other.eaten, 0);
  eat(plan, task.id, TODAY, 2);
  assert.equal(eatGame(plan, TODAY), 0, 'nothing left to eat');
});

// ── The Night Shift ──────────────────────────────────────────────────────────

function pool(n = 30, over: Partial<GameQuestion> = {}): GameQuestion[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `q${i}`, stem: `Question ${i} ${'x'.repeat(i)}`, choices: ['a', 'b', 'c', 'd'], correct: [0], explanation: 'Why', topic: 'T', priority: 1, ...over,
  }));
}

const answerRight = (run: Run, p: GameQuestion[], seconds = 60) => answerQuestion(run, p, questionOf(p, run)!.correct, seconds);
const answerWrong = (run: Run, p: GameQuestion[]) => {
  const q = questionOf(p, run)!;
  return answerQuestion(run, p, [q.choices.findIndex((_, i) => !q.correct.includes(i) && !run.hidden.includes(i))], 60);
};

/** Take a question door if there is one. */
const enterWork = (run: Run, p: GameQuestion[]) => enterDoor(run, p, run.doors.findIndex((d) => d !== 'break' && d !== 'supply'));

test('a perfect shift runs twelve hours, beats the boss, and wins', () => {
  const p = pool();
  const run = startRun(p, 7);
  assert.equal(run.coffee, 3);
  for (let i = 0; i < SHIFT_ROOMS; i++) {
    assert.equal(run.phase, 'doors');
    assert.equal(run.doors.length, 2);
    enterWork(run, p);
    assert.equal(run.phase, 'question');
    const record = answerRight(run, p);
    assert.ok(record?.questionId);
    assert.equal(run.phase, 'feedback');
    proceed(run, p);
  }
  assert.equal(run.phase, 'boss-intro');
  proceed(run, p);
  for (let i = 0; i < 5; i++) {
    assert.equal(run.room, 'boss');
    answerRight(run, p);
    proceed(run, p);
  }
  assert.deepEqual([run.phase, run.won, run.bossBeaten, run.right, run.wrong], ['over', true, true, 16, 0]);
  assert.ok(run.score > 5000);
  assert.equal(new Set(run.used).size, run.used.length, 'nothing repeated');
});

test('a wrong answer explains itself, then calls a code to fight for her coffee', () => {
  const p = pool();
  const run = startRun(p, 3);
  enterWork(run, p);
  const asked = run.questionId;
  const record = answerWrong(run, p);
  assert.equal(record?.questionId, asked, 'saved for the miss bank');
  assert.equal(run.phase, 'feedback');
  assert.equal(run.last?.right, false);
  assert.deepEqual(run.missed, [asked]);
  assert.equal(run.streak, 0);
  assert.equal(run.coffee, 3, 'nothing lost until the code');
  proceed(run, p);
  assert.ok(['code-intro', 'defib'].includes(run.phase));
  if ((run.phase as string) === 'defib') {
    defibResult(run, p, true);
    assert.equal(run.coffee, 3);
  } else {
    proceed(run, p);
    assert.equal(run.room, 'lightning');
    for (let i = 0; i < 3; i++) {
      answerRight(run, p);
      proceed(run, p);
    }
    assert.equal(run.coffee, 3);
  }
  assert.equal(run.phase, 'doors');
  assert.equal(run.hour, 1);
});

/** A run forced straight into a code of the given kind. */
function intoCode(p: GameQuestion[], kind: 'code-intro' | 'defib') {
  for (let seed = 1; seed < 200; seed++) {
    const run = startRun(p, seed);
    enterWork(run, p);
    answerWrong(run, p);
    proceed(run, p);
    if (run.phase === kind) return run;
  }
  throw new Error('no seed');
}

test('losing a code costs a coffee, and running out ends the shift', () => {
  const p = pool();
  const run = intoCode(p, 'defib');
  run.coffee = 2;
  defibResult(run, p, false);
  assert.deepEqual([run.coffee, run.phase], [1, 'doors']);
  const last = intoCode(p, 'defib');
  last.coffee = 1;
  defibResult(last, p, false);
  assert.deepEqual([last.coffee, last.phase, last.won], [0, 'over', false]);

  const lightning = intoCode(p, 'code-intro');
  proceed(lightning, p);
  answerWrong(lightning, p);
  proceed(lightning, p);
  answerWrong(lightning, p);
  proceed(lightning, p);
  answerRight(lightning, p);
  proceed(lightning, p);
  assert.equal(lightning.coffee, 2, '1 of 3 isn’t enough');
  assert.equal(lightning.missed.length, 3);
});

test('a consult removes wrong choices, and leaves something to get wrong', () => {
  const p = pool(10);
  const run = startRun(p, 5);
  enterWork(run, p);
  const q = questionOf(p, run)!;
  spendConsult(run, p);
  assert.equal(run.hidden.length, 2);
  assert.ok(!run.hidden.some((i) => q.correct.includes(i)));
  assert.equal(run.consults, 0);
  spendConsult(run, p);
  assert.equal(run.hidden.length, 2, 'one to a question');

  const two = pool(10, { choices: ['a', 'b'] });
  const small = startRun(two, 5);
  enterWork(small, two);
  spendConsult(small, two);
  assert.equal(small.hidden.length, 0);
  assert.equal(small.consults, 1, 'not spent when it can’t help');
});

test('a second opinion gives one more try, but the first answer is what’s saved', () => {
  const p = pool(10);
  const run = startRun(p, 5);
  enterWork(run, p);
  spendOpinion(run);
  assert.equal(run.opinions, 0);
  const first = answerWrong(run, p);
  assert.ok(first, 'the wrong answer still counts for the miss bank');
  assert.equal(run.phase, 'question', 'back to the same question');
  assert.equal(run.message, SECOND_OPINION);
  assert.equal(run.hidden.length, 1);
  assert.equal(run.wrong, 0);
  const second = answerRight(run, p);
  assert.equal(second, null, 'the retry isn’t saved');
  assert.deepEqual([run.right, run.phase], [1, 'feedback']);
});

test('quick answers and streaks score more, and slow ones are never punished', () => {
  const p = pool();
  const slow = startRun(p, 1);
  enterDoor(slow, p, slow.doors.indexOf('clinic') >= 0 ? slow.doors.indexOf('clinic') : 0);
  const room = slow.room;
  answerRight(slow, p, 60);
  const quick = startRun(p, 1);
  enterDoor(quick, p, quick.doors.indexOf(room as never));
  answerRight(quick, p, 5);
  assert.ok(quick.score > slow.score);
  assert.ok(slow.score > 0);
});

test('rest rooms help, and can’t be taken twice in a row', () => {
  const p = pool();
  let found = false;
  for (let seed = 1; seed < 100 && !found; seed++) {
    const run = startRun(p, seed);
    const door = run.doors.indexOf('break');
    if (door < 0) continue;
    found = true;
    enterDoor(run, p, door);
    assert.deepEqual([run.coffee, run.phase], [4, 'rest']);
    proceed(run, p);
    assert.ok(run.doors.every((d) => d !== 'break' && d !== 'supply'), 'this hour is work');
    run.coffee = MAX_COFFEE;
    run.doors = ['break', 'clinic'];
    enterDoor(run, p, 0);
    assert.equal(run.coffee, MAX_COFFEE);
    assert.equal(run.score, 100);
  }
  assert.ok(found);
});

test('the charts door only appears with misses to review, and draws them', () => {
  const none = pool();
  for (let seed = 1; seed < 30; seed++) assert.ok(!startRun(none, seed).doors.includes('charts'));
  const p = pool(20).map((q, i) => (i === 3 ? { ...q, priority: 3 as const } : q));
  let run: Run | null = null;
  for (let seed = 1; seed < 100 && !run; seed++) if (startRun(p, seed).doors.includes('charts')) run = startRun(p, seed);
  assert.ok(run);
  enterDoor(run, p, run.doors.indexOf('charts'));
  assert.equal(run.questionId, 'q3');
});

test('a small pool repeats rather than running dry, and a boss prefers its system', () => {
  const p = pool(3);
  const run = startRun(p, 2);
  for (let i = 0; i < 8; i++) {
    enterWork(run, p);
    assert.ok(questionOf(p, run));
    answerRight(run, p);
    proceed(run, p);
  }
  const mixed = [...pool(20), ...pool(5, { system: 'Renal' }).map((q, i) => ({ ...q, id: `r${i}` }))];
  const boss = startRun(mixed, 9, 'Renal');
  boss.hour = SHIFT_ROOMS;
  boss.phase = 'boss-intro';
  proceed(boss, mixed);
  assert.equal(questionOf(mixed, boss)?.system, 'Renal');
});

test('losing to the boss costs a coffee, but she still finished the shift', () => {
  const p = pool();
  const run = startRun(p, 9);
  run.hour = SHIFT_ROOMS;
  run.phase = 'boss-intro';
  proceed(run, p);
  for (let i = 0; i < 5; i++) {
    answerWrong(run, p);
    proceed(run, p);
  }
  assert.deepEqual([run.phase, run.won, run.bossBeaten, run.coffee], ['over', true, false, 2]);
});

test('the clock and the defib zone move through the night', () => {
  assert.deepEqual([clockFor(0), clockFor(5), clockFor(12)], ['7 pm', '12 am', '7 am']);
  assert.ok(defibZone(10) < defibZone(0));
  assert.ok(defibZone(100) >= 0.12);
});

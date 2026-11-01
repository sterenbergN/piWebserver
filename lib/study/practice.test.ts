import test from 'node:test';
import { strict as assert } from 'node:assert';
import { addDays } from '../habits/dates';
import type { GameQuestion } from './games';
import { emptyPlan } from './plan';
import {
  addCases, addGrids, addPuzzles, caseForHer, cellKey, diffScore, diffShareText, diffStats, emptyPractice, finishPuzzle, GRID_LEVELS, normalizePractice, parseCaseReply, parseDiffReply, parseGridReply,
  pickHidden, recordCaseRun, recordGrid, todaysPuzzle,
} from './practice';
import { buildCasePrompt, buildDifferentialPrompt, buildGridPrompt } from './prompt';
import { BOARD, nextQuestion, snakeQuestions, startSnake, tick, turn, type SnakeRun } from './snake';
import { addTest, emptyProgress, emptyTests, finishAttempt, parseTestReply, saveAttempt, startAttempt, StudyInputError } from './study';
import { STUDY_XP, studyXp } from './xp';

const NOW = '2026-11-02T15:00:00.000Z';
const TODAY = '2026-11-02';
let counter = 0;
const makeId = () => `p${++counter}`;

const gridReply = (over: Record<string, unknown> = {}) => JSON.stringify({
  title: 'Murmurs', course: 'Cardio', columns: ['Timing', 'Location'],
  rows: [{ name: 'Aortic stenosis', cells: ['Systolic', 'RUSB'] }, { name: 'Mitral regurgitation', cells: ['Holosystolic', 'Apex'] }, { name: 'Aortic regurgitation', cells: ['Diastolic', 'LSB'] }],
  ...over,
});

const caseReply = (over: Record<string, unknown> = {}) => JSON.stringify({
  door: { age: 58, sex: 'man', complaint: 'chest pain', vitals: 'BP 150/90, HR 100' },
  opening: 'My chest hurts.',
  script: [{ ask: 'Onset', say: 'An hour ago.' }, { ask: 'Radiation', say: 'To my left arm.' }, { ask: 'Smoking', say: 'A pack a day.' }],
  exam: [{ maneuver: 'Heart', finding: 'Regular, no murmur.' }],
  checklist: ['Asks about onset', 'Asks about radiation', 'Asks about risk factors', 'Orders an ECG'],
  diagnosis: 'Acute coronary syndrome',
  teaching: 'Get an ECG within 10 minutes.',
  ...over,
});

const puzzleReply = (answer = 'Pulmonary embolism', over: Record<string, unknown> = {}) => ({
  answer,
  clues: [{ label: 'Complaint', text: `Sudden dyspnea, case ${answer}` }, { label: 'Vitals', text: 'HR 120, SpO2 90%' }, { label: 'Exam', text: 'Clear lungs' }, { label: 'Labs', text: 'High D-dimer' }],
  options: ['Pneumonia', 'Asthma', 'Pneumothorax', 'Myocardial infarction'],
  explanation: 'Sudden dyspnea with clear lungs.',
  topic: 'Dyspnea',
  system: 'Pulmonary',
  ...over,
});

// ── Grids ────────────────────────────────────────────────────────────────────

test('a grid reply is read, with bad rows reported', () => {
  const { items } = parseGridReply(`Here:\n\`\`\`json\n${gridReply()}\n\`\`\``);
  assert.equal(items[0].title, 'Murmurs');
  assert.deepEqual(items[0].columns, ['Timing', 'Location']);
  assert.equal(items[0].rows.length, 3);

  const short = parseGridReply(gridReply({ rows: [...JSON.parse(gridReply()).rows, { name: 'Bad row', cells: ['One'] }] }));
  assert.equal(short.items[0].rows.length, 3);
  assert.match(short.problems[0], /Bad row.*1 cells, not 2/);

  const many = parseGridReply(JSON.stringify({ grids: [JSON.parse(gridReply()), JSON.parse(gridReply({ title: 'Second' }))] }));
  assert.equal(many.items.length, 2);

  assert.throws(() => parseGridReply(gridReply({ columns: ['Only one'] })), StudyInputError);
  assert.throws(() => parseGridReply(''), /Paste/);
  assert.throws(() => parseGridReply(gridReply({ rows: [{ name: 'Just one', cells: ['a', 'b'] }] })), /2 complete rows/);
});

test('hidden cells favor what she’s missed, and never hide nothing', () => {
  const data = emptyPractice();
  const [grid] = addGrids(data, parseGridReply(gridReply()).items, makeId, NOW);
  assert.equal(pickHidden(grid, GRID_LEVELS[0].share, 1).length, 2);
  assert.equal(pickHidden(grid, 1, 1).length, 6);
  assert.deepEqual(pickHidden(grid, 0.3, 5), pickHidden(grid, 0.3, 5), 'the same seed hides the same cells');

  // Know most of it, miss one, and the miss comes first.
  const results: Record<string, boolean> = {};
  grid.rows.forEach((row, r) => row.cells.forEach((_, c) => { results[cellKey(r, c)] = true; }));
  results[cellKey(2, 1)] = false;
  assert.deepEqual(recordGrid(grid, results, TODAY), { knew: 5, total: 6 });
  assert.equal(pickHidden(grid, 0.01, 3)[0], cellKey(2, 1));
  assert.deepEqual(grid.stats[cellKey(2, 1)], { seen: 1, missed: 1 });
  assert.deepEqual(grid.sessions, [{ on: TODAY, knew: 5, total: 6 }]);
});

test('recording a grid ignores cells that don’t exist', () => {
  const data = emptyPractice();
  const [grid] = addGrids(data, parseGridReply(gridReply()).items, makeId, NOW);
  assert.deepEqual(recordGrid(grid, { '9:9': true, nope: false, '0:0': 'yes' }, TODAY), { knew: 0, total: 0 });
  assert.deepEqual(grid.sessions, [], 'an empty run isn’t a session');
  assert.throws(() => recordGrid(grid, null, TODAY), /Nothing to save/);
});

// ── Mock patient ─────────────────────────────────────────────────────────────

test('a case reply is read, and its title can’t spoil the diagnosis', () => {
  const { items } = parseCaseReply(caseReply({ title: 'Acute coronary syndrome case' }));
  assert.equal(items[0].title, '58-year-old man: chest pain');
  assert.ok(!items[0].title.includes('coronary'));
  assert.equal(items[0].script.length, 3);
  assert.equal(items[0].opening, 'My chest hurts.');
});

test('a case missing its essentials says what’s missing', () => {
  assert.throws(() => parseCaseReply(caseReply({ diagnosis: '', checklist: ['one'] })), /a diagnosis, at least 3 checklist items/);
  assert.throws(() => parseCaseReply(caseReply({ door: {} })), /a chief complaint/);
  const mixed = parseCaseReply(JSON.stringify({ cases: [JSON.parse(caseReply()), { door: {} }] }));
  assert.equal(mixed.items.length, 1);
  assert.equal(mixed.problems.length, 1);
});

test('her view keeps the case’s secrets until she’s played it', () => {
  const data = emptyPractice();
  const [item] = addCases(data, parseCaseReply(caseReply()).items, makeId, NOW);
  const before = JSON.stringify(caseForHer(item));
  for (const secret of ['Acute coronary', 'To my left arm', 'Orders an ECG', 'Get an ECG']) assert.ok(!before.includes(secret), secret);
  assert.ok(before.includes('chest pain'));

  const run = recordCaseRun(item, [0, 1, 99, 'x'], 300.4, TODAY);
  assert.deepEqual([run.right, run.total, run.seconds], [2, 4, 300]);
  assert.deepEqual(run.missed, ['Asks about risk factors', 'Orders an ECG']);
  const after = caseForHer(item);
  assert.equal(after.diagnosis, 'Acute coronary syndrome');
  assert.equal(after.teaching, 'Get an ECG within 10 minutes.');
});

// ── Differential ─────────────────────────────────────────────────────────────

test('a differential reply always offers the answer, and repeats are reported', () => {
  const { items, problems } = parseDiffReply(JSON.stringify({ cases: [puzzleReply(), puzzleReply(), puzzleReply('Asthma')] }));
  assert.equal(items.length, 2);
  assert.match(problems[0], /twice/);
  assert.ok(items[0].options.includes('Pulmonary embolism'));
  assert.equal(new Set(items[1].options).size, items[1].options.length, 'the answer isn’t offered twice');
  assert.equal(items[0].system, 'Pulmonary');
  assert.throws(() => parseDiffReply(JSON.stringify(puzzleReply('X', { clues: [{ text: 'one' }] }))), /needs at least 3/);
  assert.throws(() => parseDiffReply(JSON.stringify(puzzleReply('X', { options: ['one'] }))), /3 other diagnoses/);
});

function puzzles(...answers: string[]) {
  const data = emptyPractice();
  addPuzzles(data, parseDiffReply(JSON.stringify({ cases: answers.map((a) => puzzleReply(a)) })).items, makeId, NOW);
  return data;
}

test('a case a day: today’s stays today’s, and tomorrow moves on', () => {
  const data = puzzles('One', 'Two');
  const first = todaysPuzzle(data, TODAY)!;
  assert.equal(first.puzzle.answer, 'One');
  assert.equal(first.play, null);
  finishPuzzle(data, first.puzzle.id, { cluesUsed: 2, wrong: 0, solved: true }, TODAY);
  const again = todaysPuzzle(data, TODAY)!;
  assert.equal(again.puzzle.answer, 'One', 'still today’s');
  assert.equal(again.play?.solved, true);
  assert.equal(todaysPuzzle(data, addDays(TODAY, 1))?.puzzle.answer, 'Two');
  finishPuzzle(data, data.puzzles[1].id, { cluesUsed: 1, solved: true }, addDays(TODAY, 1));
  assert.equal(todaysPuzzle(data, addDays(TODAY, 2)), null, 'out of cases');
});

test('playing twice keeps the first result', () => {
  const data = puzzles('One');
  const [p] = data.puzzles;
  const first = finishPuzzle(data, p.id, { cluesUsed: 4, solved: false }, TODAY);
  assert.equal(finishPuzzle(data, p.id, { cluesUsed: 1, solved: true }, TODAY), first);
  assert.throws(() => finishPuzzle(data, 'gone', {}, TODAY), /isn’t here/);
  assert.equal(addPuzzles(data, [{ ...p }], makeId, NOW).length, 0, 'pasting the same case adds nothing');
});

test('fewer clues score more, and a miss scores nothing', () => {
  assert.equal(diffScore(1, 4, 0, true), 500);
  assert.equal(diffScore(4, 4, 0, true), 125);
  assert.ok(diffScore(1, 4, 1, true) < diffScore(1, 4, 0, true));
  assert.equal(diffScore(4, 4, 5, true), 50, 'solving always earns something');
  assert.equal(diffScore(1, 4, 0, false), 0);
});

test('the streak counts days played, and sharing never spoils the answer', () => {
  const data = puzzles('One', 'Two', 'Three');
  const [a, b] = data.puzzles;
  finishPuzzle(data, a.id, { cluesUsed: 1, solved: true }, addDays(TODAY, -1));
  finishPuzzle(data, b.id, { cluesUsed: 4, solved: false }, TODAY);
  assert.deepEqual(diffStats(data, TODAY), { played: 2, solved: 1, best: 500, streak: 2, left: 1 });
  assert.equal(diffStats(data, addDays(TODAY, 1)).streak, 2, 'today isn’t over');
  assert.equal(diffStats(data, addDays(TODAY, 3)).streak, 0);
  const shared = diffShareText(data.plays[a.id], 4);
  assert.match(shared, /solved on clue 1 of 4/);
  assert.ok(!shared.includes('One'));
  assert.match(diffShareText(data.plays[b.id], 4), /stumped/);
  assert.deepEqual(normalizePractice(null), emptyPractice());
});

// ── The prompts ──────────────────────────────────────────────────────────────

const exampleOf = (prompt: string) => prompt.match(/```json\n([\s\S]+?)```/)![1];

test('each prompt describes a reply its parser reads', () => {
  assert.equal(parseGridReply(exampleOf(buildGridPrompt({ subject: 'Murmurs', course: 'Cardio', rows: 6 }))).items.length, 1);
  assert.equal(parseCaseReply(exampleOf(buildCasePrompt({ subject: 'Chest pain', count: 2 }))).items.length, 1);
  assert.equal(parseDiffReply(exampleOf(buildDifferentialPrompt({ subject: 'Dyspnea', count: 5, used: [] }))).items.length, 1);
});

test('the prompts ask for the right things', () => {
  const grid = buildGridPrompt({ subject: 'Murmurs', course: 'Cardio', rows: 6 });
  assert.match(grid, /Murmurs/);
  assert.match(grid, /6 rows/);
  const patient = buildCasePrompt({ subject: 'Chest pain', count: 2 });
  assert.match(patient, /2 mock patient/);
  assert.match(patient, /checklist/);
  const diff = buildDifferentialPrompt({ subject: 'Dyspnea', count: 5, used: ['Asthma', 'Pneumonia'] });
  assert.match(diff, /5 cases/);
  assert.match(diff, /Don’t use these as answers.*Asthma, Pneumonia/);
  assert.match(buildDifferentialPrompt({ count: 5, used: [] }), /my notes/);
});

// ── Study Snake ──────────────────────────────────────────────────────────────

const pool = (n = 6, over: Partial<GameQuestion> = {}): GameQuestion[] => Array.from({ length: n }, (_, i) => ({ id: `q${i}`, stem: `Q${i}`, choices: ['a', 'b', 'c', 'd', 'e'], correct: [0], explanation: 'Why', topic: 'T', priority: 1, ...over }));

/** Put a food directly ahead of the snake. */
function foodAhead(run: SnakeRun, right: boolean, p: GameQuestion[]) {
  const q = p.find((x) => x.id === run.questionId)!;
  const food = run.foods.find((f) => q.correct.includes(f.choice) === right)!;
  food.x = run.snake[0].x;
  food.y = run.snake[0].y - 1;
}

test('the snake waits for her, then eating the right food grows it', () => {
  const p = pool();
  const run = startSnake(p, 7);
  assert.equal(run.phase, 'waiting');
  assert.ok(run.foods.length <= 4);
  assert.equal(new Set(run.foods.map((f) => f.choice)).size, run.foods.length);
  assert.ok(run.foods.some((f) => f.choice === 0), 'the right answer is always on the board');
  assert.equal(tick(run, p), null);
  assert.equal(run.snake[0].y, 7, 'no moving until she turns');
  foodAhead(run, true, p);
  turn(run, 'up');
  assert.equal(run.phase, 'moving');
  const record = tick(run, p);
  assert.deepEqual(record, { questionId: run.questionId, answer: [0] });
  assert.deepEqual([run.snake.length, run.right, run.phase, run.last?.right], [4, 1, 'feedback', true]);
  assert.ok(run.score > 0);
  nextQuestion(run, p);
  assert.equal(run.phase, 'waiting');
});

test('the wrong food costs a heart and shows why', () => {
  const p = pool();
  const run = startSnake(p, 3);
  foodAhead(run, false, p);
  turn(run, 'up');
  const record = tick(run, p);
  assert.ok(record && record.answer[0] !== 0);
  assert.deepEqual([run.hearts, run.wrong, run.snake.length, run.last?.right, run.phase], [2, 1, 3, false, 'feedback']);
  assert.deepEqual(run.missed, [run.questionId]);
});

test('walls cost a heart but don’t count as a wrong answer, and three ends it', () => {
  const p = pool();
  const run = startSnake(p, 9);
  run.foods = [];
  turn(run, 'up');
  let record = null;
  for (let i = 0; i < BOARD && run.phase === 'moving'; i++) record = tick(run, p);
  assert.equal(record, null, 'nothing saved for a crash');
  assert.deepEqual([run.hearts, run.wrong, run.last?.crashed, run.phase], [2, 0, true, 'feedback']);
  nextQuestion(run, p);
  assert.deepEqual(run.snake[0], { x: 7, y: 7 }, 'back in the middle');
  run.hearts = 1;
  run.foods = [];
  turn(run, 'up');
  for (let i = 0; i < BOARD && run.phase === 'moving'; i++) tick(run, p);
  assert.equal(run.phase, 'over');
});

test('the snake can’t reverse into itself', () => {
  const p = pool();
  const run = startSnake(p, 1);
  turn(run, 'down');
  assert.deepEqual(run.queue, [], 'straight back is ignored');
  turn(run, 'left');
  turn(run, 'right');
  assert.deepEqual(run.queue, ['left'], 'nor by way of a quick double turn');
});

test('select-all questions don’t fit, and few questions just repeat', () => {
  assert.equal(snakeQuestions(pool(3, { correct: [0, 1] })).length, 0);
  const p = pool(1);
  const run = startSnake(p, 2);
  foodAhead(run, true, p);
  turn(run, 'up');
  tick(run, p);
  nextQuestion(run, p);
  assert.equal(run.questionId, 'q0');
});

// ── XP ───────────────────────────────────────────────────────────────────────

test('Study XP adds up what she did, and retaking a test doesn’t farm it', () => {
  const tests = emptyTests();
  const t = addTest(tests, parseTestReply(JSON.stringify({ questions: [{ stem: 'One?', choices: ['a', 'b'], correct: 'A', topic: 'T' }, { stem: 'Two?', choices: ['a', 'b'], correct: 'A', topic: 'T' }] })), {}, makeId, NOW);
  const progress = emptyProgress();
  const plan = emptyPlan();
  const practice = emptyPractice();
  assert.equal(studyXp(tests, progress, plan, practice), 0);

  const take = () => {
    const attempt = startAttempt(progress, t, { fresh: true }, makeId, 1, NOW);
    saveAttempt(attempt, t, { answers: { [t.questions[0].id]: [0], [t.questions[1].id]: [1] } });
    finishAttempt(progress, attempt, t, TODAY, NOW);
  };
  take();
  const base = 2 * STUDY_XP.answered + STUDY_XP.right;
  assert.equal(studyXp(tests, progress, plan, practice), base);
  progress.misses = {};
  take();
  progress.misses = {};
  assert.equal(studyXp(tests, progress, plan, practice), base, 'the same answers again earn nothing');

  plan.eatenOn[TODAY] = 3;
  plan.cleanDays = [TODAY];
  progress.games = { runs: 2, survived: 1, best: 1, bestHours: 1 };
  assert.equal(studyXp(tests, progress, plan, practice), base + 3 * STUDY_XP.pancake + STUDY_XP.cleanPlate + 2 * STUDY_XP.nightShift + STUDY_XP.nightShiftSurvived);

  const [grid] = addGrids(practice, parseGridReply(gridReply()).items, makeId, NOW);
  grid.sessions.push({ on: TODAY, knew: 1, total: 1 });
  const [item] = addCases(practice, parseCaseReply(caseReply()).items, makeId, NOW);
  recordCaseRun(item, [0], 10, TODAY);
  const before = studyXp(tests, emptyProgress(), emptyPlan(), emptyPractice());
  assert.equal(before, 0);
  assert.equal(studyXp(emptyTests(), emptyProgress(), emptyPlan(), practice), STUDY_XP.gridSession + STUDY_XP.patientRun);
});

import test from 'node:test';
import { strict as assert } from 'node:assert';
import {
  BLUEPRINT, coverageMap, deckMatch, deckRows, emptyMap, MapInputError, MIN_PROVEN, saveClass, setMatch, suggestSystem, unmatchedTags, WEIGHT_TOTAL,
  type AnkiData, type AnkiGroup,
} from './coverage';
import { addTest, emptyProgress, emptyTests, finishAttempt, parseTestReply, PANCE_SYSTEMS, saveAttempt, startAttempt, type ProgressData, type StudyTest } from './study';

const NOW = '2026-10-31T15:00:00.000Z';
const TODAY = '2026-10-31';
let counter = 0;
const makeId = () => `c${++counter}`;

const group = (over: Partial<AnkiGroup>): AnkiGroup => ({ deck: 0, tags: [], cards: 0, fresh: 0, young: 0, mature: 0, suspended: 0, lapses: 0, reviews: 0, passed: 0, graded: 0, ...over });
const anki = (decks: string[], tags: string[], groups: AnkiGroup[]): AnkiData => ({ importedAt: NOW, fileName: 'x.apkg', format: 'legacy', hasHistory: true, decks, tags, groups, leeches: [] });

function testWith(system: string | undefined, n: number, course = ''): { data: ReturnType<typeof emptyTests>; test: StudyTest } {
  const data = emptyTests();
  const questions = Array.from({ length: n }, (_, i) => ({ stem: `Q${i} ${system}`, choices: ['a', 'b'], correct: 'A', topic: i % 2 ? 'Odd' : 'Even', ...(system ? { system } : {}) }));
  const made = addTest(data, parseTestReply(JSON.stringify({ questions })), { course }, makeId, NOW);
  return { data, test: made };
}

function take(progress: ProgressData, t: StudyTest, right: number) {
  const attempt = startAttempt(progress, t, { fresh: true }, makeId, 1, NOW);
  const answers = Object.fromEntries(t.questions.map((q, i) => [q.id, [i < right ? 0 : 1]]));
  saveAttempt(attempt, t, { answers });
  finishAttempt(progress, attempt, t, TODAY, new Date(Date.parse(NOW) + progress.attempts.length * 1000).toISOString());
}

const at = (map: ReturnType<typeof coverageMap>, system: string) => map.systems.find((s) => s.system === system)!;

test('the blueprint covers every system once, with NCCPA’s 2025 weights', () => {
  assert.deepEqual(BLUEPRINT.map((b) => b.system).sort(), [...PANCE_SYSTEMS].sort());
  assert.equal(WEIGHT_TOTAL, 94);
  assert.equal(BLUEPRINT.find((b) => b.system === 'Cardiovascular')?.weight, 11);
  assert.equal(BLUEPRINT.find((b) => b.system === 'Dermatologic')?.weight, 4);
});

test('names give away their system, without false alarms', () => {
  const cases: [string, string | null][] = [
    ['Cardiology', 'Cardiovascular'], ['Endocarditis', 'Cardiovascular'], ['EKG basics', 'Cardiovascular'], ['Lung sounds', 'Pulmonary'],
    ['GI', 'Gastrointestinal/Nutritional'], ['Orthopedics', 'Musculoskeletal'], ['Orthostatic', null], ['HIV', 'Infectious Diseases'],
    ['Neuro exam', 'Neurologic'], ['Psychiatry', 'Psychiatric/Behavioral'], ['OB/GYN', 'Reproductive'], ['ENT', 'EENT'],
    ['Diabetes', 'Endocrine'], ['Anemia', 'Hematologic'], ['Nephrology', 'Renal'], ['Derm', 'Dermatologic'], ['Urology', 'Genitourinary'],
    ['Pharmacology', null], ['Clinical Medicine I', null], ['Earnings', null], ['Patient assessment', null],
  ];
  for (const [name, system] of cases) assert.equal(suggestSystem(name), system, name);
});

test('a class needs a name, and keeps only real scores and systems', () => {
  const data = emptyMap();
  const made = saveClass(data, { name: ' Cardio I ', done: true, score: '88.4', systems: ['Cardiovascular', 'Nonsense'] }, makeId);
  assert.equal(made.name, 'Cardio I');
  assert.equal(made.score, 88);
  assert.deepEqual(made.systems, ['Cardiovascular']);
  const edited = saveClass(data, { id: made.id, name: 'Cardio I', done: false, score: '140', systems: [] }, makeId);
  assert.equal(edited.id, made.id);
  assert.equal(edited.score, undefined);
  assert.equal(data.classes.length, 1);
  assert.throws(() => saveClass(data, { name: '  ' }, makeId), MapInputError);
  assert.throws(() => saveClass(data, { name: 'cardio i' }, makeId), /already have/);
});

test('matches are saved, cleared, and checked', () => {
  const data = emptyMap();
  setMatch(data, 'deck', 'PA::Pharm', 'skip');
  setMatch(data, 'tag', 'cardio', 'Cardiovascular');
  assert.equal(data.deckMatches['PA::Pharm'], 'skip');
  setMatch(data, 'deck', 'PA::Pharm', null);
  assert.equal(data.deckMatches['PA::Pharm'], undefined);
  assert.throws(() => setMatch(data, 'deck', 'x', 'Spleen'), MapInputError);
  assert.throws(() => setMatch(data, 'note', 'x', 'skip'), MapInputError);
});

test('a deck takes its own match, then its name, then its parent', () => {
  const saved = { 'PA::Mixed': 'Renal' as const, 'PA::Skip': 'skip' as const };
  assert.equal(deckMatch('PA::Mixed', saved), 'Renal');
  assert.equal(deckMatch('PA::Mixed::Week 1', saved), 'Renal', 'a child inherits');
  assert.equal(deckMatch('PA::Mixed::Cardio', saved), 'Cardiovascular', 'its own name beats its parent');
  assert.equal(deckMatch('PA::Skip::Week 1', saved), 'skip');
  assert.equal(deckMatch('PA::Unknown', saved), null);
});

test('with no evidence, the map says so, and the heaviest systems lead', () => {
  const map = coverageMap(emptyTests(), emptyProgress(), emptyMap(), null);
  assert.equal(map.hasAnyEvidence, false);
  assert.deepEqual(map.totals, { covered: 0, studied: 0, proven: 0 });
  assert.equal(map.next[0].system, 'Cardiovascular');
  assert.equal(at(map, 'Renal').note, 'Nothing here yet.');
});

test('classes only say covered, however well she did in them', () => {
  const data = emptyMap();
  saveClass(data, { name: 'Cardio', done: true, score: 95, systems: ['Cardiovascular'] }, makeId);
  saveClass(data, { name: 'Pulm', done: false, systems: ['Pulmonary'] }, makeId);
  const map = coverageMap(emptyTests(), emptyProgress(), data, null);
  assert.equal(at(map, 'Cardiovascular').covered, 'done');
  assert.equal(at(map, 'Cardiovascular').proven.level, 'none');
  assert.equal(at(map, 'Cardiovascular').studied.cards, 0);
  assert.equal(at(map, 'Pulmonary').covered, 'started');
  assert.equal(at(map, 'Renal').covered, 'none');
  assert.equal(map.totals.covered, Math.round((11 / 94) * 100));
  assert.equal(map.totals.proven, 0);
  assert.match(at(map, 'Cardiovascular').note, /Covered in class/);
});

test('Anki counts go to the matched system, once each, and "skip" stays out', () => {
  const data = anki(['Cardio', 'Pharm', 'Misc', 'Notes'], ['renal::aki', 'other'], [
    group({ deck: 0, cards: 10, fresh: 2, young: 3, mature: 5, lapses: 4, passed: 18, graded: 20, suspended: 1 }),
    // The deck wins over a tag that says otherwise.
    group({ deck: 0, tags: [0], cards: 2, mature: 2 }),
    // No deck match, so its tag decides.
    group({ deck: 1, tags: [0], cards: 6, young: 6 }),
    group({ deck: 2, tags: [1], cards: 4, fresh: 4 }),
    group({ deck: 3, cards: 7, young: 7 }),
  ]);
  const matches = emptyMap();
  setMatch(matches, 'deck', 'Notes', 'skip');
  const map = coverageMap(emptyTests(), emptyProgress(), matches, data);
  const cardio = at(map, 'Cardiovascular').studied;
  assert.deepEqual([cardio.cards, cardio.reviewed, cardio.mature, cardio.lapses, cardio.suspended], [12, 10, 7, 4, 1]);
  assert.equal(cardio.retention, 0.9);
  assert.equal(at(map, 'Renal').studied.cards, 6);
  assert.equal(at(map, 'Renal').studied.retention, null);
  assert.equal(map.systems.reduce((n, s) => n + s.studied.cards, 0), 18, 'nothing counted twice; skipped and unmatched stay out');
  assert.match(at(map, 'Cardiovascular').note, /haven’t tested/);

  const left = unmatchedTags(data, matches);
  assert.equal(left.cards, 4);
  assert.deepEqual(left.tags, [{ tag: 'other', cards: 4 }]);
  setMatch(matches, 'tag', 'other', 'Dermatologic');
  assert.equal(coverageMap(emptyTests(), emptyProgress(), matches, data).systems.find((s) => s.system === 'Dermatologic')?.studied.cards, 4);
  assert.equal(unmatchedTags(data, matches).cards, 0);
  assert.deepEqual(deckRows(data, matches).map((r) => r.name), ['Cardio', 'Misc', 'Notes', 'Pharm']);
});

test('proven takes enough recent answers, and getting better shows', () => {
  const { data, test: t } = testWith('Renal', MIN_PROVEN);
  const progress = emptyProgress();
  let map = coverageMap(data, progress, emptyMap(), null);
  assert.equal(at(map, 'Renal').proven.level, 'none');

  take(progress, t, 5);
  map = coverageMap(data, progress, emptyMap(), null);
  assert.deepEqual(at(map, 'Renal').proven, { level: 'shaky', right: 5, total: MIN_PROVEN });
  assert.equal(at(map, 'Renal').topics.length, 2);
  const before = at(map, 'Renal').gap;

  take(progress, t, 9);
  map = coverageMap(data, progress, emptyMap(), null);
  assert.deepEqual(at(map, 'Renal').proven, { level: 'solid', right: 9, total: MIN_PROVEN }, 'the latest answer to each question counts');
  assert.ok(at(map, 'Renal').gap < before);
  assert.equal(map.totals.proven, Math.round((5 / 94) * 100));

  const small = testWith('Endocrine', 3);
  take(progress, small.test, 3);
  const thin = coverageMap(small.data, progress, emptyMap(), null);
  assert.equal(at(thin, 'Endocrine').proven.level, 'thin');
  assert.match(at(thin, 'Endocrine').note, /Only 3 answers/);
});

test('a question without a system counts toward a one-system class, or says it has nowhere to go', () => {
  const { data, test: t } = testWith(undefined, 2, 'Nephrology');
  const progress = emptyProgress();
  take(progress, t, 2);
  assert.equal(coverageMap(data, progress, emptyMap(), null).unassigned, 2);
  const classes = emptyMap();
  saveClass(classes, { name: 'nephrology', systems: ['Renal'] }, makeId);
  const map = coverageMap(data, progress, classes, null);
  assert.equal(map.unassigned, 0);
  assert.equal(at(map, 'Renal').proven.total, 2);
});

test('the next suggestion moves as evidence comes in', () => {
  const { data, test: t } = testWith('Cardiovascular', 20);
  const progress = emptyProgress();
  assert.equal(coverageMap(data, progress, emptyMap(), null).next[0].system, 'Cardiovascular');
  take(progress, t, 20);
  const map = coverageMap(data, progress, emptyMap(), null);
  assert.notEqual(map.next[0].system, 'Cardiovascular');
  assert.equal(map.next[0].system, 'Pulmonary');
  assert.equal(map.next.length, 3);
  assert.equal(map.hasAnyEvidence, true);
});

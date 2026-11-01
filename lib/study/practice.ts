// The study room's drills: comparison grids filled in from memory, mock patient
// cases for OSCE practice, and Differential, a daily clue-reveal puzzle. All three
// are written by her AI from her notes and pasted in, like tests. Pure, so the
// server, the browser and the tests share it.

import { addDays, type DateKey } from '@/lib/habits/dates';
import { readReply, readSystem, StudyInputError, type PanceSystem } from './study';

const clip = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const listOf = (value: unknown) => (Array.isArray(value) ? value : []);

export type CellStat = { seen: number; missed: number };
export type CompareGrid = {
  id: string;
  title: string;
  course: string;
  columns: string[];
  rows: { name: string; cells: string[] }[];
  createdAt: string;
  /** By "row:column". */
  stats: Record<string, CellStat>;
  sessions: { on: DateKey; knew: number; total: number }[];
};

export type PatientCase = {
  id: string;
  /** Built from the door chart, so the list never gives the diagnosis away. */
  title: string;
  course: string;
  /** What she sees before walking in. */
  door: { age: string; sex: string; complaint: string; vitals: string };
  /** How the patient opens. */
  opening: string;
  /** What the patient says, only if asked. */
  script: { ask: string; say: string }[];
  /** What an exam finds, only if she examines it. */
  exam: { maneuver: string; finding: string }[];
  checklist: string[];
  diagnosis: string;
  teaching: string;
  createdAt: string;
  runs: { on: DateKey; right: number; total: number; missed: string[]; seconds: number }[];
};

export type DiffCase = {
  id: string;
  clues: { label: string; text: string }[];
  answer: string;
  options: string[];
  explanation: string;
  topic: string;
  system?: PanceSystem;
  createdAt: string;
};
export type DiffPlay = { on: DateKey; cluesUsed: number; wrong: number; solved: boolean; score: number };

export type PracticeData = {
  grids: CompareGrid[];
  cases: PatientCase[];
  puzzles: DiffCase[];
  plays: Record<string, DiffPlay>;
};

export const emptyPractice = (): PracticeData => ({ grids: [], cases: [], puzzles: [], plays: {} });
export function normalizePractice(raw: Partial<PracticeData> | null | undefined): PracticeData {
  return {
    grids: listOf(raw?.grids) as CompareGrid[],
    cases: listOf(raw?.cases) as PatientCase[],
    puzzles: listOf(raw?.puzzles) as DiffCase[],
    plays: isRecord(raw?.plays) ? (raw.plays as Record<string, DiffPlay>) : {},
  };
}

/** The list inside a reply, whether it's `{ "cases": [...] }`, a bare list, or one item by itself. */
function itemsIn(text: unknown, key: string) {
  if (typeof text !== 'string' || !text.trim()) throw new StudyInputError('Paste the AI’s reply first.');
  const { value } = readReply(text);
  if (Array.isArray(value)) return value;
  if (isRecord(value) && Array.isArray(value[key])) return value[key] as unknown[];
  if (isRecord(value) && Array.isArray(value.questions)) return value.questions as unknown[]; // What's left of a reply cut off part way.
  return [value];
}

export type Parsed<T> = { items: T[]; problems: string[] };

// ── Comparison grids ─────────────────────────────────────────────────────────

const LIMITS = { columns: 8, rows: 24, cell: 300, grids: 300, cases: 500, puzzles: 2000 };
export type DraftGrid = Pick<CompareGrid, 'title' | 'course' | 'columns' | 'rows'>;

export function parseGridReply(text: unknown): Parsed<DraftGrid> {
  const problems: string[] = [];
  const items = itemsIn(text, 'grids').flatMap((raw, i): DraftGrid[] => {
    if (!isRecord(raw)) { problems.push(`Grid ${i + 1}: not a grid.`); return []; }
    const title = clip(raw.title, 120) || `Grid ${i + 1}`;
    const columns = listOf(raw.columns).map((c) => clip(c, 80)).filter(Boolean);
    if (columns.length < 2 || columns.length > LIMITS.columns) { problems.push(`${title}: it has ${columns.length} columns (needs 2 to ${LIMITS.columns}).`); return []; }
    const rows = listOf(raw.rows).flatMap((row) => {
      if (!isRecord(row)) return [];
      const name = clip(row.name, 120);
      const cells = listOf(row.cells).map((c) => clip(c, LIMITS.cell));
      if (!name || cells.length !== columns.length) {
        problems.push(`${title}: the row "${name || 'with no name'}" has ${cells.length} cells, not ${columns.length}.`);
        return [];
      }
      return [{ name, cells }];
    }).slice(0, LIMITS.rows);
    if (rows.length < 2) { problems.push(`${title}: it needs at least 2 complete rows.`); return []; }
    return [{ title, course: clip(raw.course, 80), columns, rows }];
  });
  if (!items.length) throw new StudyInputError(`No grids could be used. ${problems.slice(0, 3).join(' ')}`);
  return { items, problems };
}

export function addGrids(data: PracticeData, drafts: DraftGrid[], makeId: () => string, now: string) {
  if (data.grids.length + drafts.length > LIMITS.grids) throw new StudyInputError('That’s as many grids as one account can keep.');
  const made = drafts.map((d): CompareGrid => ({ ...d, id: makeId(), createdAt: now, stats: {}, sessions: [] }));
  data.grids.unshift(...made);
  return made;
}

export const cellKey = (row: number, column: number) => `${row}:${column}`;

/** A line for the list. */
export function gridSummary(grid: CompareGrid) {
  const last = grid.sessions[grid.sessions.length - 1];
  return {
    id: grid.id, title: grid.title, course: grid.course, columns: grid.columns, rows: grid.rows.map((r) => r.name),
    sessions: grid.sessions.length,
    last: last ?? null,
    shaky: Object.values(grid.stats).filter((s) => s.missed > 0 && s.missed / s.seen >= 0.5).length,
  };
}
export type GridSummary = ReturnType<typeof gridSummary>;

/** How much of a grid to hide. */
export const GRID_LEVELS = [{ id: 'some', label: 'Some', share: 0.3 }, { id: 'most', label: 'Most', share: 0.6 }, { id: 'all', label: 'All', share: 1 }];

function hash(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Which cells to hide: what she's missed most, then what she hasn't seen, then the rest, in a seeded order. */
export function pickHidden(grid: CompareGrid, share: number, seed: number): string[] {
  const keys = grid.rows.flatMap((row, r) => row.cells.map((_, c) => cellKey(r, c)));
  const rank = (key: string) => {
    const stat = grid.stats[key];
    if (!stat?.seen) return 0.5;
    return stat.missed / stat.seen === 0 ? 0 : 1 + stat.missed / stat.seen;
  };
  const ordered = [...keys].sort((a, b) => rank(b) - rank(a) || hash(`${a}${seed}`) - hash(`${b}${seed}`));
  return ordered.slice(0, Math.max(1, Math.ceil(keys.length * Math.min(1, share))));
}

/** Note a run through a grid: `results` says whether she knew each cell. */
export function recordGrid(grid: CompareGrid, results: unknown, today: DateKey) {
  if (!isRecord(results)) throw new StudyInputError('Nothing to save.');
  let knew = 0;
  let total = 0;
  for (const [key, value] of Object.entries(results)) {
    const [r, c] = key.split(':').map(Number);
    if (typeof value !== 'boolean' || !grid.rows[r]?.cells[c]) continue;
    const stat = grid.stats[key] ?? { seen: 0, missed: 0 };
    stat.seen++;
    if (!value) stat.missed++;
    else knew++;
    grid.stats[key] = stat;
    total++;
  }
  if (total) grid.sessions.push({ on: today, knew, total });
  return { knew, total };
}

// ── Mock patient ─────────────────────────────────────────────────────────────

export type DraftCase = Omit<PatientCase, 'id' | 'createdAt' | 'runs'>;

export function parseCaseReply(text: unknown): Parsed<DraftCase> {
  const problems: string[] = [];
  const items = itemsIn(text, 'cases').flatMap((raw, i): DraftCase[] => {
    if (!isRecord(raw)) { problems.push(`Case ${i + 1}: not a case.`); return []; }
    const door = isRecord(raw.door) ? raw.door : {};
    const complaint = clip(door.complaint, 200);
    const age = clip(typeof door.age === 'number' ? String(door.age) : door.age, 20);
    const sex = clip(door.sex, 30);
    const diagnosis = clip(raw.diagnosis, 200);
    const script = listOf(raw.script).flatMap((s) => (isRecord(s) && clip(s.ask, 200) && clip(s.say, 600) ? [{ ask: clip(s.ask, 200), say: clip(s.say, 600) }] : [])).slice(0, 40);
    const exam = listOf(raw.exam).flatMap((s) => (isRecord(s) && clip(s.maneuver, 200) && clip(s.finding, 400) ? [{ maneuver: clip(s.maneuver, 200), finding: clip(s.finding, 400) }] : [])).slice(0, 30);
    const checklist = listOf(raw.checklist).map((c) => clip(c, 200)).filter(Boolean).slice(0, 40);
    const missing = [!complaint && 'a chief complaint', !diagnosis && 'a diagnosis', script.length < 3 && 'at least 3 history answers', checklist.length < 3 && 'at least 3 checklist items'].filter(Boolean);
    if (missing.length) { problems.push(`Case ${i + 1}: it needs ${missing.join(', ')}.`); return []; }
    return [{
      title: `${[age && `${age}-year-old`, sex].filter(Boolean).join(' ')}${age || sex ? ': ' : ''}${complaint}`,
      course: clip(raw.course, 80),
      door: { age, sex, complaint, vitals: clip(door.vitals, 300) },
      opening: clip(raw.opening, 400) || complaint,
      script, exam, checklist, diagnosis,
      teaching: clip(raw.teaching, 2000),
    }];
  });
  if (!items.length) throw new StudyInputError(`No cases could be used. ${problems.slice(0, 3).join(' ')}`);
  return { items, problems };
}

export function addCases(data: PracticeData, drafts: DraftCase[], makeId: () => string, now: string) {
  if (data.cases.length + drafts.length > LIMITS.cases) throw new StudyInputError('That’s as many cases as one account can keep.');
  const made = drafts.map((d): PatientCase => ({ ...d, id: makeId(), createdAt: now, runs: [] }));
  data.cases.unshift(...made);
  return made;
}

/** A case with nothing that would spoil it, for her own lists. The answers wait until she's played it. */
export function caseForHer(item: PatientCase) {
  const played = item.runs.length > 0;
  return {
    id: item.id, title: item.title, course: item.course, door: item.door, createdAt: item.createdAt, runs: item.runs,
    ...(played ? { diagnosis: item.diagnosis, teaching: item.teaching } : {}),
  };
}
export type PatientCaseForHer = ReturnType<typeof caseForHer>;

/** Score a run from the items the other person ticked. */
export function recordCaseRun(item: PatientCase, ticked: unknown, seconds: unknown, today: DateKey) {
  const set = new Set(listOf(ticked).filter((n): n is number => Number.isInteger(n)));
  const missed = item.checklist.filter((_, i) => !set.has(i));
  const run = { on: today, right: item.checklist.length - missed.length, total: item.checklist.length, missed, seconds: Math.max(0, Math.min(7200, Math.round(Number(seconds) || 0))) };
  item.runs.push(run);
  return run;
}

// ── Differential ─────────────────────────────────────────────────────────────

export type DraftPuzzle = Omit<DiffCase, 'id' | 'createdAt'>;
const MIN_CLUES = 3;
const MAX_CLUES = 6;
export const MAX_DIFF_SCORE = 500;

export function parseDiffReply(text: unknown): Parsed<DraftPuzzle> {
  const problems: string[] = [];
  const seen = new Set<string>();
  const items = itemsIn(text, 'cases').flatMap((raw, i): DraftPuzzle[] => {
    if (!isRecord(raw)) { problems.push(`Case ${i + 1}: not a case.`); return []; }
    const answer = clip(raw.answer, 120);
    const clues = listOf(raw.clues).flatMap((c) => (isRecord(c) && clip(c.text, 400) ? [{ label: clip(c.label, 40) || 'Clue', text: clip(c.text, 400) }] : [])).slice(0, MAX_CLUES);
    if (!answer) { problems.push(`Case ${i + 1}: it has no answer.`); return []; }
    if (clues.length < MIN_CLUES) { problems.push(`Case ${i + 1}: it has ${clues.length} clues (needs at least ${MIN_CLUES}).`); return []; }
    const options = [...new Set([...listOf(raw.options).map((o) => clip(o, 120)).filter(Boolean)].filter((o) => o.toLowerCase() !== answer.toLowerCase()))].slice(0, 7);
    if (options.length < 3) { problems.push(`${answer}: it needs at least 3 other diagnoses to choose from.`); return []; }
    const key = `${answer}|${clues[0].text}`.toLowerCase();
    if (seen.has(key)) { problems.push(`${answer}: it’s in there twice.`); return []; }
    seen.add(key);
    const system = readSystem(raw.system);
    return [{ clues, answer, options: [...options, answer], explanation: clip(raw.explanation, 2000), topic: clip(raw.topic, 80) || answer, ...(system ? { system } : {}) }];
  });
  if (!items.length) throw new StudyInputError(`No cases could be used. ${problems.slice(0, 3).join(' ')}`);
  return { items, problems };
}

export function addPuzzles(data: PracticeData, drafts: DraftPuzzle[], makeId: () => string, now: string) {
  if (data.puzzles.length + drafts.length > LIMITS.puzzles) throw new StudyInputError('That’s as many cases as one account can keep.');
  const fresh = drafts.filter((d) => !data.puzzles.some((p) => p.answer.toLowerCase() === d.answer.toLowerCase() && p.clues[0]?.text.toLowerCase() === d.clues[0]?.text.toLowerCase()));
  // Oldest first, so the daily case works through them in order.
  const made = fresh.map((d): DiffCase => ({ ...d, id: makeId(), createdAt: now }));
  data.puzzles.push(...made);
  return made;
}

/** The choices in an order fixed for each case, so the answer isn't always last. */
export const diffOptions = (puzzle: Pick<DiffCase, 'id' | 'options'>) => [...puzzle.options].sort((a, b) => hash(`${puzzle.id}${a}`) - hash(`${puzzle.id}${b}`));

/** Another case on top of today's, for when one isn't enough. */
export function nextPuzzle(data: PracticeData) {
  const next = data.puzzles.find((p) => !data.plays[p.id]);
  return next ? { puzzle: next, play: null } : null;
}

/** Today's case: the one she played today, or the next she hasn't. */
export function todaysPuzzle(data: PracticeData, today: DateKey) {
  const played = data.puzzles.find((p) => data.plays[p.id]?.on === today);
  if (played) return { puzzle: played, play: data.plays[played.id] };
  const next = data.puzzles.find((p) => !data.plays[p.id]);
  return next ? { puzzle: next, play: null } : null;
}

/** Fewer clues scores more, and each wrong guess costs a little. A miss scores nothing. */
export function diffScore(cluesUsed: number, totalClues: number, wrong: number, solved: boolean) {
  if (!solved) return 0;
  const clueShare = (totalClues - Math.max(1, cluesUsed) + 1) / totalClues;
  return Math.max(50, Math.round(MAX_DIFF_SCORE * clueShare) - wrong * 50);
}

export function finishPuzzle(data: PracticeData, id: unknown, input: { cluesUsed?: unknown; wrong?: unknown; solved?: unknown }, today: DateKey) {
  const puzzle = data.puzzles.find((p) => p.id === id);
  if (!puzzle) throw new StudyInputError('That case isn’t here any more.', 'missing');
  if (data.plays[puzzle.id]) return data.plays[puzzle.id];
  const cluesUsed = Math.max(1, Math.min(puzzle.clues.length, Math.round(Number(input.cluesUsed) || 1)));
  const wrong = Math.max(0, Math.round(Number(input.wrong) || 0));
  const solved = input.solved === true;
  const play: DiffPlay = { on: today, cluesUsed, wrong, solved, score: diffScore(cluesUsed, puzzle.clues.length, wrong, solved) };
  data.plays[puzzle.id] = play;
  return play;
}

export function diffStats(data: PracticeData, today: DateKey) {
  const plays = Object.values(data.plays);
  const days = new Set(plays.map((p) => p.on));
  let streak = 0;
  for (let d = days.has(today) ? today : addDays(today, -1); days.has(d); d = addDays(d, -1)) streak++;
  return {
    played: plays.length,
    solved: plays.filter((p) => p.solved).length,
    best: plays.reduce((n, p) => Math.max(n, p.score), 0),
    streak,
    left: data.puzzles.filter((p) => !data.plays[p.id]).length,
  };
}

/** A result to share, with nothing in it that spoils the case. */
export function diffShareText(play: DiffPlay, totalClues: number) {
  const squares = Array.from({ length: totalClues }, (_, i) => (i < play.cluesUsed ? '🟦' : '⬜')).join('');
  return play.solved ? `🩺 Differential: solved on clue ${play.cluesUsed} of ${totalClues}, ${play.score} points\n${squares}` : `🩺 Differential: stumped after ${totalClues} clues\n${squares}`;
}

/** A time on the mock patient's clock. */
export const formatSeconds = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

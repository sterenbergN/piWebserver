// The PANCE coverage map. It keeps three kinds of evidence apart, so nothing
// claims she knows a topic just because it was taught: covered (classes she's
// finished), studied (from her Anki export) and proven (results on tests here).
// Pure, so the server, the browser and the tests share it.

import { PANCE_SYSTEMS, scoreAttempt, type PanceSystem, type ProgressData, type TestsData } from './study';

/**
 * NCCPA's 2025 blueprint, "% distribution of content by organ system" (from
 * NCCPA's "PANCE at a Glance" slides). These add up to 94. The slides don't say
 * where the rest goes, so percentages of "the blueprint" here are out of WEIGHT_TOTAL.
 */
export const BLUEPRINT: { system: PanceSystem; label: string; weight: number }[] = [
  { system: 'Cardiovascular', label: 'Cardiovascular', weight: 11 },
  { system: 'Pulmonary', label: 'Pulmonary', weight: 9 },
  { system: 'Gastrointestinal/Nutritional', label: 'Gastrointestinal & nutrition', weight: 8 },
  { system: 'Musculoskeletal', label: 'Musculoskeletal', weight: 8 },
  { system: 'Infectious Diseases', label: 'Infectious diseases', weight: 7 },
  { system: 'Neurologic', label: 'Neurologic', weight: 7 },
  { system: 'Psychiatric/Behavioral', label: 'Psychiatry & behavioral science', weight: 7 },
  { system: 'Reproductive', label: 'Reproductive', weight: 7 },
  { system: 'EENT', label: 'Eyes, ears, nose & throat', weight: 6 },
  { system: 'Endocrine', label: 'Endocrine', weight: 6 },
  { system: 'Hematologic', label: 'Hematologic', weight: 5 },
  { system: 'Renal', label: 'Renal', weight: 5 },
  { system: 'Dermatologic', label: 'Dermatologic', weight: 4 },
  { system: 'Genitourinary', label: 'Genitourinary', weight: 4 },
];
export const WEIGHT_TOTAL = BLUEPRINT.reduce((sum, b) => sum + b.weight, 0);

/** Words in a deck, tag or class name that give away its organ system. First match wins, so the specific ones come first. */
const KEYWORDS: [PanceSystem, RegExp][] = [
  ['Cardiovascular', /cardi|heart|\be[ck]g\b|arrhythm|hypertens|valv|vascular|coronary/i],
  ['Pulmonary', /pulm|lung|respir|asthma|copd|pneumo/i],
  ['Gastrointestinal/Nutritional', /gastro|\bgi\b|hepat|liver|bowel|nutrition|pancrea/i],
  ['Musculoskeletal', /musculo|\bmsk\b|ortho(?!st)|rheum|\bbones?\b|\bjoints?\b|\bspine\b/i],
  ['Infectious Diseases', /infect|\bid\b|microbio|antibio|antimicrob|\bvir(al|us)|bacter|fung|parasit|\bhiv\b/i],
  ['Neurologic', /neuro|stroke|seizure|headache|\bbrain\b/i],
  ['Psychiatric/Behavioral', /psych|behavio|mental health|depress|anxiety|bipolar/i],
  ['Reproductive', /repro|ob.?gyn|obstet|gyne|women'?s health|pregnan|\bbreast\b/i],
  ['EENT', /\beent\b|\bent\b|ophth|otolar|\beyes?\b|\bears?\b|\bnose\b|\bthroat\b/i],
  ['Endocrine', /endocrin|diabet|thyroid|adrenal|pituit/i],
  ['Hematologic', /h(a)?emat|h(a)?emo|anemia|coag|oncolog|leuk|lymphom/i],
  ['Renal', /renal|nephro|kidney|acid.?base|electrolyte|dialysis/i],
  ['Dermatologic', /derm|\bskin\b|\brash/i],
  ['Genitourinary', /genitourin|\bgu\b|urolog|prostat|bladder/i],
];

export function suggestSystem(name: string): PanceSystem | null {
  return KEYWORDS.find(([, words]) => words.test(name))?.[0] ?? null;
}

// ── Classes and matches ──────────────────────────────────────────────────────

export type ClassEntry = {
  id: string;
  name: string;
  done: boolean;
  /** Her exam average, 0–100, if she wants to give one. */
  score?: number;
  systems: PanceSystem[];
};

/** A saved match: an organ system, or "skip" for what isn't on the PANCE. */
export type Match = PanceSystem | 'skip';
export type MapData = { classes: ClassEntry[]; deckMatches: Record<string, Match>; tagMatches: Record<string, Match> };

export const emptyMap = (): MapData => ({ classes: [], deckMatches: {}, tagMatches: {} });
export function normalizeMap(raw: Partial<MapData> | null | undefined): MapData {
  return {
    classes: Array.isArray(raw?.classes) ? raw.classes : [],
    deckMatches: raw?.deckMatches && typeof raw.deckMatches === 'object' ? raw.deckMatches : {},
    tagMatches: raw?.tagMatches && typeof raw.tagMatches === 'object' ? raw.tagMatches : {},
  };
}

export class MapInputError extends Error {}

const MAX_CLASSES = 100;
const cleanSystems = (value: unknown) => (Array.isArray(value) ? PANCE_SYSTEMS.filter((s) => value.includes(s)) : []);

export function saveClass(data: MapData, input: { id?: unknown; name?: unknown; done?: unknown; score?: unknown; systems?: unknown }, makeId: () => string) {
  const name = typeof input.name === 'string' ? input.name.trim().slice(0, 80) : '';
  if (!name) throw new MapInputError('Give the class a name.');
  const existing = data.classes.find((c) => c.id === input.id);
  if (data.classes.some((c) => c !== existing && c.name.toLowerCase() === name.toLowerCase())) throw new MapInputError('You already have a class with that name.');
  if (!existing && data.classes.length >= MAX_CLASSES) throw new MapInputError('That’s as many classes as one account can keep.');
  const number = input.score === '' || input.score === null || input.score === undefined ? NaN : Number(input.score);
  const entry: ClassEntry = {
    id: existing?.id ?? makeId(),
    name,
    done: input.done === true,
    systems: cleanSystems(input.systems),
    ...(Number.isFinite(number) && number >= 0 && number <= 100 ? { score: Math.round(number) } : {}),
  };
  if (existing) data.classes[data.classes.indexOf(existing)] = entry;
  else data.classes.push(entry);
  return entry;
}

export function setMatch(data: MapData, kind: unknown, name: unknown, value: unknown) {
  const target = kind === 'tag' ? data.tagMatches : kind === 'deck' ? data.deckMatches : null;
  if (!target || typeof name !== 'string' || !name || name.length > 300) throw new MapInputError('That can’t be matched.');
  if (value === null || value === '') delete target[name];
  else if (value === 'skip' || PANCE_SYSTEMS.includes(value as PanceSystem)) target[name] = value as Match;
  else throw new MapInputError('That isn’t an organ system.');
}

// ── What the Anki import keeps ───────────────────────────────────────────────

/** Cards that share a deck and tags, added up. Grouping keeps the file small, and lets a changed match recount without a new import. */
export type AnkiGroup = {
  deck: number;
  tags: number[];
  cards: number;
  /** Never reviewed. */
  fresh: number;
  /** Reviewed, with an interval under 21 days. */
  young: number;
  /** Interval of 21 days or more, which is what Anki calls mature. */
  mature: number;
  suspended: number;
  lapses: number;
  reviews: number;
  /** Review-card answers that passed, out of how many. Anki's "retention". */
  passed: number;
  graded: number;
  lastReview?: string;
};
export type AnkiLeech = { deck: number; tags: number[]; front: string; back: string; lapses: number };
export type AnkiData = {
  importedAt: string;
  fileName: string;
  format: 'modern' | 'legacy';
  /** False when the export left out scheduling, so every card looks brand new. */
  hasHistory: boolean;
  decks: string[];
  tags: string[];
  groups: AnkiGroup[];
  leeches: AnkiLeech[];
};

/** A deck's system: its own saved match, then what its name says, then its parent's. */
export function deckMatch(deck: string, matches: Record<string, Match>): Match | null {
  const parts = deck.split('::');
  for (let i = parts.length; i > 0; i--) {
    const saved = matches[parts.slice(0, i).join('::')];
    if (saved) return saved;
    const guess = suggestSystem(parts[i - 1]);
    if (guess) return guess;
  }
  return null;
}

const tagMatch = (tag: string, matches: Record<string, Match>): Match | null => matches[tag] ?? suggestSystem(tag);

/** Which system a group of cards counts toward: its deck first, then its tags. Null means she hasn't said. */
function groupMatch(group: AnkiGroup, anki: AnkiData, map: MapData): Match | null {
  const byDeck = deckMatch(anki.decks[group.deck] ?? '', map.deckMatches);
  if (byDeck) return byDeck;
  for (const index of group.tags) {
    const byTag = tagMatch(anki.tags[index] ?? '', map.tagMatches);
    if (byTag) return byTag;
  }
  return null;
}

export type DeckRow = { name: string; depth: number; cards: number; reviewed: number; match: Match | null; saved: boolean };

/** Every deck and its parents, in tree order, for matching. Cards count toward each deck above them too. */
export function deckRows(anki: AnkiData, map: MapData): DeckRow[] {
  const totals = new Map<string, { cards: number; reviewed: number }>();
  for (const group of anki.groups) {
    const parts = (anki.decks[group.deck] ?? '').split('::');
    for (let i = 1; i <= parts.length; i++) {
      const name = parts.slice(0, i).join('::');
      const total = totals.get(name) ?? { cards: 0, reviewed: 0 };
      total.cards += group.cards;
      total.reviewed += group.cards - group.fresh;
      totals.set(name, total);
    }
  }
  return [...totals.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, total]) => ({
    name,
    depth: name.split('::').length - 1,
    ...total,
    match: deckMatch(name, map.deckMatches),
    saved: !!map.deckMatches[name],
  }));
}

/** The commonest tags on cards nothing has matched yet: where a match would help most. */
export function unmatchedTags(anki: AnkiData, map: MapData, limit = 15) {
  const counts = new Map<string, number>();
  let cards = 0;
  for (const group of anki.groups) {
    if (groupMatch(group, anki, map)) continue;
    cards += group.cards;
    for (const index of group.tags) {
      const tag = anki.tags[index];
      if (tag) counts.set(tag, (counts.get(tag) ?? 0) + group.cards);
    }
  }
  return { cards, tags: [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([tag, count]) => ({ tag, cards: count })) };
}

// ── The map ──────────────────────────────────────────────────────────────────

/** Fewer answers than this says too little to call a system proven either way. */
export const MIN_PROVEN = 10;
const SOLID = 0.75;

export type ProvenLevel = 'none' | 'thin' | 'shaky' | 'solid';
export type TopicResult = { topic: string; right: number; total: number };
export type SystemCoverage = {
  system: PanceSystem;
  label: string;
  weight: number;
  covered: 'none' | 'started' | 'done';
  classes: { name: string; done: boolean; score?: number }[];
  studied: { cards: number; reviewed: number; mature: number; lapses: number; retention: number | null; suspended: number };
  proven: { level: ProvenLevel; right: number; total: number };
  topics: TopicResult[];
  /** Higher means more of the exam with less behind it. A nudge for what to do next, not a prediction of a score. */
  gap: number;
  /** One line on why it sits where it does. */
  note: string;
};

export type CoverageMap = {
  systems: SystemCoverage[];
  /** Each out of the blueprint, by weight, 0–100. */
  totals: { covered: number; studied: number; proven: number };
  /** Where to look next, biggest gap first. */
  next: SystemCoverage[];
  /** Answers on questions with no organ system to count toward. */
  unassigned: number;
  hasAnyEvidence: boolean;
};

function noteFor(c: Pick<SystemCoverage, 'covered' | 'studied' | 'proven'>) {
  const { covered, studied, proven } = c;
  if (proven.level === 'solid') return 'Your test results here are strong.';
  if (proven.level === 'shaky') return 'Your test results here have room to grow.';
  if (covered === 'none' && !studied.reviewed && !proven.total) return 'Nothing here yet.';
  if (proven.level === 'thin') return `Only ${proven.total} answer${proven.total === 1 ? '' : 's'} so far. A test would say more.`;
  if (studied.reviewed) return 'You’ve studied this, but haven’t tested it here yet.';
  if (covered === 'done') return 'Covered in class, but nothing shows how it stuck yet.';
  return 'In progress, with nothing tested yet.';
}

export function coverageMap(tests: TestsData, progress: ProgressData, map: MapData, anki: AnkiData | null): CoverageMap {
  // A question with no system counts toward its class, if that class is about just one.
  const classSystem = new Map(map.classes.filter((c) => c.systems.length === 1).map((c) => [c.name.toLowerCase(), c.systems[0]]));

  // The latest answer to each question, so getting better shows.
  const finished = progress.attempts.filter((a) => a.finishedAt).sort((a, b) => String(a.finishedAt).localeCompare(String(b.finishedAt)));
  const byId = new Map(tests.tests.map((t) => [t.id, t]));
  const latest = new Map<string, { system?: PanceSystem; topic: string; right: boolean }>();
  for (const attempt of finished) {
    const test = byId.get(attempt.testId);
    if (!test) continue;
    for (const { question, right } of scoreAttempt(attempt, test).results) {
      latest.set(question.id, { system: question.system ?? classSystem.get(test.course.toLowerCase()), topic: question.topic, right });
    }
  }

  const studied = new Map<PanceSystem, SystemCoverage['studied'] & { passed: number; graded: number }>();
  if (anki) {
    for (const group of anki.groups) {
      const match = groupMatch(group, anki, map);
      if (!match || match === 'skip') continue;
      const s = studied.get(match) ?? { cards: 0, reviewed: 0, mature: 0, lapses: 0, retention: null, suspended: 0, passed: 0, graded: 0 };
      s.cards += group.cards;
      s.reviewed += group.cards - group.fresh;
      s.mature += group.mature;
      s.lapses += group.lapses;
      s.suspended += group.suspended;
      s.passed += group.passed;
      s.graded += group.graded;
      studied.set(match, s);
    }
  }

  const systems = BLUEPRINT.map(({ system, label, weight }): SystemCoverage => {
    const classes = map.classes.filter((c) => c.systems.includes(system));
    const covered: SystemCoverage['covered'] = classes.some((c) => c.done) ? 'done' : classes.length ? 'started' : 'none';
    const answers = [...latest.values()].filter((a) => a.system === system);
    const right = answers.filter((a) => a.right).length;
    const total = answers.length;
    const level: ProvenLevel = !total ? 'none' : total < MIN_PROVEN ? 'thin' : right / total >= SOLID ? 'solid' : 'shaky';

    const topics = new Map<string, TopicResult>();
    for (const a of answers) {
      const t = topics.get(a.topic) ?? { topic: a.topic, right: 0, total: 0 };
      t.total++;
      if (a.right) t.right++;
      topics.set(a.topic, t);
    }

    const s = studied.get(system);
    const study: SystemCoverage['studied'] = s
      ? { cards: s.cards, reviewed: s.reviewed, mature: s.mature, lapses: s.lapses, suspended: s.suspended, retention: s.graded ? s.passed / s.graded : null }
      : { cards: 0, reviewed: 0, mature: 0, lapses: 0, retention: null, suspended: 0 };

    // Tests count most, since they're the only evidence of recall under exam conditions.
    const testShare = total ? (right / total) * Math.min(1, total / MIN_PROVEN) : 0;
    const studyShare = study.cards ? study.mature / study.cards : 0;
    const coverShare = covered === 'done' ? 1 : covered === 'started' ? 0.5 : 0;
    const readiness = 0.5 * testShare + 0.3 * studyShare + 0.2 * coverShare;

    const entry = {
      system, label, weight, covered,
      classes: classes.map((c) => ({ name: c.name, done: c.done, ...(c.score !== undefined ? { score: c.score } : {}) })),
      studied: study,
      proven: { level, right, total },
      topics: [...topics.values()].sort((a, b) => a.right / a.total - b.right / b.total || b.total - a.total),
      gap: weight * (1 - readiness),
    };
    return { ...entry, note: noteFor(entry) };
  });

  const share = (test: (c: SystemCoverage) => boolean) => Math.round((systems.filter(test).reduce((sum, c) => sum + c.weight, 0) / WEIGHT_TOTAL) * 100);
  return {
    systems,
    totals: {
      covered: share((c) => c.covered === 'done'),
      studied: share((c) => c.studied.reviewed > 0),
      proven: share((c) => c.proven.level === 'solid'),
    },
    next: [...systems].sort((a, b) => b.gap - a.gap).slice(0, 3),
    unassigned: [...latest.values()].filter((a) => !a.system).length,
    hasAnyEvidence: map.classes.length > 0 || !!anki || latest.size > 0,
  };
}

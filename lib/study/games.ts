// What the study games play with, and what they leave behind. A game draws from
// her tests and leans on what she's been missing. Each answer counts like a
// review: a miss goes in the bank, and getting a due one right moves it along.
// Pure, so the server, the browser and the tests share it.

import type { DateKey } from '@/lib/habits/dates';
import type { AnkiData } from './coverage';
import { mathToPlain } from './math';
import { isRight, recordGameMiss, moveMissAlong, type PanceSystem, type ProgressData, type StudyQuestion, type TestsData } from './study';

export type GameQuestion = Pick<StudyQuestion, 'id' | 'stem' | 'choices' | 'correct' | 'explanation' | 'whyWrong' | 'quote' | 'topic' | 'system'> & {
  /** Which test it's from. Cards from Anki have none, so their answers aren't saved. */
  testId?: string;
  /** 3: due for review. 2: in the miss bank. 1: everything else. */
  priority: 1 | 2 | 3;
};

export type PoolFilter = { course?: unknown; system?: unknown; missesOnly?: unknown };

export function gamePool(tests: TestsData, progress: ProgressData, filter: PoolFilter, today: DateKey): GameQuestion[] {
  const course = typeof filter.course === 'string' ? filter.course : '';
  const system = typeof filter.system === 'string' ? filter.system : '';
  return tests.tests.flatMap((test) => {
    if (course && test.course !== course) return [];
    return test.questions.flatMap((q): GameQuestion[] => {
      if (system && q.system !== system) return [];
      const miss = progress.misses[q.id];
      const active = miss?.state === 'active';
      if (filter.missesOnly === true && !active) return [];
      return [{
        id: q.id, stem: q.stem, choices: q.choices, correct: q.correct, explanation: q.explanation, topic: q.topic, testId: test.id,
        priority: active && miss.dueOn <= today ? 3 : active ? 2 : 1,
        ...(q.whyWrong ? { whyWrong: q.whyWrong } : {}),
        ...(q.quote ? { quote: q.quote } : {}),
        ...(q.system ? { system: q.system } : {}),
      }];
    });
  });
}

/** The organ system she's doing worst in, from her latest answers, for the boss to go after. */
export function weakestSystem(pool: GameQuestion[], tests: TestsData, progress: ProgressData): PanceSystem | null {
  const results = new Map<string, boolean>();
  for (const attempt of [...progress.attempts].filter((a) => a.finishedAt).sort((a, b) => String(a.finishedAt).localeCompare(String(b.finishedAt)))) {
    const test = tests.tests.find((t) => t.id === attempt.testId);
    if (!test) continue;
    for (const q of test.questions) if (attempt.questionIds.includes(q.id)) results.set(q.id, isRight(q, attempt.answers[q.id]));
  }
  const tally = new Map<PanceSystem, { right: number; total: number; available: number }>();
  for (const q of pool) {
    if (!q.system) continue;
    const t = tally.get(q.system) ?? { right: 0, total: 0, available: 0 };
    t.available++;
    const result = results.get(q.id);
    if (result !== undefined) {
      t.total++;
      if (result) t.right++;
    }
    tally.set(q.system, t);
  }
  const ranked = [...tally.entries()].filter(([, t]) => t.available >= 3);
  ranked.sort(([, a], [, b]) => (a.total ? a.right / a.total : 0.5) - (b.total ? b.right / b.total : 0.5) || b.available - a.available);
  return ranked[0]?.[0] ?? null;
}

function shuffled<T>(list: T[], random: () => number) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const clozeAnswer = /\[([^\]]+)\]/;

/** The cards she keeps forgetting, as questions. Cards have no wrong answers, so they borrow them from the other cards, from the same deck when they can. */
export function ankiQuestions(anki: AnkiData | null, random = Math.random): GameQuestion[] {
  if (!anki) return [];
  const cards = anki.leeches.flatMap((card, i) => {
    const cloze = !card.back ? card.front.match(clozeAnswer) : null;
    const answer = (card.back || cloze?.[1] || '').trim();
    if (!answer || answer.length > 200) return [];
    return [{ key: `anki-${i}`, deck: card.deck, answer, stem: cloze ? card.front.replace(clozeAnswer, '_____') : card.front }];
  });
  const answers = [...new Set(cards.map((c) => c.answer))];
  if (answers.length < 4) return [];
  return cards.map((card): GameQuestion => {
    const same = cards.filter((c) => c.deck === card.deck && c.answer !== card.answer).map((c) => c.answer);
    const others = answers.filter((a) => a !== card.answer && !same.includes(a));
    const wrong = [...new Set([...shuffled(same, random), ...shuffled(others, random)])].slice(0, 3);
    const choices = shuffled([card.answer, ...wrong], random);
    return {
      id: card.key,
      stem: card.stem,
      choices,
      correct: [choices.indexOf(card.answer)],
      explanation: `From your Anki deck, ${anki.decks[card.deck] ?? 'a card you keep forgetting'}. This is one you keep forgetting.`,
      topic: 'Anki',
      priority: 2,
    };
  });
}

/** One question for the party game: four choices at most, one right answer, and the way back to the real question. */
export type TriviaStudyQuestion = {
  question: string;
  choices: string[];
  answer: number;
  category?: string;
  explanation?: string;
  studyId: string;
  /** Original choice index for each one shown. */
  choiceMap: number[];
};

/** Rooms need this many different questions to get through a whole game. */
export const MIN_TRIVIA_QUESTIONS = 11;
const TRIVIA_DECK_SIZE = 31;

/** Her questions for Trivia Death, what she's missing first. Select-all questions don't fit a one-tap game. */
export function triviaDeck(pool: GameQuestion[], random = Math.random): TriviaStudyQuestion[] {
  const usable = pool.filter((q) => q.correct.length === 1 && q.choices.length >= 2 && q.testId);
  const ordered = [...shuffled(usable.filter((q) => q.priority > 1), random), ...shuffled(usable.filter((q) => q.priority === 1), random)].slice(0, TRIVIA_DECK_SIZE);
  // Misses come first in the draw, but shouldn't all land in the first rounds.
  const cards = shuffled(ordered, random).map((q): TriviaStudyQuestion => {
    const wrong = shuffled(q.choices.map((_, i) => i).filter((i) => i !== q.correct[0]), random).slice(0, 3);
    const choiceMap = shuffled([q.correct[0], ...wrong], random);
    return {
      // Party screens show plain text, so math is flattened to something readable.
      question: mathToPlain(q.stem),
      choices: choiceMap.map((i) => mathToPlain(q.choices[i])),
      answer: choiceMap.indexOf(q.correct[0]),
      ...(q.topic && q.topic !== 'General' ? { category: q.topic } : {}),
      ...(q.explanation ? { explanation: mathToPlain(q.explanation) } : {}),
      studyId: q.id,
      choiceMap,
    };
  });
  // The game always asks for a full deck: repeat if she has fewer.
  return cards.length ? Array.from({ length: TRIVIA_DECK_SIZE }, (_, i) => cards[i % cards.length]) : [];
}

/** One answer from a game: remembered for the map, and counted like a review. */
export function recordGameAnswer(progress: ProgressData, question: StudyQuestion, testId: string, answer: number[], today: DateKey, now: string) {
  const right = isRight(question, answer);
  progress.gameAnswers[question.id] = { testId, answer, at: now };
  if (!right) recordGameMiss(progress, testId, question.id, today);
  else moveMissAlong(progress, question.id, today);
  return right;
}

export type GameStats = { runs: number; survived: number; best: number; bestHours: number; lastOn?: DateKey };
export const emptyGameStats = (): GameStats => ({ runs: 0, survived: 0, best: 0, bestHours: 0 });

/** Note a finished run. The numbers come from the browser, so they're only ever hers to fool herself with. */
export function recordRun(progress: ProgressData, input: { score?: unknown; hours?: unknown; survived?: unknown }, today: DateKey) {
  const stats = progress.games ?? emptyGameStats();
  const score = Math.max(0, Math.min(10_000_000, Math.round(Number(input.score) || 0)));
  const hours = Math.max(0, Math.min(12, Math.round(Number(input.hours) || 0)));
  const isBest = score > stats.best;
  if (!progress.reviewDays.includes(today)) progress.reviewDays.push(today);
  progress.games = {
    runs: stats.runs + 1,
    survived: stats.survived + (input.survived === true ? 1 : 0),
    best: Math.max(stats.best, score),
    bestHours: Math.max(stats.bestHours, hours),
    lastOn: today,
  };
  return { stats: progress.games, isBest };
}

/** Rank by best score, for a little something to chase. */
const RANKS: [number, string][] = [[0, 'Student'], [1500, 'Intern'], [4000, 'Resident'], [8000, 'Chief Resident'], [11000, 'Attending'], [13000, 'Legend of the Night Shift']];
export const rankFor = (score: number) => [...RANKS].reverse().find(([at]) => score >= at)?.[1] ?? 'Student';

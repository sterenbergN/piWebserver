// Strengths and weaknesses from someone's answers: accuracy and an ability
// estimate per track and topic, how difficulty affects them, which answer
// types and slips trip them up, how it's trending, which topics they haven't
// met, and what to practise next. Pure, so the server and tests share it.
//
// Ability is an Elo-style estimate on the 1–5 difficulty scale: the
// difficulty at which you'd fully solve about half the questions. Each
// answer nudges it toward what you showed (partial credit, retries, hints
// and giving up all count), more at first and less once it has settled.

import { addDays, weekStart, type DateKey } from '@/lib/habits/dates';
import { triesFactor, XP_RULES, type AttemptMeta } from './progress';
import type { QuestionStatus } from './grade';
import { SYLLABUS } from './syllabus';
import { TRACKS, type Answer, type Track } from './types';

export type AnalysisAttempt = {
  questionId: string;
  at: string;
  answeredOn: DateKey;
  meta: AttemptMeta;
  status: QuestionStatus;
  correct: number;
  total: number;
  hints: number;
  tries?: number;
  /** Per part, when the question was at hand to regrade. */
  parts?: { correct: boolean; type: Answer['type']; mistake?: string }[];
};

export type Label = 'strength' | 'solid' | 'developing' | 'weakness' | 'new';
export type Stat = {
  answered: number;
  studied: number;
  solved: number;
  /** Solved on the first check, without hints. */
  clean: number;
  partsRight: number;
  partsTotal: number;
  hints: number;
  avgTries: number | null;
  avgDifficulty: number | null;
  maxSolved: number | null;
  /** Ability on the 1–5 difficulty scale. */
  ability: number;
  confidence: 'low' | 'medium' | 'high';
};
export type TopicStat = Stat & { track: Track; topic: string; label: Label; trend: 'up' | 'down' | 'flat' | null; last: DateKey };
export type Focus = { track: Track; topic: string; difficulty: number; reason: string };

export type Analysis = {
  overall: Stat;
  tracks: (Stat & { track: Track })[];
  topics: TopicStat[];
  difficulty: { difficulty: number; answered: number; solved: number; partRate: number | null }[];
  /** Highest difficulty with a solve rate of 60 % or better (2+ answers). */
  comfort: number | null;
  answerTypes: { type: Answer['type']; parts: number; right: number }[];
  slips: { note: string; track: Track; topic: string; count: number }[];
  weeks: { week: DateKey; answered: number; partRate: number | null }[];
  untried: { track: Track; topic: string; weight: number }[];
  strengths: TopicStat[];
  weaknesses: TopicStat[];
  focus: Focus[];
};

const START = 2.5;
const SCALE = 1.1;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const mean = (l: number[]) => (l.length ? l.reduce((a, b) => a + b, 0) / l.length : null);

/** How well one answer went, 0–1: partial credit, less for retries and hints, nothing for giving up. */
export function performance(a: AnalysisAttempt) {
  if (a.status === 'studied' || !a.total) return 0;
  return (a.correct / a.total) * triesFactor(a.tries) * Math.max(XP_RULES.minHintFactor, 1 - XP_RULES.hintCost * a.hints);
}

/** Ability after these answers (oldest first). */
export function ability(list: AnalysisAttempt[]) {
  let theta = START;
  list.forEach((a, i) => {
    const expected = 1 / (1 + Math.exp(-(theta - a.meta.difficulty) * SCALE));
    const k = 1.2 / (1 + i * 0.25);
    theta = clamp(theta + k * (performance(a) - expected) * 2, 0.5, 6);
  });
  return Math.round(theta * 100) / 100;
}

function stat(list: AnalysisAttempt[]): Stat {
  const answered = list.filter((a) => a.status !== 'studied');
  const solved = answered.filter((a) => a.status === 'solved');
  return {
    answered: answered.length,
    studied: list.length - answered.length,
    solved: solved.length,
    clean: solved.filter((a) => (a.tries ?? 1) === 1 && a.hints === 0).length,
    partsRight: answered.reduce((s, a) => s + a.correct, 0),
    partsTotal: answered.reduce((s, a) => s + a.total, 0),
    hints: list.reduce((s, a) => s + a.hints, 0),
    avgTries: mean(answered.map((a) => a.tries ?? 1)),
    avgDifficulty: mean(list.map((a) => a.meta.difficulty)),
    maxSolved: solved.length ? Math.max(...solved.map((a) => a.meta.difficulty)) : null,
    ability: ability(list),
    confidence: list.length >= 8 ? 'high' : list.length >= 4 ? 'medium' : 'low',
  };
}

export const partRate = (s: Pick<Stat, 'partsRight' | 'partsTotal'>) => (s.partsTotal ? s.partsRight / s.partsTotal : null);

function labelFor(s: Stat, count: number, overall: number): Label {
  if (count < 3) return 'new';
  const rate = partRate(s) ?? 0;
  if (s.ability >= Math.max(3.4, overall + 0.4) && rate >= 0.7) return 'strength';
  if (s.ability < Math.min(2.4, overall - 0.4) || rate < 0.5 || s.studied / count >= 0.4) return 'weakness';
  if (s.ability >= 3 && rate >= 0.65) return 'solid';
  return 'developing';
}

function trendOf(list: AnalysisAttempt[]): TopicStat['trend'] {
  if (list.length < 6) return null;
  const recent = mean(list.slice(-3).map(performance))!;
  const before = mean(list.slice(0, -3).map(performance))!;
  return recent - before > 0.15 ? 'up' : before - recent > 0.15 ? 'down' : 'flat';
}

export function analyze(attempts: AnalysisAttempt[], today: DateKey): Analysis {
  const sorted = [...attempts].sort((a, b) => a.at.localeCompare(b.at));
  const overall = stat(sorted);
  const tracks = TRACKS.map((track) => ({ track, ...stat(sorted.filter((a) => a.meta.track === track)) })).filter((t) => t.answered + t.studied > 0);

  const byTopic = new Map<string, AnalysisAttempt[]>();
  for (const a of sorted) {
    const key = `${a.meta.track}/${a.meta.topic}`;
    byTopic.set(key, [...(byTopic.get(key) ?? []), a]);
  }
  const topics: TopicStat[] = [...byTopic.values()].map((list) => {
    const s = stat(list);
    return { ...s, track: list[0].meta.track, topic: list[0].meta.topic, label: labelFor(s, list.length, overall.ability), trend: trendOf(list), last: list[list.length - 1].answeredOn };
  }).sort((a, b) => b.ability - a.ability || b.answered - a.answered);

  const difficulty = [1, 2, 3, 4, 5].map((d) => {
    const s = stat(sorted.filter((a) => a.meta.difficulty === d));
    return { difficulty: d, answered: s.answered, solved: s.solved, partRate: partRate(s) };
  });
  const comfort = difficulty.filter((d) => d.answered >= 2 && d.solved / d.answered >= 0.6).map((d) => d.difficulty).pop() ?? null;

  const types = new Map<Answer['type'], { parts: number; right: number }>();
  const slips = new Map<string, { note: string; track: Track; topic: string; count: number }>();
  for (const a of sorted) {
    for (const p of a.parts ?? []) {
      if (a.status === 'studied') continue;
      const t = types.get(p.type) ?? { parts: 0, right: 0 };
      t.parts++;
      if (p.correct) t.right++;
      types.set(p.type, t);
      if (p.mistake) {
        const slip = slips.get(p.mistake) ?? { note: p.mistake, track: a.meta.track, topic: a.meta.topic, count: 0 };
        slip.count++;
        slips.set(p.mistake, slip);
      }
    }
  }

  const thisWeek = weekStart(today);
  const weeks = Array.from({ length: 12 }, (_, i) => addDays(thisWeek, (i - 11) * 7)).map((week) => {
    const s = stat(sorted.filter((a) => weekStart(a.answeredOn) === week));
    return { week, answered: s.answered + s.studied, partRate: partRate(s) };
  });

  const seen = new Set(topics.map((t) => `${t.track}/${t.topic}`));
  const untried = TRACKS.flatMap((track) => SYLLABUS[track].filter(([topic]) => !seen.has(`${track}/${topic}`)).map(([topic, weight]) => ({ track, topic, weight })))
    .sort((a, b) => b.weight - a.weight);

  const strengths = topics.filter((t) => t.label === 'strength');
  const weaknesses = topics.filter((t) => t.label === 'weakness').sort((a, b) => a.ability - b.ability);
  const shaky = topics.filter((t) => t.label === 'developing' || (t.label === 'new' && t.answered + t.studied >= 1 && (partRate(t) ?? 0) < 0.6))
    .sort((a, b) => a.ability - b.ability);
  const focus: Focus[] = [
    ...weaknesses.map((t) => ({ track: t.track, topic: t.topic, difficulty: clamp(Math.round(t.ability), 1, 5), reason: `${pct(partRate(t))} of parts right${t.studied ? `, gave up on ${t.studied}` : ''} — rebuild it at an easier level` })),
    ...shaky.map((t) => ({ track: t.track, topic: t.topic, difficulty: clamp(Math.round(t.ability + 0.5), 1, 5), reason: t.trend === 'down' ? 'slipping lately' : 'not settled yet — a few more will tell' })),
    ...untried.slice(0, 2).map((u) => ({ track: u.track, topic: u.topic, difficulty: clamp(Math.round(overall.ability), 1, 4), reason: 'not tried yet' })),
  ].slice(0, 5);

  return {
    overall, tracks, topics, difficulty, comfort,
    answerTypes: [...types].map(([type, t]) => ({ type, ...t })).sort((a, b) => b.parts - a.parts),
    slips: [...slips.values()].sort((a, b) => b.count - a.count).slice(0, 8),
    weeks, untried, strengths, weaknesses, focus,
  };
}

const pct = (r: number | null) => (r === null ? '—' : `${Math.round(r * 100)}%`);

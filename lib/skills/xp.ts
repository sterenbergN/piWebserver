// Skills' share of the site-wide level, worked out from what's stored like the
// other features. Practising the same question again the same day earns nothing
// more, so "Everything" mode can't be farmed; coming back on another day can.

import type { ProgressData, ResourceKind, SkillsData } from './types';
import { GOOD } from './model';

export const SKILLS_XP = {
  /** Any finished question or card, once per question per day. */
  answered: 1,
  /** Got it (70 % or better), plus its difficulty. */
  right: 2,
  /** A day with at least REVIEW_DAY_ANSWERS answers. */
  reviewDay: 5,
  /** Finishing a resource. */
  resource: { book: 20, course: 20, project: 30, paper: 10, activity: 10, article: 5, video: 5, other: 5 } satisfies Record<ResourceKind, number>,
};

/** Answers in a day that make it a review day (for XP and for a linked habit). */
export const REVIEW_DAY_ANSWERS = 3;

/** Days with at least REVIEW_DAY_ANSWERS answers, oldest first. */
export function reviewDays(progress: ProgressData) {
  const counts = new Map<string, number>();
  for (const a of progress.attempts) counts.set(a.day, (counts.get(a.day) ?? 0) + 1);
  return [...counts].filter(([, n]) => n >= REVIEW_DAY_ANSWERS).map(([day]) => day).sort();
}

export function skillsXp(data: SkillsData, progress: ProgressData) {
  const items = new Set(data.subjects.flatMap((s) => s.items.map((i) => i.id)));
  const best = new Map<string, { score: number; difficulty: number }>();
  for (const a of progress.attempts) {
    if (!items.has(a.itemId)) continue;
    const key = `${a.itemId}|${a.day}`;
    const seen = best.get(key);
    if (!seen || a.score > seen.score) best.set(key, { score: a.score, difficulty: a.difficulty });
  }
  let xp = 0;
  for (const { score, difficulty } of best.values()) {
    xp += SKILLS_XP.answered;
    if (score >= GOOD) xp += SKILLS_XP.right + difficulty;
  }
  xp += reviewDays(progress).length * SKILLS_XP.reviewDay;
  for (const subject of data.subjects) {
    for (const r of subject.resources) if (r.status === 'done') xp += SKILLS_XP.resource[r.kind] ?? 0;
  }
  return xp;
}

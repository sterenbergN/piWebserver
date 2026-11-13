// What the weekly question writer (the scheduled Claude Code run in
// scripts/daily-generator) should add to Skills. Only subjects you've switched
// "weekly questions" on for are looked at. Each gets questions for the topics
// that are running low on fresh ones, weakest and most faded first, with the
// same prompt the site would give you, so the reply format is the one
// import-questions already reads.

import type { DateKey } from '@/lib/habits/dates';
import { subjectStats, type TopicStats } from './model';
import { buildQuestionsPrompt, historyOf } from './prompts';
import type { ProgressData, Subject } from './types';

/** Fresh questions (never answered) a topic should have waiting. */
export const FRESH_TARGET = 3;
/** Most questions asked for one subject in one week. */
export const WEEKLY_CAP = 12;

const ORDER: Record<TopicStats['state'], number> = { weak: 0, fading: 1, untested: 2, ok: 3, strong: 4, gap: 5 };

export type TopUpTopic = { topicId: string; name: string; state: TopicStats['state']; level: number; fresh: number; need: number };
export type TopUpRequest = { subjectId: string; subjectName: string; topics: TopUpTopic[]; count: number; prompt: string };

/**
 * The request for one subject, or null when nothing is needed. Not-started
 * topics only count once the subject is past "want to learn" or kept fresh.
 */
export function topUpRequest(subject: Subject, progress: ProgressData, today: DateKey): TopUpRequest | null {
  if (!subject.autoTopUp || subject.status === 'paused' || subject.status === 'want' || !subject.topics.length) return null;
  const stats = subjectStats(subject, progress, today);
  const answered = new Set(progress.attempts.map((a) => a.itemId));
  const wanted = stats.topics
    .filter((t) => t.state !== 'gap' || subject.status === 'maintaining' || t.stage <= 2)
    .map((t) => {
      const fresh = subject.items.filter((i) => i.topicId === t.topicId && !i.retired && !answered.has(i.id)).length;
      return { topicId: t.topicId, name: t.name, state: t.state, level: t.level, fresh, need: Math.max(0, FRESH_TARGET - fresh), stats: t };
    })
    .filter((t) => t.need > 0)
    .sort((a, b) => ORDER[a.state] - ORDER[b.state] || a.level - b.level);
  if (!wanted.length) return null;

  let left = WEEKLY_CAP;
  const topics = wanted.flatMap((t) => {
    const need = Math.min(t.need, left);
    left -= need;
    return need > 0 ? [{ ...t, need }] : [];
  });
  const count = topics.reduce((s, t) => s + t.need, 0);
  const descriptions = new Map(subject.topics.map((t) => [t.id, t.description]));
  const prompt = buildQuestionsPrompt({
    subject: { name: subject.name, resources: subject.resources, items: historyOf(subject.items) },
    topics: topics.map((t) => ({ ...t.stats, description: descriptions.get(t.topicId) })),
    count,
    style: 'mixed',
    difficulty: 'auto',
    extra: `How many per topic: ${topics.map((t) => `"${t.name}" ${t.need}`).join(', ')}.`,
  });
  return { subjectId: subject.id, subjectName: subject.name, topics: topics.map(({ stats: _stats, ...t }) => t), count, prompt };
}

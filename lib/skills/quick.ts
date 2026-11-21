import type { DateKey } from '@/lib/habits/dates';
import { buildQueue, subjectStats, type QueueEntry } from './model';
import type { Item, ProgressData, SkillsData } from './types';

// Skills questions small enough for a rest between workout sets (30–90 s):
// recall cards, one-part questions you answer by picking or ordering, and
// short easy numeric ones. Due ones first, then weak topics, then new ones.

/** A numeric question this short (prompt characters) and this easy still fits a rest. */
export const QUICK_NUMERIC_PROMPT = 280;
export const QUICK_NUMERIC_DIFFICULTY = 2;
export const QUICK_MAX = 5;

export function isQuickItem(item: Item): boolean {
  if (item.retired) return false;
  if (item.kind === 'card') return true;
  const { parts, prompt, difficulty } = item.question;
  if (parts.length !== 1) return false;
  const type = parts[0].answer.type;
  if (type === 'choice' || type === 'multi' || type === 'order') return true;
  return type === 'numeric' && difficulty <= QUICK_NUMERIC_DIFFICULTY && (prompt + (parts[0].prompt ?? '')).length <= QUICK_NUMERIC_PROMPT;
}

export type QuickReason = 'due' | 'weak' | 'new' | 'practice';

const RANK: Record<QuickReason, number> = { due: 0, weak: 1, new: 2, practice: 3 };

/**
 * Up to `limit` quick items. Uses the review queue's own order within each
 * group (most overdue first, weakest topic first, easiest new first), and
 * skips anything already answered today, as a review does. Items from topics
 * that aren't weak and aren't due come last, so there's still something when
 * everything's up to date.
 */
export function quickQueue(data: SkillsData, progress: ProgressData, today: DateKey, limit = QUICK_MAX): (QueueEntry & { quickReason: QuickReason })[] {
  const queue = buildQueue(data, progress, today, { mode: 'all', limit: 10_000 });
  const weakTopics = new Set<string>();
  for (const subject of data.subjects) {
    if (subject.status === 'paused') continue;
    for (const t of subjectStats(subject, progress, today).topics) {
      if (['weak', 'fading', 'gap'].includes(t.state)) weakTopics.add(`${subject.id}/${t.topicId}`);
    }
  }
  const reasonOf = (entry: QueueEntry): QuickReason => {
    if (entry.reason === 'due') return 'due';
    if (entry.reason === 'new') return 'new';
    if (entry.reason === 'fading' || weakTopics.has(`${entry.subject.id}/${entry.topic.id}`)) return 'weak';
    return 'practice';
  };
  return queue
    .filter((e) => isQuickItem(e.item))
    .map((e, order) => ({ ...e, quickReason: reasonOf(e), order }))
    .sort((a, b) => RANK[a.quickReason] - RANK[b.quickReason] || a.order - b.order)
    .slice(0, Math.max(1, Math.min(QUICK_MAX, limit)))
    .map(({ order: _order, ...e }) => e);
}

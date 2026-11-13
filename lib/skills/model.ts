// The numbers behind the skill board: a level per topic fitted to my answers,
// how much of it has faded since, the subject's level and SME badge, each
// question's review schedule, what to review today and what to do next.
// Everything is worked out again from the history, so nothing here is stored.
// The reasoning is in docs/skills/PLAN.md.

import { addDays, daysBetween, type DateKey } from '@/lib/habits/dates';
import {
  CARD_SCORE, LEVELS, MAX_LEVEL, itemDifficulty, type CardRating, type Item, type ProgressData, type Schedule, type SkillAttempt, type SkillsData, type Subject, type Topic,
} from './types';

// ── Fitting a level ──────────────────────────────────────────────────────────

/** Chance of getting a difficulty-d question right at level θ: 70 % at θ = d. */
export const expectedScore = (level: number, difficulty: number) => 1 / (1 + Math.exp(-1.7 * (level - difficulty + 0.5)));

/** A score this good counts as "got it" for stability and scheduling. */
export const GOOD = 0.7;

const clampLevel = (v: number) => Math.min(MAX_LEVEL, Math.max(0, v));

/** Walk the answers in order, nudging the level toward what each one says. Steps shrink as evidence builds up. */
export function fitLevel(prior: number, attempts: Pick<SkillAttempt, 'score' | 'difficulty'>[]) {
  let level = clampLevel(prior);
  attempts.forEach((a, n) => {
    const step = Math.max(0.3, 1.2 / Math.sqrt(1 + n));
    level = clampLevel(level + step * (a.score - expectedScore(level, a.difficulty)));
  });
  return level;
}

/** Days a topic stays fresh: 21, ×1.5 for every day it was got right (up to 8). */
export const stabilityDays = (goodDays: number) => 21 * 1.5 ** Math.min(8, Math.max(0, goodDays));

export function retentionAfter(days: number, stability: number) {
  return Math.exp(-Math.max(0, days) / stability);
}

/** The level today: the fitted level, sliding toward half of it as it fades. */
export const fadedLevel = (fitted: number, retention: number) => fitted * (0.5 + 0.5 * retention);

/** Named from the level as shown (one decimal), so 4.97 shown as "5.0" is called Expert, not Proficient. */
export function levelName(level: number) {
  return LEVELS[Math.min(MAX_LEVEL, Math.max(0, Math.floor(Math.round(level * 10) / 10 + 1e-9)))].name;
}

/** Graded questions: parts right, less for extra checks and hints; nothing for opening the solution. */
export function gradedScore(correct: number, total: number, tries = 1, hints = 0, studied = false) {
  if (studied || total <= 0) return 0;
  const tryFactor = tries > 1 ? (tries > 2 ? 0.7 : 0.85) : 1;
  const hintFactor = Math.max(0.6, 1 - 0.15 * hints);
  return Math.round((correct / total) * tryFactor * hintFactor * 1000) / 1000;
}

export const cardScore = (rating: CardRating) => CARD_SCORE[rating];

// ── Topics ───────────────────────────────────────────────────────────────────

export type TopicState = 'strong' | 'weak' | 'fading' | 'untested' | 'gap' | 'ok';
export type Confidence = 'none' | 'self' | 'some' | 'verified';

export type TopicStats = {
  topicId: string;
  name: string;
  stage: Topic['stage'];
  core: boolean;
  selfRating?: number;
  /** Level fitted to the answers (and self-rating), before fading. */
  fitted: number;
  /** Level today, after fading. */
  level: number;
  retention: number;
  stability: number;
  lastPractice?: DateKey;
  lastTested?: DateKey;
  answers: number;
  recentRight: number;
  recentTotal: number;
  confidence: Confidence;
  state: TopicState;
  liveItems: number;
  dueItems: number;
  newItems: number;
  resourcesDone: number;
  resourcesOpen: number;
};

const byTime = (a: SkillAttempt, b: SkillAttempt) => a.at.localeCompare(b.at);

/** Attempts that count: their question still exists and isn't retired. */
export function liveAttempts(subject: Subject, attempts: SkillAttempt[]) {
  const live = new Set(subject.items.filter((i) => !i.retired).map((i) => i.id));
  return attempts.filter((a) => a.subjectId === subject.id && live.has(a.itemId)).sort(byTime);
}

export function topicStats(subject: Subject, topic: Topic, attempts: SkillAttempt[], schedule: ProgressData['schedule'], today: DateKey): TopicStats {
  const mine = attempts.filter((a) => a.topicId === topic.id && a.day <= today);
  const fitted = fitLevel(topic.selfRating ?? 0, mine);
  const goodDays = new Set(mine.filter((a) => a.score >= GOOD).map((a) => a.day)).size;
  const done = subject.resources.filter((r) => r.topicIds.includes(topic.id) && r.status === 'done');
  const open = subject.resources.filter((r) => r.topicIds.includes(topic.id) && (r.status === 'planned' || r.status === 'doing'));
  const stability = stabilityDays(goodDays + (topic.selfRating !== undefined ? 2 : 0) + done.length);
  const lastTested = mine.length ? mine[mine.length - 1].day : undefined;
  const practiceDays = [lastTested, topic.selfRating !== undefined ? topic.selfRatedOn : undefined, ...done.map((r) => r.finishedOn)]
    .filter((d): d is string => !!d && d <= today);
  const lastPractice = practiceDays.sort().pop();
  const retention = lastPractice ? retentionAfter(daysBetween(lastPractice, today), stability) : 1;
  const level = fadedLevel(fitted, retention);
  const recent = mine.slice(-10);
  const recentRight = recent.filter((a) => a.score >= GOOD).length;
  const confidence: Confidence = mine.length >= 6 ? 'verified' : mine.length ? 'some' : topic.selfRating !== undefined ? 'self' : 'none';

  const items = subject.items.filter((i) => i.topicId === topic.id && !i.retired);
  const dueItems = items.filter((i) => schedule[i.id] && schedule[i.id].due <= today).length;
  const newItems = items.filter((i) => !schedule[i.id]).length;

  return withState({
    topicId: topic.id, name: topic.name, stage: topic.stage, core: topic.core, ...(topic.selfRating !== undefined ? { selfRating: topic.selfRating } : {}),
    fitted: round2(fitted), level: round2(level), retention: round2(retention), stability: Math.round(stability), lastPractice, lastTested,
    answers: mine.length, recentRight, recentTotal: recent.length, confidence,
    state: 'ok', liveItems: items.length, dueItems, newItems, resourcesDone: done.length, resourcesOpen: open.length,
  }, subject.target);
}

const round2 = (v: number) => Math.round(v * 100) / 100;

function withState(stats: TopicStats, target: number): TopicStats {
  let state: TopicState = 'ok';
  if (stats.confidence === 'none') state = 'gap';
  else if (stats.fitted >= 2 && stats.retention < 0.5) state = 'fading';
  else if (!stats.answers) state = 'untested';
  else if (stats.level < target - 1.5 || (stats.recentTotal >= 4 && stats.recentRight / stats.recentTotal < 0.5)) state = 'weak';
  else if (stats.level >= Math.max(3, target - 0.5)) state = 'strong';
  return { ...stats, state };
}

// ── Subjects ─────────────────────────────────────────────────────────────────

export type SubjectStats = {
  level: number;
  /** The level if nothing had faded. */
  fitted: number;
  levelName: string;
  sme: boolean;
  /** Why it is or isn't an SME yet, one line each. */
  smeChecks: { label: string; met: boolean }[];
  confidence: Confidence;
  topics: TopicStats[];
  answers: number;
  lastTested?: DateKey;
  due: number;
  newItems: number;
  liveItems: number;
  /** Share of core topics with any evidence (self-rating or answers). */
  coverage: number;
  resources: { done: number; doing: number; planned: number; hoursDone: number };
};

const weightOf = (t: Pick<TopicStats, 'core'>) => (t.core ? 1 : 0.5);

function weightedLevel(topics: TopicStats[], pick: (t: TopicStats) => number) {
  const total = topics.reduce((s, t) => s + weightOf(t), 0);
  return total ? topics.reduce((s, t) => s + weightOf(t) * pick(t), 0) / total : 0;
}

export function subjectStats(subject: Subject, progress: ProgressData, today: DateKey): SubjectStats {
  const attempts = liveAttempts(subject, progress.attempts);
  const topics = subject.topics.map((t) => topicStats(subject, t, attempts, progress.schedule, today));
  const level = weightedLevel(topics, (t) => t.level);
  const fitted = weightedLevel(topics, (t) => t.fitted);
  const core = topics.filter((t) => t.core);
  const tested = attempts.filter((a) => a.day <= today);
  const lastTested = tested.length ? tested[tested.length - 1].day : undefined;
  const smeChecks = [
    { label: 'Subject level 4 or more', met: level >= 4 },
    { label: '¾ of core topics at 3.5 or more', met: core.length > 0 && core.filter((t) => t.level >= 3.5).length / core.length >= 0.75 },
    { label: 'At least 10 answers', met: tested.length >= 10 },
    { label: 'Tested in the last 90 days', met: !!lastTested && daysBetween(lastTested, today) <= 90 },
  ];
  const confidence: Confidence = tested.length >= 10 && topics.every((t) => t.confidence !== 'none' && t.confidence !== 'self') ? 'verified'
    : tested.length ? 'some' : topics.some((t) => t.confidence === 'self') ? 'self' : 'none';
  const done = subject.resources.filter((r) => r.status === 'done');
  return {
    level: round2(level), fitted: round2(fitted), levelName: levelName(level), sme: smeChecks.every((c) => c.met), smeChecks, confidence, topics,
    answers: tested.length, lastTested,
    due: topics.reduce((s, t) => s + t.dueItems, 0),
    newItems: topics.reduce((s, t) => s + t.newItems, 0),
    liveItems: topics.reduce((s, t) => s + t.liveItems, 0),
    coverage: core.length ? round2(core.filter((t) => t.confidence !== 'none').length / core.length) : 0,
    resources: {
      done: done.length,
      doing: subject.resources.filter((r) => r.status === 'doing').length,
      planned: subject.resources.filter((r) => r.status === 'planned').length,
      hoursDone: done.reduce((s, r) => s + (r.hours ?? 0), 0),
    },
  };
}

/** The subject's level at the end of each week, for a chart. */
export function levelHistory(subject: Subject, progress: ProgressData, today: DateKey, weeks = 26) {
  const attempts = liveAttempts(subject, progress.attempts);
  const first = [subject.createdAt.slice(0, 10), attempts[0]?.day].filter(Boolean).sort()[0] ?? today;
  const points: { day: DateKey; level: number; fitted: number }[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const day = addDays(today, -7 * i);
    if (day < first && i > 0) continue;
    const upTo = attempts.filter((a) => a.day <= day);
    const shown = { ...subject, topics: subject.topics.map((t) => (t.selfRatedOn && t.selfRatedOn > day ? { ...t, selfRating: undefined } : t)) };
    const topics = shown.topics.map((t) => topicStats(shown, t, upTo, {}, day));
    points.push({ day, level: round2(weightedLevel(topics, (t) => t.level)), fitted: round2(weightedLevel(topics, (t) => t.fitted)) });
  }
  return points;
}

// ── Scheduling ───────────────────────────────────────────────────────────────

/** SM-2 style: intervals grow when it's got right, go back to tomorrow when it isn't. */
export function nextSchedule(prev: Schedule | undefined, score: number, day: DateKey, rating?: CardRating): Schedule {
  let { interval, ease, reps, lapses } = prev ?? { interval: 0, ease: 2.5, reps: 0, lapses: 0 };
  const band = rating === 'easy' ? 'easy' : score < 0.4 ? 'fail' : score < GOOD ? 'hard' : 'good';
  if (band === 'fail') {
    lapses += 1;
    reps = 0;
    interval = 1;
    ease = Math.max(1.3, ease - 0.2);
  } else if (band === 'hard') {
    interval = Math.max(1, Math.round(interval * 1.2));
    ease = Math.max(1.3, ease - 0.15);
  } else {
    reps += 1;
    const easy = band === 'easy';
    interval = reps === 1 ? (easy ? 4 : 2) : reps === 2 ? (easy ? 8 : 6) : Math.round(interval * ease * (easy ? 1.3 : 1));
    if (easy) ease += 0.15;
  }
  interval = Math.min(365, Math.max(1, interval));
  return { due: addDays(day, interval), interval, ease: round2(ease), reps, lapses, last: day };
}

// ── What to review ───────────────────────────────────────────────────────────

export type ReviewMode = 'due' | 'weak' | 'all';
export type QueueReason = 'due' | 'fading' | 'new' | 'weak' | 'practice';
export type QueueEntry = { item: Item; subject: Subject; topic: Topic; reason: QueueReason };

export const NEW_PER_DAY = 5;

/**
 * A review session: due questions (most overdue, weakest topic first), then
 * questions from fading topics, then a few new ones. Weak mode keeps to weak,
 * fading and untested topics; all mode is "test me on this", everything in scope.
 */
export function buildQueue(data: SkillsData, progress: ProgressData, today: DateKey, options: { subjectId?: string; topicId?: string; itemId?: string; mode?: ReviewMode; limit?: number; newPerDay?: number } = {}) {
  const mode = options.itemId ? 'all' : options.mode ?? (options.topicId ? 'all' : 'due');
  const limit = options.limit ?? 20;
  const subjects = data.subjects.filter((s) => (options.subjectId ? s.id === options.subjectId : options.itemId ? true : s.status !== 'paused'));
  const answeredToday = new Set(progress.attempts.filter((a) => a.day === today).map((a) => a.itemId));
  const firstSeen = new Map<string, string>();
  for (const a of [...progress.attempts].sort(byTime)) if (!firstSeen.has(a.itemId)) firstSeen.set(a.itemId, a.day);
  const newToday = [...firstSeen.values()].filter((d) => d === today).length;
  const newLeft = Math.max(0, (options.newPerDay ?? NEW_PER_DAY) - newToday);

  type Candidate = QueueEntry & { stats: TopicStats; schedule?: Schedule };
  const candidates: Candidate[] = [];
  for (const subject of subjects) {
    const stats = subjectStats(subject, progress, today);
    for (const item of subject.items) {
      // One question asked for by name (from its Notes page) comes up even if it was answered today.
      if (options.itemId) { if (item.id !== options.itemId || item.retired) continue; } else if (item.retired || answeredToday.has(item.id)) continue;
      if (options.topicId && item.topicId !== options.topicId) continue;
      const topic = subject.topics.find((t) => t.id === item.topicId);
      const topicStat = stats.topics.find((t) => t.topicId === item.topicId);
      if (!topic || !topicStat) continue;
      if (mode === 'weak' && !['weak', 'fading', 'untested', 'gap'].includes(topicStat.state)) continue;
      candidates.push({ item, subject, topic, reason: 'practice', stats: topicStat, schedule: progress.schedule[item.id] });
    }
  }

  const overdue = (c: Candidate) => (c.schedule ? daysBetween(c.schedule.due, today) : -Infinity);
  const due = candidates.filter((c) => c.schedule && c.schedule.due <= today)
    .sort((a, b) => overdue(b) - overdue(a) || a.stats.level - b.stats.level)
    .map((c) => ({ ...c, reason: 'due' as const }));
  const seenNotDue = candidates.filter((c) => c.schedule && c.schedule.due > today);
  const fading = seenNotDue.filter((c) => c.stats.state === 'fading')
    .sort((a, b) => a.schedule!.last.localeCompare(b.schedule!.last))
    .map((c) => ({ ...c, reason: 'fading' as const }));
  const fresh = candidates.filter((c) => !c.schedule)
    .sort((a, b) => a.topic.stage - b.topic.stage || a.stats.level - b.stats.level || itemDifficulty(a.item) - itemDifficulty(b.item) || a.item.createdAt.localeCompare(b.item.createdAt))
    .map((c) => ({ ...c, reason: 'new' as const }));

  let picked: Candidate[];
  if (mode === 'due') picked = [...due, ...fading, ...fresh.slice(0, newLeft)];
  else {
    const fadingIds = new Set(fading.map((c) => c.item.id));
    const rest = seenNotDue.filter((c) => !fadingIds.has(c.item.id))
      .sort((a, b) => a.stats.level - b.stats.level || a.schedule!.last.localeCompare(b.schedule!.last))
      .map((c) => ({ ...c, reason: (mode === 'weak' ? 'weak' : 'practice') as QueueReason }));
    picked = [...due, ...fading, ...fresh, ...rest];
  }
  const seen = new Set<string>();
  return picked.filter((c) => !seen.has(c.item.id) && seen.add(c.item.id)).slice(0, limit)
    .map(({ item, subject, topic, reason }) => ({ item, subject, topic, reason }));
}

// ── What to do next ──────────────────────────────────────────────────────────

export type NextStepKind = 'review' | 'plan' | 'rate' | 'practice' | 'refresh' | 'test-yourself' | 'write' | 'resource' | 'find-material';
export type NextStep = { kind: NextStepKind; subjectId?: string; topicId?: string; title: string; detail: string; href: string; priority: number };

const fmtLevel = (v: number) => v.toFixed(1);

/** The steps that would help most, from the numbers alone. */
export function nextSteps(subject: Subject, stats: SubjectStats, today: DateKey): NextStep[] {
  if (subject.status === 'paused') return [];
  const base = `/skills/${subject.id}`;
  const steps: NextStep[] = [];
  const add = (step: Omit<NextStep, 'subjectId'>) => steps.push({ ...step, subjectId: subject.id });

  if (!subject.topics.length) {
    add({ kind: 'plan', title: `Plan ${subject.name}`, detail: 'Break it into topics and find books, courses and projects for it.', href: `${base}/plan`, priority: 90 });
    return steps;
  }
  if (stats.due) add({ kind: 'review', title: `Review ${subject.name}`, detail: `${stats.due} question${stats.due === 1 ? '' : 's'} due.`, href: `/skills/review?subject=${subject.id}`, priority: 75 + Math.min(10, stats.due) });
  if (stats.topics.every((t) => t.confidence === 'none')) {
    add({ kind: 'rate', title: `Rate yourself on ${subject.name}`, detail: 'A quick 0–5 per topic gives the board somewhere to start.', href: `${base}?tab=topics`, priority: 85 });
  }

  for (const t of stats.topics) {
    const topicHref = `/skills/review?subject=${subject.id}&topic=${t.topicId}`;
    const openResource = subject.resources.find((r) => r.topicIds.includes(t.topicId) && (r.status === 'doing' || r.status === 'planned'));
    if (t.state === 'weak') {
      if (t.liveItems) add({ kind: 'practice', topicId: t.topicId, title: `Practise ${t.name}`, detail: `Level ${fmtLevel(t.level)}, aiming for ${subject.target}. ${t.recentTotal ? `${t.recentRight} of the last ${t.recentTotal} right.` : ''}`.trim(), href: topicHref, priority: 80 - t.level });
      if (openResource) add({ kind: 'resource', topicId: t.topicId, title: `${openResource.status === 'doing' ? 'Carry on with' : 'Start'} ${openResource.title}`, detail: `It covers ${t.name}, one of your weak spots.`, href: `${base}?tab=resources#r-${openResource.id}`, priority: 68 - t.level });
    } else if (t.state === 'fading') {
      const days = t.lastPractice ? daysBetween(t.lastPractice, today) : 0;
      add({ kind: 'refresh', topicId: t.topicId, title: `Refresh ${t.name}`, detail: `Last practised ${days} days ago; down to ${fmtLevel(t.level)} from ${fmtLevel(t.fitted)}.`, href: t.liveItems ? topicHref : `${base}/questions?topics=${t.topicId}`, priority: 70 });
    } else if (t.state === 'untested' && t.resourcesDone) {
      add({ kind: 'test-yourself', topicId: t.topicId, title: `Test yourself on ${t.name}`, detail: 'You’ve finished material on it but never been tested.', href: t.liveItems ? topicHref : `${base}/questions?topics=${t.topicId}`, priority: 66 });
    } else if (t.state === 'gap' && subject.status !== 'want') {
      if (openResource) add({ kind: 'resource', topicId: t.topicId, title: `${openResource.status === 'doing' ? 'Carry on with' : 'Start'} ${openResource.title}`, detail: `For ${t.name}, which you haven’t started.`, href: `${base}?tab=resources#r-${openResource.id}`, priority: 45 - t.stage });
      else if (!subject.resources.some((r) => r.topicIds.includes(t.topicId))) add({ kind: 'find-material', topicId: t.topicId, title: `Find material for ${t.name}`, detail: 'Nothing is tied to it yet. Re-plan to add books or projects.', href: `${base}/plan`, priority: 35 - t.stage });
    }
  }

  const thin = stats.topics.filter((t) => t.liveItems < 3 && (t.state !== 'gap' || subject.status === 'maintaining'));
  if (thin.length && subject.status !== 'want') {
    const names = thin.slice(0, 3).map((t) => t.name).join(', ') + (thin.length > 3 ? ` and ${thin.length - 3} more` : '');
    add({ kind: 'write', title: `Write questions for ${subject.name}`, detail: `Few questions on ${names}.`, href: `${base}/questions?topics=${thin.map((t) => t.topicId).join(',')}`, priority: 60 });
  }

  const seen = new Set<string>();
  return steps.sort((a, b) => b.priority - a.priority).filter((s) => !seen.has(s.title) && seen.add(s.title));
}

// ── The board ────────────────────────────────────────────────────────────────

export type Tier = 'sme' | 'proficient' | 'competent' | 'developing' | 'not-started';
export const TIER_LABEL: Record<Tier, string> = { sme: 'Subject-matter expert', proficient: 'Proficient', competent: 'Competent', developing: 'Developing', 'not-started': 'Not started' };

/** The same cut-offs as the level names, so a tier never disagrees with the level shown beside it. */
export function tierOf(stats: Pick<SubjectStats, 'sme' | 'level'>): Tier {
  if (stats.sme) return 'sme';
  const shown = Math.round(stats.level * 10) / 10;
  if (shown >= 4) return 'proficient';
  if (shown >= 3) return 'competent';
  if (shown >= 0.5) return 'developing';
  return 'not-started';
}

export type SubjectCard = {
  id: string; name: string; icon: string; area: string; status: Subject['status']; target: number;
  level: number; fitted: number; levelName: string; sme: boolean; tier: Tier; confidence: Confidence;
  due: number; newItems: number; liveItems: number; answers: number; lastTested?: DateKey; coverage: number;
  topics: number; resources: { done: number; total: number };
  strong: string[]; weak: string[]; fading: string[]; gaps: number;
};

export function subjectCard(subject: Subject, stats: SubjectStats): SubjectCard {
  const named = (state: TopicState) => stats.topics.filter((t) => t.state === state).sort((a, b) => (state === 'strong' ? b.level - a.level : a.level - b.level)).map((t) => t.name);
  return {
    id: subject.id, name: subject.name, icon: subject.icon, area: subject.area, status: subject.status, target: subject.target,
    level: stats.level, fitted: stats.fitted, levelName: stats.levelName, sme: stats.sme, tier: tierOf(stats), confidence: stats.confidence,
    due: stats.due, newItems: stats.newItems, liveItems: stats.liveItems, answers: stats.answers, lastTested: stats.lastTested, coverage: stats.coverage,
    topics: subject.topics.length, resources: { done: stats.resources.done, total: subject.resources.filter((r) => r.status !== 'dropped').length },
    strong: named('strong'), weak: named('weak'), fading: named('fading'), gaps: stats.topics.filter((t) => t.state === 'gap').length,
  };
}

/** Days in a row (ending today, or yesterday if nothing yet today) with at least one answer. */
export function reviewStreak(progress: ProgressData, today: DateKey) {
  const days = new Set(progress.attempts.map((a) => a.day));
  let day = days.has(today) ? today : addDays(today, -1);
  let streak = 0;
  while (days.has(day)) { streak++; day = addDays(day, -1); }
  return streak;
}

export function boardSummary(data: SkillsData, progress: ProgressData, today: DateKey) {
  const rows = data.subjects.map((subject) => {
    const stats = subjectStats(subject, progress, today);
    return { subject, stats, card: subjectCard(subject, stats) };
  });
  const areas = [...new Set(rows.map((r) => r.subject.area))].sort((a, b) => a.localeCompare(b));
  const steps = rows.flatMap((r) => nextSteps(r.subject, r.stats, today).slice(0, 3)).sort((a, b) => b.priority - a.priority);
  const due = buildQueue(data, progress, today).length;
  const lastWeek = addDays(today, -6);
  return {
    subjects: rows.map((r) => r.card),
    areas,
    due,
    answeredToday: progress.attempts.filter((a) => a.day === today).length,
    answeredThisWeek: progress.attempts.filter((a) => a.day >= lastWeek && a.day <= today).length,
    streak: reviewStreak(progress, today),
    nextSteps: steps.slice(0, 8),
  };
}
export type BoardSummary = ReturnType<typeof boardSummary>;

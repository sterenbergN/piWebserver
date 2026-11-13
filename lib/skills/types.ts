// Skills: subjects I know or want to learn, their topics, the books and projects
// for them, and the questions that test them. See docs/skills/PLAN.md.

import type { PartResponse, Question } from '@/lib/daily/types';
import type { QuestionStatus } from '@/lib/daily/grade';

export const SUBJECT_STATUSES = ['want', 'learning', 'maintaining', 'paused'] as const;
export type SubjectStatus = (typeof SUBJECT_STATUSES)[number];
export const STATUS_LABEL: Record<SubjectStatus, string> = {
  want: 'Want to learn',
  learning: 'Learning',
  maintaining: 'Keeping fresh',
  paused: 'Paused',
};

/** The Dreyfus model, so a level means the same thing at work. */
export const LEVELS = [
  { level: 0, name: 'Not started', meaning: 'Haven’t looked at it yet' },
  { level: 1, name: 'Novice', meaning: 'Know the words; follow rules with help' },
  { level: 2, name: 'Advanced beginner', meaning: 'Routine problems with a reference open' },
  { level: 3, name: 'Competent', meaning: 'Work independently on normal problems' },
  { level: 4, name: 'Proficient', meaning: 'Handle the unusual cases; see the big picture' },
  { level: 5, name: 'Expert', meaning: 'The go-to person; teach it and judge others’ work' },
] as const;
export const MAX_LEVEL = 5;

export const STAGES = [
  { stage: 1, name: 'Foundations' },
  { stage: 2, name: 'Core' },
  { stage: 3, name: 'Applied' },
  { stage: 4, name: 'Mastery' },
] as const;
export type Stage = 1 | 2 | 3 | 4;

export type Topic = {
  id: string;
  name: string;
  description?: string;
  stage: Stage;
  /** Core topics count fully toward the subject's level, optional ones half. */
  core: boolean;
  /** My own 0–5 rating, the starting point before any answers. */
  selfRating?: number;
  selfRatedOn?: string;
  notes?: string;
  createdAt: string;
};

export const RESOURCE_KINDS = ['book', 'course', 'video', 'article', 'paper', 'project', 'activity', 'other'] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];
export const RESOURCE_LABEL: Record<ResourceKind, { label: string; icon: string }> = {
  book: { label: 'Book', icon: '📕' },
  course: { label: 'Course', icon: '🎓' },
  video: { label: 'Video', icon: '🎬' },
  article: { label: 'Article', icon: '📰' },
  paper: { label: 'Paper', icon: '📄' },
  project: { label: 'Project', icon: '🛠️' },
  activity: { label: 'Activity', icon: '🏃' },
  other: { label: 'Other', icon: '📎' },
};

export const RESOURCE_STATUSES = ['planned', 'doing', 'done', 'dropped'] as const;
export type ResourceStatus = (typeof RESOURCE_STATUSES)[number];
export const RESOURCE_STATUS_LABEL: Record<ResourceStatus, string> = { planned: 'Planned', doing: 'In progress', done: 'Done', dropped: 'Dropped' };

export type Resource = {
  id: string;
  kind: ResourceKind;
  title: string;
  author?: string;
  url?: string;
  /** Why it's here, which chapters, or (for a project) what to build. */
  detail?: string;
  topicIds: string[];
  status: ResourceStatus;
  /** e.g. 120 of 400 pages. */
  progress?: { done: number; total: number; unit: string };
  /** Rough hours to get through it. */
  hours?: number;
  startedOn?: string;
  finishedOn?: string;
  takeaways?: string;
  createdAt: string;
};

/** A graded question in the daily question format, minus the daily track. */
export type SkillQuestion = Omit<Question, 'track' | 'topic'>;

type ItemBase = {
  id: string;
  topicId: string;
  createdAt: string;
  source: 'ai' | 'manual';
  /** Reported as wrong: never asked again and not counted toward any level. */
  retired?: boolean;
  /** How it felt and whether it was any good (fed back into the next prompt). */
  feedback?: { rating?: 'up' | 'down'; difficulty?: 'easy' | 'right' | 'hard'; report?: { kind: string; note: string } };
};
export type GradedItem = ItemBase & { kind: 'graded'; question: SkillQuestion };
export type CardItem = ItemBase & { kind: 'card'; difficulty: number; front: string; back: string };
export type Item = GradedItem | CardItem;

export const itemDifficulty = (item: Item) => (item.kind === 'graded' ? item.question.difficulty : item.difficulty);
export const itemTitle = (item: Item) => (item.kind === 'graded' ? item.question.title : item.front.split('\n')[0].slice(0, 120));

export type Subject = {
  id: string;
  name: string;
  icon: string;
  area: string;
  status: SubjectStatus;
  goal?: string;
  /** Where I want to get to, 1–5. */
  target: number;
  /** Markdown: how I plan to get there (usually written by the plan prompt). */
  roadmap?: string;
  /** What I already know coming in (fed into the plan prompt). */
  background?: string;
  hoursPerWeek?: number;
  topics: Topic[];
  resources: Resource[];
  items: Item[];
  createdAt: string;
  updatedAt: string;
};

export type SkillsData = { subjects: Subject[] };

export const CARD_RATINGS = ['again', 'hard', 'good', 'easy'] as const;
export type CardRating = (typeof CARD_RATINGS)[number];
/** How a card rating counts as a score. */
export const CARD_SCORE: Record<CardRating, number> = { again: 0, hard: 0.5, good: 0.85, easy: 1 };

/** One finished go at a question or card. */
export type SkillAttempt = {
  id: string;
  subjectId: string;
  topicId: string;
  itemId: string;
  /** The day (YYYY-MM-DD) it counts for. */
  day: string;
  at: string;
  /** 0–1: parts right for graded questions (0 if the solution was opened), the rating for cards. */
  score: number;
  difficulty: number;
  status?: QuestionStatus;
  rating?: CardRating;
  responses?: Record<string, PartResponse> | null;
  hints?: number;
  tries?: number;
};

/** A question's spaced-repetition schedule. */
export type Schedule = { due: string; interval: number; ease: number; reps: number; lapses: number; last: string };

export type ProgressData = { attempts: SkillAttempt[]; schedule: Record<string, Schedule> };

export const emptySkills = (): SkillsData => ({ subjects: [] });
export const emptyProgress = (): ProgressData => ({ attempts: [], schedule: {} });

// Skills: subjects I know or want to learn, their topics, the books and projects
// for them, explicit study steps, interconnected subskills, a shifting daily
// schedule, and the questions that test them. See docs/skills/PLAN.md.

import type { QuestionStatus } from '@/lib/daily/grade';
import type { PartResponse, Question } from '@/lib/daily/types';
import type { DateKey } from '@/lib/habits/dates';

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
  /** Notes pages about this topic (in /notes). */
  notePages?: NotesPageRef[];
  createdAt: string;
};

export type NotesPageRef = { notebook: string; page: string };

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

export const PROJECT_ATTACHMENT_KINDS = ['video', 'zip', 'image', 'file', 'link'] as const;
export type ProjectAttachmentKind = (typeof PROJECT_ATTACHMENT_KINDS)[number];

export type ProjectAttachment = {
  id: string;
  kind: ProjectAttachmentKind;
  name: string;
  url: string;
  size?: number;
  mime?: string;
};

export type ProjectLogEntry = {
  id: string;
  title: string;
  note?: string;
  day: DateKey;
  createdAt: string;
  attachments: ProjectAttachment[];
};

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
  /** The same book in the Reader: its reading progress keeps this one's up to date. */
  readerBookId?: string;
  /** Project progress logs with attachments (videos, zips, images, links). */
  logs?: ProjectLogEntry[];
  /** Direct free/open-access PDF link if saved. */
  freePdfUrl?: string;
  /** Direct YouTube audiobook or lecture series link if saved. */
  youtubeAudioUrl?: string;
  createdAt: string;
};

export const SKILL_STEP_KINDS = ['read', 'practice', 'project', 'note', 'other'] as const;
export type SkillStepKind = (typeof SKILL_STEP_KINDS)[number];

export type SkillStep = {
  id: string;
  title: string;
  amount?: string;
  detail?: string;
  kind: SkillStepKind;
  topicId?: string;
  resourceId?: string;
  minutes?: number;
  done?: boolean;
  completedOn?: DateKey;
};

/** A graded question in the daily question format, minus the daily track. */
export type SkillQuestion = Omit<Question, 'track' | 'topic'>;

type ItemBase = {
  id: string;
  topicId: string;
  createdAt: string;
  /** weekly: added by the weekly question writer. */
  source: 'ai' | 'manual' | 'weekly';
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
  /** Let the weekly question writer add questions where this subject runs low. */
  autoTopUp?: boolean;
  /** Prerequisite / parent subject IDs in the interconnected skill graph. */
  parentIds?: string[];
  /** Ordered explicit study/practice/project progression steps. */
  steps?: SkillStep[];
  topics: Topic[];
  resources: Resource[];
  items: Item[];
  createdAt: string;
  updatedAt: string;
};

export type ScheduledSkillTask = {
  id: string;
  subjectId: string;
  stepId?: string;
  topicId?: string;
  resourceId?: string;
  title: string;
  amount?: string;
  detail?: string;
  minutes?: number;
  day: DateKey;
  done?: boolean;
  completedOn?: DateKey;
};

export type SkillSchedule = {
  updatedAt: string;
  hoursPerDay?: number;
  tasks: ScheduledSkillTask[];
};

export const INQUIRY_STATUSES = ['open', 'solved'] as const;
export type InquiryStatus = (typeof INQUIRY_STATUSES)[number];

export type KnowledgeInquiry = {
  id: string;
  question: string;
  context?: string;
  answer?: string;
  takeaways?: string;
  sources?: string[];
  tags?: string[];
  status: InquiryStatus;
  subjectId?: string;
  topicId?: string;
  cardItemId?: string;
  createdAt: string;
  updatedAt: string;
  solvedAt?: string;
};

export type DraftInquiryAnswer = {
  inquiryId?: string;
  question: string;
  answer: string;
  takeaways?: string;
  tags: string[];
  sources: string[];
  suggestedSubject?: string;
  suggestedTopic?: string;
  subjectId?: string;
  topicId?: string;
  flashcard?: { front: string; back: string; difficulty?: number };
};

export type SkillsData = {
  subjects: Subject[];
  /** The Notes notebook that topic pages and question working go in, once made. */
  notesNotebook?: string;
  /** Multi-day skill study schedule that automatically shifts missed days forward. */
  schedule?: SkillSchedule;
  /** Running inbox / solved knowledge base of lookups and questions. */
  inquiries?: KnowledgeInquiry[];
};

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

// ── AI plan drafts & parser types ────────────────────────────────────────────

export type DraftTopic = { key: string; name: string; stage: Stage; core: boolean; description?: string; existingId?: string };
export type DraftResource = {
  kind: ResourceKind;
  title: string;
  author?: string;
  url?: string;
  freePdfUrl?: string;
  youtubeAudioUrl?: string;
  detail?: string;
  hours?: number;
  topicKeys: string[];
  existingId?: string;
};
export type DraftStep = {
  title: string;
  kind: SkillStepKind;
  amount?: string;
  detail?: string;
  topicKey?: string;
  topic?: string;
  resourceTitle?: string;
  resource?: string;
  minutes?: number;
};

export type DraftNewSubject = {
  name: string;
  icon?: string;
  area: string;
  why?: string;
  goal?: string;
  target: number;
  status: SubjectStatus;
  parentSubjectRefs: string[];
  parentIds: string[];
  topics: DraftTopic[];
  resources: DraftResource[];
  steps: DraftStep[];
};

export type DraftParentLink = {
  subjectRef: string;
  subjectId?: string;
  subjectName: string;
  parentRefs: string[];
  parentIds: string[];
};

export type DraftSubjectPlan = {
  subjectRef: string;
  existingSubjectId?: string;
  subjectName: string;
  parentRefs: string[];
  parentIds: string[];
  topics: DraftTopic[];
  resources: DraftResource[];
  steps: DraftStep[];
};

export type DraftScheduledTask = {
  subjectRef: string;
  subjectId?: string;
  subjectName: string;
  stepTitle?: string;
  topicName?: string;
  resourceTitle?: string;
  title: string;
  amount?: string;
  detail?: string;
  minutes?: number;
  day: DateKey;
  dayIndex: number;
};

export type InterconnectedPlanDraft = {
  summary?: string;
  hoursPerDay?: number;
  newSubjects: DraftNewSubject[];
  parentLinks: DraftParentLink[];
  subjectPlans: DraftSubjectPlan[];
  schedule: DraftScheduledTask[];
};

export type ParseResult<T> =
  | { ok: true; data: T; warnings: string[] }
  | { ok: false; error: string; warnings: string[] };

// ── Discriminated union of all Skills mutations ──────────────────────────────

export type SkillEdit =
  | {
      op: 'add-subject';
      name: string;
      icon?: string;
      area?: string;
      status?: SubjectStatus;
      target?: number;
      goal?: string;
      background?: string;
      hoursPerWeek?: number;
      parentIds?: string[];
      steps?: SkillStep[];
    }
  | {
      op: 'edit-subject';
      subjectId: string;
      changes: Partial<
        Pick<Subject, 'name' | 'icon' | 'area' | 'status' | 'target' | 'goal' | 'background' | 'roadmap' | 'hoursPerWeek' | 'autoTopUp' | 'parentIds' | 'steps'>
      >;
    }
  | { op: 'remove-subject'; subjectId: string }
  | {
      op: 'add-topic';
      subjectId: string;
      name: string;
      stage?: Stage;
      core?: boolean;
      description?: string;
      notes?: string;
      selfRating?: number | null;
    }
  | {
      op: 'edit-topic';
      subjectId: string;
      topicId: string;
      changes: Partial<Pick<Topic, 'name' | 'stage' | 'core' | 'description' | 'notes'>> & { selfRating?: number | null };
    }
  | { op: 'rate-topics'; subjectId: string; ratings: Record<string, number | null> }
  | { op: 'move-topic'; subjectId: string; topicId: string; direction: 'up' | 'down' }
  | { op: 'remove-topic'; subjectId: string; topicId: string }
  | { op: 'topic-notes-new'; subjectId: string; topicId: string }
  | { op: 'topic-notes-tie'; subjectId: string; topicId: string; notebook: string; page: string }
  | { op: 'topic-notes-untie'; subjectId: string; topicId: string; page: string }
  | {
      op: 'add-resource';
      subjectId: string;
      title: string;
      kind?: ResourceKind;
      author?: string;
      url?: string;
      freePdfUrl?: string;
      youtubeAudioUrl?: string;
      detail?: string;
      topicIds?: string[];
      hours?: number;
      progress?: { done?: number; total: number; unit?: string } | null;
      status?: ResourceStatus;
      readerBookId?: string;
    }
  | {
      op: 'edit-resource';
      subjectId: string;
      resourceId: string;
      changes: Partial<
        Pick<
          Resource,
          'title' | 'kind' | 'author' | 'url' | 'detail' | 'takeaways' | 'topicIds' | 'hours' | 'status' | 'readerBookId' | 'freePdfUrl' | 'youtubeAudioUrl'
        >
      > & { progress?: { done?: number; total: number; unit?: string } | null };
    }
  | { op: 'remove-resource'; subjectId: string; resourceId: string }
  | {
      op: 'import-plan';
      subjectId: string;
      reply: string;
      topicKeys?: string[];
      resourceIndexes?: number[];
      roadmap?: boolean | 'append';
      includeSteps?: boolean;
      includeParents?: boolean;
    }
  | { op: 'import-questions'; subjectId: string; reply: string; skip?: number[]; fallbackTopicId?: string }
  | { op: 'save-card'; subjectId: string; itemId?: string; topicId: string; front: string; back: string; difficulty?: number }
  | { op: 'move-item'; subjectId: string; itemId: string; topicId: string }
  | { op: 'retire-item'; subjectId: string; itemId: string; retired?: boolean }
  | { op: 'remove-item'; subjectId: string; itemId: string }
  | {
      op: 'feedback';
      itemId: string;
      changes: { rating?: 'up' | 'down' | null; difficulty?: 'easy' | 'right' | 'hard' | null; report?: { kind: string; note: string } | null };
    }
  | { op: 'answer'; itemId: string; responses?: Record<string, PartResponse> | null; hints?: number; tries?: number }
  | { op: 'rate-card'; itemId: string; rating: CardRating }
  | {
      op: 'add-step';
      subjectId: string;
      title: string;
      kind?: SkillStepKind;
      amount?: string;
      detail?: string;
      topicId?: string;
      resourceId?: string;
      minutes?: number;
      done?: boolean;
    }
  | {
      op: 'edit-step';
      subjectId: string;
      stepId: string;
      changes: Partial<Pick<SkillStep, 'title' | 'kind' | 'amount' | 'detail' | 'topicId' | 'resourceId' | 'minutes' | 'done' | 'completedOn'>>;
    }
  | { op: 'toggle-step'; subjectId: string; stepId: string; done?: boolean }
  | { op: 'move-step'; subjectId: string; stepId: string; direction: 'up' | 'down' }
  | { op: 'remove-step'; subjectId: string; stepId: string }
  | { op: 'set-parents'; subjectId: string; parentIds: string[] }
  | {
      op: 'set-schedule';
      schedule?: { updatedAt?: string; hoursPerDay?: number; tasks: Array<Omit<ScheduledSkillTask, 'id'> & { id?: string }> };
      hoursPerDay?: number;
      tasks?: Array<Omit<ScheduledSkillTask, 'id'> & { id?: string }>;
    }
  | { op: 'shift-schedule' }
  | { op: 'toggle-schedule-task'; taskId: string; done?: boolean }
  | {
      op: 'add-schedule-task';
      subjectId: string;
      title: string;
      day?: DateKey;
      stepId?: string;
      topicId?: string;
      resourceId?: string;
      amount?: string;
      detail?: string;
      minutes?: number;
    }
  | { op: 'remove-schedule-task'; taskId: string }
  | { op: 'rebuild-schedule-from-steps'; minutesPerDay?: number; hoursPerDay?: number; startDay?: DateKey; subjectIds?: string[]; keepCompleted?: boolean }
  | {
      op: 'apply-interconnected-plan';
      draft?: InterconnectedPlanDraft;
      reply?: string;
      startDay?: DateKey;
      hoursPerDay?: number;
      replaceSteps?: boolean;
      replaceParents?: boolean;
      replaceSchedule?: boolean;
      includeNewSubjects?: boolean;
      includeSubjectPlans?: boolean;
      includeSchedule?: boolean;
    }
  | {
      op: 'add-project-log';
      subjectId: string;
      resourceId: string;
      title: string;
      note?: string;
      day?: DateKey;
      attachments?: Array<Omit<ProjectAttachment, 'id'> & { id?: string }>;
    }
  | {
      op: 'edit-project-log';
      subjectId: string;
      resourceId: string;
      logId: string;
      changes: {
        title?: string;
        note?: string | null;
        day?: DateKey;
        attachments?: Array<Omit<ProjectAttachment, 'id'> & { id?: string }>;
      };
    }
  | { op: 'remove-project-log'; subjectId: string; resourceId: string; logId: string }
  | {
      op: 'add-inquiry';
      question: string;
      context?: string;
      answer?: string;
      takeaways?: string;
      sources?: string[];
      tags?: string[];
      status?: InquiryStatus;
      subjectId?: string;
      topicId?: string;
    }
  | {
      op: 'import-inquiries';
      text?: string;
      items?: Array<{
        question: string;
        context?: string;
        answer?: string;
        takeaways?: string;
        tags?: string[];
        subjectId?: string;
        topicId?: string;
      }>;
      subjectId?: string;
      topicId?: string;
      tags?: string[];
    }
  | {
      op: 'edit-inquiry';
      inquiryId: string;
      changes: Partial<
        Pick<
          KnowledgeInquiry,
          'question' | 'context' | 'answer' | 'takeaways' | 'sources' | 'tags' | 'status' | 'subjectId' | 'topicId'
        >
      >;
    }
  | { op: 'toggle-inquiry'; inquiryId: string; status?: InquiryStatus; answer?: string }
  | { op: 'remove-inquiry'; inquiryId: string }
  | {
      op: 'promote-inquiry-to-card';
      inquiryId: string;
      subjectId?: string;
      topicId?: string;
      front?: string;
      back?: string;
      difficulty?: number;
    }
  | { op: 'apply-inquiry-answers'; reply?: string; answers?: DraftInquiryAnswer[]; createCards?: boolean };

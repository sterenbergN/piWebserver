'use client';

import { localToday } from '@/lib/habits/dates';
import type { PublicQuestion } from '@/lib/daily/grade';
import type { BoardSummary, NextStep, QueueReason, SubjectStats } from '@/lib/skills/model';
import type {
  KnowledgeBacklink,
  KnowledgeBundle,
  KnowledgeEdge,
  KnowledgeEdgeKind,
  KnowledgeGraph,
  KnowledgeMaterialItem,
  KnowledgeNode,
  KnowledgeNodeKind,
} from '@/lib/skills/links';
import type { DraftInquiryAnswer, InquiryStatus, Item, KnowledgeInquiry, ProjectAttachment, SkillAttempt, Subject } from '@/lib/skills/types';
import type { Answered } from '@/components/daily/QuestionCard';
import type { CheckResult } from '@/components/daily/useDaily';

export type {
  DraftInquiryAnswer,
  InquiryStatus,
  KnowledgeBacklink,
  KnowledgeBundle,
  KnowledgeEdge,
  KnowledgeEdgeKind,
  KnowledgeGraph,
  KnowledgeInquiry,
  KnowledgeMaterialItem,
  KnowledgeNode,
  KnowledgeNodeKind,
};

// Talking to /api/skills. A 401 means signed out (pages show a way in); anything
// else that fails carries a message worth showing.

export class SignedOut extends Error {}

async function read<T>(res: Response): Promise<T> {
  if (res.status === 401) throw new SignedOut();
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.success) throw new Error(body.message || 'Something went wrong. Try again.');
  return body as T;
}

export async function skillsGet<T>(query: Record<string, string | undefined> = {}): Promise<T> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined) params.set(k, v);
  params.set('today', localToday());
  return read<T>(await fetch(`/api/skills?${params}`, { cache: 'no-store' }));
}

export async function skillsPost<T = Record<string, unknown>>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  return read<T>(await fetch('/api/skills', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, today: localToday(), ...payload }),
  }));
}

export async function uploadProjectFile(file: Blob | File, filename?: string): Promise<ProjectAttachment> {
  const form = new FormData();
  const resolvedName = filename?.trim() || (file instanceof File && file.name ? file.name : 'attachment');
  form.append('file', file, resolvedName);
  form.append('name', resolvedName);
  const res = await read<{ attachment: ProjectAttachment }>(
    await fetch('/api/skills/projects/file', {
      method: 'POST',
      body: form,
    }),
  );
  return res.attachment;
}

// ── Response shapes ──────────────────────────────────────────────────────────

/** GET /api/skills */
export type BoardResponse = { board: BoardSummary; xp: number; reviewDays: string[] };

/** A question in a subject's list (no answer). */
export type ItemRow = {
  id: string; kind: Item['kind']; topicId: string; title: string; difficulty: number; source: Item['source']; createdAt: string;
  retired: boolean; feedback: Item['feedback'] | null; answers: number; lastScore: number | null; lastDay: string | null; due: string | null;
};

export type SubjectListSummary = {
  id: string;
  name: string;
  icon: string;
  area: string;
  status: Subject['status'];
  level: number;
  parentIds: string[];
};

/** GET /api/skills?all=1: the board, and every subject with its stats (no questions). */
export type AllSubjectsResponse = { board: BoardSummary; subjects: { subject: Omit<Subject, 'items'>; stats: SubjectStats }[] };

/** GET /api/skills?subject=id */
export type SubjectResponse = {
  subject: Omit<Subject, 'items'>;
  items: ItemRow[];
  stats: SubjectStats;
  nextSteps: NextStep[];
  history: { day: string; level: number; fitted: number }[];
  areas: string[];
  /** Each topic's Notes pages, by topic id (only topics that have some). */
  topicPages: Record<string, NotesPageView[]>;
  allSubjects?: SubjectListSummary[];
  inquiries?: KnowledgeInquiry[];
};

export type KnowledgeSubjectOption = {
  id: string;
  name: string;
  icon: string;
  area: string;
  topics: { id: string; name: string }[];
};

/** GET /api/skills?knowledge=1(&subject=id) */
export type KnowledgeResponse = {
  graph: KnowledgeGraph;
  bundle: KnowledgeBundle;
  inquiries?: KnowledgeInquiry[];
  subjects?: KnowledgeSubjectOption[];
};

export type NotesPageView = { notebook: string; page: string; label: string; href: string };

/** GET ?material=1&subject=&topics=: your notes on those topics, for the question prompt. */
export type Material = { id: string; kind: 'book' | 'page'; label: string; text: string };

/** GET /api/skills?item=id: the whole question, answer included. */
export type ItemResponse = { item: Item; row: ItemRow; attempts: SkillAttempt[] };

type AskBase = { id: string; subjectId: string; subjectName: string; subjectIcon: string; topicId: string; topicName: string; difficulty: number; feedback: Item['feedback'] | null; reason: QueueReason };
export type AskGraded = AskBase & { kind: 'graded'; question: PublicQuestion };
export type AskCard = AskBase & { kind: 'card'; front: string; back: string };
export type Ask = AskGraded | AskCard;

/** GET /api/skills?review=1&subject=&topic=&mode=due|weak|all&limit= */
export type ReviewResponse = { queue: Ask[] };

/** POST answer: marks only while there are checks left, or the finished question. */
export type AnswerResponse = { result: CheckResult | ({ final: true } & Answered) };

export const fmtLevel = (v: number) => v.toFixed(1);

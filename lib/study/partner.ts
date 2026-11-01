// Quiz me and the mock patient, where someone else holds the questions. They open
// a private link, no account needed. The link only shows what that one sitting
// needs, one question at a time for a quiz, and it stops showing anything once the
// sitting is over or a day has passed. A session keeps question ids, not questions,
// so nothing of hers sits in the sessions folder, and whose it is never leaves the
// server. Pure, so the server and the tests share it.

import type { GameQuestion } from './games';
import type { PatientCase } from './practice';
import type { StudyQuestion } from './study';

export const SESSION_HOURS = 24;
export const QUIZ_SIZES = [10, 20, 30, 50];
const TOKEN = /^[\w-]{32,64}$/;
export const isToken = (value: unknown): value is string => typeof value === 'string' && TOKEN.test(value);

export type CaseRun = PatientCase['runs'][number];
export type PartnerSession = {
  token: string;
  ownerId: string;
  kind: 'quiz' | 'patient';
  createdAt: string;
  expiresAt: string;
  finishedAt?: string;
  // A quiz.
  questionIds: string[];
  index: number;
  right: number;
  wrong: number;
  missedIds: string[];
  // A mock patient.
  caseId?: string;
  startedAt?: string;
  ticked: number[];
  run?: CaseRun;
};

export function newSession(input: { token: string; ownerId: string; kind: PartnerSession['kind']; questionIds?: string[]; caseId?: string }, now: Date): PartnerSession {
  return {
    token: input.token, ownerId: input.ownerId, kind: input.kind,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + SESSION_HOURS * 3_600_000).toISOString(),
    questionIds: input.questionIds ?? [], index: 0, right: 0, wrong: 0, missedIds: [],
    ...(input.caseId ? { caseId: input.caseId } : {}),
    ticked: [],
  };
}

export const isExpired = (session: PartnerSession, now: Date) => !(new Date(session.expiresAt).getTime() > now.getTime());

/** What to ask: what's due first, then the rest of her misses, then anything else, each shuffled. */
export function quizPick(pool: GameQuestion[], size: number, random = Math.random) {
  const shuffled = pool.map((q) => ({ q, order: random() })).sort((a, b) => b.q.priority - a.q.priority || a.order - b.order);
  return shuffled.slice(0, size).map(({ q }) => q.id);
}

/** Mark the current question and move on. A different `index` is a double tap or a second phone, and does nothing. */
export function markQuestion(session: PartnerSession, index: unknown, verdict: unknown, now: Date) {
  if (session.kind !== 'quiz' || session.finishedAt || index !== session.index) return null;
  const id = session.questionIds[session.index];
  if (!id) return null;
  if (verdict === true) session.right++;
  if (verdict === false) {
    session.wrong++;
    session.missedIds.push(id);
  }
  session.index++;
  if (session.index >= session.questionIds.length) session.finishedAt = now.toISOString();
  return { id, verdict: verdict === true ? true : verdict === false ? false : null };
}

/** Whoever's quizzing sees only the question in front of them. */
export function partnerQuizView(session: PartnerSession, question: StudyQuestion | null) {
  const counts = { kind: 'quiz' as const, index: session.index, total: session.questionIds.length, right: session.right, wrong: session.wrong };
  if (session.finishedAt) return { ...counts, finished: true as const };
  return {
    ...counts,
    finished: false as const,
    question: question && {
      stem: question.stem, choices: question.choices, correct: question.correct, explanation: question.explanation, topic: question.topic,
      ...(question.quote ? { quote: question.quote } : {}),
    },
  };
}
export type PartnerQuizView = ReturnType<typeof partnerQuizView>;

/** Whoever's playing the patient sees the script until it's over, then only how it went. */
export function partnerCaseView(session: PartnerSession, item: PatientCase) {
  const base = { kind: 'patient' as const, title: item.title };
  if (session.finishedAt && session.run) return { ...base, finished: true as const, run: session.run, diagnosis: item.diagnosis, teaching: item.teaching };
  return {
    ...base,
    finished: false as const,
    door: item.door, opening: item.opening, script: item.script, exam: item.exam, checklist: item.checklist, diagnosis: item.diagnosis,
    ticked: session.ticked,
    startedAt: session.startedAt ?? null,
  };
}
export type PartnerCaseView = ReturnType<typeof partnerCaseView>;

/** How it's going, for her own screen. No script and no checklist until it's over. */
export function ownerView(session: PartnerSession, item: PatientCase | null, missedStems: string[]) {
  const base = { token: session.token, kind: session.kind, finished: !!session.finishedAt, expiresAt: session.expiresAt };
  if (session.kind === 'quiz') {
    return { ...base, index: session.index, total: session.questionIds.length, right: session.right, wrong: session.wrong, ...(session.finishedAt ? { missedStems } : {}) };
  }
  return {
    ...base,
    caseId: session.caseId,
    startedAt: session.startedAt ?? null,
    door: item?.door ?? null,
    title: item?.title ?? '',
    ...(session.finishedAt && session.run && item ? { run: session.run, diagnosis: item.diagnosis, teaching: item.teaching } : {}),
  };
}
export type OwnerSessionView = ReturnType<typeof ownerView>;

export function setTicked(session: PartnerSession, ticked: unknown, checklistLength: number) {
  if (session.finishedAt || !Array.isArray(ticked)) return;
  session.ticked = [...new Set(ticked.filter((n): n is number => Number.isInteger(n) && n >= 0 && n < checklistLength))];
}

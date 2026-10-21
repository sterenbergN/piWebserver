'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { localToday, type DateKey } from '@/lib/habits/dates';
import { attemptXp, questionStats, scoreAll, type Attempt, type ScoredAttempt } from '@/lib/daily/progress';
import type { PartResult, PublicDay } from '@/lib/daily/grade';
import type { PartResponse, Track } from '@/lib/daily/types';
import type { Answered, Feedback } from './QuestionCard';

export type ArchiveDay = { date: DateKey; title: string; track: Track; topic: string; boss: boolean };
export type Progress = { stats: ReturnType<typeof questionStats>; history: Omit<ScoredAttempt, 'responses'>[]; leaderboard: boolean };

const DEVICE_KEY = 'daily:device';

export function readDeviceAttempts(): Attempt[] {
  try {
    const data = JSON.parse(localStorage.getItem(DEVICE_KEY) || 'null');
    return Array.isArray(data?.attempts) ? data.attempts : [];
  } catch {
    return [];
  }
}

function writeDeviceAttempts(attempts: Attempt[] | null) {
  try {
    if (attempts) localStorage.setItem(DEVICE_KEY, JSON.stringify({ attempts }));
    else localStorage.removeItem(DEVICE_KEY);
  } catch { /* storage blocked: answers last until the page closes */ }
}

/** Progress from answers kept on this device (signed out), using the grades they got then. */
export function deviceProgress(today: DateKey): Progress {
  const scored = scoreAll(readDeviceAttempts(), new Map());
  return { stats: questionStats(scored, today), history: [...scored].sort((a, b) => b.date.localeCompare(a.date)), leaderboard: false };
}

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!data.success) throw new Error(data.message || 'Something went wrong.');
  return data;
}

/** A check that wasn't fully right: which parts are wrong (not the answers), and how many checks are left. */
export type CheckResult = { final: false; tries: number; triesLeft: number; parts: PartResult[]; correct: number; total: number };
export type AnswerResult = CheckResult | ({ final: true } & Answered & { attempt: Attempt; saved: boolean });

/**
 * Check an answer (or reveal the solution when `responses` is null). Signed
 * out, a finished answer is kept on this device. `tries` is how many checks
 * were used before this one.
 */
export async function sendAnswer(args: { date: DateKey; questionId: string; responses: Record<string, PartResponse> | null; hints: number; tries: number; today: DateKey }): Promise<AnswerResult> {
  const data = await post('/api/daily/answer', { ...args, reveal: args.responses === null });
  if (data.final && !data.saved) {
    const attempts = readDeviceAttempts().filter((a) => a.questionId !== args.questionId);
    writeDeviceAttempts([...attempts, data.attempt]);
  }
  return data.final ? { ...data, feedback: { rating: null, difficulty: null, report: null } } : data;
}

/** Rate or report a question (signed in). Returns the saved feedback. */
export async function sendFeedback(questionId: string, patch: Partial<Feedback>): Promise<Feedback> {
  return (await post('/api/daily/feedback', { questionId, ...patch })).feedback;
}

/** The solution for an answer kept on this device (signed out), graded again by the server. */
export async function regradeDeviceAttempt(a: Attempt): Promise<Answered> {
  const graded = await post('/api/daily/answer', { date: a.date, questionId: a.questionId, responses: a.responses, reveal: a.responses === null, hints: a.hints, tries: a.tries ?? 1, final: true, today: a.answeredOn });
  // XP from the stored attempt: the server only knows today's date, not when you answered.
  return { ...graded, late: a.answeredOn > a.date, xp: attemptXp(a, graded) };
}

export function useDaily() {
  const [today, setToday] = useState<DateKey>(() => localToday());
  const [date, setDate] = useState<DateKey | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [day, setDay] = useState<PublicDay | null>(null);
  const [archive, setArchive] = useState<ArchiveDay[]>([]);
  const [answered, setAnswered] = useState<Record<string, Answered>>({});
  /** Checks used on questions not finished yet. */
  const [tries, setTries] = useState<Record<string, number>>({});
  const [signedIn, setSignedIn] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [deviceCount, setDeviceCount] = useState(0);
  const [error, setError] = useState('');
  const loadId = useRef(0);

  const loadProgress = useCallback(async (signed: boolean, day: DateKey) => {
    if (!signed) { setProgress(deviceProgress(day)); return; }
    try {
      const res = await fetch(`/api/daily/progress?today=${day}`, { cache: 'no-store' });
      const data = await res.json();
      if (data.success) setProgress({ stats: data.stats, history: data.history, leaderboard: data.leaderboard });
    } catch { /* stats stay as they were */ }
  }, []);

  const load = useCallback(async (which: DateKey | null) => {
    const id = ++loadId.current;
    const now = localToday();
    setToday(now);
    try {
      const res = await fetch(`/api/daily?today=${now}${which ? `&date=${which}` : ''}`, { cache: 'no-store' });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);
      if (id !== loadId.current) return;
      setDay(data.day);
      setArchive(data.archive);
      setSignedIn(data.signedIn);
      setDate(data.date);
      const known: Record<string, Answered> = data.answered ?? {};
      // Signed out: answers live on this device; ask the server to grade them again for the solutions.
      if (!data.signedIn && data.day) {
        const mine = readDeviceAttempts().filter((a) => a.date === data.date);
        for (const a of mine) {
          try {
            known[a.questionId] = await regradeDeviceAttempt(a);
          } catch { /* the question may have been removed */ }
        }
      }
      if (id !== loadId.current) return;
      setAnswered(known);
      setTries((all) => (data.signedIn ? data.tries ?? {} : all));
      setDeviceCount(data.signedIn ? readDeviceAttempts().length : 0);
      setState('ready');
      loadProgress(data.signedIn, now);
    } catch {
      if (id === loadId.current) setState('error');
    }
  }, [loadProgress]);

  useEffect(() => { load(null); }, [load]);

  const open = useCallback((d: DateKey) => { setError(''); load(d); }, [load]);

  const submit = useCallback(async (questionId: string, responses: Record<string, PartResponse> | null, hints: number): Promise<AnswerResult | null> => {
    if (!date) return null;
    setError('');
    try {
      const data = await sendAnswer({ date, questionId, responses, hints, tries: tries[questionId] ?? 0, today });
      if (!data.final) {
        setTries((all) => ({ ...all, [questionId]: data.tries }));
        return data;
      }
      setAnswered((all) => ({ ...all, [questionId]: data }));
      loadProgress(signedIn, today);
      return data;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t check that answer.');
      return null;
    }
  }, [date, today, signedIn, tries, loadProgress]);

  const feedback = useCallback(async (questionId: string, patch: Partial<Feedback>) => {
    try {
      const saved = await sendFeedback(questionId, patch);
      setAnswered((all) => all[questionId] ? { ...all, [questionId]: { ...all[questionId], feedback: saved } } : all);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t save that.');
    }
  }, []);

  const setLeaderboard = useCallback(async (on: boolean) => {
    try {
      await post('/api/daily/progress', { action: 'leaderboard', on });
      setProgress((p) => p ? { ...p, leaderboard: on } : p);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t save that.');
    }
  }, []);

  const importDevice = useCallback(async () => {
    try {
      const data = await post('/api/daily/progress', { action: 'import', attempts: readDeviceAttempts(), today });
      writeDeviceAttempts(null);
      setDeviceCount(0);
      if (date) await load(date);
      return data.added as number;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t import those answers.');
      return 0;
    }
  }, [today, date, load]);

  const dismissDevice = useCallback(() => { writeDeviceAttempts(null); setDeviceCount(0); }, []);

  return { today, date, state, day, archive, answered, tries, signedIn, progress, error, clearError: () => setError(''), deviceCount,
    open, submit, feedback, setLeaderboard, importDevice, dismissDevice, reload: () => load(date), reloadProgress: () => loadProgress(signedIn, today) };
}

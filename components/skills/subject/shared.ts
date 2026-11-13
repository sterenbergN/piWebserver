'use client';

import { useCallback, useState } from 'react';
import { daysBetween, localToday } from '@/lib/habits/dates';
import { skillsPost, type SubjectResponse } from '../api';

// What every tab of the subject page shares: the loaded data, a way to reload
// it, and one place to run a change and show its error.

export type TabProps = {
  data: SubjectResponse;
  /** Fetch the subject again (after every change). */
  reload: () => Promise<void>;
};

/** Run an API action, reload, and keep the first error to show. */
export function useAct(data: SubjectResponse, reload: () => Promise<void>) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const subjectId = data.subject.id;
  const act = useCallback(async (action: string, payload: Record<string, unknown> = {}) => {
    setBusy(true);
    setError('');
    try {
      await skillsPost(action, { subjectId, ...payload });
      await reload();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
      return false;
    } finally {
      setBusy(false);
    }
  }, [subjectId, reload]);
  return { act, busy, error, setError };
}

/** "today", "3 days ago", "never". */
export function ago(day?: string | null) {
  if (!day) return 'never';
  const d = daysBetween(day, localToday());
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  return `${d} days ago`;
}

/** "due today", "due in 6 days", "overdue", "new". */
export function dueText(due: string | null) {
  if (!due) return 'new';
  const d = daysBetween(localToday(), due);
  if (d < 0) return `overdue by ${-d} day${d === -1 ? '' : 's'}`;
  if (d === 0) return 'due today';
  return `due in ${d} day${d === 1 ? '' : 's'}`;
}

export const shortDay = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
export const longDay = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

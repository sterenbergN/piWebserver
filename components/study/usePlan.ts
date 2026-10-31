'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { localToday } from '@/lib/habits/dates';
import type { PlanData } from '@/lib/study/plan';

// The planner's data, shared by PA Today, the plan page and the main Today card.
// Every change answers with the whole plan, so there's only one way it updates.

export type PlanState = {
  plan: PlanData;
  reviewsDue: number;
  reviewedToday: boolean;
  tests: { id: string; title: string; course: string }[];
  calendarStale: boolean;
};

type PlanAnswer = PlanState & { success: boolean; message?: string; cleaned?: boolean; added?: { dates: number; work: number }; problems?: string[]; moved?: number };

export function usePlan() {
  const [status, setStatus] = useState<'loading' | 'ready' | 'signed-out' | 'error'>('loading');
  const [data, setData] = useState<PlanState | null>(null);
  const [today] = useState(() => localToday());
  const refreshed = useRef(false);

  const take = useCallback((body: PlanAnswer) => {
    setData({ plan: body.plan, reviewsDue: body.reviewsDue, reviewedToday: body.reviewedToday, tests: body.tests, calendarStale: body.calendarStale });
    setStatus('ready');
  }, []);

  /** Make a change. Throws with a message worth showing if it fails. */
  const post = useCallback(async (action: string, payload: Record<string, unknown> = {}) => {
    const res = await fetch('/api/study/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, today: localToday(), ...payload }),
    });
    const body: PlanAnswer = await res.json().catch(() => ({}));
    if (!res.ok || !body.success) throw new Error(body.message || 'That didn’t save. Try again.');
    take(body);
    return body;
  }, [take]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/study/plan?today=${localToday()}`, { cache: 'no-store' });
      if (cancelled) return;
      if (res.status === 401) { setStatus('signed-out'); return; }
      const body: PlanAnswer = await res.json().catch(() => ({}));
      if (cancelled) return;
      if (!res.ok || !body.success) { setStatus('error'); return; }
      take(body);
      // An old copy of the calendar gets refreshed behind the scenes.
      if (body.calendarStale && !refreshed.current) {
        refreshed.current = true;
        post('calendar-refresh').catch(() => { /* it'll try again next visit */ });
      }
    })().catch(() => { if (!cancelled) setStatus('error'); });
    return () => { cancelled = true; };
  }, [post, take]);

  return { status, data, post, today };
}

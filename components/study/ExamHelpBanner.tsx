'use client';

import { useCallback, useEffect, useState } from 'react';
import { localToday } from '@/lib/habits/dates';
import './exam-help.css';

// Exam-week help where the household will see it: on Today, Chores and the meal
// plan. Everyone sees the same thing, and anyone can end it.

export type HelpState = {
  canAsk: boolean;
  help: null | { title: string; until: string; name: string; mine: boolean; moved: number; movedTo: string | null; movedToMe: boolean };
};

export function useExamHelp() {
  const [state, setState] = useState<HelpState | null>(null);
  const load = useCallback(async () => {
    const res = await fetch(`/api/study/help?today=${localToday()}`, { cache: 'no-store' });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.success) setState({ canAsk: body.canAsk, help: body.help });
  }, []);
  useEffect(() => { load().catch(() => { /* the banner just stays away */ }); }, [load]);

  const act = useCallback(async (action: 'start' | 'end', deadlineId?: string) => {
    const res = await fetch('/api/study/help', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, deadlineId, today: localToday() }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.success) throw new Error(body.message || 'That didn’t save. Try again.');
    setState({ canAsk: body.canAsk, help: body.help });
  }, []);
  return { state, act };
}

const day = (key: string) => new Date(`${key}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

function choreLine(help: NonNullable<HelpState['help']>) {
  if (!help.moved) return 'No chores needed moving.';
  const chores = `${help.moved} chore${help.moved === 1 ? '' : 's'}`;
  if (help.mine) return help.movedTo ? `${chores} moved to ${help.movedTo}.` : `${chores} moved to anyone in the household.`;
  return help.movedToMe ? `${chores} moved to you.` : help.movedTo ? `${chores} moved to ${help.movedTo}.` : `${chores} up for grabs.`;
}

export default function ExamHelpBanner({ quickMeals }: { quickMeals?: { title: string; minutes: string }[] }) {
  return <ExamHelpView helper={useExamHelp()} quickMeals={quickMeals} />;
}

/** For a page that also starts help, so both stay in step. */
export function ExamHelpView({ helper, quickMeals }: { helper: ReturnType<typeof useExamHelp>; quickMeals?: { title: string; minutes: string }[] }) {
  const { state, act } = helper;
  const [error, setError] = useState('');
  const help = state?.help;
  if (!help) return null;
  return (
    <div className="exam-help" role="status">
      <span>
        🩺 <strong>{help.mine ? 'Your' : `${help.name}’s`} exam week:</strong> {help.title}, {day(help.until)}. {choreLine(help)} Chores go back after the exam.
        {quickMeals && quickMeals.length > 0 && <> Quick meals to lean on: {quickMeals.map((m) => `${m.title} (${m.minutes})`).join(', ')}.</>}
        {error && <> {error}</>}
      </span>
      <button type="button" onClick={() => act('end').catch((e) => setError(e.message))}>End early</button>
    </div>
  );
}

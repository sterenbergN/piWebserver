'use client';

import { HoldButton, habitColor } from '@/components/habits/HabitCard';
import { addDays, type DateKey } from '@/lib/habits/dates';
import { latestEntry, type Chore, type ChoresData } from '@/lib/chores/chores';
import { choreStreak, dueStatus, dueText, repeatText } from '@/lib/chores/stats';
import type { Member } from './useChores';

const fmtDay = (d: DateKey, today: DateKey) =>
  d === today ? 'today' : d === addDays(today, -1) ? 'yesterday' : new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

type Props = {
  chore: Chore;
  data: ChoresData;
  today: DateKey;
  members: Member[];
  me: string | null;
  onDone: () => void;
  onSkip?: () => void;
  onUndo: (entryId: string) => void;
  onEdit?: () => void;
};

/** One chore: when it's due, who it's for, the last time it was done, and a ring to hold when it's done. */
export default function ChoreCard({ chore, data, today, members, me, onDone, onSkip, onUndo, onEdit }: Props) {
  const { status } = dueStatus(chore, today);
  const last = latestEntry(data, chore.id);
  const streak = choreStreak(data, chore.id);
  const nameOf = (id: string | null) => (id && id === me ? 'you' : members.find((m) => m.id === id)?.name ?? null);
  const assignee = chore.assignee ? nameOf(chore.assignee) : null;
  // Undo stays on offer for a couple of days after it was done or skipped.
  const undoable = last && last.date >= addDays(today, -1);

  const meta = [dueText(chore, today), repeatText(chore), assignee && `👤 ${assignee === 'you' ? 'You' : assignee}`, streak >= 2 && `🔥 ${streak} on time`]
    .filter(Boolean).join(' · ');
  const lastText = last && `${last.skipped ? 'Skipped' : 'Done'} ${fmtDay(last.date, today)}${last.by && members.length > 1 ? ` by ${nameOf(last.by) ?? 'someone'}` : ''}`;

  return (
    <div className={`hb-card ch-card is-${status}`} style={habitColor(chore)}>
      <span className="hb-emoji" aria-hidden>{chore.emoji}</span>
      <div className="hb-card-text">
        {onEdit ? <button type="button" className="ch-name" onClick={onEdit}>{chore.name}</button> : <strong>{chore.name}</strong>}
        <span className={`hb-meta ch-due is-${status}`}>{meta}</span>
        {chore.notes && <span className="hb-meta ch-notes">📝 {chore.notes}</span>}
        {(lastText || onSkip) && (
          <span className="ch-row">
            {lastText && <span className="hb-meta">{lastText}</span>}
            {undoable && <button type="button" className="hb-text-btn" onClick={() => onUndo(last.id)}>Undo</button>}
            {onSkip && chore.repeat && (status === 'overdue' || status === 'today' || status === 'soon') && (
              <button type="button" className="hb-text-btn" onClick={onSkip}>Skip this time</button>
            )}
          </span>
        )}
      </div>
      <HoldButton done={false} symbol="" label={`${chore.name}: hold to mark done`} onHold={onDone} />
    </div>
  );
}

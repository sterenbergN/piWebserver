'use client';

import HabitSheet from './HabitSheet';
import { habitColor } from './HabitCard';
import { isActive, type Habit, type HabitAction } from '@/lib/habits/habits';

type Props = {
  habits: Habit[];
  dispatch: (action: HabitAction) => boolean;
  onEdit: (habit: Habit) => void;
  onClose: () => void;
  confirm: (options: { title: string; message: string; confirmLabel: string; danger: boolean }) => Promise<boolean>;
};

/** Reorder, edit, archive (keeps history, hides it) or delete (removes history). */
export default function ManageHabits({ habits, dispatch, onEdit, onClose, confirm }: Props) {
  const active = habits.filter(isActive);
  const archived = habits.filter((h) => !isActive(h));

  const remove = async (habit: Habit) => {
    const ok = await confirm({
      title: `Delete “${habit.name}”?`,
      message: 'This removes the habit and all of its history, XP and garden plant. Archive it instead to keep the history.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (ok) dispatch({ type: 'delete', id: habit.id });
  };

  const row = (habit: Habit, index: number, list: Habit[]) => (
    <li key={habit.id} className="hb-manage-row" style={habitColor(habit)}>
      <span className="hb-emoji is-small" aria-hidden>{habit.emoji}</span>
      <span className="hb-manage-name">{habit.name}</span>
      {isActive(habit) && (
        <>
          <button type="button" className="hb-icon-btn" aria-label={`Move ${habit.name} up`} disabled={index === 0}
            onClick={() => dispatch({ type: 'move', id: habit.id, direction: -1 })}>↑</button>
          <button type="button" className="hb-icon-btn" aria-label={`Move ${habit.name} down`} disabled={index === list.length - 1}
            onClick={() => dispatch({ type: 'move', id: habit.id, direction: 1 })}>↓</button>
          <button type="button" className="hb-icon-btn" aria-label={`Edit ${habit.name}`} onClick={() => onEdit(habit)}>✎</button>
        </>
      )}
      <button type="button" className="hb-small-btn" onClick={() => dispatch({ type: 'archive', id: habit.id, archived: isActive(habit) })}>
        {isActive(habit) ? 'Archive' : 'Restore'}
      </button>
      <button type="button" className="hb-icon-btn is-danger" aria-label={`Delete ${habit.name}`} onClick={() => remove(habit)}>🗑</button>
    </li>
  );

  return (
    <HabitSheet title="Manage habits" onClose={onClose}>
      {!habits.length && <p className="hb-hint">No habits yet.</p>}
      <ul className="hb-manage-list">{active.map(row)}</ul>
      {archived.length > 0 && (
        <>
          <span className="hb-label">Archived</span>
          <p className="hb-hint">Hidden from your day; their history still counts in stats and XP.</p>
          <ul className="hb-manage-list">{archived.map(row)}</ul>
        </>
      )}
    </HabitSheet>
  );
}

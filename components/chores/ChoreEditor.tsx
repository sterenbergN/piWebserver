'use client';

import { useState } from 'react';
import HabitSheet from '@/components/habits/HabitSheet';
import { COLOR_NAMES } from '@/components/habits/HabitEditor';
import type { DateKey } from '@/lib/habits/dates';
import { isOpen, type Chore, type ChoreEffort, type ChoreInput, type RepeatUnit } from '@/lib/chores/chores';
import { CHORE_XP, EFFORT_LABEL } from '@/lib/chores/stats';
import type { Member } from './useChores';

export const CHORE_TEMPLATES: ChoreInput[] = [
  { emoji: '🧹', name: 'Vacuum floors', repeat: { every: 1, unit: 'week' }, effort: 2 },
  { emoji: '🧽', name: 'Wipe counters', repeat: { every: 1, unit: 'week' }, effort: 1 },
  { emoji: '🛁', name: 'Clean bathroom', repeat: { every: 2, unit: 'week' }, effort: 3 },
  { emoji: '🗑️', name: 'Take out the bins', repeat: { every: 1, unit: 'week' }, effort: 1, fromDone: false },
  { emoji: '🧺', name: 'Laundry', repeat: { every: 1, unit: 'week' }, effort: 2 },
  { emoji: '🛏️', name: 'Change bed sheets', repeat: { every: 2, unit: 'week' }, effort: 2 },
  { emoji: '🪴', name: 'Water plants', repeat: { every: 3, unit: 'day' }, effort: 1 },
  { emoji: '🧊', name: 'Clean out the fridge', repeat: { every: 1, unit: 'month' }, effort: 2 },
  { emoji: '🌬️', name: 'Replace HVAC filter', repeat: { every: 3, unit: 'month' }, effort: 1 },
  { emoji: '🐾', name: 'Vet visit', repeat: null, effort: 2 },
];

const EMOJIS = ['🧹', '🧽', '🛁', '🚽', '🗑️', '🧺', '🛏️', '🍽️', '🪴', '🧊', '🚗', '🌿', '🐾', '🐶', '🐱', '🔧', '💡', '📦', '🛒', '🩺'];
const UNITS: { unit: RepeatUnit; label: string }[] = [{ unit: 'day', label: 'Days' }, { unit: 'week', label: 'Weeks' }, { unit: 'month', label: 'Months' }];
const MAX_EVERY: Record<RepeatUnit, number> = { day: 365, week: 52, month: 24 };

type Props = {
  chore: Chore | null;
  today: DateKey;
  members: Member[];
  me: string | null;
  onSave: (chore: ChoreInput) => boolean;
  onClose: () => void;
  /** Shown for an existing chore. */
  onDelete?: () => void;
  onRestore?: () => void;
};

export default function ChoreEditor({ chore, today, members, me, onSave, onClose, onDelete, onRestore }: Props) {
  const [draft, setDraft] = useState<ChoreInput>(() => chore ? { ...chore } : { emoji: '🧹', repeat: { every: 1, unit: 'week' }, effort: 2, due: today, fromDone: true });
  const set = (patch: ChoreInput) => setDraft((d) => ({ ...d, ...patch }));
  const repeat = draft.repeat ?? null;
  const effort = (draft.effort ?? 2) as ChoreEffort;

  const setEvery = (every: number) => repeat && set({ repeat: { ...repeat, every: Math.min(MAX_EVERY[repeat.unit], Math.max(1, every)) } });
  const save = () => { if (onSave(draft)) onClose(); };

  return (
    <HabitSheet
      title={chore ? 'Edit chore' : 'New chore'}
      onClose={onClose}
      footer={<>
        <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={!draft.name?.trim()}>{chore ? 'Save' : 'Add chore'}</button>
      </>}
    >
      {!chore && (
        <>
          <span className="hb-label">Quick start</span>
          <div className="hb-chips">
            {CHORE_TEMPLATES.map((t) => (
              <button key={t.name} type="button" className="hb-chip" aria-pressed={draft.name === t.name}
                onClick={() => setDraft({ fromDone: true, ...t, due: t.repeat ? today : null, color: draft.color, assignee: draft.assignee })}>
                <span aria-hidden>{t.emoji}</span> {t.name}
              </button>
            ))}
          </div>
        </>
      )}

      <label className="hb-label" htmlFor="ch-name">Name</label>
      <input id="ch-name" value={draft.name ?? ''} maxLength={60} placeholder="e.g. Mop the kitchen"
        onChange={(e) => set({ name: e.target.value })} />

      <span className="hb-label" id="ch-emoji-label">Icon</span>
      <div className="hb-emoji-row" role="radiogroup" aria-labelledby="ch-emoji-label">
        {EMOJIS.map((e) => (
          <button key={e} type="button" role="radio" aria-checked={draft.emoji === e} className="hb-emoji-pick" onClick={() => set({ emoji: e })}>{e}</button>
        ))}
        <input className="hb-emoji-input" aria-label="Or type any emoji" value={draft.emoji ?? ''} maxLength={8}
          onChange={(e) => set({ emoji: e.target.value })} />
      </div>

      <span className="hb-label" id="ch-color-label">Color</span>
      <div className="hb-swatches" role="radiogroup" aria-labelledby="ch-color-label">
        {COLOR_NAMES.map((name, i) => (
          <button key={name} type="button" role="radio" aria-checked={draft.color === i + 1} aria-label={name} title={name}
            className="hb-swatch" style={{ background: `var(--habit-${i + 1})` }} onClick={() => set({ color: i + 1 })} />
        ))}
      </div>

      <span className="hb-label">How often</span>
      <div className="hb-seg" role="radiogroup" aria-label="How often">
        <button type="button" role="radio" aria-checked={!!repeat} onClick={() => set({ repeat: repeat ?? { every: 1, unit: 'week' }, due: draft.due ?? today })}>Repeats</button>
        <button type="button" role="radio" aria-checked={!repeat} onClick={() => set({ repeat: null })}>One time</button>
      </div>
      {repeat && (
        <>
          <div className="hb-stepper">
            <button type="button" aria-label="Less often" onClick={() => setEvery(repeat.every - 1)} disabled={repeat.every <= 1}>−</button>
            <span>Every <strong>{repeat.every === 1 ? '' : `${repeat.every} `}{repeat.unit}{repeat.every === 1 ? '' : 's'}</strong></span>
            <button type="button" aria-label="More apart" onClick={() => setEvery(repeat.every + 1)} disabled={repeat.every >= MAX_EVERY[repeat.unit]}>+</button>
          </div>
          <div className="hb-seg ch-units" role="radiogroup" aria-label="Repeat unit">
            {UNITS.map((u) => (
              <button key={u.unit} type="button" role="radio" aria-checked={repeat.unit === u.unit}
                onClick={() => set({ repeat: { unit: u.unit, every: Math.min(MAX_EVERY[u.unit], repeat.every) } })}>{u.label}</button>
            ))}
          </div>
        </>
      )}

      <label className="hb-label" htmlFor="ch-due">{repeat ? 'Next due' : 'Due date (optional)'}</label>
      <div className="ch-date-row">
        <input id="ch-due" type="date" value={draft.due ?? ''} onChange={(e) => set({ due: e.target.value || (repeat ? today : null) })} />
        {!repeat && draft.due && <button type="button" className="hb-small-btn" onClick={() => set({ due: null })}>No date</button>}
      </div>

      {repeat && (
        <>
          <span className="hb-label">After it’s done</span>
          <div className="hb-seg" role="radiogroup" aria-label="After it’s done">
            <button type="button" role="radio" aria-checked={draft.fromDone !== false} onClick={() => set({ fromDone: true })}>Count from that day</button>
            <button type="button" role="radio" aria-checked={draft.fromDone === false} onClick={() => set({ fromDone: false })}>Keep the schedule</button>
          </div>
          <p className="hb-hint">
            {draft.fromDone !== false
              ? 'Done late? The next one is a full repeat after the day it was actually done.'
              : 'Stays on the calendar (bins every Monday), however early or late it got done.'}
          </p>
        </>
      )}

      <span className="hb-label">How big a job</span>
      <div className="hb-seg" role="radiogroup" aria-label="How big a job">
        {([1, 2, 3] as const).map((e) => (
          <button key={e} type="button" role="radio" aria-checked={effort === e} onClick={() => set({ effort: e })}>
            {EFFORT_LABEL[e]} · {CHORE_XP.effort[e]} XP
          </button>
        ))}
      </div>
      <p className="hb-hint">+{CHORE_XP.onTime} XP when it’s done by its due date, and a bonus for keeping it on time in a row.</p>

      {members.length > 1 && (
        <>
          <label className="hb-label" htmlFor="ch-who">Who does it</label>
          <select id="ch-who" value={draft.assignee ?? ''} onChange={(e) => set({ assignee: e.target.value || null })}>
            <option value="">Anyone</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.id === me ? `${m.name} (you)` : m.name}</option>)}
          </select>
        </>
      )}

      <label className="hb-label" htmlFor="ch-notes">Notes</label>
      <textarea id="ch-notes" rows={2} maxLength={300} value={draft.notes ?? ''} placeholder="Anything to remember (which filter size, the vet’s number…)"
        onChange={(e) => set({ notes: e.target.value })} />

      {chore && (
        <div className="ch-editor-extra">
          {!isOpen(chore) && onRestore && <button type="button" className="hb-small-btn" onClick={() => { onRestore(); onClose(); }}>Put back on the list</button>}
          {onDelete && <button type="button" className="hb-small-btn ch-danger" onClick={onDelete}>Delete chore</button>}
        </div>
      )}
    </HabitSheet>
  );
}

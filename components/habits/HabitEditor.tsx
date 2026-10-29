'use client';

import { useState } from 'react';
import HabitSheet from './HabitSheet';
import { COLOR_SLOTS, type Habit, type HabitInput, type HabitKind, type HabitLink, type HabitSchedule } from '@/lib/habits/habits';

export const COLOR_NAMES = ['Blue', 'Orange', 'Aqua', 'Yellow', 'Pink', 'Green', 'Violet', 'Red'];

export const TEMPLATES: HabitInput[] = [
  { emoji: '💧', name: 'Drink water', kind: 'count', target: 8, unit: 'glasses' },
  { emoji: '🏋️', name: 'Work out', kind: 'check', schedule: { type: 'weekly', times: 3 }, link: 'workout' },
  { emoji: '🧠', name: 'Daily engineering question', kind: 'check', link: 'daily-question' },
  { emoji: '✍️', name: 'Journal', kind: 'check', link: 'journal' },
  { emoji: '📖', name: 'Read', kind: 'duration', target: 20 },
  { emoji: '🧘', name: 'Meditate', kind: 'duration', target: 10 },
  { emoji: '🚶', name: 'Go for a walk', kind: 'check' },
  { emoji: '🥤', name: 'No soda', kind: 'avoid' },
  { emoji: '😴', name: 'In bed by 11', kind: 'check' },
  { emoji: '🦷', name: 'Floss', kind: 'check' },
];

const EMOJIS = ['✅', '💧', '🏃', '🏋️', '📖', '🧘', '🥗', '😴', '🦷', '✍️', '🎸', '🧠', '💊', '🌞', '🚭', '📵'];
const KINDS: { kind: HabitKind; label: string; hint: string }[] = [
  { kind: 'check', label: 'Do it', hint: 'Hold to mark it done.' },
  { kind: 'count', label: 'Count', hint: 'Tap to add one until you reach your goal.' },
  { kind: 'duration', label: 'Minutes', hint: 'Tap to add minutes until you reach your goal.' },
  { kind: 'avoid', label: 'Avoid', hint: 'Hold each day you stayed clean; log a slip if you didn’t.' },
];
const WEEKDAYS = [[1, 'M'], [2, 'T'], [3, 'W'], [4, 'T'], [5, 'F'], [6, 'S'], [0, 'S']] as const;
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

type Props = {
  habit: Habit | null;
  onSave: (habit: HabitInput) => boolean;
  onClose: () => void;
  /** Shown for an existing habit. */
  onManage?: () => void;
};

export default function HabitEditor({ habit, onSave, onClose, onManage }: Props) {
  const [draft, setDraft] = useState<HabitInput>(() => habit ? { ...habit } : { emoji: '✅', kind: 'check', schedule: { type: 'daily' } });
  const set = (patch: HabitInput) => setDraft((d) => ({ ...d, ...patch }));
  const schedule: HabitSchedule = draft.schedule ?? { type: 'daily' };
  const kind = draft.kind ?? 'check';

  const setKind = (next: HabitKind) => set({
    kind: next,
    target: next === 'count' ? (kind === 'count' ? draft.target : 8) : next === 'duration' ? (kind === 'duration' ? draft.target : 15) : 1,
    link: next === 'check' ? draft.link : undefined,
  });
  const toggleDay = (day: number) => {
    const days = schedule.type === 'weekdays' ? schedule.days : [1, 2, 3, 4, 5];
    const next = days.includes(day) ? days.filter((d) => d !== day) : [...days, day];
    if (next.length) set({ schedule: { type: 'weekdays', days: next } });
  };

  const save = () => { if (onSave(draft)) onClose(); };

  return (
    <HabitSheet
      title={habit ? 'Edit habit' : 'New habit'}
      onClose={onClose}
      footer={<>
        <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={!draft.name?.trim()}>{habit ? 'Save' : 'Add habit'}</button>
      </>}
    >
      {!habit && (
        <>
          <span className="hb-label">Quick start</span>
          <div className="hb-chips">
            {TEMPLATES.map((t) => (
              <button key={t.name} type="button" className="hb-chip" aria-pressed={draft.name === t.name}
                onClick={() => setDraft({ ...t, color: draft.color })}>
                <span aria-hidden>{t.emoji}</span> {t.name}
              </button>
            ))}
          </div>
        </>
      )}

      <label className="hb-label" htmlFor="hb-name">Name</label>
      <input id="hb-name" value={draft.name ?? ''} maxLength={60} placeholder="e.g. Stretch for 5 minutes"
        onChange={(e) => set({ name: e.target.value })} />

      <span className="hb-label" id="hb-emoji-label">Icon</span>
      <div className="hb-emoji-row" role="radiogroup" aria-labelledby="hb-emoji-label">
        {EMOJIS.map((e) => (
          <button key={e} type="button" role="radio" aria-checked={draft.emoji === e} className="hb-emoji-pick" onClick={() => set({ emoji: e })}>{e}</button>
        ))}
        <input className="hb-emoji-input" aria-label="Or type any emoji" value={draft.emoji ?? ''} maxLength={8}
          onChange={(e) => set({ emoji: e.target.value })} />
      </div>

      <span className="hb-label" id="hb-color-label">Color</span>
      <div className="hb-swatches" role="radiogroup" aria-labelledby="hb-color-label">
        {Array.from({ length: COLOR_SLOTS }, (_, i) => i + 1).map((c) => (
          <button key={c} type="button" role="radio" aria-checked={draft.color === c} aria-label={COLOR_NAMES[c - 1]} title={COLOR_NAMES[c - 1]}
            className="hb-swatch" style={{ background: `var(--habit-${c})` }} onClick={() => set({ color: c })} />
        ))}
      </div>

      <span className="hb-label">Type</span>
      <div className="hb-seg" role="radiogroup" aria-label="Type">
        {KINDS.map((k) => (
          <button key={k.kind} type="button" role="radio" aria-checked={kind === k.kind} onClick={() => setKind(k.kind)}>{k.label}</button>
        ))}
      </div>
      <p className="hb-hint">{KINDS.find((k) => k.kind === kind)?.hint}</p>

      {kind === 'count' && (
        <div className="hb-row">
          <label className="hb-field"><span>Goal</span>
            <input type="number" inputMode="numeric" min={1} max={1000} value={draft.target ?? 1} onChange={(e) => set({ target: Number(e.target.value) })} />
          </label>
          <label className="hb-field"><span>Unit</span>
            <input value={draft.unit ?? ''} maxLength={20} placeholder="times" onChange={(e) => set({ unit: e.target.value })} />
          </label>
        </div>
      )}
      {kind === 'duration' && (
        <label className="hb-field"><span>Minutes a day</span>
          <input type="number" inputMode="numeric" min={1} max={1440} value={draft.target ?? 15} onChange={(e) => set({ target: Number(e.target.value) })} />
        </label>
      )}

      <span className="hb-label">How often</span>
      <div className="hb-seg" role="radiogroup" aria-label="How often">
        <button type="button" role="radio" aria-checked={schedule.type === 'daily'} onClick={() => set({ schedule: { type: 'daily' } })}>Every day</button>
        <button type="button" role="radio" aria-checked={schedule.type === 'weekdays'} onClick={() => set({ schedule: { type: 'weekdays', days: [1, 2, 3, 4, 5] } })}>Some days</button>
        <button type="button" role="radio" aria-checked={schedule.type === 'weekly'} onClick={() => set({ schedule: { type: 'weekly', times: 3 } })}>Times a week</button>
      </div>
      {schedule.type === 'weekdays' && (
        <div className="hb-days">
          {WEEKDAYS.map(([day, letter]) => (
            <button key={day} type="button" aria-pressed={schedule.days.includes(day)} aria-label={DAY_NAMES[day]} onClick={() => toggleDay(day)}>{letter}</button>
          ))}
        </div>
      )}
      {schedule.type === 'weekly' && (
        <div className="hb-stepper">
          <button type="button" aria-label="Fewer" onClick={() => set({ schedule: { type: 'weekly', times: Math.max(1, schedule.times - 1) } })} disabled={schedule.times <= 1}>−</button>
          <span><strong>{schedule.times}</strong> {schedule.times === 1 ? 'time' : 'times'} a week, any days</span>
          <button type="button" aria-label="More" onClick={() => set({ schedule: { type: 'weekly', times: Math.min(7, schedule.times + 1) } })} disabled={schedule.times >= 7}>+</button>
        </div>
      )}

      {kind === 'check' && (
        <>
          <label className="hb-label" htmlFor="hb-link">Tick off automatically</label>
          <select id="hb-link" value={draft.link ?? ''} onChange={(e) => set({ link: (e.target.value || undefined) as HabitLink | undefined })}>
            <option value="">No, I’ll check it myself</option>
            <option value="workout">On days I log a workout</option>
            <option value="daily-question">On days I do the daily question</option>
            <option value="journal">On days I write in my journal</option>
          </select>
        </>
      )}

      {habit && onManage && (
        <button type="button" className="hb-text-btn hb-manage-link" onClick={onManage}>Archive, delete or reorder habits…</button>
      )}
    </HabitSheet>
  );
}

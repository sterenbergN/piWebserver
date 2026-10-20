'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { isDone, type Habit } from '@/lib/habits/habits';
import { XP } from '@/lib/habits/stats';

const HOLD_MS = 550;

export const habitColor = (habit: Pick<Habit, 'color'>) => ({ '--hb-color': `var(--habit-${habit.color})` }) as CSSProperties;

function vibrate(pattern: number | number[]) {
  try { navigator.vibrate?.(pattern); } catch { /* not supported */ }
}

/** A ring that fills while you hold; let go early and nothing happens. */
function HoldButton({ done, label, symbol, onHold, disabled }: { done: boolean; label: string; symbol: string; onHold: () => void; disabled?: boolean }) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
  };
  useEffect(() => cancel, []);

  return (
    <button
      type="button"
      className={`hb-hold${done ? ' is-done' : ''}${holding ? ' is-holding' : ''}`}
      aria-label={label}
      aria-pressed={done}
      disabled={disabled}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        setHolding(true);
        timer.current = setTimeout(() => { timer.current = null; setHolding(false); onHold(); }, HOLD_MS);
      }}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onContextMenu={(e) => e.preventDefault()}
      // Keyboards and screen readers send a click with no pointer (detail 0): no hold needed.
      onClick={(e) => { if (e.detail === 0) onHold(); }}
    >
      <svg viewBox="0 0 48 48" aria-hidden>
        <circle className="hb-ring-track" cx="24" cy="24" r="21" />
        <circle className="hb-ring-fill" cx="24" cy="24" r="21" pathLength={100} />
      </svg>
      <span className="hb-hold-symbol">{symbol}</span>
    </button>
  );
}

/** Tap the ring to add, minus to take away; the ring shows progress to the target. */
function Counter({ habit, value, onSet, disabled }: { habit: Habit; value: number; onSet: (v: number) => void; disabled?: boolean }) {
  const step = habit.kind === 'duration' ? (habit.target >= 30 ? 10 : habit.target >= 5 ? 5 : 1) : 1;
  const share = Math.min(1, value / habit.target);
  const unit = habit.kind === 'duration' ? 'min' : habit.unit;
  return (
    <div className="hb-counter">
      <button type="button" className="hb-step" onClick={() => onSet(Math.max(0, value - step))} disabled={disabled || value <= 0} aria-label={`Remove ${step} ${unit}`}>−</button>
      <button type="button" className={`hb-ring-btn${isDone(habit, value) ? ' is-done' : ''}`} onClick={() => onSet(value + step)} disabled={disabled}
        aria-label={`Add ${step} ${unit} (now ${value} of ${habit.target})`}>
        <svg viewBox="0 0 48 48" aria-hidden>
          <circle className="hb-ring-track" cx="24" cy="24" r="21" />
          <circle className="hb-ring-fill" cx="24" cy="24" r="21" pathLength={100} style={{ strokeDashoffset: 100 - share * 100, opacity: share > 0 ? 1 : 0 }} />
        </svg>
        <span className="hb-count">{value}<small>/{habit.target}</small></span>
      </button>
    </div>
  );
}

type Props = {
  habit: Habit;
  value: number | undefined;
  /** "🔥 5-day streak", "2 of 3 this week", … */
  meta: string;
  onSet: (value: number) => void;
  disabled?: boolean;
};

export default function HabitCard({ habit, value = 0, meta, onSet, disabled }: Props) {
  const done = isDone(habit, value);
  const slipped = habit.kind === 'avoid' && value === -1;
  const [burst, setBurst] = useState(0);
  const wasDone = useRef(done);

  // Pop and float "+XP" when the habit becomes done (not when the page loads already done).
  useEffect(() => {
    if (done && !wasDone.current) setBurst(Date.now());
    wasDone.current = done;
  }, [done]);

  const set = (next: number) => {
    if (isDone(habit, next) && !done) vibrate(30);
    onSet(next);
  };

  return (
    <div className={`hb-card${done ? ' is-done' : ''}${slipped ? ' is-slipped' : ''}`} style={habitColor(habit)}>
      {/* Keyed by the burst so the pop replays on every completion. */}
      <span key={burst} className={`hb-emoji${burst ? ' is-popped' : ''}`} aria-hidden>{habit.emoji}</span>
      <div className="hb-card-text">
        <strong>{habit.name}</strong>
        <span className="hb-meta">{meta}</span>
        {habit.kind === 'avoid' && !disabled && (
          <button type="button" className="hb-text-btn" onClick={() => onSet(slipped ? 0 : -1)}>
            {slipped ? 'Undo slip' : 'I slipped'}
          </button>
        )}
      </div>
      {habit.kind === 'check' && (
        <HoldButton done={done} symbol={done ? '✓' : ''} disabled={disabled}
          label={done ? `${habit.name}: done. Hold to undo` : `${habit.name}: hold to mark done`}
          onHold={() => set(done ? 0 : 1)} />
      )}
      {habit.kind === 'avoid' && (
        <HoldButton done={done} symbol={done ? '✓' : slipped ? '✕' : ''} disabled={disabled}
          label={done ? `${habit.name}: stayed clean. Hold to undo` : `${habit.name}: hold if you stayed clean`}
          onHold={() => set(done ? 0 : 1)} />
      )}
      {(habit.kind === 'count' || habit.kind === 'duration') && (
        <Counter habit={habit} value={Math.max(0, value)} onSet={set} disabled={disabled} />
      )}
      {burst > 0 && <span key={burst} className="hb-xp-float" aria-hidden>+{XP.habit} XP</span>}
    </div>
  );
}

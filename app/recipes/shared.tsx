'use client';

import React from 'react';
import {
  formatBomAmount,
  formatIngredientAmount,
  formatTemp,
  parseStepTokens,
  type BomItem,
  type TimerToken,
  type UnitMode,
} from '@/lib/recipes/recipes';
import { isRunning, secondsLeft, type RecipeTimers } from './useRecipeTimers';

// ︎ keeps the play sign as text (phones otherwise draw it as a blue emoji).
export const PLAY = '▶︎';
export const PAUSE = '❚❚';

export function formatClock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const rem = String(s % 60).padStart(2, '0');
  return hrs > 0 ? `${hrs}:${String(mins).padStart(2, '0')}:${rem}` : `${mins}:${rem}`;
}

export const timerIdFor = (recipeId: string, stepKey: string, segIdx: number) => `${recipeId}:${stepKey}:${segIdx}`;
export const timerLabel = (sectionName: string, stepIndex: number) => `${sectionName || 'Timer'} · step ${stepIndex + 1}`;

/** A step's sentence, with its amounts and temperatures in the chosen units and scale. */
export function StepText({
  step,
  scale,
  unitMode,
  renderTimer,
}: {
  step: string;
  scale: number;
  unitMode: UnitMode;
  renderTimer: (seg: TimerToken, segIdx: number) => React.ReactNode;
}) {
  return (
    <>
      {parseStepTokens(step).map((seg, i) => {
        if (seg.kind === 'text') return <React.Fragment key={i}>{seg.text}</React.Fragment>;
        if (seg.kind === 'temp') return <strong key={i} className="rc-amt">{formatTemp(seg, unitMode)}</strong>;
        if (seg.kind === 'timer') return <React.Fragment key={i}>{renderTimer(seg, i)}</React.Fragment>;
        const amount = formatIngredientAmount(seg, scale, unitMode);
        return (
          <React.Fragment key={i}>
            {amount && <strong className="rc-amt">{amount} </strong>}
            {seg.name}
          </React.Fragment>
        );
      })}
    </>
  );
}

/** A timer inside a step's sentence: tap to start, pause or resume. */
export function TimerChip({
  id,
  seg,
  label,
  recipeSlug,
  timers,
}: {
  id: string;
  seg: TimerToken;
  label: string;
  recipeSlug: string;
  timers: RecipeTimers;
}) {
  const t = timers.timers[id];
  const running = isRunning(t);
  const text = !t ? `${PLAY} ${seg.label}` : t.done ? '✓ Done' : `${running ? PAUSE : PLAY} ${formatClock(secondsLeft(t, timers.now))}`;
  return (
    <button
      type="button"
      className={`rc-timer-chip${running ? ' is-running' : ''}${t?.done ? ' is-done' : ''}`}
      onClick={() => timers.toggle(id, label, seg.seconds, recipeSlug)}
      aria-label={!t ? `Start ${seg.label} timer` : running ? 'Pause timer' : t.done ? 'Restart timer' : 'Resume timer'}
    >
      {text}
    </button>
  );
}

/** Running and finished timers, as a row that scrolls sideways when there are many. */
export function TimerPills({
  timers,
  hide,
  onOpenRecipe,
}: {
  timers: RecipeTimers;
  /** Timers shown elsewhere on the screen. */
  hide?: (id: string) => boolean;
  onOpenRecipe?: (slug: string) => void;
}) {
  const list = Object.values(timers.timers).filter((t) => !hide?.(t.id));
  if (!list.length) return null;
  return (
    <div className="rc-pills" role="status" aria-live="polite">
      {list.map((t) => {
        const running = isRunning(t);
        return (
          <div key={t.id} className={`rc-pill${t.done ? ' is-done' : ''}`}>
            {onOpenRecipe ? (
              <button type="button" className="rc-pill-label" onClick={() => onOpenRecipe(t.recipeSlug)}>
                {t.label}
              </button>
            ) : (
              <span className="rc-pill-label">{t.label}</span>
            )}
            <strong>{t.done ? 'Done' : formatClock(secondsLeft(t, timers.now))}</strong>
            <button
              type="button"
              className="rc-pill-btn"
              onClick={() => timers.toggle(t.id, t.label, t.totalSec, t.recipeSlug)}
              aria-label={running ? 'Pause timer' : t.done ? 'Restart timer' : 'Resume timer'}
            >
              {running ? PAUSE : PLAY}
            </button>
            <button type="button" className="rc-pill-btn" onClick={() => timers.dismiss(t.id)} aria-label="Dismiss timer">
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** Copy a shopping list as a Markdown checklist. Resolves false if the clipboard isn't available. */
export async function copyShoppingList(items: BomItem[], scale: number, unitMode: UnitMode, heading: string) {
  const lines = items.map((item) => {
    const amount = formatBomAmount(item, scale, unitMode);
    return `- [ ] ${amount ? `${amount} ` : ''}${item.name}`;
  });
  try {
    await navigator.clipboard.writeText(`${heading}\n${lines.join('\n')}`);
    return true;
  } catch {
    return false;
  }
}

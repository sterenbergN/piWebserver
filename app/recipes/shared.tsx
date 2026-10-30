'use client';

import React, { useCallback, useEffect } from 'react';
import { readPref } from '@/lib/workout/device-prefs';
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

/** Cooking progress on this device, so a reload or leaving the recipe doesn't lose your place. */
export type SavedCook = { slug: string; title: string; step: number; scale: number; at: number; open: boolean };
export const COOK_PREF = 'recipes:cooking';
const COOK_RESUME_MS = 12 * 60 * 60 * 1000;

export function readSavedCook(): SavedCook | null {
  try {
    const saved = JSON.parse(readPref(COOK_PREF) || 'null') as SavedCook | null;
    return saved && Date.now() - saved.at < COOK_RESUME_MS ? saved : null;
  } catch {
    return null;
  }
}

/** "45 min", "1 hr 20 min". */
export function formatMinutes(minutes: number): string {
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  const rest = m % 60;
  return `${Math.floor(m / 60)} hr${rest ? ` ${rest} min` : ''}`;
}

/** The phone's back button leaves cook mode rather than the page. Returns how to close it the same way. */
export function useCookHistory(active: boolean, onExit: () => void) {
  useEffect(() => {
    if (!active) return;
    if (!window.history.state?.rcCook) window.history.pushState({ rcCook: true }, '');
    window.addEventListener('popstate', onExit);
    return () => window.removeEventListener('popstate', onExit);
  }, [active, onExit]);

  return useCallback(() => {
    if (window.history.state?.rcCook) window.history.back();
    else onExit();
  }, [onExit]);
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
            {onOpenRecipe && t.recipeSlug ? (
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

/** Ingredient rows. With `onToggle` they're tap-to-check; without, just a list. */
export function IngredientRows({
  items,
  scale,
  unitMode,
  isChecked,
  isStruck,
  onToggle,
}: {
  items: BomItem[];
  scale: number;
  unitMode: UnitMode;
  isChecked?: (item: BomItem) => boolean;
  /** Crossed out, e.g. already used in this cook. */
  isStruck?: (item: BomItem) => boolean;
  onToggle?: (item: BomItem) => void;
}) {
  return (
    <ul className="rc-ingredients">
      {items.map((item) => {
        const checked = Boolean(isChecked?.(item));
        const className = `rc-ing-row${checked ? ' is-checked' : ''}${isStruck?.(item) ? ' is-done' : ''}`;
        const content = (
          <>
            <span className="rc-check" aria-hidden="true">{checked ? '✓' : ''}</span>
            <span className="rc-ing-amt">{formatBomAmount(item, scale, unitMode)}</span>
            <span className="rc-ing-name">{item.name}</span>
          </>
        );
        return (
          <li key={item.key}>
            {onToggle ? (
              <button type="button" className={className} aria-pressed={checked} onClick={() => onToggle(item)}>
                {content}
              </button>
            ) : (
              <div className={className}>{content}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** A loud banner for each timer that has gone off, over everything including cook mode. */
export function TimerAlerts({ timers }: { timers: RecipeTimers }) {
  const ringing = Object.values(timers.timers).filter((t) => t.ringing);
  if (!ringing.length) return null;
  return (
    <div className="rc-alerts" role="alert">
      {ringing.map((t) => (
        <button key={t.id} type="button" className="rc-alert" onClick={() => timers.dismiss(t.id)}>
          <span>
            <strong>Time’s up</strong>
            <span className="rc-alert-label">{t.label}</span>
          </span>
          <span className="rc-alert-ok">OK</span>
        </button>
      ))}
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

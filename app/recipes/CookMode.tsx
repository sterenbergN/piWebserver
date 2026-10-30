'use client';

import { useEffect, useRef, useState } from 'react';
import { parseStepTokens, stepPlainText, type BomItem, type GanttBlock, type Recipe, type TimerToken, type UnitMode } from '@/lib/recipes/recipes';
import { IngredientRows, PAUSE, PLAY, StepText, TimerPills, formatClock, timerIdFor, timerLabel } from './shared';
import { isRunning, secondsLeft, type RecipeTimers } from './useRecipeTimers';

/** A big timer under the step: tap to start, pause or resume; fills up as it runs. */
function BigTimer({ id, seg, label, recipeSlug, timers }: { id: string; seg: TimerToken; label: string; recipeSlug: string; timers: RecipeTimers }) {
  const t = timers.timers[id];
  const running = isRunning(t);
  const left = t ? secondsLeft(t, timers.now) : seg.seconds;
  const elapsed = t && !t.done ? 1 - left / Math.max(1, t.totalSec) : t?.done ? 1 : 0;
  return (
    <div className={`rc-big-timer${running ? ' is-running' : ''}${t?.done ? ' is-done' : ''}`}>
      <button
        type="button"
        className="rc-big-timer-main"
        onClick={() => timers.toggle(id, label, seg.seconds, recipeSlug)}
        aria-label={!t ? `Start ${seg.label} timer` : running ? 'Pause timer' : t.done ? 'Restart timer' : 'Resume timer'}
      >
        <span className="rc-big-timer-fill" style={{ width: `${elapsed * 100}%` }} />
        <span className="rc-big-timer-text">
          {!t ? (
            <>
              <span aria-hidden="true">{PLAY}</span> Start {seg.label} timer
            </>
          ) : t.done ? (
            '✓ Time’s up'
          ) : (
            <>
              <strong>{formatClock(left)}</strong>
              <span className="rc-big-timer-hint">{running ? `${PAUSE} Pause` : `${PLAY} Resume`}</span>
            </>
          )}
        </span>
      </button>
      {t && (
        <button type="button" className="rc-icon-btn" onClick={() => timers.dismiss(id)} aria-label="Cancel timer">
          ×
        </button>
      )}
    </div>
  );
}

/**
 * One step at a time, filling the screen, with the buttons where a thumb
 * reaches: every part of the recipe merged in the order to do things, so a
 * phone propped on the counter never needs scrolling.
 */
export default function CookMode({
  recipe,
  order,
  bom,
  isIngredientUsed,
  sectionScales,
  step,
  scale,
  unitMode,
  timers,
  canLog,
  cookLogged,
  rating,
  onRate,
  onStep,
  onClose,
  onLogCook,
}: {
  recipe: Recipe;
  order: GanttBlock[];
  bom: BomItem[];
  isIngredientUsed?: (item: BomItem) => boolean;
  /** For a prep session: each section's own scale, instead of `scale`. */
  sectionScales?: number[];
  step: number;
  scale: number;
  unitMode: UnitMode;
  timers: RecipeTimers;
  canLog: boolean;
  cookLogged: boolean;
  rating?: number;
  onRate?: (rating: number) => void;
  onStep: (step: number) => void;
  onClose: () => void;
  onLogCook: (undo?: boolean) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [showIngredients, setShowIngredients] = useState(false);
  const finished = step >= order.length;
  const block = finished ? null : order[step];
  const text = block ? recipe.sections[block.sectionIndex]?.steps[block.stepIndex] ?? '' : '';
  const next = order[step + 1];
  const nextText = next ? stepPlainText(recipe.sections[next.sectionIndex]?.steps[next.stepIndex] ?? '') : '';

  // The page behind doesn't scroll; arrow keys and Escape work on a laptop.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    rootRef.current?.focus();
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  const stepRef = useRef({ step, finished, showIngredients });
  useEffect(() => {
    stepRef.current = { step, finished, showIngredients };
  }, [step, finished, showIngredients]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const cur = stepRef.current;
      if (cur.showIngredients) {
        if (e.key === 'Escape') setShowIngredients(false);
      } else if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight' && !cur.finished) onStep(cur.step + 1);
      else if (e.key === 'ArrowLeft' && cur.step > 0) onStep(cur.step - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onStep]);

  // Swipe sideways between steps.
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchStart.current;
    touchStart.current = null;
    const touch = e.changedTouches[0];
    if (!start || !touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (dx < 0 && !finished) onStep(step + 1);
    if (dx > 0 && step > 0) onStep(step - 1);
  };

  // Timers from this step sit under it; any others stay in view along the bottom.
  const stepTimers = block
    ? parseStepTokens(text).flatMap((seg, i) =>
        seg.kind === 'timer' ? [{ seg, id: timerIdFor(recipe.id, block.stepKey, i) }] : [],
      )
    : [];
  const stepTimerIds = new Set(stepTimers.map((t) => t.id));

  return (
    <div
      ref={rootRef}
      className="rc-cook"
      role="dialog"
      aria-modal="true"
      aria-label={`Cooking ${recipe.title}`}
      tabIndex={-1}
      onTouchStart={(e) => {
        const touch = e.touches[0];
        touchStart.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
      }}
      onTouchEnd={onTouchEnd}
    >
      <div className="rc-cook-top">
        <button type="button" className="rc-icon-btn" onClick={onClose} aria-label="Leave cook mode">
          ×
        </button>
        <span className="rc-meta">{finished ? 'Finished' : `Step ${step + 1} of ${order.length}`}</span>
        <button type="button" className="rc-text-btn rc-cook-peek" onClick={() => setShowIngredients(true)}>
          Ingredients
        </button>
      </div>
      <div className="rc-cook-progress" aria-hidden="true">
        <div style={{ width: `${(Math.min(step, order.length) / Math.max(1, order.length)) * 100}%` }} />
      </div>

      {block ? (
        <div className="rc-cook-body" aria-live="polite">
          {recipe.sections.length > 1 && <div className="rc-cook-part">{block.sectionName}</div>}
          <p className="rc-cook-text">
            <StepText step={text} scale={sectionScales?.[block.sectionIndex] ?? scale} unitMode={unitMode} renderTimer={(seg) => <strong className="rc-amt">{seg.label}</strong>} />
          </p>
          {stepTimers.map(({ seg, id }) => (
            <BigTimer
              key={id}
              id={id}
              seg={seg}
              label={timerLabel(block.sectionName, block.stepIndex)}
              recipeSlug={recipe.slug}
              timers={timers}
            />
          ))}
        </div>
      ) : (
        <div className="rc-cook-body rc-cook-finish">
          <h2>All done</h2>
          <p className="rc-meta">Enjoy your {recipe.title.toLowerCase()}.</p>
          {canLog &&
            (cookLogged ? (
              <button type="button" className="btn btn-secondary" onClick={() => onLogCook(true)}>
                ✓ Logged · Undo
              </button>
            ) : (
              <button type="button" className="btn btn-secondary" onClick={() => onLogCook()}>
                Log this cook
              </button>
            ))}
          {onRate && (
            <div className="rc-rate" role="group" aria-label="Rate this recipe">
              <span className="rc-meta">How was it?</span>
              <div>
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    className={(rating || 0) >= star * 2 ? 'is-on' : ''}
                    aria-label={`${star} of 5 stars`}
                    onClick={() => onRate(star * 2)}
                  >
                    ★
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="rc-cook-foot">
        <TimerPills timers={timers} hide={(id) => stepTimerIds.has(id)} />
        {next && <div className="rc-cook-next rc-meta">Next: {nextText}</div>}
        <div className="rc-cook-nav">
          <button type="button" className="btn btn-secondary" disabled={step === 0} onClick={() => onStep(step - 1)}>
            Back
          </button>
          {finished ? (
            <button type="button" className="btn btn-primary" onClick={onClose}>
              Close
            </button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={() => onStep(step + 1)}>
              {step === order.length - 1 ? 'Finish' : 'Next'}
            </button>
          )}
        </div>
      </div>

      {showIngredients && (
        <div
          className="rc-sheet-backdrop"
          onClick={() => setShowIngredients(false)}
          onTouchStart={(e) => e.stopPropagation()}
          onTouchEnd={(e) => e.stopPropagation()}
        >
          <div className="rc-sheet" role="dialog" aria-modal="true" aria-label="Ingredients" onClick={(e) => e.stopPropagation()}>
            <div className="rc-sheet-head">
              <h2>Ingredients</h2>
              <button type="button" className="rc-icon-btn" onClick={() => setShowIngredients(false)} aria-label="Close">
                ×
              </button>
            </div>
            <IngredientRows items={bom} scale={scale} unitMode={unitMode} isChecked={isIngredientUsed} isStruck={isIngredientUsed} />
          </div>
        </div>
      )}
    </div>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import { madeKey, parseStepTokens, stepPlainText, type BomItem, type GanttBlock, type Recipe, type TimerToken, type UnitMode } from '@/lib/recipes/recipes';
import { IngredientRows, PAUSE, PLAY, StepText, TimerPills, formatClock, timerIdFor, timerLabel } from './shared';
import type { Kitchen } from './useKitchen';
import { isRunning, secondsLeft, type RecipeTimers } from './useRecipeTimers';

/** The moment you know best what's left: one tap for low, another for gone, a third to take it back. */
function RanOutChips({ bom, kitchen }: { bom: BomItem[]; kitchen: Kitchen }) {
  const items = bom.filter((item) => kitchen.state.have.includes(item.key) || kitchen.state.pantry[item.key]?.out).slice(0, 12);
  if (!items.length) return null;
  return (
    <div className="rc-ranout">
      <span className="rc-meta">Anything run out? Tap once if it’s low, twice if it’s gone.</span>
      <div className="rc-have-chips">
        {items.map((item) => {
          const detail = kitchen.state.pantry[item.key];
          const state = detail?.out ? 'out' : detail?.low ? 'low' : 'ok';
          return (
            <button
              key={item.key}
              type="button"
              className={`rc-chip${state !== 'ok' ? ' is-active' : ''}`}
              onClick={() => {
                if (state === 'ok') kitchen.setPantry(item.key, item.name, { low: true });
                else if (state === 'low') kitchen.ranOut(item.key, item.name);
                else kitchen.setPantry(item.key, item.name, { low: false });
              }}
            >
              {item.name}
              {state !== 'ok' ? ` · ${state}` : ''}
            </button>
          );
        })}
      </div>
    </div>
  );
}

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

const COOK_FINISH_CHIPS = ['Spot on', 'More seasoning', 'Less time', 'More time', 'Keeper'] as const;

export function ratingDescriptor(rating?: number | null): string {
  if (!rating || rating <= 0) return '';
  if (rating >= 9.8) return 'Perfect';
  if (rating >= 9) return 'Favorite';
  if (rating >= 8) return 'Great';
  if (rating >= 7) return 'Very good';
  if (rating >= 6) return 'Good';
  if (rating >= 5) return 'Okay';
  if (rating >= 3) return 'Fair';
  return 'Needs work';
}

export function formatScoreLabel(rating?: number | null): string {
  if (!rating || rating <= 0) return 'Unrated';
  const num = Number.isInteger(rating) ? String(rating) : rating.toFixed(1);
  return `★ ${num} · ${ratingDescriptor(rating)}`;
}

export function appendTweakNote(current: string, chip: string): string {
  const trimmed = current.trim();
  if (!trimmed) return chip;
  if (trimmed.toLowerCase().endsWith(chip.toLowerCase())) return trimmed;
  const sep = /[.!?]$/.test(trimmed) || /[,;]$/.test(trimmed) ? ' ' : ', ';
  return `${trimmed}${sep}${chip}`;
}

/** Combined 5-star and 1–10 pill rating control with descriptor label and clear action. */
export function RatingPicker({
  value,
  onChange,
  disabled,
  label = 'Rating from 1 to 10',
}: {
  value?: number | null;
  onChange: (next: number | null) => void;
  disabled?: boolean;
  label?: string;
}) {
  const current = value && value > 0 ? value : 0;
  return (
    <div className="rc-rate-box">
      <div className="rc-rate-head">
        <div className="rc-rate-stars" role="group" aria-label="Star rating">
          {[1, 2, 3, 4, 5].map((star) => {
            const full = current >= star * 2;
            const half = !full && current >= star * 2 - 1;
            return (
              <button
                key={star}
                type="button"
                className={full ? 'is-on' : half ? 'is-half' : ''}
                disabled={disabled}
                aria-label={`${star} of 5 stars (${star * 2} of 10)`}
                onClick={() => onChange(star * 2)}
              >
                ★
              </button>
            );
          })}
        </div>
        <div className="rc-rate-meta">
          <span className={`rc-rate-label${current ? '' : ' is-empty'}`}>{formatScoreLabel(current)}</span>
          {current > 0 && !disabled && (
            <button type="button" className="rc-text-btn rc-rate-clear" onClick={() => onChange(null)}>
              Clear
            </button>
          )}
        </div>
      </div>
      <div className="rc-rate-pills" role="group" aria-label={label}>
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
          <button
            key={n}
            type="button"
            className={`rc-rate-pill${current === n ? ' is-active' : ''}`}
            aria-pressed={current === n}
            disabled={disabled}
            onClick={() => onChange(n)}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

/** One-tap chips that append quick cooking observations into a note field. */
export function TweakChips({
  chips,
  onPick,
  disabled,
}: {
  chips: readonly string[];
  onPick: (chip: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="rc-tweak-chips">
      {chips.map((chip) => (
        <button key={chip} type="button" className="rc-chip rc-tweak-chip" disabled={disabled} onClick={() => onPick(chip)}>
          + {chip}
        </button>
      ))}
    </div>
  );
}

export type CookFeedback = {
  rating: number | null;
  cookNote: string;
  notes?: string;
};

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
  onSaveNotes,
  onCompleteCook,
  kitchen,
  keepsBatch,
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
  onSaveNotes?: (notes: string) => Promise<void> | void;
  onCompleteCook?: (feedback: CookFeedback) => Promise<void> | void;
  kitchen?: Kitchen;
  /** Other recipes use this one as a part, so a batch of it is worth keeping track of. */
  keepsBatch?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [showIngredients, setShowIngredients] = useState(false);
  const [showQuickNote, setShowQuickNote] = useState(false);
  const [quickNoteText, setQuickNoteText] = useState('');
  const [savingQuickNote, setSavingQuickNote] = useState(false);

  const [finishRating, setFinishRating] = useState<number | null>(rating ?? null);
  const [ratingDirty, setRatingDirty] = useState(false);
  const [finishCookNote, setFinishCookNote] = useState('');
  const [finishPinnedNotes, setFinishPinnedNotes] = useState(recipe.notes || '');
  const [pinnedDirty, setPinnedDirty] = useState(false);
  const [showPinnedNotes, setShowPinnedNotes] = useState(false);
  const [savingFinish, setSavingFinish] = useState(false);
  const [finishSaved, setFinishSaved] = useState(false);

  useEffect(() => {
    if (!ratingDirty) setFinishRating(rating ?? null);
  }, [rating, ratingDirty]);

  useEffect(() => {
    if (!pinnedDirty) setFinishPinnedNotes(recipe.notes || '');
  }, [recipe.notes, pinnedDirty]);

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

  const stepRef = useRef({ step, finished, showIngredients, showQuickNote });
  useEffect(() => {
    stepRef.current = { step, finished, showIngredients, showQuickNote };
  }, [step, finished, showIngredients, showQuickNote]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const cur = stepRef.current;
      const targetTag = (e.target as HTMLElement | null)?.tagName;
      const typing = targetTag === 'TEXTAREA' || targetTag === 'INPUT';
      if (cur.showQuickNote) {
        if (e.key === 'Escape') setShowQuickNote(false);
        return;
      }
      if (cur.showIngredients) {
        if (e.key === 'Escape') setShowIngredients(false);
        return;
      }
      if (e.key === 'Escape') onClose();
      else if (!typing && e.key === 'ArrowRight' && !cur.finished) onStep(cur.step + 1);
      else if (!typing && e.key === 'ArrowLeft' && cur.step > 0) onStep(cur.step - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onStep]);

  // Swipe sideways between steps.
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchStart.current;
    touchStart.current = null;
    if (showIngredients || showQuickNote) return;
    const touch = e.changedTouches[0];
    if (!start || !touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (dx < 0 && !finished) onStep(step + 1);
    if (dx > 0 && step > 0) onStep(step - 1);
  };

  const openQuickNote = () => {
    setQuickNoteText(finished ? '' : `Step ${step + 1}: `);
    setShowQuickNote(true);
  };

  const saveQuickNote = async () => {
    const trimmed = quickNoteText.trim();
    if (!trimmed || !onSaveNotes || savingQuickNote) return;
    setSavingQuickNote(true);
    try {
      const nextNotes = recipe.notes?.trim() ? `${recipe.notes.trim()}\n${trimmed}` : trimmed;
      await onSaveNotes(nextNotes);
      setShowQuickNote(false);
    } finally {
      setSavingQuickNote(false);
    }
  };

  const handleCompleteCook = async () => {
    if (!onCompleteCook || savingFinish) return;
    setSavingFinish(true);
    try {
      await onCompleteCook({
        rating: finishRating,
        cookNote: finishCookNote.trim(),
        notes: pinnedDirty || showPinnedNotes ? finishPinnedNotes : undefined,
      });
      setFinishSaved(true);
    } finally {
      setSavingFinish(false);
    }
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
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (tag === 'TEXTAREA' || tag === 'INPUT') {
          touchStart.current = null;
          return;
        }
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
        <div className="rc-cook-top-actions">
          {onSaveNotes && (
            <button type="button" className="rc-text-btn rc-cook-note-btn" onClick={openQuickNote}>
              📝 Note
            </button>
          )}
          <button type="button" className="rc-text-btn rc-cook-peek" onClick={() => setShowIngredients(true)}>
            Ingredients
          </button>
        </div>
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
          {canLog && onCompleteCook ? (
            <div className="rc-cook-finish-card">
              <div className="rc-cook-finish-head">
                <h3>Rate &amp; note this cook</h3>
                {cookLogged && (
                  <span className="rc-cook-finish-status">
                    ✓ Logged
                    <button type="button" className="rc-text-btn rc-rate-clear" onClick={() => onLogCook(true)}>
                      Undo
                    </button>
                  </span>
                )}
              </div>
              <RatingPicker
                value={finishRating}
                disabled={savingFinish}
                onChange={(nextRating) => {
                  setFinishRating(nextRating);
                  setRatingDirty(true);
                  setFinishSaved(false);
                }}
              />
              <TweakChips
                chips={COOK_FINISH_CHIPS}
                disabled={savingFinish}
                onPick={(chip) => {
                  setFinishCookNote((prev) => appendTweakNote(prev, chip));
                  setFinishSaved(false);
                }}
              />
              <label className="rc-field">
                Notes for this cook
                <textarea
                  className="rc-input"
                  rows={2}
                  placeholder="How did it turn out? Any tweaks or timing observations?"
                  value={finishCookNote}
                  onChange={(e) => {
                    setFinishCookNote(e.target.value);
                    setFinishSaved(false);
                  }}
                />
              </label>
              <button type="button" className="rc-text-btn rc-pinned-toggle" onClick={() => setShowPinnedNotes((v) => !v)}>
                {showPinnedNotes
                  ? '▾ Hide recipe notes for next time'
                  : `▸ Recipe notes for next time${recipe.notes ? ' (edit)' : ' (add)'}`}
              </button>
              {!showPinnedNotes && recipe.notes && <p className="rc-meta rc-pinned-preview">{recipe.notes}</p>}
              {showPinnedNotes && (
                <label className="rc-field">
                  Recipe notes for next time
                  <textarea
                    className="rc-input"
                    rows={2}
                    placeholder="Permanent notes always shown on this recipe…"
                    value={finishPinnedNotes}
                    onChange={(e) => {
                      setFinishPinnedNotes(e.target.value);
                      setPinnedDirty(true);
                      setFinishSaved(false);
                    }}
                  />
                </label>
              )}
              <button type="button" className="btn btn-primary rc-finish-cta" disabled={savingFinish} onClick={handleCompleteCook}>
                {savingFinish
                  ? 'Saving…'
                  : cookLogged
                    ? finishSaved
                      ? '✓ Saved rating & notes'
                      : 'Save rating & notes'
                    : 'Log cook & save'}
              </button>
            </div>
          ) : (
            <>
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
            </>
          )}
          {kitchen && keepsBatch && (
            <button type="button" className="rc-paper-btn" onClick={() => kitchen.setMade(recipe, !kitchen.state.have.includes(madeKey(recipe.id)))}>
              {kitchen.state.have.includes(madeKey(recipe.id)) ? '✓ The rest is in the pantry' : 'Keep the rest for other recipes'}
            </button>
          )}
          {kitchen && <RanOutChips bom={bom} kitchen={kitchen} />}
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

      {showQuickNote && (
        <div
          className="rc-sheet-backdrop"
          onClick={() => setShowQuickNote(false)}
          onTouchStart={(e) => e.stopPropagation()}
          onTouchEnd={(e) => e.stopPropagation()}
        >
          <div className="rc-sheet rc-postcook-sheet" role="dialog" aria-modal="true" aria-label="Mid-cook quick note" onClick={(e) => e.stopPropagation()}>
            <div className="rc-sheet-head">
              <h2>Quick note</h2>
              <button type="button" className="rc-icon-btn" onClick={() => setShowQuickNote(false)} aria-label="Close">
                ×
              </button>
            </div>
            {recipe.notes && <p className="rc-meta rc-note-existing">Pinned notes: {recipe.notes}</p>}
            <textarea
              className="rc-input"
              rows={3}
              placeholder="Jot down a tweak, heat adjustment, or timing note…"
              value={quickNoteText}
              onChange={(e) => setQuickNoteText(e.target.value)}
              autoFocus
            />
            <div className="rc-sheet-actions">
              <button type="button" className="btn btn-secondary" disabled={savingQuickNote} onClick={() => setShowQuickNote(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!quickNoteText.trim() || savingQuickNote}
                onClick={saveQuickNote}
              >
                {savingQuickNote ? 'Saving…' : 'Save note'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useWakeLock } from '@/components/useWakeLock';
import { mediaSrc } from '@/lib/media-url';
import { readPref, savePref } from '@/lib/workout/device-prefs';
import {
  CATEGORY_LABELS,
  buildSchedule,
  cookOrder,
  extractIngredients,
  formatBomAmount,
  formatQuantity,
  parseStepKey,
  type Recipe,
  type UnitMode,
} from '@/lib/recipes/recipes';
import CookMode from './CookMode';
import { StepText, TimerChip, TimerPills, copyShoppingList, timerIdFor, timerLabel } from './shared';
import type { RecipeTimers } from './useRecipeTimers';

type Tab = 'ingredients' | 'steps' | 'timeline';
type SavedCook = { slug: string; step: number; scale: number; at: number };

const COOK_PREF = 'recipes:cooking';
const COOK_RESUME_MS = 12 * 60 * 60 * 1000;

/** A cook in progress on this device, so a reload (or the phone dropping the tab) picks it back up. */
function readSavedCook(slug: string): SavedCook | null {
  try {
    const saved = JSON.parse(readPref(COOK_PREF) || 'null') as SavedCook | null;
    return saved && saved.slug === slug && Date.now() - saved.at < COOK_RESUME_MS ? saved : null;
  } catch {
    return null;
  }
}

export default function RecipeView({
  recipe,
  canEdit,
  canDelete,
  inCart,
  unitMode,
  timers,
  cookLogged,
  onUnitMode,
  onToggleCart,
  onBack,
  onOpenRecipe,
  onEdit,
  onDelete,
  onLogCook,
  showAlert,
}: {
  recipe: Recipe;
  canEdit: boolean;
  canDelete: boolean;
  inCart: boolean;
  unitMode: UnitMode;
  timers: RecipeTimers;
  cookLogged: boolean;
  onUnitMode: (mode: UnitMode) => void;
  onToggleCart: () => void;
  onBack: () => void;
  onOpenRecipe: (slug: string) => void;
  onEdit: () => void;
  onDelete: () => void;
  onLogCook: (undo?: boolean) => void;
  showAlert: (message: string) => Promise<void> | void;
}) {
  const bom = useMemo(() => extractIngredients(recipe), [recipe]);
  const schedule = useMemo(() => buildSchedule(recipe), [recipe]);
  const order = useMemo(() => cookOrder(schedule), [schedule]);

  const [savedCook] = useState(() => readSavedCook(recipe.slug));
  const [scale, setScale] = useState(savedCook?.scale ?? 1);
  const [tab, setTab] = useState<Tab>('ingredients');
  const [cookStep, setCookStep] = useState<number | null>(savedCook ? Math.min(savedCook.step, order.length) : null);
  const [completed, setCompleted] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(order.slice(0, savedCook?.step ?? 0).map((b) => [b.stepKey, true])),
  );
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [keepAwake, setKeepAwake] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [copied, setCopied] = useState(false);
  const [constraintKey, setConstraintKey] = useState('');
  const [constraintVal, setConstraintVal] = useState('');

  const cooking = cookStep !== null;
  useWakeLock(keepAwake || cooking);

  useEffect(() => {
    savePref(COOK_PREF, JSON.stringify(cookStep === null ? null : { slug: recipe.slug, step: cookStep, scale, at: Date.now() }));
  }, [cookStep, scale, recipe.slug]);

  // The phone's back button leaves cook mode rather than the recipe.
  useEffect(() => {
    if (!cooking) return;
    if (!window.history.state?.rcCook) window.history.pushState({ rcCook: true }, '');
    const onPop = () => setCookStep(null);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [cooking]);

  const closeCook = useCallback(() => {
    if (window.history.state?.rcCook) window.history.back();
    else setCookStep(null);
  }, []);

  const goToStep = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(next, order.length));
      setCookStep(clamped);
      setCompleted((prev) => {
        const updated = { ...prev };
        order.forEach((b, i) => {
          updated[b.stepKey] = i < clamped;
        });
        return updated;
      });
    },
    [order],
  );

  const doneCount = order.filter((b) => completed[b.stepKey]).length;
  const startCooking = () => goToStep(doneCount === order.length ? 0 : order.findIndex((b) => !completed[b.stepKey]));
  const startLabel = doneCount > 0 && doneCount < order.length ? `Continue cooking · step ${doneCount + 1}` : 'Start cooking';

  const scaledServings = Math.round(recipe.servings * scale * 10) / 10;
  const setServings = (next: number) => {
    setScale(Math.min(48, Math.max(1, next)) / recipe.servings);
    setConstraintKey('');
    setConstraintVal('');
  };

  // Scale to the amount you have of one ingredient (typed in the units on screen).
  const applyConstraint = (key: string, value: string, mode: UnitMode = unitMode) => {
    setConstraintKey(key);
    setConstraintVal(value);
    const amount = Number(value);
    const item = bom.find((b) => b.key === key);
    if (!item || !Number.isFinite(amount) || amount <= 0) return;
    const base = mode === 'metric' ? item.metricQty ?? item.usQty : item.usQty ?? item.metricQty;
    if (!base || base <= 0) return;
    const nextScale = Math.round((amount / base) * 100) / 100;
    if (nextScale > 0 && nextScale <= 20) setScale(nextScale);
  };
  const quantifiable = bom.filter((b) => b.usQty !== null || b.metricQty !== null);

  const handleCopy = async () => {
    const ok = await copyShoppingList(bom, scale, unitMode, `${recipe.title} (${formatQuantity(scaledServings, true)} servings)`);
    if (!ok) {
      await showAlert('Could not access the clipboard.');
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  const span = Math.max(1, ...schedule.tracks.flatMap((t) => t.blocks.map((b) => b.endMin)));
  const macros = recipe.macros;
  const macroParts = [
    macros?.calories ? `${macros.calories} kcal` : '',
    macros?.protein !== undefined ? `${macros.protein} g protein` : '',
    macros?.carbs !== undefined ? `${macros.carbs} g carbs` : '',
    macros?.fat !== undefined ? `${macros.fat} g fat` : '',
  ].filter(Boolean);

  const startButton = (extraClass: string) => (
    <button type="button" className={`btn btn-primary ${extraClass}`} onClick={startCooking}>
      {startLabel}
    </button>
  );

  return (
    <div className="rc-page">
      <div className="rc-bar">
        <button type="button" className="rc-text-btn" onClick={onBack}>
          ‹ Recipes
        </button>
        <div className="rc-menu-wrap">
          <button
            type="button"
            className="rc-icon-btn"
            aria-label="More actions"
            aria-expanded={showMenu}
            onClick={() => setShowMenu((v) => !v)}
          >
            ⋯
          </button>
          {showMenu && (
            <>
              <button type="button" className="rc-menu-scrim" aria-label="Close menu" onClick={() => setShowMenu(false)} />
              <div className="rc-menu" role="menu" onClick={() => setShowMenu(false)}>
                <button type="button" role="menuitem" onClick={() => setKeepAwake((v) => !v)}>
                  {keepAwake ? '✓ Keeping screen on' : 'Keep screen on'}
                </button>
                {canEdit && (
                  <button type="button" role="menuitem" onClick={() => onLogCook()}>
                    Log a cook
                  </button>
                )}
                {canEdit && (
                  <button type="button" role="menuitem" onClick={onEdit}>
                    Edit
                  </button>
                )}
                {canDelete && (
                  <button type="button" role="menuitem" className="is-danger" onClick={onDelete}>
                    Delete
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <header className="rc-head">
        <div className="rc-head-text">
          <h1>{recipe.title}</h1>
          <p className="rc-meta">
            {CATEGORY_LABELS[recipe.category]?.label} · {schedule.totalMinutes} min
            {recipe.rating ? ` · ★ ${recipe.rating.toFixed(1)}` : ''}
            {recipe.timesCooked > 0 ? ` · Cooked ${recipe.timesCooked}×` : ''}
          </p>
        </div>
        {recipe.photo && <img src={mediaSrc(recipe.photo, 400)} alt="" className="rc-head-photo" decoding="async" />}
      </header>
      {recipe.summary && <p className="rc-summary">{recipe.summary}</p>}

      <div className="rc-controls">
        <div className="rc-stepper" role="group" aria-label="Servings">
          <button
            type="button"
            aria-label="Fewer servings"
            disabled={scaledServings <= 1}
            onClick={() => setServings(Math.round(scaledServings) - 1)}
          >
            −
          </button>
          <span>
            {formatQuantity(scaledServings, true)} {scaledServings === 1 ? 'serving' : 'servings'}
          </span>
          <button type="button" aria-label="More servings" onClick={() => setServings(Math.round(scaledServings) + 1)}>
            +
          </button>
        </div>
        <div className="rc-seg" role="group" aria-label="Units">
          {(['us', 'metric'] as UnitMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              className={unitMode === mode ? 'is-active' : ''}
              aria-pressed={unitMode === mode}
              onClick={() => {
                onUnitMode(mode);
                if (constraintKey) applyConstraint(constraintKey, constraintVal, mode);
              }}
            >
              {mode === 'us' ? 'US' : 'Metric'}
            </button>
          ))}
        </div>
      </div>

      {/* One panel at a time on a phone; side by side on a wider screen. */}
      <div className="rc-tabs" role="tablist">
        {(
          [
            ['ingredients', `Ingredients`],
            ['steps', 'Steps'],
            ['timeline', 'Timeline'],
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'is-active' : ''} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      <div className="rc-body">
        <section className={`rc-panel rc-panel-ingredients${tab === 'ingredients' ? ' is-active' : ''}`} aria-label="Ingredients">
          <h2 className="rc-panel-title">Ingredients</h2>
          <ul className="rc-ingredients">
            {bom.map((item) => {
              const used = item.stepKeys.length > 0 && item.stepKeys.every((key) => completed[key]);
              const isDone = used || Boolean(checked[item.key]);
              return (
                <li key={item.key}>
                  <button
                    type="button"
                    className={`rc-ing-row${isDone ? ' is-done' : ''}`}
                    aria-pressed={isDone}
                    onClick={() => setChecked((prev) => ({ ...prev, [item.key]: !isDone }))}
                  >
                    <span className="rc-check" aria-hidden="true">{isDone ? '✓' : ''}</span>
                    <span className="rc-ing-amt">{formatBomAmount(item, scale, unitMode)}</span>
                    <span>{item.name}</span>
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="rc-links">
            <button type="button" className="rc-text-btn" onClick={onToggleCart}>
              {inCart ? '✓ On grocery list' : '+ Grocery list'}
            </button>
            <button type="button" className="rc-text-btn" onClick={handleCopy}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>

          {quantifiable.length > 0 && (
            <details className="rc-details">
              <summary>Scale to what you have</summary>
              <div className="rc-constraint">
                <select
                  className="rc-input"
                  aria-label="Ingredient you have a limited amount of"
                  value={constraintKey}
                  onChange={(e) => applyConstraint(e.target.value, constraintVal)}
                >
                  <option value="">Choose an ingredient</option>
                  {quantifiable.map((item) => {
                    const unit = unitMode === 'metric' ? item.metricUnit || item.usUnit : item.usUnit || item.metricUnit;
                    return (
                      <option key={item.key} value={item.key}>
                        {item.name}
                        {unit ? ` (${unit})` : ''}
                      </option>
                    );
                  })}
                </select>
                <input
                  type="number"
                  step="any"
                  min="0"
                  inputMode="decimal"
                  className="rc-input"
                  placeholder="Amount"
                  aria-label="Amount you have"
                  disabled={!constraintKey}
                  value={constraintVal}
                  onChange={(e) => applyConstraint(constraintKey, e.target.value)}
                />
              </div>
            </details>
          )}

          {(recipe.equipment.length > 0 || macroParts.length > 0) && (
            <div className="rc-facts">
              {recipe.equipment.length > 0 && <p>You’ll need: {recipe.equipment.join(', ')}</p>}
              {macroParts.length > 0 && <p>Per serving: {macroParts.join(' · ')}</p>}
            </div>
          )}
          {startButton('rc-start-wide')}
        </section>

        <section className={`rc-panel rc-panel-steps${tab === 'steps' ? ' is-active' : ''}`} aria-label="Steps">
          <h2 className="rc-panel-title">Steps</h2>
          {recipe.sections.map((sec, sIdx) => {
            const readyFor = parseStepKey(sec.readyBy);
            const readyForName = readyFor ? recipe.sections[readyFor.section]?.name : undefined;
            return (
              <div key={sIdx} className="rc-part">
                {recipe.sections.length > 1 && (
                  <div className="rc-part-head">
                    <h3>{sec.name || `Part ${sIdx + 1}`}</h3>
                    {readyFor && readyForName !== undefined && (
                      <span className="rc-meta">For {readyForName || 'the main part'}, step {readyFor.step + 1}</span>
                    )}
                  </div>
                )}
                <ol className="rc-steps">
                  {sec.steps.map((stepText, stIdx) => {
                    const stepKey = `${sIdx}:${stIdx}`;
                    const isDone = Boolean(completed[stepKey]);
                    return (
                      <li key={stepKey} className={`rc-step${isDone ? ' is-done' : ''}`}>
                        <button
                          type="button"
                          className="rc-step-num"
                          aria-pressed={isDone}
                          aria-label={`Mark step ${stIdx + 1} ${isDone ? 'not done' : 'done'}`}
                          onClick={() => setCompleted((prev) => ({ ...prev, [stepKey]: !prev[stepKey] }))}
                        >
                          {isDone ? '✓' : stIdx + 1}
                        </button>
                        <p>
                          <StepText
                            step={stepText}
                            scale={scale}
                            unitMode={unitMode}
                            renderTimer={(seg, segIdx) => (
                              <TimerChip
                                id={timerIdFor(recipe.id, stepKey, segIdx)}
                                seg={seg}
                                label={timerLabel(sec.name, stIdx)}
                                recipeSlug={recipe.slug}
                                timers={timers}
                              />
                            )}
                          />
                        </p>
                      </li>
                    );
                  })}
                </ol>
              </div>
            );
          })}
          {recipe.notes && (
            <div className="rc-notes">
              <h3>Notes</h3>
              <p>{recipe.notes}</p>
            </div>
          )}
        </section>

        <section className={`rc-panel rc-panel-timeline${tab === 'timeline' ? ' is-active' : ''}`} aria-label="Timeline">
          <h2 className="rc-panel-title">Timeline</h2>
          <p className="rc-meta rc-tl-summary">
            {schedule.activeMinutes} min hands-on · {schedule.passiveMinutes} min waiting
          </p>
          <div className="rc-tl">
            {schedule.tracks.map((track) => (
              <div key={track.sectionIndex} className="rc-tl-row">
                <div className="rc-tl-label">
                  <span>{track.sectionName}</span>
                  <span className="rc-meta">{track.startOffsetMin > 0 ? `Start at ${Math.round(track.startOffsetMin)} min` : 'Start first'}</span>
                </div>
                <div className="rc-tl-track">
                  {track.blocks.map((b) => (
                    <div
                      key={b.stepKey}
                      className={`rc-tl-block${b.passive ? ' is-wait' : ''}${completed[b.stepKey] ? ' is-done' : ''}`}
                      style={{ left: `${(b.startMin / span) * 100}%`, width: `${((b.endMin - b.startMin) / span) * 100}%` }}
                      title={`${b.label} (${b.durationMin} min${b.passive ? ', waiting' : ''})`}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="rc-tl-legend rc-meta">
            <span><i className="rc-tl-key" /> Hands-on</span>
            <span><i className="rc-tl-key is-wait" /> Waiting</span>
          </div>
        </section>
      </div>

      <div className="rc-dock">
        {cookLogged && !cooking && (
          <div className="rc-toast" role="status">
            Cook logged
            <button type="button" className="rc-text-btn" onClick={() => onLogCook(true)}>
              Undo
            </button>
          </div>
        )}
        <TimerPills timers={timers} onOpenRecipe={onOpenRecipe} />
        {startButton('rc-dock-main rc-start-phone')}
      </div>

      {cookStep !== null && (
        <CookMode
          recipe={recipe}
          order={order}
          step={cookStep}
          scale={scale}
          unitMode={unitMode}
          timers={timers}
          canLog={canEdit}
          cookLogged={cookLogged}
          onStep={goToStep}
          onClose={closeCook}
          onLogCook={onLogCook}
        />
      )}
    </div>
  );
}

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useWakeLock } from '@/components/useWakeLock';
import { missingIngredients, stockFor } from '@/lib/recipes/kitchen';
import { mediaSrc } from '@/lib/media-url';
import { savePref } from '@/lib/workout/device-prefs';
import {
  CATEGORY_LABELS,
  buildSchedule,
  cookOrder,
  extractIngredients,
  formatQuantity,
  madeKey,
  parseStepKey,
  recipeEmoji,
  type BomItem,
  type Recipe,
  type UnitMode,
} from '@/lib/recipes/recipes';
import CookMode from './CookMode';
import PantrySheet from './PantrySheet';
import {
  COOK_PREF,
  IngredientRows,
  StepText,
  TimerChip,
  TimerPills,
  copyShoppingList,
  formatMinutes,
  readSavedCook,
  stockLabel,
  timerIdFor,
  timerLabel,
  useCookHistory,
} from './shared';
import type { Kitchen } from './useKitchen';
import type { RecipeTimers } from './useRecipeTimers';

type Tab = 'ingredients' | 'steps' | 'timeline';

function siteName(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'the web';
  }
}

export default function RecipeView({
  recipe,
  initialServings,
  canEdit,
  canDelete,
  kitchen,
  usedBy,
  unitMode,
  timers,
  cookLogged,
  backLabel,
  onUnitMode,
  onBack,
  onOpenRecipe,
  onPlan,
  onEdit,
  onDelete,
  onLogCook,
  onRate,
  onFlash,
  showAlert,
}: {
  recipe: Recipe;
  initialServings?: number;
  canEdit: boolean;
  canDelete: boolean;
  kitchen: Kitchen;
  /** Recipes this one goes into as a part. */
  usedBy: Recipe[];
  unitMode: UnitMode;
  timers: RecipeTimers;
  cookLogged: boolean;
  backLabel: string;
  onUnitMode: (mode: UnitMode) => void;
  onBack: () => void;
  onOpenRecipe: (slug: string) => void;
  onPlan: (servings: number) => void;
  onEdit: () => void;
  onDelete: () => void;
  onLogCook: (undo: boolean, servings: number) => void;
  onRate: (rating: number) => void;
  onFlash: (message: string) => void;
  showAlert: (message: string) => Promise<void> | void;
}) {
  const bom = useMemo(() => extractIngredients(recipe), [recipe]);
  const schedule = useMemo(() => buildSchedule(recipe), [recipe]);
  const order = useMemo(() => cookOrder(schedule), [schedule]);

  const [savedCook] = useState(() => {
    const saved = readSavedCook();
    return saved?.slug === recipe.slug ? saved : null;
  });
  const [scale, setScale] = useState(savedCook?.scale ?? (initialServings ? initialServings / recipe.servings : 1));
  const [tab, setTab] = useState<Tab>('ingredients');
  const [cookStep, setCookStep] = useState<number | null>(savedCook?.open ? Math.min(savedCook.step, order.length) : null);
  const [completed, setCompleted] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(order.slice(0, savedCook?.step ?? 0).map((b) => [b.stepKey, true])),
  );
  const [keepAwake, setKeepAwake] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showFullSummary, setShowFullSummary] = useState(false);
  const [constraintKey, setConstraintKey] = useState('');
  const [constraintVal, setConstraintVal] = useState('');
  const [pantryItem, setPantryItem] = useState<BomItem | null>(null);

  const cooking = cookStep !== null;
  useWakeLock(keepAwake || cooking);

  const doneCount = order.filter((b) => completed[b.stepKey]).length;
  const nextStep = order.findIndex((b) => !completed[b.stepKey]);

  // Remember where you are, even after leaving the recipe. A recipe with no
  // progress only clears its own entry, not a cook under way on another one.
  useEffect(() => {
    if (cookStep !== null || (doneCount > 0 && nextStep >= 0)) {
      const saved = { slug: recipe.slug, title: recipe.title, step: cookStep ?? nextStep, scale, at: Date.now(), open: cookStep !== null };
      savePref(COOK_PREF, JSON.stringify(saved));
    } else if (readSavedCook()?.slug === recipe.slug) {
      savePref(COOK_PREF, 'null');
    }
  }, [cookStep, doneCount, nextStep, scale, recipe.slug, recipe.title]);

  const closeCook = useCookHistory(cooking, useCallback(() => setCookStep(null), []));

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

  const startCooking = () => goToStep(nextStep < 0 ? 0 : nextStep);
  const startLabel = doneCount > 0 && nextStep >= 0 ? `Continue cooking · step ${nextStep + 1}` : 'Start cooking';
  const startOver = () => setCompleted({});

  // What you have is yours across recipes; what's been used is only this cook.
  const isUsed = (item: BomItem) => item.stepKeys.length > 0 && item.stepKeys.every((key) => completed[key]);
  const missing = useMemo(() => missingIngredients(recipe, kitchen.state, scale), [recipe, kitchen.state, scale]);

  // Tapping says "I have this". On something that's marked but counted short, it asks how much instead.
  const tapIngredient = (item: BomItem) => {
    const stock = stockFor(item, kitchen.state, scale);
    if (stock.status === 'short') setPantryItem(item);
    else if (stock.status === 'missing' && kitchen.state.have.includes(item.key)) kitchen.confirmPantry(item.key);
    else kitchen.toggleHave(item.key, item.name);
  };
  const stockAside = (item: BomItem) => {
    if (!kitchen.state.have.includes(item.key)) return null;
    const stock = stockFor(item, kitchen.state, scale);
    const detail = kitchen.state.pantry[item.key];
    const label = stockLabel(detail?.amount, unitMode, detail?.estimated);
    return (
      <button
        type="button"
        className={`rc-ing-stock${stock.status !== 'have' ? ' is-short' : ''}`}
        aria-label={`How much ${item.name} is at home`}
        onClick={() => setPantryItem(item)}
      >
        {stock.status === 'short' ? `have ${label}` : stock.status === 'missing' ? 'used up?' : label || '⋯'}
      </button>
    );
  };
  const batchMade = kitchen.state.have.includes(madeKey(recipe.id));

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

  const inList = kitchen.state.listRecipes.some((r) => r.recipeId === recipe.id);
  const servingsNow = Math.max(1, Math.round(scaledServings));
  const toggleList = () => {
    if (inList) {
      kitchen.removeListRecipe(recipe.id);
      onFlash('Taken off the shopping list');
    } else {
      kitchen.addListRecipe(recipe.id, servingsNow);
      onFlash(`Added ${missing.length} ${missing.length === 1 ? 'item' : 'items'} to the shopping list`);
    }
  };

  const copyMissing = async () => {
    const ok = await copyShoppingList(missing, scale, unitMode, `${recipe.title} (${formatQuantity(scaledServings, true)} servings)`);
    if (ok) onFlash('Copied what’s missing');
    else await showAlert('Could not access the clipboard.');
  };

  const shareRecipe = async () => {
    const url = window.location.href;
    try {
      if (typeof navigator.share === 'function' && window.matchMedia('(pointer: coarse)').matches) {
        await navigator.share({ title: recipe.title, url });
      } else {
        await navigator.clipboard.writeText(url);
        onFlash('Link copied');
      }
    } catch {
      /* cancelled */
    }
  };

  const span = Math.max(1, ...schedule.tracks.flatMap((t) => t.blocks.map((b) => b.endMin)));
  const macros = recipe.macros;
  const macroParts = [
    macros?.calories ? `${macros.calories} kcal` : '',
    macros?.protein !== undefined ? `${macros.protein} g protein` : '',
    macros?.carbs !== undefined ? `${macros.carbs} g carbs` : '',
    macros?.fat !== undefined ? `${macros.fat} g fat` : '',
  ].filter(Boolean);

  const lastCooked = recipe.lastCookedAt
    ? new Date(recipe.lastCookedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : '';

  const startButton = (extraClass: string) => (
    <button type="button" className={`btn btn-primary ${extraClass}`} onClick={startCooking}>
      {startLabel}
    </button>
  );

  return (
    <div className="rc-page">
      <div className="rc-bar">
        <button type="button" className="rc-text-btn" onClick={onBack}>
          ‹ {backLabel}
        </button>
        <div className="rc-menu-wrap">
          <button type="button" className="rc-icon-btn" aria-label="More actions" aria-expanded={showMenu} onClick={() => setShowMenu((v) => !v)}>
            ⋯
          </button>
          {showMenu && (
            <>
              <button type="button" className="rc-menu-scrim" aria-label="Close menu" onClick={() => setShowMenu(false)} />
              <div className="rc-menu" role="menu" onClick={() => setShowMenu(false)}>
                <button type="button" role="menuitem" onClick={() => onPlan(servingsNow)}>
                  Add to week
                </button>
                <button type="button" role="menuitem" onClick={shareRecipe}>
                  Share
                </button>
                <button type="button" role="menuitem" onClick={() => setKeepAwake((v) => !v)}>
                  {keepAwake ? '✓ Keeping screen on' : 'Keep screen on'}
                </button>
                {doneCount > 0 && (
                  <button type="button" role="menuitem" onClick={startOver}>
                    Start over
                  </button>
                )}
                {canEdit && (
                  <button type="button" role="menuitem" onClick={() => onLogCook(false, servingsNow)}>
                    Log a cook
                  </button>
                )}
                {usedBy.length > 0 && (
                  <button type="button" role="menuitem" onClick={() => kitchen.setMade(recipe, !batchMade)}>
                    {batchMade ? '✓ A batch is made' : 'I have a batch made'}
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

      <header className="rc-recipe-card">
        <div className="rc-head">
          <div className="rc-head-text">
            <p className="rc-card-category">{CATEGORY_LABELS[recipe.category]?.label}</p>
            <h1>{recipe.title}</h1>
            <p className="rc-meta">
              {formatMinutes(schedule.totalMinutes)}
              {recipe.rating ? ` · ★ ${recipe.rating.toFixed(1)}` : ''}
              {recipe.timesCooked > 0 ? ` · Made ${recipe.timesCooked}×${lastCooked ? `, last ${lastCooked}` : ''}` : ''}
              {recipe.private ? ' · Private' : ''}
            </p>
          </div>
          <span className="rc-snapshot rc-snapshot-head" aria-hidden="true">
            {recipe.photo ? (
              <img src={mediaSrc(recipe.photo, 400)} alt="" decoding="async" />
            ) : (
              <span className="rc-snapshot-blank">{recipeEmoji(recipe)}</span>
            )}
          </span>
        </div>
        {recipe.summary && (
          <button
            type="button"
            className={`rc-summary${showFullSummary ? ' is-open' : ''}`}
            aria-expanded={showFullSummary}
            onClick={() => setShowFullSummary((v) => !v)}
          >
            {recipe.summary}
          </button>
        )}
        {recipe.equipment.length > 0 && (
          <ul className="rc-gear" aria-label="Equipment">
            {recipe.equipment.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        )}
      </header>

      <div className="rc-controls">
        <div className="rc-stepper" role="group" aria-label="Servings">
          <button type="button" aria-label="Fewer servings" disabled={scaledServings <= 1} onClick={() => setServings(Math.round(scaledServings) - 1)}>
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
            ['ingredients', 'Ingredients'],
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
          <p className="rc-have-hint">
            {missing.length === 0 ? '✓ You have everything for this.' : 'Tap what you already have. It stays in your pantry until you say it’s gone.'}
          </p>
          <IngredientRows
            items={bom}
            scale={scale}
            unitMode={unitMode}
            isChecked={(item) => stockFor(item, kitchen.state, scale).status === 'have'}
            isStruck={isUsed}
            onToggle={tapIngredient}
            renderAside={stockAside}
          />

          <div className="rc-recipe-actions">
            <button type="button" className={`rc-paper-btn${inList ? ' is-active' : ''}`} onClick={toggleList} disabled={!inList && missing.length === 0}>
              {inList ? '✓ On shopping list' : `Add ${missing.length} missing to list`}
            </button>
            <button type="button" className="rc-paper-btn" onClick={() => onPlan(servingsNow)}>
              Add to week
            </button>
          </div>

          <details className="rc-details">
            <summary>More</summary>
            {missing.length > 0 && (
              <button type="button" className="rc-text-btn" onClick={copyMissing}>
                Copy what’s missing
              </button>
            )}
            {quantifiable.length > 0 && (
              <div className="rc-field rc-constraint-field">
                Scale to what you have
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
              </div>
            )}
          </details>

          {(usedBy.length > 0 || macroParts.length > 0 || recipe.sourceUrl) && (
            <div className="rc-facts">
              {usedBy.length > 0 && (
                <p>
                  Goes in:{' '}
                  {usedBy.map((parent, i) => (
                    <span key={parent.id}>
                      {i > 0 && ', '}
                      <button type="button" className="rc-link-small" onClick={() => onOpenRecipe(parent.slug)}>
                        {parent.title}
                      </button>
                    </span>
                  ))}
                </p>
              )}
              {macroParts.length > 0 && <p>Per serving: {macroParts.join(' · ')}</p>}
              {recipe.sourceUrl && (
                <p>
                  From{' '}
                  <a href={recipe.sourceUrl} target="_blank" rel="noopener noreferrer">
                    {siteName(recipe.sourceUrl)}
                  </a>
                </p>
              )}
            </div>
          )}
          {startButton('rc-start-wide')}
        </section>

        <section className={`rc-panel rc-panel-steps${tab === 'steps' ? ' is-active' : ''}`} aria-label="Steps">
          <h2 className="rc-panel-title">Steps</h2>
          {recipe.sections.map((sec, sIdx) => {
            const readyFor = parseStepKey(sec.readyBy);
            const readyForName = readyFor ? recipe.sections[readyFor.section]?.name : undefined;
            const from = sec.from;
            return (
              <div key={sIdx} className="rc-part">
                {(recipe.sections.length > 1 || from) && (
                  <div className="rc-part-head">
                    <h3>
                      {from?.slug ? (
                        <button type="button" className="rc-part-link" onClick={() => onOpenRecipe(from.slug!)}>
                          {sec.name} <span aria-hidden="true">›</span>
                        </button>
                      ) : (
                        sec.name || `Part ${sIdx + 1}`
                      )}
                    </h3>
                    {readyFor && readyForName !== undefined && (
                      <span className="rc-meta">For {readyForName || 'the main part'}, step {readyFor.step + 1}</span>
                    )}
                    {from && !from.unavailable && (
                      <button
                        type="button"
                        className="rc-link-small"
                        onClick={() => kitchen.setMade({ id: from.recipeId, title: from.title || sec.name }, !from.made)}
                      >
                        {from.made ? 'Make it fresh' : 'Already made'}
                      </button>
                    )}
                  </div>
                )}
                {from?.made && <p className="rc-meta">✓ You have a batch made, so this part is skipped.</p>}
                {from?.unavailable && <p className="rc-meta">This part comes from a recipe you can’t see right now.</p>}
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
            {formatMinutes(schedule.activeMinutes)} hands-on · {formatMinutes(schedule.passiveMinutes)} waiting
          </p>
          <div className="rc-tl">
            {schedule.tracks.filter((track) => track.blocks.length).map((track) => (
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
            <button type="button" className="rc-text-btn" onClick={() => onLogCook(true, servingsNow)}>
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
          bom={bom}
          isIngredientUsed={isUsed}
          step={cookStep}
          scale={scale}
          unitMode={unitMode}
          timers={timers}
          canLog={canEdit}
          cookLogged={cookLogged}
          rating={recipe.rating}
          onRate={canEdit ? onRate : undefined}
          onStep={goToStep}
          onClose={closeCook}
          onLogCook={(undo) => onLogCook(Boolean(undo), servingsNow)}
          kitchen={kitchen}
          keepsBatch={usedBy.length > 0}
        />
      )}

      {pantryItem && (
        <PantrySheet itemKey={pantryItem.key} name={pantryItem.name} kitchen={kitchen} unitMode={unitMode} onClose={() => setPantryItem(null)} onFlash={onFlash} />
      )}
    </div>
  );
}

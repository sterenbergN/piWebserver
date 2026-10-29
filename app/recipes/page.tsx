'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSitePopup } from '@/components/SitePopup';
import { useWakeLock } from '@/components/useWakeLock';
import { mediaSrc } from '@/lib/media-url';
import { playBeep, readPref, savePref, unlockAudio, vibrate } from '@/lib/workout/device-prefs';
import {
  CATEGORY_LABELS,
  RECIPE_CATEGORIES,
  buildSchedule,
  extractIngredients,
  formatBomAmount,
  formatIngredientAmount,
  formatQuantity,
  formatTemp,
  matchPantry,
  parseStepKey,
  parseStepTokens,
  smartAnnotateText,
  type BomItem,
  type Recipe,
  type RecipeCategory,
  type RecipeSection,
  type UnitMode,
} from '@/lib/recipes/recipes';
import './recipes.css';

type SortMode = 'rating' | 'fastest' | 'fewest_ing' | 'most_cooked' | 'protein_efficiency';

/**
 * A countdown keeps the time it goes off rather than counting ticks, so it
 * stays right when the phone sleeps or the tab is in the background (like
 * the workout rest timer). Kept on this device so a reload doesn't lose it.
 */
type RunningTimer = {
  id: string;
  label: string;
  recipeSlug: string;
  totalSec: number;
  /** When it goes off (ms since epoch) while running; null while paused or done. */
  endsAt: number | null;
  /** Seconds left while paused. */
  remainingSec: number;
  done: boolean;
};

const TIMERS_PREF = 'recipes:timers';
/** Coming back to a timer that went off longer ago than this doesn't beep late. */
const LATE_ALARM_MS = 2 * 60 * 1000;

const secondsLeft = (t: RunningTimer, now: number) =>
  t.endsAt !== null ? Math.max(0, Math.ceil((t.endsAt - now) / 1000)) : t.remainingSec;

function readSavedTimers(): Record<string, RunningTimer> {
  try {
    const saved = JSON.parse(readPref(TIMERS_PREF) || '{}');
    return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
  } catch {
    return {};
  }
}

type EditorDraft = {
  id?: string;
  title: string;
  summary: string;
  category: RecipeCategory;
  servings: number;
  prepMinutes: string;
  cookMinutes: string;
  equipmentText: string;
  tagsText: string;
  photo: string;
  calories: string;
  protein: string;
  carbs: string;
  fat: string;
  rating: string;
  notes: string;
  sections: RecipeSection[];
};

function emptyDraft(): EditorDraft {
  return {
    title: '',
    summary: '',
    category: 'dinner',
    servings: 4,
    prepMinutes: '',
    cookMinutes: '',
    equipmentText: 'Cast Iron',
    tagsText: 'Weeknight, High Protein',
    photo: '',
    calories: '',
    protein: '',
    carbs: '',
    fat: '',
    rating: '9.0',
    notes: '',
    sections: [
      {
        name: 'Main',
        steps: [
          'Sear [1.5 lb | 680 g chicken thighs] with [1.5 tsp | 9 g kosher salt] in a skillet at [400°F] for [8 min].',
        ],
      },
    ],
  };
}

function recipeToDraft(r: Recipe): EditorDraft {
  return {
    id: r.id,
    title: r.title,
    summary: r.summary,
    category: r.category,
    servings: r.servings,
    prepMinutes: r.prepMinutes ? String(r.prepMinutes) : '',
    cookMinutes: r.cookMinutes ? String(r.cookMinutes) : '',
    equipmentText: r.equipment.join(', '),
    tagsText: r.tags.join(', '),
    photo: r.photo || '',
    calories: r.macros?.calories !== undefined ? String(r.macros.calories) : '',
    protein: r.macros?.protein !== undefined ? String(r.macros.protein) : '',
    carbs: r.macros?.carbs !== undefined ? String(r.macros.carbs) : '',
    fat: r.macros?.fat !== undefined ? String(r.macros.fat) : '',
    rating: r.rating !== undefined ? String(r.rating) : '',
    notes: r.notes || '',
    sections: r.sections.length
      ? r.sections.map((s) => ({ ...s, steps: [...s.steps] }))
      : [{ name: 'Main', steps: [''] }],
  };
}

function formatClock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
  }
  return `${mins}:${String(rem).padStart(2, '0')}`;
}

/** Keep a section's `readyBy` pointing at the same step after a section or step is removed. */
function remapReadyBy(sections: RecipeSection[], removed: { section: number; step?: number }): RecipeSection[] {
  return sections.map((sec) => {
    const target = parseStepKey(sec.readyBy);
    if (!target) return sec;
    let { section, step } = target;
    if (removed.step === undefined) {
      if (section === removed.section) return { name: sec.name, steps: sec.steps };
      if (section > removed.section) section -= 1;
    } else if (section === removed.section) {
      if (step === removed.step) return { name: sec.name, steps: sec.steps };
      if (step > removed.step) step -= 1;
    }
    return { ...sec, readyBy: `${section}:${step}` };
  });
}

export default function RecipesPage() {
  const { confirm, showAlert, popup } = useSitePopup();

  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [canEdit, setCanEdit] = useState(false);
  const [deletableIds, setDeletableIds] = useState<string[]>([]);
  /** The last cook logged here, so a mistaken tap can be taken back for a few seconds. */
  const [lastCook, setLastCook] = useState<{ id: string; previous?: string } | null>(null);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState<EditorDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  // Finder state
  const [searchQuery, setSearchQuery] = useState('');
  const [pantryQuery, setPantryQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<RecipeCategory | 'all'>('all');
  const [quickFilter, setQuickFilter] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>('rating');
  const [cartIds, setCartIds] = useState<string[]>([]);

  // Spec / Cook Mode state
  const [unitMode, setUnitMode] = useState<UnitMode>('both');
  const [scale, setScale] = useState<number>(1);
  const [constraintKey, setConstraintKey] = useState<string>('');
  const [constraintVal, setConstraintVal] = useState<string>('');
  const [completedSteps, setCompletedSteps] = useState<Record<string, boolean>>({});
  const [manualCheckedBom, setManualCheckedBom] = useState<Record<string, boolean>>({});
  const [keepAwake, setKeepAwake] = useState(false);
  const [timers, setTimers] = useState<Record<string, RunningTimer>>({});
  const [now, setNow] = useState(() => Date.now());
  const timersRef = useRef(timers);
  const audioRef = useRef<AudioContext | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);

  // Track last focused step input (and caret) in the editor so quick-insert buttons insert at the cursor
  const focusedStepRef = useRef<{ sIdx: number; stIdx: number; caret: number } | null>(null);
  const [smartPasteRaw, setSmartPasteRaw] = useState('');
  const [showSmartPaste, setShowSmartPaste] = useState(false);

  useWakeLock(keepAwake);

  // Load recipes from API + read ?recipe= query parameter
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const initialSlug = params.get('recipe');
    if (initialSlug) setSelectedSlug(initialSlug);

    setTimers(readSavedTimers());

    fetch('/api/recipes')
      .then((r) => r.json())
      .then((data) => {
        if (!Array.isArray(data?.recipes)) throw new Error('No recipes');
        setRecipes(data.recipes);
        setCanEdit(Boolean(data.canEdit));
        setDeletableIds(Array.isArray(data.deletableIds) ? data.deletableIds : []);
        setLoadState('ready');
      })
      .catch(() => setLoadState('error'));
  }, []);

  // Sync URL query param when opening/closing a recipe
  const openRecipe = useCallback((slug: string | null) => {
    setSelectedSlug(slug);
    setScale(1);
    setConstraintKey('');
    setConstraintVal('');
    setCompletedSteps({});
    setManualCheckedBom({});
    const url = new URL(window.location.href);
    if (slug) url.searchParams.set('recipe', slug);
    else url.searchParams.delete('recipe');
    window.history.replaceState({}, '', url.toString());
  }, []);

  // Timers: remembered on this device, redrawn while any run, and each one
  // alarms at the moment it's due (not on the next tick). A timer that went
  // off while the phone slept is shown as done without a late beep.
  useEffect(() => {
    timersRef.current = timers;
    savePref(TIMERS_PREF, JSON.stringify(timers));
    const running = Object.values(timers).filter((t) => t.endsAt !== null && !t.done);
    if (!running.length) return;
    const finish = (id: string) => {
      const t = timersRef.current[id];
      if (!t || t.done || t.endsAt === null) return;
      if (Date.now() - t.endsAt < LATE_ALARM_MS) {
        vibrate([300, 150, 300, 150, 300]);
        playBeep(audioRef.current, 3);
      }
      setTimers((prev) => (prev[id] ? { ...prev, [id]: { ...prev[id], endsAt: null, remainingSec: 0, done: true } } : prev));
    };
    const alarms = running.map((t) => window.setTimeout(() => finish(t.id), Math.max(0, t.endsAt! - Date.now())));
    const tick = window.setInterval(() => setNow(Date.now()), 500);
    setNow(Date.now());
    return () => {
      alarms.forEach((handle) => window.clearTimeout(handle));
      window.clearInterval(tick);
    };
  }, [timers]);

  // Every tap re-unlocks audio, which iPhones suspend when the screen locks or
  // another app plays sound — otherwise the alarm is silently dropped.
  const hasTimers = Object.keys(timers).length > 0;
  useEffect(() => {
    if (!hasTimers) return;
    const unlock = () => {
      audioRef.current = unlockAudio(audioRef.current);
    };
    document.addEventListener('pointerdown', unlock, true);
    return () => document.removeEventListener('pointerdown', unlock, true);
  }, [hasTimers]);

  // The undo for a logged cook goes away after a few seconds.
  useEffect(() => {
    if (!lastCook) return;
    const handle = window.setTimeout(() => setLastCook(null), 10_000);
    return () => window.clearTimeout(handle);
  }, [lastCook]);

  const activeRecipe = useMemo(
    () => (selectedSlug ? recipes.find((r) => r.slug === selectedSlug || r.id === selectedSlug) || null : null),
    [recipes, selectedSlug],
  );

  // Precompute BOM, Schedule, and Pantry Match for every recipe in the Finder
  const enrichedRecipes = useMemo(() => {
    return recipes.map((recipe) => {
      const bom = extractIngredients(recipe);
      const schedule = buildSchedule(recipe);
      const pantry = matchPantry(recipe, pantryQuery);
      const proteinEfficiency =
        recipe.macros?.protein && recipe.macros?.calories
          ? (recipe.macros.protein * 100) / recipe.macros.calories
          : 0;
      return { recipe, bom, schedule, pantry, proteinEfficiency };
    });
  }, [recipes, pantryQuery]);

  const filteredRecipes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = enrichedRecipes.filter(({ recipe, bom, schedule }) => {
      if (categoryFilter !== 'all' && recipe.category !== categoryFilter) return false;
      if (quickFilter === 'fast' && schedule.totalMinutes > 25) return false;
      if (quickFilter === 'one-pan' && !recipe.equipment.some((e) => /one-pan|one-pot|sheet pan/i.test(e))) {
        return false;
      }
      if (quickFilter === 'high-protein' && (recipe.macros?.protein || 0) < 30) return false;
      if (quickFilter === 'cast-iron' && !recipe.equipment.some((e) => /cast iron/i.test(e))) return false;
      if (quickFilter === 'sheet-pan' && !recipe.equipment.some((e) => /sheet pan/i.test(e))) return false;

      if (!q) return true;
      const hay = [
        recipe.title,
        recipe.summary,
        recipe.category,
        ...recipe.equipment,
        ...recipe.tags,
        ...bom.map((b) => b.name),
      ]
        .join(' ')
        .toLowerCase();
      return q.split(/\s+/).every((term) => hay.includes(term));
    });

    return list.sort((a, b) => {
      if (pantryQuery.trim()) {
        if (b.pantry.ratio !== a.pantry.ratio) return b.pantry.ratio - a.pantry.ratio;
      }
      if (sortMode === 'fastest') return a.schedule.totalMinutes - b.schedule.totalMinutes;
      if (sortMode === 'fewest_ing') return a.bom.length - b.bom.length;
      if (sortMode === 'most_cooked') return (b.recipe.timesCooked || 0) - (a.recipe.timesCooked || 0);
      if (sortMode === 'protein_efficiency') return b.proteinEfficiency - a.proteinEfficiency;
      return (b.recipe.rating || 0) - (a.recipe.rating || 0);
    });
  }, [enrichedRecipes, searchQuery, categoryFilter, quickFilter, sortMode, pantryQuery]);

  // Combined multi-recipe grocery cart BOM
  const combinedCartBom = useMemo(() => {
    const selected = recipes.filter((r) => cartIds.includes(r.id));
    if (!selected.length) return [];
    const combinedSections = selected.flatMap((r) => r.sections);
    return extractIngredients({ sections: combinedSections });
  }, [recipes, cartIds]);

  const activeBom = useMemo(() => (activeRecipe ? extractIngredients(activeRecipe) : []), [activeRecipe]);
  const activeSchedule = useMemo(() => (activeRecipe ? buildSchedule(activeRecipe) : null), [activeRecipe]);

  // Handle "Scale by Ingredient Constraint"
  const handleConstraintChange = (key: string, valStr: string, mode: UnitMode = unitMode) => {
    setConstraintKey(key);
    setConstraintVal(valStr);
    const num = Number(valStr);
    if (!key || !Number.isFinite(num) || num <= 0) return;
    const item = activeBom.find((b) => b.key === key);
    if (!item) return;
    const baseQty = mode === 'metric' ? item.metricQty ?? item.usQty : item.usQty ?? item.metricQty;
    if (baseQty && baseQty > 0) {
      const nextScale = Math.round((num / baseQty) * 100) / 100;
      if (nextScale > 0 && nextScale <= 20) setScale(nextScale);
    }
  };

  // Start, pause, resume, or restart (once done) a timer chip
  const toggleTimerChip = (timerId: string, label: string, seconds: number, recipeSlug: string) => {
    audioRef.current = unlockAudio(audioRef.current); // a tap, so the alarm may play later
    const at = Date.now();
    setTimers((prev) => {
      const cur = prev[timerId];
      let next: RunningTimer;
      if (!cur || cur.done) {
        next = { id: timerId, label, recipeSlug, totalSec: seconds, endsAt: at + seconds * 1000, remainingSec: seconds, done: false };
      } else if (cur.endsAt !== null) {
        next = { ...cur, endsAt: null, remainingSec: secondsLeft(cur, at) };
      } else {
        next = { ...cur, endsAt: at + cur.remainingSec * 1000 };
      }
      return { ...prev, [timerId]: next };
    });
  };

  const dismissTimer = (timerId: string) => {
    setTimers((prev) => {
      const next = { ...prev };
      delete next[timerId];
      return next;
    });
  };

  const copyShoppingList = async (items: BomItem[], scaleFactor: number, heading: string) => {
    const lines = items.map((item) => {
      const amt = formatBomAmount(item, scaleFactor, unitMode);
      return `- [ ] ${amt ? `${amt} ` : ''}${item.name}`;
    });
    const text = `${heading}\n${lines.join('\n')}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus('Copied to clipboard!');
      window.setTimeout(() => setCopyStatus(null), 2200);
    } catch {
      await showAlert('Could not access clipboard.');
    }
  };

  const handleMarkCooked = async (recipe: Recipe, undo = false) => {
    try {
      const res = await fetch('/api/recipes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          undo
            ? { type: 'uncooked', id: recipe.id, previousLastCookedAt: lastCook?.previous }
            : { type: 'cooked', id: recipe.id },
        ),
      });
      const data = await res.json();
      if (!res.ok || !data?.recipe) {
        await showAlert(data?.message || 'Could not update the cook log.');
        return;
      }
      setRecipes((prev) => prev.map((r) => (r.id === recipe.id ? data.recipe : r)));
      setLastCook(undo ? null : { id: recipe.id, previous: recipe.lastCookedAt });
    } catch {
      await showAlert('Failed to record cook log.');
    }
  };

  const handleDeleteRecipe = async (recipe: Recipe) => {
    const ok = await confirm({
      title: 'Delete Recipe',
      message: `Delete "${recipe.title}"? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      const res = await fetch('/api/recipes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'delete', id: recipe.id }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        await showAlert(d?.message || 'Delete failed.');
        return;
      }
      setRecipes((prev) => prev.filter((r) => r.id !== recipe.id));
      openRecipe(null);
    } catch {
      await showAlert('Delete failed.');
    }
  };

  const handleSaveDraft = async () => {
    if (!editingDraft) return;
    setSaving(true);
    try {
      const payload = {
        type: 'save',
        recipe: {
          id: editingDraft.id,
          title: editingDraft.title,
          summary: editingDraft.summary,
          category: editingDraft.category,
          servings: editingDraft.servings,
          prepMinutes: editingDraft.prepMinutes ? Number(editingDraft.prepMinutes) : undefined,
          cookMinutes: editingDraft.cookMinutes ? Number(editingDraft.cookMinutes) : undefined,
          equipment: editingDraft.equipmentText
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
          tags: editingDraft.tagsText
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
          photo: editingDraft.photo || undefined,
          macros: {
            calories: editingDraft.calories ? Number(editingDraft.calories) : undefined,
            protein: editingDraft.protein !== '' ? Number(editingDraft.protein) : undefined,
            carbs: editingDraft.carbs !== '' ? Number(editingDraft.carbs) : undefined,
            fat: editingDraft.fat !== '' ? Number(editingDraft.fat) : undefined,
          },
          rating: editingDraft.rating ? Number(editingDraft.rating) : null, // null clears it
          notes: editingDraft.notes,
          sections: editingDraft.sections,
        },
      };

      const res = await fetch('/api/recipes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data?.recipe) {
        await showAlert(data?.message || 'Could not save recipe.');
        return;
      }
      const saved: Recipe = data.recipe;
      setRecipes((prev) => {
        const idx = prev.findIndex((r) => r.id === saved.id);
        if (idx >= 0) {
          const copy = [...prev];
          copy[idx] = saved;
          return copy;
        }
        return [saved, ...prev];
      });
      if (data.canDelete) setDeletableIds((prev) => (prev.includes(saved.id) ? prev : [...prev, saved.id]));
      setEditingDraft(null);
      openRecipe(saved.slug);
    } catch {
      await showAlert('Network error saving recipe.');
    } finally {
      setSaving(false);
    }
  };

  const handlePhotoUpload = async (file: File) => {
    if (!editingDraft) return;
    setUploadingPhoto(true);
    try {
      const fd = new FormData();
      fd.append('image', file);
      const res = await fetch('/api/recipes/images', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok || !data?.src) {
        await showAlert(data?.message || 'Upload failed.');
        return;
      }
      setEditingDraft((prev) => (prev ? { ...prev, photo: data.src } : prev));
    } catch {
      await showAlert('Photo upload failed.');
    } finally {
      setUploadingPhoto(false);
    }
  };

  // Insert at the caret of the last focused step (the last step if that one was removed).
  const insertTokenIntoStep = (tokenSnippet: string) => {
    if (!editingDraft) return;
    const lastSec = editingDraft.sections.length - 1;
    const focused = focusedStepRef.current;
    const target =
      focused && editingDraft.sections[focused.sIdx]?.steps[focused.stIdx] !== undefined
        ? focused
        : { sIdx: lastSec, stIdx: editingDraft.sections[lastSec].steps.length - 1, caret: Infinity };
    const st = editingDraft.sections[target.sIdx].steps[target.stIdx];
    const caret = Math.min(target.caret, st.length);
    const before = st.slice(0, caret);
    const after = st.slice(caret);
    const lead = before && !before.endsWith(' ') ? ' ' : '';
    const trail = after.startsWith(' ') ? '' : ' ';
    const text = `${before}${lead}${tokenSnippet}${trail}${after}`;
    focusedStepRef.current = { ...target, caret: before.length + lead.length + tokenSnippet.length + trail.length };
    setEditingDraft({
      ...editingDraft,
      sections: editingDraft.sections.map((sec, sIdx) =>
        sIdx !== target.sIdx ? sec : { ...sec, steps: sec.steps.map((s, i) => (i === target.stIdx ? text : s)) },
      ),
    });
  };

  const applySmartPaste = () => {
    if (!editingDraft || !smartPasteRaw.trim()) return;
    const lines = smartPasteRaw
      .split(/\r?\n+/)
      .map((l) => l.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, '').trim())
      .filter(Boolean)
      .map((line) => smartAnnotateText(line));
    if (!lines.length) return;
    setEditingDraft((prev) => {
      if (!prev) return prev;
      const sections = [...prev.sections];
      sections[0] = {
        ...sections[0],
        steps: [...sections[0].steps.filter(Boolean), ...lines],
      };
      return { ...prev, sections };
    });
    setSmartPasteRaw('');
    setShowSmartPaste(false);
  };

  // Live preview data for the editor
  const editorPreviewBom = useMemo(
    () => (editingDraft ? extractIngredients({ sections: editingDraft.sections }) : []),
    [editingDraft],
  );
  const editorPreviewSchedule = useMemo(
    () =>
      editingDraft
        ? buildSchedule({
            sections: editingDraft.sections,
            prepMinutes: Number(editingDraft.prepMinutes) || undefined,
            cookMinutes: Number(editingDraft.cookMinutes) || undefined,
          })
        : null,
    [editingDraft],
  );

  // Sticky bar of every timer, on every view, so leaving a recipe doesn't hide one that's running.
  const timersBar = hasTimers && (
    <div className="rc-timers-bar" role="status" aria-live="polite">
      <span className="rc-control-label">⏱ Timers:</span>
      {Object.values(timers).map((t) => {
        const running = t.endsAt !== null && !t.done;
        const onOtherRecipe = !editingDraft && t.recipeSlug !== activeRecipe?.slug;
        return (
          <div key={t.id} className={`rc-timer-pill ${t.done ? 'is-done' : ''}`}>
            {onOtherRecipe ? (
              <button type="button" className="rc-timer-link" onClick={() => openRecipe(t.recipeSlug)}>
                {t.label}:
              </button>
            ) : (
              <span>{t.label}:</span>
            )}
            <strong>{t.done ? 'DONE 🔔' : formatClock(secondsLeft(t, now))}</strong>
            <button
              type="button"
              className="rc-input-clear"
              style={{ position: 'static', padding: '0 0.25rem' }}
              onClick={() => toggleTimerChip(t.id, t.label, t.totalSec, t.recipeSlug)}
              title={running ? 'Pause' : t.done ? 'Restart' : 'Resume'}
              aria-label={running ? 'Pause timer' : t.done ? 'Restart timer' : 'Resume timer'}
            >
              {running ? '⏸' : '▶'}
            </button>
            <button
              type="button"
              className="rc-input-clear"
              style={{ position: 'static', padding: '0 0.25rem' }}
              onClick={() => dismissTimer(t.id)}
              title="Dismiss timer"
              aria-label="Dismiss timer"
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );

  // ── 1. EDITOR VIEW ──
  if (editingDraft) {
    return (
      <main className="rc-page">
        {popup}
        {timersBar}
        <div className="rc-back-row" style={{ marginBottom: '1.1rem' }}>
          <button type="button" className="btn btn-secondary" onClick={() => setEditingDraft(null)}>
            ← Cancel
          </button>
          <div className="rc-top-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setShowSmartPaste((v) => !v)}
            >
              ✨ Smart Paste Instructions
            </button>
            <button type="button" className="btn btn-primary" disabled={saving} onClick={handleSaveDraft}>
              {saving ? 'Saving…' : 'Save Recipe Spec'}
            </button>
          </div>
        </div>

        {showSmartPaste && (
          <div className="rc-form-card" style={{ marginBottom: '1.15rem' }}>
            <div className="rc-box-head" style={{ marginBottom: 0 }}>
              <h3 className="rc-box-title">✨ Smart Paste Auto-Annotator</h3>
              <button type="button" className="rc-pill" onClick={() => setShowSmartPaste(false)}>
                Close
              </button>
            </div>
            <p className="rc-subtitle">
              Paste raw recipe steps below. Quantities (`2 cups flour`), temperatures (`375°F`), and durations
              (`12 minutes`, `rest 10 min`) will be wrapped in `[...]` tokens automatically.
            </p>
            <textarea
              className="rc-textarea"
              rows={4}
              placeholder="1. Sear 1.5 lb chicken thighs in 1 tbsp olive oil at 400°F for 6 minutes.&#10;2. Rest for 5 minutes."
              value={smartPasteRaw}
              onChange={(e) => setSmartPasteRaw(e.target.value)}
            />
            <div>
              <button type="button" className="btn btn-primary" onClick={applySmartPaste}>
                Convert & Append Steps
              </button>
            </div>
          </div>
        )}

        <div className="rc-editor-grid">
          <div className="rc-form-card">
            <h2 style={{ margin: 0, fontSize: '1.2rem' }}>
              {editingDraft.id ? 'Edit Recipe Spec' : 'New Engineering Recipe Spec'}
            </h2>

            <div className="rc-field-grid">
              <label className="rc-label" style={{ gridColumn: 'span 2' }}>
                Dish Title
                <input
                  className="rc-text-input"
                  value={editingDraft.title}
                  onChange={(e) => setEditingDraft({ ...editingDraft, title: e.target.value })}
                  placeholder="Crispy Cold-Pan Honey-Garlic Chicken Thighs"
                />
              </label>
              <label className="rc-label">
                Category
                <select
                  className="rc-text-input"
                  value={editingDraft.category}
                  onChange={(e) =>
                    setEditingDraft({ ...editingDraft, category: e.target.value as RecipeCategory })
                  }
                >
                  {RECIPE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_LABELS[c].emoji} {CATEGORY_LABELS[c].label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="rc-label">
              One-Line Engineering Summary
              <input
                className="rc-text-input"
                value={editingDraft.summary}
                onChange={(e) => setEditingDraft({ ...editingDraft, summary: e.target.value })}
                placeholder="Cold-pan rendered thighs glazed in a 4-ingredient honey-garlic reduction."
              />
            </label>

            <div className="rc-field-grid">
              <label className="rc-label">
                Base Servings
                <input
                  type="number"
                  min={1}
                  max={48}
                  className="rc-text-input"
                  value={editingDraft.servings}
                  onChange={(e) =>
                    setEditingDraft({ ...editingDraft, servings: Math.max(1, Number(e.target.value) || 1) })
                  }
                />
              </label>
              <label className="rc-label">
                Rating (1–10)
                <input
                  type="number"
                  step="0.1"
                  min={1}
                  max={10}
                  className="rc-text-input"
                  value={editingDraft.rating}
                  onChange={(e) => setEditingDraft({ ...editingDraft, rating: e.target.value })}
                />
              </label>
              <label className="rc-label">
                Prep Min (optional)
                <input
                  type="number"
                  min={0}
                  className="rc-text-input"
                  placeholder="Auto"
                  value={editingDraft.prepMinutes}
                  onChange={(e) => setEditingDraft({ ...editingDraft, prepMinutes: e.target.value })}
                />
              </label>
              <label className="rc-label">
                Cook Min (optional)
                <input
                  type="number"
                  min={0}
                  className="rc-text-input"
                  placeholder="Auto"
                  value={editingDraft.cookMinutes}
                  onChange={(e) => setEditingDraft({ ...editingDraft, cookMinutes: e.target.value })}
                />
              </label>
            </div>

            <div className="rc-field-grid">
              <label className="rc-label">
                Equipment (comma-separated)
                <input
                  className="rc-text-input"
                  value={editingDraft.equipmentText}
                  onChange={(e) => setEditingDraft({ ...editingDraft, equipmentText: e.target.value })}
                  placeholder="Cast Iron, Saucepan"
                />
              </label>
              <label className="rc-label">
                Tags (comma-separated)
                <input
                  className="rc-text-input"
                  value={editingDraft.tagsText}
                  onChange={(e) => setEditingDraft({ ...editingDraft, tagsText: e.target.value })}
                  placeholder="High Protein, Weeknight"
                />
              </label>
            </div>

            <div className="rc-field-grid">
              <label className="rc-label">
                Calories / serv
                <input
                  type="number"
                  className="rc-text-input"
                  value={editingDraft.calories}
                  onChange={(e) => setEditingDraft({ ...editingDraft, calories: e.target.value })}
                />
              </label>
              <label className="rc-label">
                Protein (g)
                <input
                  type="number"
                  className="rc-text-input"
                  value={editingDraft.protein}
                  onChange={(e) => setEditingDraft({ ...editingDraft, protein: e.target.value })}
                />
              </label>
              <label className="rc-label">
                Carbs (g)
                <input
                  type="number"
                  className="rc-text-input"
                  value={editingDraft.carbs}
                  onChange={(e) => setEditingDraft({ ...editingDraft, carbs: e.target.value })}
                />
              </label>
              <label className="rc-label">
                Fat (g)
                <input
                  type="number"
                  className="rc-text-input"
                  value={editingDraft.fat}
                  onChange={(e) => setEditingDraft({ ...editingDraft, fat: e.target.value })}
                />
              </label>
            </div>

            <div className="rc-field-grid">
              <div className="rc-label">
                Dish Photo
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  {editingDraft.photo && (
                    <img src={mediaSrc(editingDraft.photo, 400)} alt="" className="rc-photo-preview" />
                  )}
                  <label className="rc-token-btn" style={{ whiteSpace: 'nowrap', cursor: 'pointer' }}>
                    {uploadingPhoto ? 'Uploading…' : editingDraft.photo ? '📷 Replace' : '📷 Upload'}
                    <input
                      type="file"
                      accept="image/*"
                      style={{ display: 'none' }}
                      disabled={uploadingPhoto}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = ''; // so picking the same file again still uploads
                        if (file) handlePhotoUpload(file);
                      }}
                    />
                  </label>
                  {editingDraft.photo && (
                    <button
                      type="button"
                      className="rc-token-btn"
                      onClick={() => setEditingDraft({ ...editingDraft, photo: '' })}
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="rc-token-toolbar">
              <span className="rc-control-label">Quick Insert Token:</span>
              <button
                type="button"
                className="rc-token-btn"
                onClick={() => insertTokenIntoStep('[1/2 cup | 60 g flour]')}
              >
                + Ingredient [US | Metric]
              </button>
              <button
                type="button"
                className="rc-token-btn"
                onClick={() => insertTokenIntoStep('[2 tbsp olive oil]')}
              >
                + Ingredient [Single]
              </button>
              <button
                type="button"
                className="rc-token-btn"
                onClick={() => insertTokenIntoStep('[8 min]')}
              >
                + Active Timer [8 min]
              </button>
              <button
                type="button"
                className="rc-token-btn"
                onClick={() => insertTokenIntoStep('[15 min passive]')}
              >
                + Passive Wait [15 min passive]
              </button>
              <button
                type="button"
                className="rc-token-btn"
                onClick={() => insertTokenIntoStep('[400°F]')}
              >
                + Temp [400°F]
              </button>
            </div>

            {editingDraft.sections.map((sec, sIdx) => (
              <div key={sIdx} className="rc-sec-edit-box">
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <input
                    className="rc-text-input"
                    style={{ fontWeight: 700 }}
                    value={sec.name}
                    onChange={(e) => {
                      const sections = [...editingDraft.sections];
                      sections[sIdx] = { ...sec, name: e.target.value };
                      setEditingDraft({ ...editingDraft, sections });
                    }}
                    placeholder="Sub-Assembly Name (e.g. Jasmine Rice, Chicken Thighs)"
                  />
                  {editingDraft.sections.length > 1 && (
                    <button
                      type="button"
                      className="rc-token-btn"
                      onClick={() => {
                        const sections = remapReadyBy(
                          editingDraft.sections.filter((_, i) => i !== sIdx),
                          { section: sIdx },
                        );
                        focusedStepRef.current = null;
                        setEditingDraft({ ...editingDraft, sections });
                      }}
                    >
                      Remove Section
                    </button>
                  )}
                </div>

                {editingDraft.sections.length > 1 && (
                  <label className="rc-ready-by">
                    Ready for
                    <select
                      className="rc-select"
                      value={sec.readyBy || ''}
                      onChange={(e) => {
                        const sections = [...editingDraft.sections];
                        sections[sIdx] = e.target.value
                          ? { ...sec, readyBy: e.target.value }
                          : { name: sec.name, steps: sec.steps };
                        setEditingDraft({ ...editingDraft, sections });
                      }}
                    >
                      <option value="">The end (finishes with the dish)</option>
                      {editingDraft.sections.map((other, oIdx) =>
                        oIdx === sIdx
                          ? null
                          : other.steps.map((stepText, oStIdx) => (
                              <option key={`${oIdx}:${oStIdx}`} value={`${oIdx}:${oStIdx}`}>
                                {other.name || `Section ${oIdx + 1}`} · step {oStIdx + 1}
                                {stepText ? ` — ${stepText.replace(/\[([^\[\]]+)\]/g, '$1').slice(0, 40)}` : ''}
                              </option>
                            )),
                      )}
                    </select>
                  </label>
                )}

                {sec.steps.map((step, stIdx) => (
                  <div key={stIdx} className="rc-step-edit-row">
                    <span
                      style={{
                        fontSize: '0.78rem',
                        fontWeight: 800,
                        color: 'var(--text-secondary)',
                        paddingTop: '0.5rem',
                      }}
                    >
                      {stIdx + 1}.
                    </span>
                    <textarea
                      className="rc-textarea"
                      rows={2}
                      value={step}
                      onSelect={(e) => {
                        focusedStepRef.current = { sIdx, stIdx, caret: e.currentTarget.selectionStart };
                      }}
                      onChange={(e) => {
                        const sections = [...editingDraft.sections];
                        const steps = [...sec.steps];
                        steps[stIdx] = e.target.value;
                        sections[sIdx] = { ...sec, steps };
                        setEditingDraft({ ...editingDraft, sections });
                      }}
                      placeholder="Write step with [1 tbsp butter], [400°F], and [6 min] inline..."
                    />
                    <button
                      type="button"
                      className="rc-token-btn"
                      onClick={() => {
                        const sections = [...editingDraft.sections];
                        const steps = sec.steps.filter((_, i) => i !== stIdx);
                        sections[sIdx] = { ...sec, steps: steps.length ? steps : [''] };
                        focusedStepRef.current = null;
                        setEditingDraft({
                          ...editingDraft,
                          sections: steps.length ? remapReadyBy(sections, { section: sIdx, step: stIdx }) : sections,
                        });
                      }}
                      title="Delete step"
                    >
                      ✕
                    </button>
                  </div>
                ))}

                <div>
                  <button
                    type="button"
                    className="rc-token-btn"
                    onClick={() => {
                      const sections = [...editingDraft.sections];
                      sections[sIdx] = { ...sec, steps: [...sec.steps, ''] };
                      setEditingDraft({ ...editingDraft, sections });
                    }}
                  >
                    + Add Step
                  </button>
                </div>
              </div>
            ))}

            <div>
              <button
                type="button"
                className="rc-token-btn"
                onClick={() =>
                  setEditingDraft({
                    ...editingDraft,
                    sections: [...editingDraft.sections, { name: 'Sauce / Side', steps: [''] }],
                  })
                }
              >
                + Add Parallel Sub-Assembly Section
              </button>
            </div>

            <label className="rc-label">
              Engineering / Lab Notes (why this works, tweaks, substitutions)
              <textarea
                className="rc-textarea"
                rows={2}
                value={editingDraft.notes}
                onChange={(e) => setEditingDraft({ ...editingDraft, notes: e.target.value })}
              />
            </label>
          </div>

          {/* Live Side-by-Side Preview */}
          <div className="rc-preview-sticky">
            <div className="rc-box">
              <div className="rc-box-head">
                <h3 className="rc-box-title">📦 Auto-Extracted BOM ({editorPreviewBom.length} items)</h3>
              </div>
              {editorPreviewBom.length === 0 ? (
                <p className="rc-subtitle">
                  Wrap ingredients in brackets like <code>[1/2 cup | 60 g flour]</code> inside your steps and
                  they will automatically sum here.
                </p>
              ) : (
                <div className="rc-bom-list">
                  {editorPreviewBom.map((item) => (
                    <div key={item.key} className="rc-bom-item">
                      <div>
                        <span className="rc-bom-amount">
                          {formatBomAmount(item, 1, 'both')}
                        </span>
                        <span>{item.name}</span>
                        {item.stepKeys.length > 1 && (
                          <span className="rc-bom-multi">({item.stepKeys.length} steps)</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {editorPreviewSchedule && (
              <div className="rc-box">
                <div className="rc-box-head">
                  <h3 className="rc-box-title">
                    ⏱ Parallel Gantt Preview ({editorPreviewSchedule.totalMinutes} min total)
                  </h3>
                </div>
                <div className="rc-gantt-tracks">
                  {editorPreviewSchedule.tracks.map((track) => (
                    <div key={track.sectionIndex} className="rc-gantt-row">
                      <div className="rc-gantt-label">
                        <span>{track.sectionName}</span>
                        <span className="rc-gantt-offset">Start at T+{track.startOffsetMin}m</span>
                      </div>
                      <div className="rc-gantt-bar-track">
                        {track.blocks.map((b) => {
                          const total = Math.max(1, editorPreviewSchedule.totalMinutes);
                          const left = (b.startMin / total) * 100;
                          const width = Math.max(4, (b.durationMin / total) * 100);
                          return (
                            <div
                              key={b.stepKey}
                              className={`rc-gantt-block ${b.passive ? 'is-passive' : 'is-active'}`}
                              style={{ left: `${left}%`, width: `${width}%` }}
                              title={`${b.label} (${b.durationMin}m)`}
                            >
                              {b.durationMin}m
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    );
  }

  // ── 2. RECIPE SPEC & COOK MODE VIEW ──
  if (activeRecipe && activeSchedule) {
    const scaledServings = Math.round(activeRecipe.servings * scale * 10) / 10;
    const quantifiableBom = activeBom.filter((b) => b.usQty !== null || b.metricQty !== null);

    return (
      <main className="rc-page">
        {popup}
        <div className="rc-spec-container">
          <div className="rc-back-row">
            <button type="button" className="btn btn-secondary" onClick={() => openRecipe(null)}>
              ← All Recipes
            </button>
            <div className="rc-top-actions">
              <button
                type="button"
                className={`rc-pill ${keepAwake ? 'is-active' : ''}`}
                onClick={() => setKeepAwake((v) => !v)}
                title="Prevent your phone or tablet screen from dimming while cooking"
              >
                {keepAwake ? '☀️ Screen Awake ON' : '🌙 Keep Screen Awake'}
              </button>
              {canEdit && (
                <>
                  {lastCook?.id === activeRecipe.id ? (
                    <button
                      type="button"
                      className="rc-pill is-active"
                      onClick={() => handleMarkCooked(activeRecipe, true)}
                      title="Take back the cook you just logged"
                    >
                      ✓ Logged ({activeRecipe.timesCooked}×) · ↶ Undo
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="rc-pill"
                      onClick={() => handleMarkCooked(activeRecipe)}
                    >
                      ✓ Cooked This ({activeRecipe.timesCooked || 0}×)
                    </button>
                  )}
                  <button
                    type="button"
                    className="rc-pill"
                    onClick={() => setEditingDraft(recipeToDraft(activeRecipe))}
                  >
                    ✎ Edit Spec
                  </button>
                  {deletableIds.includes(activeRecipe.id) && (
                    <button
                      type="button"
                      className="rc-pill"
                      onClick={() => handleDeleteRecipe(activeRecipe)}
                    >
                      🗑 Delete
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Spec Header */}
          <section className="rc-spec-header">
            <div>
              <div className="rc-cat-badge">
                <span>{CATEGORY_LABELS[activeRecipe.category]?.emoji}</span>
                <span>{CATEGORY_LABELS[activeRecipe.category]?.label}</span>
                {activeRecipe.rating && (
                  <span className="rc-rating-badge" style={{ marginLeft: '0.4rem' }}>
                    ★ {activeRecipe.rating.toFixed(1)} / 10
                  </span>
                )}
              </div>
              <h1 className="rc-spec-title">{activeRecipe.title}</h1>
              <p className="rc-spec-summary">{activeRecipe.summary}</p>

              <div className="rc-tag-row">
                {activeRecipe.equipment.map((eq) => (
                  <span key={eq} className="rc-mini-tag">
                    🍳 {eq}
                  </span>
                ))}
                {activeRecipe.tags.map((tag) => (
                  <span key={tag} className="rc-mini-tag">
                    #{tag}
                  </span>
                ))}
              </div>

              <div className="rc-kpi-grid">
                <div className="rc-kpi">
                  <span className="rc-kpi-label">Total Time</span>
                  <span className="rc-kpi-val">{activeSchedule.totalMinutes} min</span>
                </div>
                <div className="rc-kpi">
                  <span className="rc-kpi-label">Active / Passive</span>
                  <span className="rc-kpi-val">
                    {activeSchedule.activeMinutes}m / {activeSchedule.passiveMinutes}m
                  </span>
                </div>
                <div className="rc-kpi">
                  <span className="rc-kpi-label">BOM Items</span>
                  <span className="rc-kpi-val">{activeBom.length}</span>
                </div>
                {activeRecipe.macros?.calories && (
                  <div className="rc-kpi">
                    <span className="rc-kpi-label">Calories / serv</span>
                    <span className="rc-kpi-val">{activeRecipe.macros.calories} kcal</span>
                  </div>
                )}
                {activeRecipe.macros?.protein !== undefined && (
                  <div className="rc-kpi">
                    <span className="rc-kpi-label">Macros (P/C/F)</span>
                    <span className="rc-kpi-val">
                      {activeRecipe.macros.protein}g / {activeRecipe.macros.carbs ?? 0}g /{' '}
                      {activeRecipe.macros.fat ?? 0}g
                    </span>
                  </div>
                )}
              </div>
            </div>

            {activeRecipe.photo && (
              <img
                src={mediaSrc(activeRecipe.photo, 960)}
                alt={activeRecipe.title}
                className="rc-spec-photo"
                decoding="async"
              />
            )}
          </section>

          {/* Scaling & Unit Control Bar */}
          <section className="rc-control-bar">
            <div className="rc-control-group">
              <span className="rc-control-label">Batch Scale</span>
              <div className="rc-seg-group">
                {[0.5, 1, 1.5, 2, 3].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    className={`rc-seg-btn ${Math.abs(scale - preset) < 0.01 ? 'is-active' : ''}`}
                    onClick={() => {
                      setScale(preset);
                      setConstraintKey('');
                      setConstraintVal('');
                    }}
                  >
                    {preset === 0.5 ? '½×' : `${preset}×`}
                  </button>
                ))}
              </div>
              <div className="rc-stepper">
                <button
                  type="button"
                  onClick={() => {
                    const nextServ = Math.max(1, Math.round(scaledServings) - 1);
                    setScale(nextServ / activeRecipe.servings);
                  }}
                >
                  −
                </button>
                <span>{formatQuantity(scaledServings, true)} servings</span>
                <button
                  type="button"
                  onClick={() => {
                    const nextServ = Math.min(48, Math.round(scaledServings) + 1);
                    setScale(nextServ / activeRecipe.servings);
                  }}
                >
                  +
                </button>
              </div>
            </div>

            <div className="rc-control-group">
              <span className="rc-control-label">Units</span>
              <div className="rc-seg-group">
                {(['us', 'metric', 'both'] as UnitMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={`rc-seg-btn ${unitMode === mode ? 'is-active' : ''}`}
                    onClick={() => {
                      setUnitMode(mode);
                      // The amount on hand was typed in the units shown, so re-read it in the new ones.
                      if (constraintKey) handleConstraintChange(constraintKey, constraintVal, mode);
                    }}
                  >
                    {mode === 'us' ? 'US' : mode === 'metric' ? 'Metric' : 'US + Metric'}
                  </button>
                ))}
              </div>
            </div>

            {quantifiableBom.length > 0 && (
              <div className="rc-constraint-row">
                <span className="rc-control-label">⚖️ Scale by Ingredient on Hand:</span>
                <select
                  className="rc-select"
                  value={constraintKey}
                  onChange={(e) => handleConstraintChange(e.target.value, constraintVal)}
                >
                  <option value="">Choose limiting ingredient…</option>
                  {quantifiableBom.map((item) => {
                    const u =
                      unitMode === 'metric'
                        ? item.metricUnit || item.usUnit
                        : item.usUnit || item.metricUnit;
                    return (
                      <option key={item.key} value={item.key}>
                        {item.name} {u ? `(${u})` : ''}
                      </option>
                    );
                  })}
                </select>
                {constraintKey && (
                  <>
                    <input
                      type="number"
                      step="any"
                      min="0.1"
                      className="rc-constraint-input"
                      placeholder="Amount"
                      value={constraintVal}
                      onChange={(e) => handleConstraintChange(constraintKey, e.target.value)}
                    />
                    <span className="rc-sec-start-badge">
                      Active Multiplier: {Number(scale.toFixed(2))}×
                    </span>
                  </>
                )}
              </div>
            )}
          </section>

          {/* Top Grid: Bill of Materials + Back-Scheduled Parallel Gantt */}
          <div className="rc-spec-top-grid">
            <section className="rc-box">
              <div className="rc-box-head">
                <h2 className="rc-box-title">
                  📦 Bill of Materials ({activeBom.length} items)
                </h2>
                <button
                  type="button"
                  className="rc-pill"
                  onClick={() =>
                    copyShoppingList(
                      activeBom,
                      scale,
                      `Shopping List — ${activeRecipe.title} (${formatQuantity(scaledServings, true)} servings)`,
                    )
                  }
                >
                  {copyStatus || '📋 Copy Shopping List'}
                </button>
              </div>
              <div className="rc-bom-list">
                {activeBom.map((item) => {
                  const autoDone =
                    item.stepKeys.length > 0 &&
                    item.stepKeys.every((sk) => completedSteps[sk]);
                  const isDone = autoDone || Boolean(manualCheckedBom[item.key]);
                  return (
                    <div
                      key={item.key}
                      className={`rc-bom-item ${isDone ? 'is-done' : ''}`}
                      onClick={() =>
                        setManualCheckedBom((prev) => ({
                          ...prev,
                          [item.key]: !isDone,
                        }))
                      }
                    >
                      <span className="rc-bom-check">{isDone ? '✓' : ''}</span>
                      <div>
                        <span className="rc-bom-amount">
                          {formatBomAmount(item, scale, unitMode)}
                        </span>
                        <span>{item.name}</span>
                        {item.stepKeys.length > 1 && (
                          <span className="rc-bom-multi">
                            (summed across {item.stepKeys.length} steps)
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="rc-box">
              <div className="rc-box-head">
                <h2 className="rc-box-title">
                  📊 Parallel Gantt Timeline (Finish @ T+{activeSchedule.totalMinutes}m)
                </h2>
                <div className="rc-gantt-legend">
                  <span>
                    <i className="rc-legend-dot is-active" /> Active
                  </span>
                  <span>
                    <i className="rc-legend-dot is-passive" /> Passive / Wait
                  </span>
                </div>
              </div>
              <div className="rc-gantt-tracks">
                {activeSchedule.tracks.map((track) => (
                  <div key={track.sectionIndex} className="rc-gantt-row">
                    <div className="rc-gantt-label">
                      <span>{track.sectionName}</span>
                      <span className="rc-gantt-offset">
                        Start at T+{track.startOffsetMin}m
                      </span>
                    </div>
                    <div className="rc-gantt-bar-track">
                      {track.blocks.map((block) => {
                        const total = Math.max(1, activeSchedule.totalMinutes);
                        const left = (block.startMin / total) * 100;
                        const width = Math.max(5, (block.durationMin / total) * 100);
                        const done = Boolean(completedSteps[block.stepKey]);
                        return (
                          <div
                            key={block.stepKey}
                            className={`rc-gantt-block ${
                              block.passive ? 'is-passive' : 'is-active'
                            } ${done ? 'is-done' : ''}`}
                            style={{ left: `${left}%`, width: `${width}%` }}
                            title={`${block.label} (${block.durationMin} min ${
                              block.passive ? 'passive' : 'active'
                            }) — click to toggle step complete`}
                            onClick={() =>
                              setCompletedSteps((prev) => ({
                                ...prev,
                                [block.stepKey]: !prev[block.stepKey],
                              }))
                            }
                          >
                            {block.durationMin}m {block.label}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>

          {/* Procedure Sections */}
          <section className="rc-procedure">
            {activeRecipe.sections.map((sec, sIdx) => {
              const track = activeSchedule.tracks[sIdx];
              const readyFor = parseStepKey(sec.readyBy);
              const readyForName = readyFor ? activeRecipe.sections[readyFor.section]?.name : undefined;
              return (
                <div key={sIdx} className="rc-sec-card">
                  <div className="rc-sec-head">
                    <h3 className="rc-sec-name">{sec.name}</h3>
                    {track && (
                      <span className="rc-sec-start-badge">
                        Start at T+{track.startOffsetMin} min · {track.durationMin} min track
                        {readyFor && readyForName !== undefined
                          ? ` · ready for ${readyForName || 'Main'} step ${readyFor.step + 1}`
                          : ''}
                      </span>
                    )}
                  </div>

                  <div className="rc-step-list">
                    {sec.steps.map((stepText, stIdx) => {
                      const stepKey = `${sIdx}:${stIdx}`;
                      const isDone = Boolean(completedSteps[stepKey]);
                      const segments = parseStepTokens(stepText);

                      return (
                        <div
                          key={stepKey}
                          className={`rc-step-row ${isDone ? 'is-done' : ''}`}
                        >
                          <button
                            type="button"
                            className="rc-step-num"
                            onClick={() =>
                              setCompletedSteps((prev) => ({
                                ...prev,
                                [stepKey]: !prev[stepKey],
                              }))
                            }
                            title="Mark step complete"
                          >
                            {isDone ? '✓' : stIdx + 1}
                          </button>

                          <div className="rc-step-text">
                            {segments.map((seg, segIdx) => {
                              if (seg.kind === 'text') {
                                return <React.Fragment key={segIdx}>{seg.text}</React.Fragment>;
                              }
                              if (seg.kind === 'ingredient') {
                                const amt = formatIngredientAmount(seg, scale, unitMode);
                                return (
                                  <span key={segIdx} className="rc-chip-ing">
                                    {amt && <span className="rc-chip-ing-qty">{amt}</span>}
                                    <span className="rc-chip-ing-name">{seg.name}</span>
                                  </span>
                                );
                              }
                              if (seg.kind === 'temp') {
                                return (
                                  <span key={segIdx} className="rc-chip-temp">
                                    🌡 {formatTemp(seg, unitMode)}
                                  </span>
                                );
                              }
                              if (seg.kind === 'timer') {
                                const timerId = `${activeRecipe.id}:${stepKey}:${segIdx}`;
                                const tState = timers[timerId];
                                const running = Boolean(tState && tState.endsAt !== null && !tState.done);
                                const done = Boolean(tState?.done);
                                return (
                                  <button
                                    key={segIdx}
                                    type="button"
                                    className={`rc-chip-timer ${running ? 'is-running' : ''} ${
                                      done ? 'is-done' : ''
                                    }`}
                                    onClick={() =>
                                      toggleTimerChip(
                                        timerId,
                                        `${sec.name} #${stIdx + 1} (${seg.label})`,
                                        seg.seconds,
                                        activeRecipe.slug,
                                      )
                                    }
                                    title="Click to start / pause countdown timer"
                                  >
                                    ⏱{' '}
                                    {tState
                                      ? done
                                        ? `Done! (${seg.label})`
                                        : `${formatClock(secondsLeft(tState, now))}${
                                            running ? '' : ' (paused)'
                                          }`
                                      : seg.label}
                                  </button>
                                );
                              }
                              return null;
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </section>

          {activeRecipe.notes && (
            <section className="rc-box">
              <div className="rc-box-head" style={{ marginBottom: '0.4rem' }}>
                <h3 className="rc-box-title">🔬 Engineering & Lab Notes</h3>
              </div>
              <p style={{ margin: 0, fontSize: '0.92rem', lineHeight: 1.55, color: 'var(--text-primary)' }}>
                {activeRecipe.notes}
              </p>
            </section>
          )}
        </div>

        {timersBar}
      </main>
    );
  }

  // Until the list arrives (also for a shared ?recipe= link, so the finder doesn't flash first).
  if (loadState === 'loading') {
    return (
      <main className="rc-page">
        <p className="rc-subtitle">Loading recipes…</p>
        {timersBar}
      </main>
    );
  }

  // ── 3. FINDER / INDEX VIEW ──
  return (
    <main className="rc-page">
      {popup}
      {timersBar}
      {selectedSlug && loadState === 'ready' && (
        <div className="rc-notice">
          That recipe wasn’t found — it may have been renamed or deleted.
          <button type="button" className="rc-pill" onClick={() => openRecipe(null)}>
            OK
          </button>
        </div>
      )}
      <header className="rc-top-bar">
        <div className="rc-title-block">
          <h1>Engineering Recipe Manager</h1>
          <p className="rc-subtitle">
            Single-source-of-truth spec sheets: write quantities & timers once inside steps; the Bill of
            Materials and back-scheduled parallel Gantt timeline assemble automatically.
          </p>
        </div>
        <div className="rc-top-actions">
          {canEdit && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setEditingDraft(emptyDraft())}
            >
              + New Recipe Spec
            </button>
          )}
        </div>
      </header>

      {/* Finder & Fridge Matcher Bar */}
      <section className="rc-finder-panel">
        <div className="rc-search-row">
          <div className="rc-input-wrap">
            <span className="rc-input-icon">🔍</span>
            <input
              className="rc-input"
              placeholder="Search dish, ingredient, equipment, or tag…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                type="button"
                className="rc-input-clear"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
              >
                ✕
              </button>
            )}
          </div>

          <div className="rc-input-wrap">
            <span className="rc-input-icon">🧊</span>
            <input
              className="rc-input"
              placeholder="Fridge / Pantry matcher (e.g. chicken, rice, garlic, honey)…"
              value={pantryQuery}
              onChange={(e) => setPantryQuery(e.target.value)}
            />
            {pantryQuery && (
              <button
                type="button"
                className="rc-input-clear"
                onClick={() => setPantryQuery('')}
                aria-label="Clear pantry filter"
              >
                ✕
              </button>
            )}
          </div>

          <select
            className="rc-select"
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as SortMode)}
            aria-label="Sort recipes"
          >
            <option value="rating">Sort: Highest Rated</option>
            <option value="fastest">Sort: Fastest Total Time</option>
            <option value="fewest_ing">Sort: Fewest Ingredients</option>
            <option value="protein_efficiency">Sort: Highest Protein / Cal</option>
            <option value="most_cooked">Sort: Most Cooked</option>
          </select>
        </div>

        <div className="rc-filter-row">
          <button
            type="button"
            className={`rc-pill ${categoryFilter === 'all' ? 'is-active' : ''}`}
            onClick={() => setCategoryFilter('all')}
          >
            All ({recipes.length})
          </button>
          {RECIPE_CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              className={`rc-pill ${categoryFilter === cat ? 'is-active' : ''}`}
              onClick={() => setCategoryFilter(categoryFilter === cat ? 'all' : cat)}
            >
              <span>{CATEGORY_LABELS[cat].emoji}</span>
              <span>{CATEGORY_LABELS[cat].label}</span>
            </button>
          ))}

          <span className="rc-filter-divider" />

          {[
            { id: 'fast', label: '⚡ ≤ 25 min' },
            { id: 'one-pan', label: '🍳 One-Pan' },
            { id: 'high-protein', label: '💪 High Protein (30g+)' },
            { id: 'cast-iron', label: '🔥 Cast Iron' },
            { id: 'sheet-pan', label: '🍪 Sheet Pan' },
          ].map((qf) => (
            <button
              key={qf.id}
              type="button"
              className={`rc-pill ${quickFilter === qf.id ? 'is-active' : ''}`}
              onClick={() => setQuickFilter(quickFilter === qf.id ? null : qf.id)}
            >
              {qf.label}
            </button>
          ))}
        </div>
      </section>

      {/* Combined Multi-Recipe Grocery Cart */}
      {cartIds.length > 0 && (
        <section className="rc-cart-bar">
          <div className="rc-cart-head">
            <div>
              <strong>🛒 Combined Grocery Cart ({cartIds.length} recipes selected)</strong>
              <span style={{ marginLeft: '0.6rem', fontSize: '0.84rem', color: 'var(--text-secondary)' }}>
                {combinedCartBom.length} merged ingredients
              </span>
            </div>
            <div className="rc-top-actions">
              <button
                type="button"
                className="rc-pill is-active"
                onClick={() =>
                  copyShoppingList(
                    combinedCartBom,
                    1,
                    `Combined Grocery List (${cartIds.length} recipes)`,
                  )
                }
              >
                {copyStatus || '📋 Copy Combined List'}
              </button>
              <button type="button" className="rc-pill" onClick={() => setCartIds([])}>
                Clear Cart
              </button>
            </div>
          </div>
          <div className="rc-cart-list">
            {combinedCartBom.map((item) => (
              <div key={item.key} className="rc-cart-item">
                <span className="rc-cart-qty">
                  {formatBomAmount(item, 1, unitMode)}
                </span>
                <span>{item.name}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {loadState === 'error' && <div className="rc-notice">Couldn’t load the recipes. Try refreshing the page.</div>}
      {loadState === 'ready' && filteredRecipes.length === 0 && (
        <div className="rc-notice">
          {recipes.length === 0
            ? canEdit
              ? 'No recipes yet — add the first one with “New Recipe Spec”.'
              : 'No recipes yet.'
            : 'No recipes match those filters.'}
        </div>
      )}

      {/* Recipe Cards Grid */}
      <section className="rc-grid">
        {filteredRecipes.map(({ recipe, bom, schedule, pantry }) => {
          const inCart = cartIds.includes(recipe.id);
          return (
            <article
              key={recipe.id}
              className="rc-card"
              role="link"
              tabIndex={0}
              aria-label={recipe.title}
              onClick={() => openRecipe(recipe.slug)}
              onKeyDown={(e) => {
                if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault();
                  openRecipe(recipe.slug);
                }
              }}
            >
              {recipe.photo && (
                <img
                  src={mediaSrc(recipe.photo, 640)}
                  alt={recipe.title}
                  className="rc-card-photo"
                  loading="lazy"
                  decoding="async"
                />
              )}
              <div className="rc-card-body">
                <div className="rc-card-top">
                  <span className="rc-cat-badge">
                    {CATEGORY_LABELS[recipe.category]?.emoji}{' '}
                    {CATEGORY_LABELS[recipe.category]?.label}
                  </span>
                  <div className="rc-card-top-right">
                    {recipe.rating && (
                      <span className="rc-rating-badge">★ {recipe.rating.toFixed(1)}</span>
                    )}
                    <button
                      type="button"
                      className={`rc-cart-toggle ${inCart ? 'is-selected' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setCartIds((prev) =>
                          prev.includes(recipe.id)
                            ? prev.filter((id) => id !== recipe.id)
                            : [...prev, recipe.id],
                        );
                      }}
                      title="Add to combined multi-recipe grocery list"
                    >
                      {inCart ? '✓ In Cart' : '+ Grocery'}
                    </button>
                  </div>
                </div>

                <h2 className="rc-card-title">{recipe.title}</h2>
                <p className="rc-card-summary">{recipe.summary}</p>

                {pantryQuery.trim() && (
                  <div className="rc-pantry-match">
                    <div className="rc-pantry-match-head">
                      <span>
                        Pantry Match: {pantry.matched}/{pantry.total}
                      </span>
                      <span>{Math.round(pantry.ratio * 100)}%</span>
                    </div>
                    {pantry.missing.length > 0 && (
                      <div className="rc-pantry-missing">
                        Need: {pantry.missing.slice(0, 4).join(', ')}
                        {pantry.missing.length > 4 ? ` +${pantry.missing.length - 4} more` : ''}
                      </div>
                    )}
                  </div>
                )}

                <div className="rc-tag-row">
                  {recipe.equipment.map((eq) => (
                    <span key={eq} className="rc-mini-tag">
                      🍳 {eq}
                    </span>
                  ))}
                  {recipe.tags.slice(0, 2).map((t) => (
                    <span key={t} className="rc-mini-tag">
                      #{t}
                    </span>
                  ))}
                </div>

                <div className="rc-spec-strip">
                  <span>
                    ⏱ <strong>{schedule.totalMinutes}m</strong> ({schedule.activeMinutes}m act)
                  </span>
                  <span>
                    📦 <strong>{bom.length}</strong> ing
                  </span>
                  {recipe.macros?.protein !== undefined && (
                    <span>
                      💪 <strong>{recipe.macros.protein}g</strong> P
                    </span>
                  )}
                  {recipe.timesCooked > 0 && <span>🔥 {recipe.timesCooked}×</span>}
                </div>
              </div>
            </article>
          );
        })}
      </section>
    </main>
  );
}

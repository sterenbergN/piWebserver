'use client';

import { useMemo, useRef, useState } from 'react';
import { mediaSrc } from '@/lib/media-url';
import {
  CATEGORY_LABELS,
  EQUIPMENT_OPTIONS,
  RECIPE_CATEGORIES,
  buildSchedule,
  canonicalEquipment,
  cleanRecipeEmoji,
  detachSubRecipe,
  extractIngredients,
  formatBomAmount,
  parseStepKey,
  recipeEmoji,
  resolveRecipe,
  smartAnnotateText,
  suggestEquipment,
  usesRecipe,
  type Recipe,
  type RecipeCategory,
  type RecipeSection,
} from '@/lib/recipes/recipes';
import type { ImportedRecipe } from '@/lib/recipes/import';
import { TimerPills } from './shared';
import type { RecipeTimers } from './useRecipeTimers';

export type EditorDraft = {
  id?: string;
  title: string;
  summary: string;
  category: RecipeCategory;
  servings: number;
  prepMinutes: string;
  cookMinutes: string;
  equipment: string[];
  tagsText: string;
  photo: string;
  emoji: string;
  calories: string;
  protein: string;
  carbs: string;
  fat: string;
  rating: string;
  notes: string;
  sourceUrl: string;
  isPrivate: boolean;
  sections: RecipeSection[];
};

export function emptyDraft(): EditorDraft {
  return {
    title: '',
    summary: '',
    category: 'dinner',
    servings: 4,
    prepMinutes: '',
    cookMinutes: '',
    equipment: [],
    tagsText: '',
    photo: '',
    emoji: '',
    calories: '',
    protein: '',
    carbs: '',
    fat: '',
    rating: '',
    notes: '',
    sourceUrl: '',
    isPrivate: false,
    sections: [{ name: 'Main', steps: [''] }],
  };
}

/** An imported recipe, ready to check over. Private until you say otherwise: it's someone else's writing. */
export function importedToDraft(recipe: ImportedRecipe & { photo?: string }): EditorDraft {
  return {
    ...emptyDraft(),
    title: recipe.title,
    summary: recipe.summary,
    category: recipe.category,
    servings: recipe.servings,
    prepMinutes: recipe.prepMinutes ? String(recipe.prepMinutes) : '',
    cookMinutes: recipe.cookMinutes ? String(recipe.cookMinutes) : '',
    equipment: recipe.equipment.map(canonicalEquipment),
    tagsText: recipe.tags.join(', '),
    photo: recipe.photo || '',
    calories: recipe.macros?.calories !== undefined ? String(recipe.macros.calories) : '',
    protein: recipe.macros?.protein !== undefined ? String(recipe.macros.protein) : '',
    carbs: recipe.macros?.carbs !== undefined ? String(recipe.macros.carbs) : '',
    fat: recipe.macros?.fat !== undefined ? String(recipe.macros.fat) : '',
    sourceUrl: recipe.sourceUrl || '',
    isPrivate: true,
    sections: recipe.sections.length ? recipe.sections : [{ name: 'Main', steps: [''] }],
  };
}

export function recipeToDraft(r: Recipe): EditorDraft {
  return {
    id: r.id,
    title: r.title,
    summary: r.summary,
    category: r.category,
    servings: r.servings,
    prepMinutes: r.prepMinutes ? String(r.prepMinutes) : '',
    cookMinutes: r.cookMinutes ? String(r.cookMinutes) : '',
    equipment: r.equipment,
    tagsText: r.tags.join(', '),
    photo: r.photo || '',
    emoji: r.emoji || '',
    calories: r.macros?.calories !== undefined ? String(r.macros.calories) : '',
    protein: r.macros?.protein !== undefined ? String(r.macros.protein) : '',
    carbs: r.macros?.carbs !== undefined ? String(r.macros.carbs) : '',
    fat: r.macros?.fat !== undefined ? String(r.macros.fat) : '',
    rating: r.rating !== undefined ? String(r.rating) : '',
    notes: r.notes || '',
    sourceUrl: r.sourceUrl || '',
    isPrivate: Boolean(r.private),
    sections: r.sections.length ? r.sections.map((s) => ({ ...s, steps: [...s.steps] })) : [{ name: 'Main', steps: [''] }],
  };
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

const stepInputId = (sIdx: number, stIdx: number) => `rc-step-${sIdx}-${stIdx}`;

const EMOJIS = [
  '🍗', '🍖', '🥩', '🥓', '🍔', '🌭', '🍕', '🌮', '🌯', '🥙', '🥪', '🍝', '🍜', '🍲', '🍛', '🍚',
  '🍣', '🍤', '🐟', '🥟', '🍱', '🍳', '🥞', '🧇', '🥯', '🥐', '🍞', '🥣', '🥗', '🥦', '🥕', '🌽',
  '🍅', '🥑', '🍆', '🥔', '🍄', '🧄', '🧅', '🌶️', '🫘', '🧀', '🫙', '🍯', '🍎', '🍌', '🍓', '🍋',
  '🍪', '🍰', '🧁', '🥧', '🍫', '🍩', '🍦', '🍮', '☕', '🍵', '🥤', '🍺', '🍷', '🍹',
];

const TOKENS = [
  { label: 'Ingredient', token: '[1 cup flour]' },
  { label: 'Timer', token: '[5 min]' },
  { label: 'Wait', token: '[15 min passive]' },
  { label: 'Temp', token: '[400°F]' },
];

export default function RecipeEditor({
  initial,
  recipes,
  timers,
  onCancel,
  onSaved,
  onCreatedPart,
  showAlert,
}: {
  initial: EditorDraft;
  /** Every recipe as stored, to use as parts. */
  recipes: Recipe[];
  timers: RecipeTimers;
  onCancel: () => void;
  onSaved: (recipe: Recipe, canDelete: boolean) => void;
  /** A part was split off into a recipe of its own, without leaving this one. */
  onCreatedPart: (recipe: Recipe, canDelete: boolean) => void;
  showAlert: (message: string) => Promise<void> | void;
}) {
  const [draft, setDraft] = useState<EditorDraft>(initial);
  const [linking, setLinking] = useState(false);
  const [linkQuery, setLinkQuery] = useState('');
  const [splitting, setSplitting] = useState<number | null>(null);
  const [showAllGear, setShowAllGear] = useState(false);
  const [newGear, setNewGear] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [showEmojis, setShowEmojis] = useState(false);
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState('');

  // The last focused step and caret, so the token buttons insert at the cursor.
  const focusedStepRef = useRef<{ sIdx: number; stIdx: number; caret: number } | null>(null);

  const byId = useMemo(() => new Map(recipes.map((r) => [r.id, r])), [recipes]);
  // The preview counts what linked recipes bring with them.
  const resolved = useMemo(() => resolveRecipe({ id: draft.id ?? '', sections: draft.sections, equipment: [] }, byId), [draft.id, draft.sections, byId]);
  const previewBom = useMemo(() => extractIngredients(resolved), [resolved]);
  const previewSchedule = useMemo(
    () =>
      buildSchedule({
        sections: resolved.sections,
        prepMinutes: Number(draft.prepMinutes) || undefined,
        cookMinutes: Number(draft.cookMinutes) || undefined,
      }),
    [resolved, draft.prepMinutes, draft.cookMinutes],
  );

  // With nothing picked, the equipment is whatever the steps call for: picking takes over from there.
  const suggested = useMemo(() => suggestEquipment(draft.sections), [draft.sections]);
  const gear = draft.equipment.length ? draft.equipment : suggested;
  const gearShown = showAllGear ? [...new Set([...EQUIPMENT_OPTIONS, ...gear])] : gear;
  const toggleGear = (item: string) => update('equipment', gear.includes(item) ? gear.filter((g) => g !== item) : [...gear, item]);
  const addGear = () => {
    const clean = canonicalEquipment(newGear);
    if (clean && !gear.includes(clean)) update('equipment', [...gear, clean]);
    setNewGear('');
  };

  // A recipe that uses this one can't also be a part of it.
  const linkable = useMemo(() => {
    const q = linkQuery.trim().toLowerCase();
    return recipes
      .filter((r) => !draft.id || !usesRecipe(r, draft.id, byId))
      .filter((r) => !draft.sections.some((s) => s.sub?.recipeId === r.id))
      .filter((r) => !q || r.title.toLowerCase().includes(q))
      .sort((a, b) => Number(b.category === 'sauce') - Number(a.category === 'sauce') || a.title.localeCompare(b.title));
  }, [recipes, draft.id, draft.sections, linkQuery, byId]);

  const addLink = (recipe: Recipe) => {
    // A recipe that's only an empty "Main" so far has nothing worth keeping.
    const keep = draft.sections.filter((s) => s.sub || s.name !== 'Main' || s.steps.some((step) => step.trim()));
    update('sections', [...keep, { name: '', steps: [], sub: { recipeId: recipe.id, servings: draft.servings } }]);
    setLinking(false);
    setLinkQuery('');
    focusedStepRef.current = null;
  };

  // Lift a part out into a recipe of its own, and leave a link where it was.
  const splitPart = async (sIdx: number) => {
    const sec = draft.sections[sIdx];
    if (!sec.name.trim()) {
      await showAlert('Give this part a name first, like Tzatziki. That becomes the new recipe’s name.');
      return;
    }
    setSplitting(sIdx);
    try {
      const res = await fetch('/api/recipes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'save',
          recipe: {
            title: sec.name,
            category: 'sauce',
            servings: draft.servings,
            private: draft.isPrivate,
            sections: [{ name: 'Main', steps: sec.steps }],
          },
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.recipe) {
        await showAlert(data?.message || 'Could not make that into a recipe.');
        return;
      }
      onCreatedPart(data.recipe, Boolean(data.canDelete));
      focusedStepRef.current = null;
      setDraft((prev) => ({
        ...prev,
        sections: prev.sections.map((s, i) => {
          if (i === sIdx) return { name: '', steps: [], sub: { recipeId: data.recipe.id, servings: prev.servings }, ...(s.readyBy ? { readyBy: s.readyBy } : {}) };
          // Its steps have moved, so nothing here can be timed against them any more.
          return parseStepKey(s.readyBy)?.section === sIdx ? { name: s.name, steps: s.steps } : s;
        }),
      }));
    } catch {
      await showAlert('Network error. Try again.');
    } finally {
      setSplitting(null);
    }
  };

  // Keep this recipe's own copy of the steps, cut off from the original.
  const detachPart = (recipeId: string) => {
    const child = byId.get(recipeId);
    if (child) update('sections', detachSubRecipe({ id: draft.id ?? '', sections: draft.sections }, child).sections);
  };

  const update = <K extends keyof EditorDraft>(key: K, value: EditorDraft[K]) => setDraft((prev) => ({ ...prev, [key]: value }));

  const handleSave = async () => {
    setSaving(true);
    try {
      const toList = (text: string) => text.split(',').map((s) => s.trim()).filter(Boolean);
      const res = await fetch('/api/recipes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'save',
          recipe: {
            id: draft.id,
            title: draft.title,
            summary: draft.summary,
            category: draft.category,
            servings: draft.servings,
            prepMinutes: draft.prepMinutes ? Number(draft.prepMinutes) : undefined,
            cookMinutes: draft.cookMinutes ? Number(draft.cookMinutes) : undefined,
            equipment: draft.equipment,
            tags: toList(draft.tagsText),
            photo: draft.photo || undefined,
            emoji: draft.emoji,
            macros: {
              calories: draft.calories ? Number(draft.calories) : undefined,
              protein: draft.protein !== '' ? Number(draft.protein) : undefined,
              carbs: draft.carbs !== '' ? Number(draft.carbs) : undefined,
              fat: draft.fat !== '' ? Number(draft.fat) : undefined,
            },
            rating: draft.rating ? Number(draft.rating) : null, // null clears it
            notes: draft.notes,
            sourceUrl: draft.sourceUrl,
            private: draft.isPrivate,
            sections: draft.sections,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.recipe) {
        await showAlert(data?.message || 'Could not save the recipe.');
        return;
      }
      onSaved(data.recipe, Boolean(data.canDelete));
    } catch {
      await showAlert('Network error saving the recipe.');
    } finally {
      setSaving(false);
    }
  };

  const handlePhotoUpload = async (file: File) => {
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
      update('photo', data.src);
    } catch {
      await showAlert('Photo upload failed.');
    } finally {
      setUploadingPhoto(false);
    }
  };

  // Insert at the caret of the last focused step (the last step if that one
  // was removed), then select what's inside the brackets to type over it.
  const insertToken = (token: string) => {
    const lastSec = draft.sections.reduce((last, s, i) => (s.sub ? last : i), -1);
    if (lastSec < 0) return; // nothing but linked recipes, whose steps live elsewhere
    const focused = focusedStepRef.current;
    const target =
      focused && draft.sections[focused.sIdx]?.steps[focused.stIdx] !== undefined
        ? focused
        : { sIdx: lastSec, stIdx: draft.sections[lastSec].steps.length - 1, caret: Infinity };
    const st = draft.sections[target.sIdx].steps[target.stIdx];
    const caret = Math.min(target.caret, st.length);
    const before = st.slice(0, caret);
    const after = st.slice(caret);
    const lead = before && !before.endsWith(' ') ? ' ' : '';
    const trail = after.startsWith(' ') ? '' : ' ';
    const start = before.length + lead.length;
    focusedStepRef.current = { ...target, caret: start + token.length + trail.length };
    setDraft({
      ...draft,
      sections: draft.sections.map((sec, sIdx) =>
        sIdx !== target.sIdx
          ? sec
          : { ...sec, steps: sec.steps.map((s, i) => (i === target.stIdx ? `${before}${lead}${token}${trail}${after}` : s)) },
      ),
    });
    window.setTimeout(() => {
      const input = document.getElementById(stepInputId(target.sIdx, target.stIdx)) as HTMLTextAreaElement | null;
      input?.focus();
      input?.setSelectionRange(start + 1, start + token.length - 1);
    });
  };

  const applyPaste = () => {
    const lines = pasteText
      .split(/\r?\n+/)
      .map((l) => l.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, '').trim())
      .filter(Boolean)
      .map((line) => smartAnnotateText(line));
    if (!lines.length) return;
    const target = Math.max(0, draft.sections.findIndex((s) => !s.sub));
    const sections = draft.sections.some((s) => !s.sub) ? [...draft.sections] : [{ name: 'Main', steps: [] }, ...draft.sections];
    sections[target] = { ...sections[target], steps: [...sections[target].steps.filter(Boolean), ...lines] };
    setDraft({ ...draft, sections });
    setPasteText('');
    setShowPaste(false);
  };

  const setSection = (sIdx: number, section: RecipeSection) => {
    const sections = [...draft.sections];
    sections[sIdx] = section;
    update('sections', sections);
  };

  return (
    <div className="rc-page rc-narrow">
      <div className="rc-editor-bar">
        <button type="button" className="rc-text-btn" onClick={onCancel}>
          Cancel
        </button>
        <span className="rc-editor-title">{draft.id ? 'Edit recipe' : draft.sourceUrl ? 'Check the import' : 'New recipe'}</span>
        <button type="button" className="btn btn-primary rc-btn-small" disabled={saving} onClick={handleSave}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      <div className="rc-form">
        {!draft.id && draft.sourceUrl && (
          <p className="rc-import-note">
            Imported from {draft.sourceUrl.replace(/^https?:\/\/(www\.)?/, '').split('/')[0]}. Give it a quick read: amounts were matched to the steps automatically.
          </p>
        )}

        <label className="rc-field">
          Name
          <input className="rc-input" value={draft.title} onChange={(e) => update('title', e.target.value)} placeholder="Honey-garlic chicken thighs" />
        </label>

        <label className="rc-field">
          Short description
          <input className="rc-input" value={draft.summary} onChange={(e) => update('summary', e.target.value)} placeholder="Optional" />
        </label>

        <div className="rc-form-row">
          <label className="rc-field">
            Category
            <select className="rc-input" value={draft.category} onChange={(e) => update('category', e.target.value as RecipeCategory)}>
              {RECIPE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c].label}
                </option>
              ))}
            </select>
          </label>
          <label className="rc-field">
            Servings
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={48}
              className="rc-input"
              value={draft.servings}
              onChange={(e) => update('servings', Math.max(1, Number(e.target.value) || 1))}
            />
          </label>
        </div>

        <div className="rc-field">
          Photo or emoji
          <div className="rc-photo-row">
            {draft.photo ? (
              <img src={mediaSrc(draft.photo, 400)} alt="" className="rc-row-photo" />
            ) : (
              <span className="rc-row-photo rc-row-emoji" aria-hidden="true">{recipeEmoji(draft)}</span>
            )}
            <label className="rc-chip rc-file">
              {uploadingPhoto ? 'Uploading…' : draft.photo ? 'Replace' : 'Add a photo'}
              <input
                type="file"
                accept="image/*"
                disabled={uploadingPhoto}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = ''; // so picking the same file again still uploads
                  if (file) handlePhotoUpload(file);
                }}
              />
            </label>
            {draft.photo ? (
              <button type="button" className="rc-text-btn" onClick={() => update('photo', '')}>
                Remove
              </button>
            ) : (
              <button type="button" className={`rc-chip${showEmojis ? ' is-active' : ''}`} aria-expanded={showEmojis} onClick={() => setShowEmojis((v) => !v)}>
                Pick an emoji
              </button>
            )}
          </div>
          {showEmojis && !draft.photo && (
            <div className="rc-emoji-panel">
              <div className="rc-emoji-grid" role="radiogroup" aria-label="Recipe emoji">
                {EMOJIS.map((e) => (
                  <button key={e} type="button" role="radio" aria-checked={draft.emoji === e} className="rc-emoji-pick" onClick={() => update('emoji', e)}>
                    {e}
                  </button>
                ))}
              </div>
              <div className="rc-emoji-more">
                <input
                  className="rc-input"
                  aria-label="Or type any emoji"
                  placeholder="Or type any emoji"
                  value={draft.emoji}
                  onChange={(e) => update('emoji', cleanRecipeEmoji(e.target.value))}
                />
                {draft.emoji && (
                  <button type="button" className="rc-text-btn" onClick={() => update('emoji', '')}>
                    Match the category
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="rc-form-block">
          <div className="rc-form-head">
            <h2>Steps</h2>
            <button type="button" className="rc-text-btn" aria-expanded={showPaste} onClick={() => setShowPaste((v) => !v)}>
              Paste a recipe
            </button>
          </div>
          <p className="rc-meta">
            Put amounts, times and temperatures in brackets, like <code>[1 cup flour]</code>, <code>[8 min]</code> or{' '}
            <code>[400°F]</code>. The ingredient list and timers are built from them. <code>[1 cup | 120 g flour]</code> sets both units;{' '}
            <code>[15 min passive]</code> is a hands-off wait.
          </p>

          {showPaste && (
            <div className="rc-paste">
              <textarea
                className="rc-input"
                rows={5}
                aria-label="Recipe text to paste"
                placeholder={'1. Sear 1.5 lb chicken in 1 tbsp olive oil at 400°F for 6 minutes.\n2. Rest for 5 minutes.'}
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
              />
              <button type="button" className="btn btn-secondary rc-btn-small" onClick={applyPaste}>
                Add as steps
              </button>
            </div>
          )}

          {draft.sections.map((sec, sIdx) => sec.sub ? (
            <div key={sIdx} className="rc-edit-part rc-edit-link">
              <div className="rc-edit-part-head">
                <strong className="rc-edit-link-name">
                  <span aria-hidden="true">↗</span> {byId.get(sec.sub.recipeId)?.title || 'A recipe that’s gone'}
                </strong>
                <button
                  type="button"
                  className="rc-icon-btn"
                  aria-label={`Remove ${byId.get(sec.sub.recipeId)?.title || 'this part'}`}
                  onClick={() => {
                    focusedStepRef.current = null;
                    const left = remapReadyBy(draft.sections.filter((_, i) => i !== sIdx), { section: sIdx });
                    update('sections', left.length ? left : [{ name: 'Main', steps: [''] }]);
                  }}
                >
                  ×
                </button>
              </div>
              <div className="rc-edit-link-row">
                <div className="rc-stepper" role="group" aria-label="Servings of it that go in">
                  <button type="button" aria-label="Fewer servings" disabled={sec.sub.servings <= 1} onClick={() => setSection(sIdx, { ...sec, sub: { ...sec.sub!, servings: sec.sub!.servings - 1 } })}>
                    −
                  </button>
                  <span>
                    {sec.sub.servings} {sec.sub.servings === 1 ? 'serving' : 'servings'} of it
                  </span>
                  <button type="button" aria-label="More servings" onClick={() => setSection(sIdx, { ...sec, sub: { ...sec.sub!, servings: Math.min(48, sec.sub!.servings + 1) } })}>
                    +
                  </button>
                </div>
                {byId.has(sec.sub.recipeId) && (
                  <button type="button" className="rc-text-btn" onClick={() => detachPart(sec.sub!.recipeId)}>
                    Copy the steps in instead
                  </button>
                )}
              </div>
              <p className="rc-meta">Its steps and ingredients come from that recipe, so a change there shows up here too.</p>
            </div>
          ) : (
            <div key={sIdx} className="rc-edit-part">
              {draft.sections.length > 1 && (
                <>
                  <div className="rc-edit-part-head">
                    <input
                      className="rc-input"
                      aria-label="Part name"
                      value={sec.name}
                      onChange={(e) => setSection(sIdx, { ...sec, name: e.target.value })}
                      placeholder="Part name, e.g. Sauce"
                    />
                    <button
                      type="button"
                      className="rc-icon-btn"
                      aria-label={`Remove ${sec.name || 'this part'}`}
                      onClick={() => {
                        focusedStepRef.current = null;
                        update('sections', remapReadyBy(draft.sections.filter((_, i) => i !== sIdx), { section: sIdx }));
                      }}
                    >
                      ×
                    </button>
                  </div>
                  <label className="rc-field">
                    Needs to be ready for
                    <select
                      className="rc-input"
                      value={sec.readyBy || ''}
                      onChange={(e) =>
                        setSection(sIdx, e.target.value ? { ...sec, readyBy: e.target.value } : { name: sec.name, steps: sec.steps })
                      }
                    >
                      <option value="">Serving (finishes with the dish)</option>
                      {draft.sections.map((other, oIdx) =>
                        oIdx === sIdx
                          ? null
                          : other.steps.map((stepText, oStIdx) => (
                              <option key={`${oIdx}:${oStIdx}`} value={`${oIdx}:${oStIdx}`}>
                                {other.name || `Part ${oIdx + 1}`}, step {oStIdx + 1}
                                {stepText ? `: ${stepText.replace(/\[([^\[\]]+)\]/g, '$1').slice(0, 36)}` : ''}
                              </option>
                            )),
                      )}
                    </select>
                  </label>
                </>
              )}

              {sec.steps.map((step, stIdx) => (
                <div key={stIdx} className="rc-edit-step">
                  <span className="rc-edit-num">{stIdx + 1}</span>
                  <textarea
                    id={stepInputId(sIdx, stIdx)}
                    className="rc-input"
                    rows={2}
                    aria-label={`Step ${stIdx + 1}`}
                    value={step}
                    onSelect={(e) => {
                      focusedStepRef.current = { sIdx, stIdx, caret: e.currentTarget.selectionStart };
                    }}
                    onChange={(e) => {
                      const steps = [...sec.steps];
                      steps[stIdx] = e.target.value;
                      setSection(sIdx, { ...sec, steps });
                    }}
                    placeholder="Sear [1 lb chicken] for [8 min]."
                  />
                  <button
                    type="button"
                    className="rc-icon-btn"
                    aria-label={`Delete step ${stIdx + 1}`}
                    onClick={() => {
                      const steps = sec.steps.filter((_, i) => i !== stIdx);
                      const sections = [...draft.sections];
                      sections[sIdx] = { ...sec, steps: steps.length ? steps : [''] };
                      focusedStepRef.current = null;
                      update('sections', steps.length ? remapReadyBy(sections, { section: sIdx, step: stIdx }) : sections);
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}

              <div className="rc-edit-part-foot">
                <button type="button" className="rc-text-btn" onClick={() => setSection(sIdx, { ...sec, steps: [...sec.steps, ''] })}>
                  + Add step
                </button>
                {draft.sections.length > 1 && sec.steps.some((s) => s.trim()) && (
                  <button type="button" className="rc-text-btn rc-muted-btn" disabled={splitting !== null} onClick={() => splitPart(sIdx)}>
                    {splitting === sIdx ? 'Making it…' : 'Make this its own recipe'}
                  </button>
                )}
              </div>
            </div>
          ))}

          <button
            type="button"
            className="rc-text-btn"
            onClick={() => update('sections', [...draft.sections, { name: '', steps: [''] }])}
          >
            + Add a part that cooks at the same time
          </button>
          {recipes.length > 0 && (
            <button type="button" className="rc-text-btn" onClick={() => setLinking(true)}>
              + Use another recipe as a part
            </button>
          )}

          <div className="rc-token-bar" role="group" aria-label="Insert into the step">
            <span className="rc-meta">Insert</span>
            {TOKENS.map(({ label, token }) => (
              <button
                key={label}
                type="button"
                className="rc-chip"
                // Keep the keyboard up and the caret in place while tapping.
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => insertToken(token)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="rc-field">
          Equipment
          {!draft.equipment.length && suggested.length > 0 && <span className="rc-meta">Worked out from your steps. Tap to change.</span>}
          <div className="rc-chips rc-chips-wrap">
            {gearShown.map((item) => (
              <button key={item} type="button" className={`rc-chip${gear.includes(item) ? ' is-active' : ''}`} aria-pressed={gear.includes(item)} onClick={() => toggleGear(item)}>
                {item}
              </button>
            ))}
            <button type="button" className="rc-chip rc-chip-more" aria-expanded={showAllGear} onClick={() => setShowAllGear((v) => !v)}>
              {showAllGear ? 'Fewer' : gearShown.length ? 'More' : 'Choose'}
            </button>
          </div>
          {showAllGear && (
            <div className="rc-gear-add">
              <input
                className="rc-input"
                placeholder="Something else, like Smoker"
                aria-label="Add other equipment"
                value={newGear}
                onChange={(e) => setNewGear(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addGear();
                  }
                }}
              />
              {newGear.trim() && (
                <button type="button" className="rc-text-btn" onClick={addGear}>
                  Add
                </button>
              )}
            </div>
          )}
        </div>

        <label className="rc-toggle">
          <input type="checkbox" checked={draft.isPrivate} onChange={(e) => update('isPrivate', e.target.checked)} />
          <span>
            Private
            <small>Only people signed in can see it. Best for recipes from other sites.</small>
          </span>
        </label>

        <details className="rc-details">
          <summary>
            Preview · {previewBom.length} {previewBom.length === 1 ? 'ingredient' : 'ingredients'}, {previewSchedule.totalMinutes} min
          </summary>
          {previewBom.length === 0 ? (
            <p className="rc-meta">Ingredients in brackets show up here.</p>
          ) : (
            <ul className="rc-preview">
              {previewBom.map((item) => (
                <li key={item.key}>
                  <strong className="rc-amt">{formatBomAmount(item, 1, 'both')}</strong> {item.name}
                </li>
              ))}
            </ul>
          )}
        </details>

        <details className="rc-details">
          <summary>More details</summary>
          <div className="rc-form">
            <div className="rc-form-row">
              <label className="rc-field">
                Prep minutes
                <input type="number" inputMode="numeric" min={0} className="rc-input" placeholder="Auto" value={draft.prepMinutes} onChange={(e) => update('prepMinutes', e.target.value)} />
              </label>
              <label className="rc-field">
                Cook minutes
                <input type="number" inputMode="numeric" min={0} className="rc-input" placeholder="Auto" value={draft.cookMinutes} onChange={(e) => update('cookMinutes', e.target.value)} />
              </label>
            </div>
            <label className="rc-field">
              Tags (comma-separated)
              <input className="rc-input" value={draft.tagsText} onChange={(e) => update('tagsText', e.target.value)} placeholder="Weeknight, High protein" />
            </label>
            <div className="rc-form-row">
              <label className="rc-field">
                Calories per serving
                <input type="number" inputMode="numeric" className="rc-input" value={draft.calories} onChange={(e) => update('calories', e.target.value)} />
              </label>
              <label className="rc-field">
                Protein (g)
                <input type="number" inputMode="numeric" className="rc-input" value={draft.protein} onChange={(e) => update('protein', e.target.value)} />
              </label>
              <label className="rc-field">
                Carbs (g)
                <input type="number" inputMode="numeric" className="rc-input" value={draft.carbs} onChange={(e) => update('carbs', e.target.value)} />
              </label>
              <label className="rc-field">
                Fat (g)
                <input type="number" inputMode="numeric" className="rc-input" value={draft.fat} onChange={(e) => update('fat', e.target.value)} />
              </label>
            </div>
            <label className="rc-field">
              Rating (1–10)
              <input type="number" inputMode="decimal" step="0.1" min={1} max={10} className="rc-input" value={draft.rating} onChange={(e) => update('rating', e.target.value)} />
            </label>
            <label className="rc-field">
              Source link
              <input type="url" className="rc-input" value={draft.sourceUrl} onChange={(e) => update('sourceUrl', e.target.value)} placeholder="Where it came from" />
            </label>
            <label className="rc-field">
              Notes
              <textarea className="rc-input" rows={3} value={draft.notes} onChange={(e) => update('notes', e.target.value)} placeholder="Tweaks, substitutions, why it works" />
            </label>
          </div>
        </details>
      </div>

      {timers.hasTimers && (
        <div className="rc-dock">
          <TimerPills timers={timers} />
        </div>
      )}

      {linking && (
        <div className="rc-sheet-backdrop" onClick={() => setLinking(false)}>
          <div className="rc-sheet" role="dialog" aria-modal="true" aria-label="Choose a recipe to use" onClick={(e) => e.stopPropagation()}>
            <div className="rc-sheet-head">
              <h2>Use a recipe as a part</h2>
              <button type="button" className="rc-icon-btn" onClick={() => setLinking(false)} aria-label="Close">
                ×
              </button>
            </div>
            <input type="search" className="rc-input" placeholder="Search your recipes" aria-label="Search your recipes" value={linkQuery} onChange={(e) => setLinkQuery(e.target.value)} />
            <ul className="rc-picker">
              {linkable.map((recipe) => (
                <li key={recipe.id}>
                  <button type="button" onClick={() => addLink(recipe)}>
                    <span className="rc-row-title">{recipe.title}</span>
                    <span className="rc-meta">
                      {CATEGORY_LABELS[recipe.category]?.label} · serves {recipe.servings}
                    </span>
                  </button>
                </li>
              ))}
              {linkable.length === 0 && <li className="rc-empty">No recipes to use here.</li>}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

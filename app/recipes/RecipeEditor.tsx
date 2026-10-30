'use client';

import { useMemo, useRef, useState } from 'react';
import { mediaSrc } from '@/lib/media-url';
import {
  CATEGORY_LABELS,
  RECIPE_CATEGORIES,
  buildSchedule,
  extractIngredients,
  formatBomAmount,
  parseStepKey,
  smartAnnotateText,
  type Recipe,
  type RecipeCategory,
  type RecipeSection,
} from '@/lib/recipes/recipes';
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

export function emptyDraft(): EditorDraft {
  return {
    title: '',
    summary: '',
    category: 'dinner',
    servings: 4,
    prepMinutes: '',
    cookMinutes: '',
    equipmentText: '',
    tagsText: '',
    photo: '',
    calories: '',
    protein: '',
    carbs: '',
    fat: '',
    rating: '',
    notes: '',
    sections: [{ name: 'Main', steps: [''] }],
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
    equipmentText: r.equipment.join(', '),
    tagsText: r.tags.join(', '),
    photo: r.photo || '',
    calories: r.macros?.calories !== undefined ? String(r.macros.calories) : '',
    protein: r.macros?.protein !== undefined ? String(r.macros.protein) : '',
    carbs: r.macros?.carbs !== undefined ? String(r.macros.carbs) : '',
    fat: r.macros?.fat !== undefined ? String(r.macros.fat) : '',
    rating: r.rating !== undefined ? String(r.rating) : '',
    notes: r.notes || '',
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

const TOKENS = [
  { label: 'Ingredient', token: '[1 cup flour]' },
  { label: 'Timer', token: '[5 min]' },
  { label: 'Wait', token: '[15 min passive]' },
  { label: 'Temp', token: '[400°F]' },
];

export default function RecipeEditor({
  initial,
  timers,
  onCancel,
  onSaved,
  showAlert,
}: {
  initial: EditorDraft;
  timers: RecipeTimers;
  onCancel: () => void;
  onSaved: (recipe: Recipe, canDelete: boolean) => void;
  showAlert: (message: string) => Promise<void> | void;
}) {
  const [draft, setDraft] = useState<EditorDraft>(initial);
  const [saving, setSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState('');

  // The last focused step and caret, so the token buttons insert at the cursor.
  const focusedStepRef = useRef<{ sIdx: number; stIdx: number; caret: number } | null>(null);

  const previewBom = useMemo(() => extractIngredients({ sections: draft.sections }), [draft.sections]);
  const previewSchedule = useMemo(
    () =>
      buildSchedule({
        sections: draft.sections,
        prepMinutes: Number(draft.prepMinutes) || undefined,
        cookMinutes: Number(draft.cookMinutes) || undefined,
      }),
    [draft.sections, draft.prepMinutes, draft.cookMinutes],
  );

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
            equipment: toList(draft.equipmentText),
            tags: toList(draft.tagsText),
            photo: draft.photo || undefined,
            macros: {
              calories: draft.calories ? Number(draft.calories) : undefined,
              protein: draft.protein !== '' ? Number(draft.protein) : undefined,
              carbs: draft.carbs !== '' ? Number(draft.carbs) : undefined,
              fat: draft.fat !== '' ? Number(draft.fat) : undefined,
            },
            rating: draft.rating ? Number(draft.rating) : null, // null clears it
            notes: draft.notes,
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
    const lastSec = draft.sections.length - 1;
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
    const sections = [...draft.sections];
    sections[0] = { ...sections[0], steps: [...sections[0].steps.filter(Boolean), ...lines] };
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
        <span className="rc-editor-title">{draft.id ? 'Edit recipe' : 'New recipe'}</span>
        <button type="button" className="btn btn-primary rc-btn-small" disabled={saving} onClick={handleSave}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      <div className="rc-form">
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
          Photo
          <div className="rc-photo-row">
            {draft.photo && <img src={mediaSrc(draft.photo, 400)} alt="" className="rc-row-photo" />}
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
            {draft.photo && (
              <button type="button" className="rc-text-btn" onClick={() => update('photo', '')}>
                Remove
              </button>
            )}
          </div>
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

          {draft.sections.map((sec, sIdx) => (
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

              <button type="button" className="rc-text-btn" onClick={() => setSection(sIdx, { ...sec, steps: [...sec.steps, ''] })}>
                + Add step
              </button>
            </div>
          ))}

          <button
            type="button"
            className="rc-text-btn"
            onClick={() => update('sections', [...draft.sections, { name: '', steps: [''] }])}
          >
            + Add a part that cooks at the same time
          </button>

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
              Equipment (comma-separated)
              <input className="rc-input" value={draft.equipmentText} onChange={(e) => update('equipmentText', e.target.value)} placeholder="Cast iron, Saucepan" />
            </label>
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
    </div>
  );
}

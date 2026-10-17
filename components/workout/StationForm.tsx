'use client';

import { useState } from 'react';
import { STATION_TYPE_OPTIONS, type Lift, type Station, type StationType } from '@/lib/workout/types';
import { finalizeStation, listFieldsFromStation, newRecordId, upsertLift } from '@/lib/workout/stations';
import { presetLifts, suggestedLiftNames, type EquipmentPreset } from '@/lib/workout/catalog';
import { exerciseKeyFromName, libraryExercisesFor, liftFromNameOrLibrary, type Exercise } from '@/lib/workout/exercises';
import { STATION_TYPE_META } from '@/lib/workout/station-summary';
import Sheet from './Sheet';
import LiftForm, { describeLift } from './LiftForm';
import { StationWeightFields } from './WeightFields';
import { PhotoPicker } from './StationPhoto';

const COMMON_ATTACHMENTS = ['Rope', 'Straight Bar', 'V-Bar', 'D-Handle', 'Wide Bar', 'Ankle Strap'];

/** Sensible starting weights when switching a station to a type it had no settings for. */
const TYPE_DEFAULTS: Record<StationType, Partial<Station>> = {
  plates: { baseWeight: 45, plateSets: [45, 45, 35, 25, 10, 5, 2.5] },
  stack: { minWeight: 10, maxWeight: 200, increment: 10 },
  cable: { minWeight: 5, maxWeight: 150, increment: 5 },
  dumbbells: { dumbbellPairs: [5, 10, 15, 20, 25, 30, 35, 40, 45, 50] },
  bodyweight: { bodyWeightAdditions: [] },
};

type StationFormProps = {
  /** Existing station to edit, or a partial template for a new one. */
  initial?: Partial<Station>;
  /** Equipment preset the new station starts from (pre-fills weights and lifts). */
  preset?: EquipmentPreset;
  /** One of your stations from another gym to start from (lifts keep their details). */
  copyFrom?: Station;
  saving?: boolean;
  onSave: (station: Station) => void | Promise<void>;
  onCancel: () => void;
  /** Shown as a delete button when editing an existing station. */
  onDelete?: () => void;
  /** Your exercises from all your gyms: offered first, and their details reused. */
  exercises?: Exercise[];
};

/** Create/edit sheet for a piece of equipment, shared by the config page and the workout screens. */
export default function StationForm({ initial, preset, copyFrom, saving = false, onSave, onCancel, onDelete, exercises = [] }: StationFormProps) {
  const [draft, setDraft] = useState<Partial<Station>>(() => {
    const copied: Partial<Station> = copyFrom ? { ...copyFrom, id: undefined, lifts: [] } : {};
    const fromPreset: Partial<Station> = preset ? { ...preset.station, name: preset.name } : {};
    const start = { type: 'plates' as StationType, lifts: [], attachments: [], ...fromPreset, ...copied, ...initial };
    // A brand-new blank station gets the defaults for its type so it's usable straight away.
    return initial?.id || preset || copyFrom ? start : { ...TYPE_DEFAULTS[start.type], ...start };
  });
  const [attachmentInput, setAttachmentInput] = useState('');
  const isEditing = !!initial?.id;
  // New stations can bring their lifts along: preset / copied lifts start selected.
  const [pickedLifts, setPickedLifts] = useState<Set<string>>(() => new Set((copyFrom?.lifts || preset?.lifts || []).map((l) => l.name)));
  const [typedLifts, setTypedLifts] = useState('');
  // A lift on this station open in the stacked lift sheet ('new' = a blank one).
  const [editingLift, setEditingLift] = useState<string | null>(null);
  const currentLifts = draft.lifts || [];
  const catalogSuggestions = isEditing ? suggestedLiftNames({ name: draft.name || '', type: draft.type || 'plates', lifts: currentLifts })
    : copyFrom ? [...new Set([...(copyFrom.lifts || []).map((l) => l.name), ...suggestedLiftNames({ name: copyFrom.name, type: copyFrom.type, lifts: copyFrom.lifts })])]
    : preset ? preset.lifts.map((l) => l.name) : suggestedLiftNames({ name: draft.name || '', type: draft.type || 'plates' });
  // Exercises you already do on this kind of equipment come first.
  const yours = libraryExercisesFor({ type: draft.type || 'plates', lifts: currentLifts }, exercises).map((e) => e.name);
  const liftSuggestions = [...yours, ...catalogSuggestions]
    .filter((n, i, all) => all.findIndex((m) => exerciseKeyFromName(m) === exerciseKeyFromName(n)) === i);

  const update = (patch: Partial<Station>) => setDraft((prev) => ({ ...prev, ...patch }));
  const changeType = (type: StationType) => setDraft((prev) => {
    // Keep weights already set for that type; otherwise start from its defaults.
    const defaults = Object.fromEntries(Object.entries(TYPE_DEFAULTS[type]).filter(([key]) => prev[key as keyof Station] === undefined));
    return { ...prev, ...defaults, type };
  });

  const attachments = draft.attachments || [];
  const addAttachment = (value: string) => {
    const name = value.trim();
    if (name && !attachments.some((a) => a.toLowerCase() === name.toLowerCase())) update({ attachments: [...attachments, name] });
    setAttachmentInput('');
  };

  /** Lifts picked or typed in this sheet that the station doesn't have yet. */
  const newLifts = () => {
    const fromSource = isEditing ? []
      : copyFrom ? (copyFrom.lifts || []).filter((l) => pickedLifts.has(l.name)).map((l) => ({ ...l, id: newRecordId() }))
      : preset ? presetLifts(preset, [...pickedLifts]) : [];
    const taken = new Set([...currentLifts, ...fromSource].map((l) => l.name.toLowerCase()));
    // A cable station with a single handle: new lifts use it.
    const attachment = draft.type === 'cable' && attachments.length === 1 ? attachments[0] : undefined;
    const others = [...[...pickedLifts].filter((n) => liftSuggestions.includes(n)), ...typedLifts.split(',')]
      .map((n) => n.trim())
      .filter((n, i, all) => n && !taken.has(n.toLowerCase()) && all.findIndex((m) => m.toLowerCase() === n.toLowerCase()) === i)
      .map((n) => liftFromNameOrLibrary(n, exercises, attachment ? { attachment } : {}));
    return [...fromSource, ...others];
  };

  const saveLift = (lift: Lift) => {
    update({ lifts: upsertLift({ ...draft, lifts: currentLifts } as Station, lift).lifts });
    setEditingLift(null);
  };
  const removeLift = (id: string) => {
    update({ lifts: currentLifts.filter((l) => l.id !== id) });
    setEditingLift(null);
  };

  const handleSave = () => {
    if (!draft.name?.trim()) return;
    // Renaming (or renaming a copy) keeps it the same machine as before.
    const source = isEditing ? initial : copyFrom;
    const kind = draft.kind || source?.name;
    onSave(finalizeStation({ ...draft, kind, lifts: [...(draft.lifts || []), ...newLifts()] }, listFieldsFromStation(draft)));
  };

  const togglePicked = (name: string) => setPickedLifts((prev) => {
    const next = new Set(prev);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });

  const liftCount = newLifts().length;
  const liftsLabel = `${liftCount} lift${liftCount === 1 ? '' : 's'}`;
  const saveLabel = saving ? 'Saving…'
    : isEditing ? (liftCount ? `Save and add ${liftsLabel}` : 'Save changes')
    : liftCount ? `Add with ${liftsLabel}` : 'Add equipment';
  const removedCount = (initial?.lifts || []).filter((l) => !currentLifts.some((c) => c.id === l.id)).length;
  const liftBeingEdited = editingLift && editingLift !== 'new' ? currentLifts.find((l) => l.id === editingLift) : undefined;

  return (
    <Sheet
      title={isEditing ? `Edit ${initial?.name || 'equipment'}` : 'New equipment'}
      subtitle={copyFrom ? 'Copied from your other gym — check the weights here' : preset ? 'Starting weights filled in — change anything that differs' : undefined}
      onClose={onCancel}
      footer={<button className="workout-button is-primary" disabled={!draft.name?.trim() || saving} onClick={handleSave}>{saveLabel}</button>}
    >
      <label className="workout-field" style={{ display: 'block' }}>
        <span className="workout-label">Name</span>
        <input className="workout-input" placeholder="e.g. Squat Rack" value={draft.name || ''} autoFocus={!isEditing && !preset && !copyFrom} onChange={(e) => update({ name: e.target.value })} />
      </label>

      <div className="workout-field">
        <span className="workout-label">Kind of equipment</span>
        <div className="workout-choice-grid" role="radiogroup" aria-label="Kind of equipment">
          {STATION_TYPE_OPTIONS.map(({ value, label }) => (
            <button key={value} type="button" role="radio" aria-checked={draft.type === value} title={label} className="workout-choice" onClick={() => changeType(value)}>
              <span aria-hidden>{STATION_TYPE_META[value].icon}</span>
              {STATION_TYPE_META[value].label}
              <small>{STATION_TYPE_META[value].hint}</small>
            </button>
          ))}
        </div>
      </div>

      <PhotoPicker photo={draft.photo} onChange={(photo) => update({ photo })} />

      <div className="workout-section-title">Weights</div>
      {/* Keyed by type so the number boxes start fresh after switching. */}
      <StationWeightFields key={draft.type} station={draft} onChange={update} />

      {draft.type === 'cable' && (<>
        <div className="workout-section-title">Handles & attachments</div>
        <div className="workout-chip-list">
          {attachments.map((att) => (
            <span key={att} className="workout-chip-x">
              {att}
              <button type="button" aria-label={`Remove ${att}`} onClick={() => update({ attachments: attachments.filter((a) => a !== att) })}>✕</button>
            </span>
          ))}
          {COMMON_ATTACHMENTS.filter((a) => !attachments.includes(a)).map((a) => (
            <button key={a} type="button" className="workout-toggle-chip" onClick={() => addAttachment(a)}>+ {a}</button>
          ))}
        </div>
        <div className="workout-inline-add">
          <input className="workout-input" placeholder="Other attachment" value={attachmentInput}
            onChange={(e) => setAttachmentInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addAttachment(attachmentInput); } }} />
          <button type="button" className="workout-button" disabled={!attachmentInput.trim()} onClick={() => addAttachment(attachmentInput)}>Add</button>
        </div>
      </>)}

      <div className="workout-section-title">
        Lifts on it
        <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>
          {isEditing ? `${currentLifts.length} · tap one to edit` : pickedLifts.size ? `${pickedLifts.size} picked` : 'tap to pick'}
        </span>
      </div>
      {currentLifts.length > 0 && (
        <div className="workout-stack" style={{ marginBottom: '0.75rem' }}>
          {currentLifts.map((l) => (
            <div key={l.id} style={{ display: 'flex', gap: '0.4rem' }}>
              <button type="button" className="workout-lift-row" onClick={() => setEditingLift(l.id)}>
                <span className="workout-card-text">
                  <span className="workout-card-title">{l.name}</span>
                  <span className="workout-card-meta">{describeLift(l)}{l.notes ? ` · ${l.notes}` : ''}</span>
                </span>
                <span className="workout-chevron" aria-hidden>›</span>
              </button>
              <button type="button" className="workout-icon-btn" style={{ alignSelf: 'center' }} aria-label={`Remove ${l.name}`} onClick={() => removeLift(l.id)}>✕</button>
            </div>
          ))}
        </div>
      )}
      {removedCount > 0 && (
        <p className="workout-hint" style={{ margin: '-0.35rem 0 0.75rem' }}>
          {removedCount} lift{removedCount === 1 ? '' : 's'} will be removed when you save. Past workouts keep their history.
        </p>
      )}
      <>
        {liftSuggestions.length > 0 && (
          <div className="workout-chip-list" style={{ marginBottom: '0.6rem' }}>
            {liftSuggestions.map((name) => (
              <button key={name} type="button" className="workout-toggle-chip" aria-pressed={pickedLifts.has(name)} onClick={() => togglePicked(name)}
                title={yours.includes(name) ? 'One of your exercises: shares its history' : undefined}>
                {pickedLifts.has(name) ? '✓ ' : yours.includes(name) ? '↻ ' : '+ '}{name}
              </button>
            ))}
          </div>
        )}
        <input className="workout-input" style={{ marginBottom: '0.35rem' }} placeholder={isEditing ? 'Add lifts, separated by commas' : 'Other lifts, separated by commas'} value={typedLifts} onChange={(e) => setTypedLifts(e.target.value)} />
        <div className="workout-hint">
          Muscles are filled in from each lift&apos;s name.{' '}
          <button type="button" className="workout-text-btn" style={{ fontSize: 'inherit', textDecoration: 'underline' }} onClick={() => setEditingLift('new')}>Set every detail by hand</button>
        </div>
      </>

      {isEditing && onDelete && (
        <button type="button" className="workout-button is-danger is-block" style={{ marginTop: '1.5rem' }} onClick={onDelete}>
          Delete this equipment{initial?.lifts?.length ? ` and its ${initial.lifts.length} lift${initial.lifts.length === 1 ? '' : 's'}` : ''}
        </button>
      )}

      {/* Lift details are edited in a sheet on top; nothing is saved until this sheet is. */}
      {editingLift && (
        <LiftForm
          station={{ ...draft, name: draft.name || 'this equipment', lifts: currentLifts } as Station}
          initial={liftBeingEdited}
          onSave={saveLift}
          onCancel={() => setEditingLift(null)}
          onDelete={liftBeingEdited ? () => removeLift(liftBeingEdited.id) : undefined}
          exercises={exercises}
        />
      )}
    </Sheet>
  );
}

'use client';

import { useState } from 'react';
import { STATION_TYPE_OPTIONS, type Station, type StationType } from '@/lib/workout/types';
import { finalizeStation, listFieldsFromStation, newRecordId } from '@/lib/workout/stations';
import { liftFromName, presetLifts, suggestedLiftNames, type EquipmentPreset } from '@/lib/workout/catalog';
import { STATION_TYPE_META } from '@/lib/workout/station-summary';
import Sheet from './Sheet';
import { StationWeightFields } from './WeightFields';

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
};

/** Create/edit sheet for a piece of equipment, shared by the config page and the workout screens. */
export default function StationForm({ initial, preset, copyFrom, saving = false, onSave, onCancel, onDelete }: StationFormProps) {
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
  const liftSuggestions = isEditing ? []
    : copyFrom ? [...new Set([...(copyFrom.lifts || []).map((l) => l.name), ...suggestedLiftNames({ name: copyFrom.name, type: copyFrom.type, lifts: copyFrom.lifts })])]
    : preset ? preset.lifts.map((l) => l.name) : suggestedLiftNames({ name: draft.name || '', type: draft.type || 'plates' });

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

  const newLifts = () => {
    if (isEditing) return [];
    const fromSource = copyFrom
      ? (copyFrom.lifts || []).filter((l) => pickedLifts.has(l.name)).map((l) => ({ ...l, id: newRecordId() }))
      : preset ? presetLifts(preset, [...pickedLifts]) : [];
    const sourceNames = new Set(fromSource.map((l) => l.name.toLowerCase()));
    const others = [...[...pickedLifts].filter((n) => liftSuggestions.includes(n)), ...typedLifts.split(',')]
      .map((n) => n.trim())
      .filter((n, i, all) => n && !sourceNames.has(n.toLowerCase()) && all.findIndex((m) => m.toLowerCase() === n.toLowerCase()) === i)
      .map((n) => liftFromName(n));
    return [...fromSource, ...others];
  };

  const handleSave = () => {
    if (!draft.name?.trim()) return;
    onSave(finalizeStation({ ...draft, lifts: [...(draft.lifts || []), ...newLifts()] }, listFieldsFromStation(draft)));
  };

  const togglePicked = (name: string) => setPickedLifts((prev) => {
    const next = new Set(prev);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });

  const liftCount = newLifts().length;
  const saveLabel = saving ? 'Saving…' : isEditing ? 'Save changes' : liftCount ? `Add with ${liftCount} lift${liftCount === 1 ? '' : 's'}` : 'Add equipment';

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

      {!isEditing && (<>
        <div className="workout-section-title">
          Lifts on it <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>{pickedLifts.size ? `${pickedLifts.size} picked` : 'tap to pick'}</span>
        </div>
        {liftSuggestions.length > 0 && (
          <div className="workout-chip-list" style={{ marginBottom: '0.6rem' }}>
            {liftSuggestions.map((name) => (
              <button key={name} type="button" className="workout-toggle-chip" aria-pressed={pickedLifts.has(name)} onClick={() => togglePicked(name)}>
                {pickedLifts.has(name) ? '✓ ' : '+ '}{name}
              </button>
            ))}
          </div>
        )}
        <input className="workout-input" style={{ marginBottom: '0.35rem' }} placeholder="Other lifts, separated by commas" value={typedLifts} onChange={(e) => setTypedLifts(e.target.value)} />
        <div className="workout-hint">Muscles are filled in from each lift&apos;s name. You can fine-tune any lift afterwards.</div>
      </>)}

      {isEditing && onDelete && (
        <button type="button" className="workout-button is-danger is-block" style={{ marginTop: '1.5rem' }} onClick={onDelete}>
          Delete this equipment{initial?.lifts?.length ? ` and its ${initial.lifts.length} lift${initial.lifts.length === 1 ? '' : 's'}` : ''}
        </button>
      )}
    </Sheet>
  );
}

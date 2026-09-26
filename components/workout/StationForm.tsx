'use client';

import { useState } from 'react';
import { STATION_TYPE_OPTIONS, isLoadStation, type Station, type StationType } from '@/lib/workout/types';
import { finalizeStation, listFieldsFromStation, type StationListFields } from '@/lib/workout/stations';
import { liftFromName, presetLifts, suggestedLiftNames, type EquipmentPreset } from '@/lib/workout/catalog';

const parseOptionalNumber = (value: string) => {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

type StationFormProps = {
  /** Existing station to edit, or a partial template for a new one. */
  initial?: Partial<Station>;
  /** Equipment preset the new station starts from (pre-fills weights and lifts). */
  preset?: EquipmentPreset;
  saving?: boolean;
  onSave: (station: Station) => void | Promise<void>;
  onCancel: () => void;
};

/** Create/edit form for a gym station, shared by the config page and the in-workout editor. */
export default function StationForm({ initial, preset, saving = false, onSave, onCancel }: StationFormProps) {
  const start: Partial<Station> = { type: 'plates', lifts: [], attachments: [], ...(preset ? { ...preset.station, name: preset.name } : {}), ...initial };
  const [draft, setDraft] = useState<Partial<Station>>(() => start);
  const [lists, setLists] = useState<StationListFields>(() => listFieldsFromStation(start));
  const [attachmentInput, setAttachmentInput] = useState('');
  const isEditing = !!initial?.id;
  // New stations can bring their lifts along: preset lifts start selected.
  const [pickedLifts, setPickedLifts] = useState<Set<string>>(() => new Set(preset?.lifts.map((l) => l.name) || []));
  const [typedLifts, setTypedLifts] = useState('');
  const liftSuggestions = isEditing ? [] : preset ? preset.lifts.map((l) => l.name) : suggestedLiftNames({ name: draft.name || '', type: draft.type || 'plates' });

  const update = (patch: Partial<Station>) => setDraft((prev) => ({ ...prev, ...patch }));
  const updateList = (key: keyof StationListFields) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setLists((prev) => ({ ...prev, [key]: e.target.value }));

  const addAttachment = () => {
    const value = attachmentInput.trim();
    if (value && !(draft.attachments || []).includes(value)) {
      update({ attachments: [...(draft.attachments || []), value] });
    }
    setAttachmentInput('');
  };

  const newLifts = () => {
    if (isEditing) return [];
    const fromPreset = preset ? presetLifts(preset, [...pickedLifts]) : [];
    const presetNames = new Set(fromPreset.map((l) => l.name.toLowerCase()));
    const others = [...[...pickedLifts].filter((n) => liftSuggestions.includes(n)), ...typedLifts.split(',')]
      .map((n) => n.trim())
      .filter((n, i, all) => n && !presetNames.has(n.toLowerCase()) && all.findIndex((m) => m.toLowerCase() === n.toLowerCase()) === i)
      .map((n) => liftFromName(n));
    return [...fromPreset, ...others];
  };

  const handleSave = () => {
    if (!draft.name?.trim()) return;
    onSave(finalizeStation({ ...draft, lifts: [...(draft.lifts || []), ...newLifts()] }, lists));
  };

  const togglePicked = (name: string) => setPickedLifts((prev) => {
    const next = new Set(prev);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });

  return (
    <div className="workout-form-panel animate-fade-in">
      <h4 style={{ margin: '0 0 1rem 0' }}>{isEditing ? 'Edit Station' : 'New Station'}</h4>

      <label className="workout-label">Station Name</label>
      <input className="workout-input" placeholder="e.g. Squat Rack" value={draft.name || ''} onChange={(e) => update({ name: e.target.value })} />

      <label className="workout-label">Station Type</label>
      <select className="workout-input" value={draft.type} onChange={(e) => update({ type: e.target.value as StationType })}>
        {STATION_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>

      {draft.type === 'plates' && (
        <>
          <label className="workout-label">Bar Weight (lbs)</label>
          <input className="workout-input" type="number" placeholder="45" value={draft.baseWeight ?? ''} onChange={(e) => update({ baseWeight: parseOptionalNumber(e.target.value) })} />
          <label className="workout-label">Plates available per side (comma separated)</label>
          <input className="workout-input" placeholder="e.g. 45, 45, 25, 10, 5, 2.5" value={lists.plates} onChange={updateList('plates')} />
        </>
      )}

      {isLoadStation(draft.type) && (
        <>
          <div className="workout-grid-2">
            <div>
              <label className="workout-label">Min Weight (lbs)</label>
              <input className="workout-input" type="number" placeholder="10" value={draft.minWeight ?? ''} onChange={(e) => update({ minWeight: parseOptionalNumber(e.target.value) })} />
            </div>
            <div>
              <label className="workout-label">Max Weight (lbs)</label>
              <input className="workout-input" type="number" placeholder="200" value={draft.maxWeight ?? ''} onChange={(e) => update({ maxWeight: parseOptionalNumber(e.target.value) })} />
            </div>
          </div>
          <div className="workout-grid-2">
            <div>
              <label className="workout-label">Increment (lbs)</label>
              <input className="workout-input" type="number" placeholder="10" value={draft.increment ?? ''} onChange={(e) => update({ increment: parseOptionalNumber(e.target.value) })} />
            </div>
            <div>
              <label className="workout-label">Add-on Weights (lbs)</label>
              <input className="workout-input" placeholder="e.g. 2.5, 5" value={lists.additionalWeights} onChange={updateList('additionalWeights')} />
            </div>
          </div>
        </>
      )}

      {draft.type === 'cable' && (
        <div style={{ marginBottom: '1rem' }}>
          <label className="workout-label">Attachments</label>
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <input
              className="workout-input"
              style={{ marginBottom: 0, flex: 1 }}
              placeholder="e.g. Rope, V-Bar"
              value={attachmentInput}
              onChange={(e) => setAttachmentInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addAttachment(); } }}
            />
            <button className="btn btn-secondary" style={{ padding: '0.5rem 1rem', whiteSpace: 'nowrap' }} onClick={addAttachment}>+ Add</button>
          </div>
          {(draft.attachments || []).length > 0 && (
            <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
              {(draft.attachments || []).map((att) => (
                <span key={att} className="workout-chip">
                  {att}
                  <button
                    className="workout-text-btn danger"
                    aria-label={`Remove ${att}`}
                    onClick={() => update({ attachments: (draft.attachments || []).filter((a) => a !== att) })}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {draft.type === 'dumbbells' && (
        <>
          <label className="workout-label">Dumbbell Pairs (lbs, comma separated)</label>
          <input className="workout-input" placeholder="e.g. 5, 10, 15, 20, 25" value={lists.dumbbells} onChange={updateList('dumbbells')} />
        </>
      )}

      {draft.type === 'bodyweight' && (
        <>
          <label className="workout-label">Added Weight Options (lbs, comma separated)</label>
          <input className="workout-input" placeholder="e.g. 10, 25, 45" value={lists.bodyWeight} onChange={updateList('bodyWeight')} />
        </>
      )}

      {!isEditing && (
        <div style={{ marginTop: '0.5rem' }}>
          <label className="workout-label">Lifts on this station</label>
          {liftSuggestions.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginBottom: '0.5rem' }}>
              {liftSuggestions.map((name) => (
                <button key={name} type="button" className="workout-toggle-chip" aria-pressed={pickedLifts.has(name)} onClick={() => togglePicked(name)}>
                  {pickedLifts.has(name) ? '✓ ' : '+ '}{name}
                </button>
              ))}
            </div>
          )}
          <input className="workout-input" placeholder="Other lifts, separated by commas (optional)" value={typedLifts} onChange={(e) => setTypedLifts(e.target.value)} />
          <div className="workout-hint">Muscles are filled in from the lift name — you can fine-tune each lift afterwards.</div>
        </div>
      )}

      <div className="workout-btn-row" style={{ marginTop: '1rem' }}>
        <button className="workout-btn-primary" disabled={!draft.name?.trim() || saving} onClick={handleSave}>
          {saving ? 'Saving…' : isEditing ? 'Save Station' : (() => { const n = newLifts().length; return n ? `Add Station + ${n} Lift${n === 1 ? '' : 's'}` : 'Add Station'; })()}
        </button>
        <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

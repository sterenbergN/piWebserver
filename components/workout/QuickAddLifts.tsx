'use client';

import { useMemo, useState } from 'react';
import type { Lift, Station } from '@/lib/workout/types';
import { liftFromName, suggestedLiftNames } from '@/lib/workout/catalog';
import Sheet from './Sheet';

type QuickAddLiftsProps = {
  station: Station;
  saving?: boolean;
  onSave: (lifts: Lift[]) => void | Promise<void>;
  onCancel: () => void;
  /** Open the full lift form instead (for setting every detail by hand). */
  onCustom?: () => void;
};

const splitNames = (text: string) => text.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);

/**
 * Add several lifts to a station at once: tap suggestions and/or type names
 * separated by commas. Muscles are filled in from the lift name.
 */
export default function QuickAddLifts({ station, saving = false, onSave, onCancel, onCustom }: QuickAddLiftsProps) {
  const suggestions = useMemo(() => suggestedLiftNames(station), [station]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [typed, setTyped] = useState('');

  const existing = new Set(station.lifts.map((l) => l.name.toLowerCase()));
  const names = Array.from(new Set([...picked, ...splitNames(typed)].map((n) => n.trim())))
    .filter((n, i, all) => !existing.has(n.toLowerCase()) && all.findIndex((m) => m.toLowerCase() === n.toLowerCase()) === i);
  const attachment = station.type === 'cable' && station.attachments?.length === 1 ? station.attachments[0] : undefined;
  const preview = names.map((n) => liftFromName(n, attachment ? { attachment } : {}));

  const toggle = (name: string) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });

  return (
    <Sheet
      title="Add lifts"
      subtitle={`On ${station.name}`}
      onClose={onCancel}
      footer={
        <button className="workout-button is-primary" disabled={preview.length === 0 || saving} onClick={() => onSave(preview)}>
          {saving ? 'Saving…' : preview.length > 1 ? `Add ${preview.length} lifts` : preview.length ? 'Add 1 lift' : 'Pick or type a lift'}
        </button>
      }
    >
      {suggestions.length > 0 && (<>
        <div className="workout-section-title">Common lifts here</div>
        <div className="workout-chip-list" style={{ marginBottom: '1rem' }}>
          {suggestions.map((name) => (
            <button key={name} type="button" className="workout-toggle-chip" aria-pressed={picked.has(name)} onClick={() => toggle(name)}>
              {picked.has(name) ? '✓ ' : '+ '}{name}
            </button>
          ))}
        </div>
      </>)}

      <label className="workout-field" style={{ display: 'block' }}>
        <span className="workout-label">Or type them, separated by commas</span>
        <input
          className="workout-input"
          placeholder="e.g. Incline Press, Pause Squat"
          value={typed}
          autoFocus={suggestions.length === 0}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && preview.length) { e.preventDefault(); onSave(preview); } }}
        />
      </label>

      {preview.length > 0 && (<>
        <div className="workout-section-title">Will add</div>
        <div className="workout-stack">
          {preview.map((l) => (
            <div key={l.name} className="workout-lift-row" style={{ cursor: 'default' }}>
              <span className="workout-card-text">
                <span className="workout-card-title">{l.name}</span>
                <span className="workout-card-meta">
                  {l.primaryMuscle}{l.secondaryMuscle !== 'None' ? ` · ${l.secondaryMuscle}` : ''}{l.singleArmLeg ? ' · single limb' : ''}
                </span>
              </span>
            </div>
          ))}
        </div>
      </>)}

      {onCustom && (
        <button type="button" className="workout-button is-block" style={{ marginTop: '1.25rem' }} onClick={onCustom}>
          Set every detail by hand instead
        </button>
      )}
    </Sheet>
  );
}

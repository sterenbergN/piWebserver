'use client';

import { useMemo, useState } from 'react';
import type { Lift, Station } from '@/lib/workout/types';
import { liftFromName, suggestedLiftNames } from '@/lib/workout/catalog';

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
    <div className="workout-form-panel animate-fade-in" style={{ marginTop: '0.5rem' }}>
      <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.95rem' }}>Add lifts to {station.name}</h4>
      {suggestions.length > 0 && (
        <>
          <div className="workout-hint" style={{ marginBottom: '0.4rem' }}>Tap to add:</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginBottom: '0.75rem' }}>
            {suggestions.map((name) => (
              <button key={name} type="button" className="workout-toggle-chip" aria-pressed={picked.has(name)} onClick={() => toggle(name)}>
                {picked.has(name) ? '✓ ' : '+ '}{name}
              </button>
            ))}
          </div>
        </>
      )}
      <input
        className="workout-input"
        placeholder="Or type lift names, separated by commas"
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && preview.length) { e.preventDefault(); onSave(preview); } }}
      />
      {preview.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 0.75rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          {preview.map((l) => (
            <li key={l.name} className="workout-hint" style={{ fontSize: '0.8rem' }}>
              <strong style={{ color: 'var(--foreground)' }}>{l.name}</strong> — {l.primaryMuscle}
              {l.secondaryMuscle !== 'None' ? ` / ${l.secondaryMuscle}` : ''}{l.singleArmLeg ? ' · single limb' : ''}
            </li>
          ))}
        </ul>
      )}
      <div className="workout-btn-row">
        <button className="workout-btn-primary" disabled={preview.length === 0 || saving} onClick={() => onSave(preview)}>
          {saving ? 'Saving…' : preview.length > 1 ? `Add ${preview.length} Lifts` : 'Add Lift'}
        </button>
        <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
      </div>
      {onCustom && (
        <button className="workout-text-btn" style={{ marginTop: '0.5rem' }} onClick={onCustom}>
          Set every detail by hand instead →
        </button>
      )}
    </div>
  );
}

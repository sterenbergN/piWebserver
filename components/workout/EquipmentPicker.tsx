'use client';

import { useMemo, useState } from 'react';
import { EQUIPMENT_PRESETS, type EquipmentPreset } from '@/lib/workout/catalog';
import type { Station } from '@/lib/workout/types';

type EquipmentPickerProps = {
  /** Names of stations the gym already has, so they can be marked. */
  existingNames?: string[];
  onPick: (preset: EquipmentPreset | null) => void;
  /** Stations from your other gyms to reuse (see equipmentLibrary). */
  library?: Station[];
  onPickStation?: (station: Station) => void;
  onCancel: () => void;
};

const CATEGORIES: EquipmentPreset['category'][] = ['Free weights', 'Machines', 'Cables', 'Bodyweight'];

/** Choose a common piece of equipment (pre-filled weights + lifts) or start a custom one. */
export default function EquipmentPicker({ existingNames = [], onPick, library = [], onPickStation, onCancel }: EquipmentPickerProps) {
  const [query, setQuery] = useState('');
  const have = useMemo(() => new Set(existingNames.map((n) => n.toLowerCase())), [existingNames]);
  const q = query.trim().toLowerCase();
  const matches = EQUIPMENT_PRESETS.filter(
    (p) => !q || p.name.toLowerCase().includes(q) || p.lifts.some((l) => l.name.toLowerCase().includes(q)),
  );
  const mine = onPickStation ? library.filter(
    (s) => !q || s.name.toLowerCase().includes(q) || (s.lifts || []).some((l) => l.name.toLowerCase().includes(q)),
  ) : [];

  return (
    <div className="workout-form-panel animate-fade-in">
      <div className="workout-flex-between" style={{ marginBottom: '0.75rem' }}>
        <h4 style={{ margin: 0 }}>Add Equipment</h4>
        <button className="workout-text-btn" onClick={onCancel}>Cancel</button>
      </div>
      <input
        className="workout-input"
        placeholder="Search equipment or a lift (e.g. leg press, curl)…"
        value={query}
        autoFocus
        onChange={(e) => setQuery(e.target.value)}
      />
      <button className="btn btn-secondary" style={{ width: '100%', marginBottom: '1rem' }} onClick={() => onPick(null)}>
        ✏️ Custom station{q ? ` “${query.trim()}”` : ''}
      </button>
      {mine.length > 0 && (
        <div>
          <div className="workout-label" style={{ marginTop: 0 }}>📦 Your equipment <span style={{ textTransform: 'none', fontWeight: 400 }}>(from your other gyms — you&apos;ll set this gym&apos;s weights next)</span></div>
          <div className="workout-preset-grid">
            {mine.map((s) => (
              <button key={s.id} className="workout-preset-card" onClick={() => onPickStation?.(s)}>
                <strong>{s.name}</strong>
                <span>{s.type} · {(s.lifts || []).length} lift{(s.lifts || []).length === 1 ? '' : 's'}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {CATEGORIES.map((category) => {
        const items = matches.filter((p) => p.category === category);
        if (items.length === 0) return null;
        return (
          <div key={category}>
            <div className="workout-label" style={{ marginTop: 0 }}>{category}</div>
            <div className="workout-preset-grid">
              {items.map((p) => (
                <button key={p.key} className="workout-preset-card" onClick={() => onPick(p)}>
                  <strong>{p.icon} {p.name}</strong>
                  <span>{have.has(p.name.toLowerCase()) ? '✓ Already added · ' : ''}{p.lifts.length} lift{p.lifts.length === 1 ? '' : 's'}</span>
                </button>
              ))}
            </div>
          </div>
        );
      })}
      {matches.length === 0 && mine.length === 0 && <p className="workout-hint">Nothing matches — use a custom station.</p>}
    </div>
  );
}

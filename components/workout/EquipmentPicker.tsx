'use client';

import { useMemo, useState } from 'react';
import { EQUIPMENT_PRESETS, type EquipmentPreset } from '@/lib/workout/catalog';
import type { Station } from '@/lib/workout/types';
import { STATION_TYPE_META } from '@/lib/workout/station-summary';
import Sheet from './Sheet';

/** One chosen piece of equipment: a built-in preset or a station from another gym. */
export type PickedEquipment = { preset: EquipmentPreset } | { station: Station };

type EquipmentPickerProps = {
  /** Names of stations the gym already has, so they can be marked. */
  existingNames?: string[];
  onPick: (preset: EquipmentPreset | null) => void;
  /** Stations from your other gyms to reuse (see equipmentLibrary). */
  library?: Station[];
  onPickStation?: (station: Station) => void;
  /**
   * Enables multi-select: tap several cards, then add them all at once with
   * their usual weights and lifts. Without it, a tap picks one straight away.
   */
  onAddMany?: (items: PickedEquipment[]) => void;
  saving?: boolean;
  onCancel: () => void;
};

const CATEGORIES: EquipmentPreset['category'][] = ['Free weights', 'Machines', 'Cables', 'Bodyweight'];

/** Choose common equipment (pre-filled weights + lifts), reuse your own, or start a custom one. */
export default function EquipmentPicker({ existingNames = [], onPick, library = [], onPickStation, onAddMany, saving = false, onCancel }: EquipmentPickerProps) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const have = useMemo(() => new Set(existingNames.map((n) => n.toLowerCase())), [existingNames]);
  const q = query.trim().toLowerCase();
  const matches = EQUIPMENT_PRESETS.filter(
    (p) => !q || p.name.toLowerCase().includes(q) || p.lifts.some((l) => l.name.toLowerCase().includes(q)),
  );
  const mine = onPickStation || onAddMany ? library.filter(
    (s) => !q || s.name.toLowerCase().includes(q) || (s.lifts || []).some((l) => l.name.toLowerCase().includes(q)),
  ) : [];

  const itemFor = (key: string): PickedEquipment | null => {
    if (key.startsWith('preset:')) { const preset = EQUIPMENT_PRESETS.find((p) => p.key === key.slice(7)); return preset ? { preset } : null; }
    const station = library.find((s) => s.id === key.slice(5));
    return station ? { station } : null;
  };
  const tap = (key: string) => {
    if (!onAddMany) {
      const item = itemFor(key);
      if (item && 'preset' in item) onPick(item.preset); else if (item) onPickStation?.(item.station);
      return;
    }
    setSelected((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  };
  const customize = () => {
    const item = itemFor(selected[0]);
    if (item && 'preset' in item) onPick(item.preset); else if (item) onPickStation?.(item.station);
  };
  const addAll = () => onAddMany?.(selected.map(itemFor).filter((i): i is PickedEquipment => !!i));

  const card = (key: string, title: string, meta: string) => (
    <button key={key} className="workout-preset-card" aria-pressed={onAddMany ? selected.includes(key) : undefined} onClick={() => tap(key)}>
      <strong>{onAddMany && selected.includes(key) ? '✓ ' : ''}{title}</strong>
      <span>{meta}</span>
    </button>
  );

  const footer = onAddMany && selected.length > 0 ? (
    <>
      {selected.length === 1 && <button className="workout-button" onClick={customize}>Adjust first</button>}
      <button className="workout-button is-primary" disabled={saving} onClick={addAll}>
        {saving ? 'Adding…' : `Add ${selected.length} item${selected.length === 1 ? '' : 's'}`}
      </button>
    </>
  ) : undefined;

  return (
    <Sheet
      title="Add equipment"
      subtitle={onAddMany ? 'Tap everything this gym has — each comes with typical weights and lifts' : 'Pick what you’re using'}
      onClose={onCancel}
      footer={footer}
    >
      <input
        className="workout-input"
        type="search"
        placeholder="Search equipment or a lift (e.g. leg press, curl)"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <button className="workout-button is-dashed is-block" style={{ marginBottom: '0.5rem' }} onClick={() => onPick(null)}>
        ✏️ Something else{q ? ` — “${query.trim()}”` : ''}
      </button>

      {mine.length > 0 && (<>
        <div className="workout-section-title">From your other gyms</div>
        <div className="workout-preset-grid">
          {mine.map((s) => card(`mine:${s.id}`, s.name, `${STATION_TYPE_META[s.type]?.label || s.type} · ${(s.lifts || []).length} lift${(s.lifts || []).length === 1 ? '' : 's'}`))}
        </div>
      </>)}

      {CATEGORIES.map((category) => {
        const items = matches.filter((p) => p.category === category);
        if (items.length === 0) return null;
        return (
          <div key={category}>
            <div className="workout-section-title">{category}</div>
            <div className="workout-preset-grid">
              {items.map((p) => card(`preset:${p.key}`, `${p.icon} ${p.name}`, `${have.has(p.name.toLowerCase()) ? 'Already added · ' : ''}${p.lifts.length} lift${p.lifts.length === 1 ? '' : 's'}`))}
            </div>
          </div>
        );
      })}
      {matches.length === 0 && mine.length === 0 && <p className="workout-hint">Nothing matches — tap “Something else” to set it up yourself.</p>}
    </Sheet>
  );
}

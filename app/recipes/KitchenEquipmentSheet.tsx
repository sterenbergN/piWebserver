'use client';

import { useMemo, useState } from 'react';
import { BASIC_KITCHEN_EQUIPMENT, COMMON_KITCHEN_EQUIPMENT } from '@/lib/recipes/kitchen';
import { canonicalEquipment } from '@/lib/recipes/recipes';
import type { Kitchen } from './useKitchen';

/** Reusable editor for choosing which cookware and appliances your kitchen has. */
export function KitchenEquipmentEditor({
  kitchen,
  onFlash,
}: {
  kitchen: Kitchen;
  onFlash?: (message: string) => void;
}) {
  const [custom, setCustom] = useState('');
  const selected = kitchen.state.equipment;

  const selectedCanon = useMemo(
    () => new Set(selected.map((e) => canonicalEquipment(e).toLowerCase())),
    [selected],
  );
  const commonCanon = useMemo(
    () => new Set(COMMON_KITCHEN_EQUIPMENT.map((e) => canonicalEquipment(e).toLowerCase())),
    [],
  );
  const customItems = useMemo(
    () => selected.filter((e) => !commonCanon.has(canonicalEquipment(e).toLowerCase())),
    [selected, commonCanon],
  );
  const allItems = useMemo(
    () => [...COMMON_KITCHEN_EQUIPMENT, ...customItems],
    [customItems],
  );

  const addBasics = () => {
    const merged = [...new Set([...selected, ...BASIC_KITCHEN_EQUIPMENT])];
    kitchen.setEquipment(merged);
    onFlash?.('Added basic kitchen equipment');
  };

  const selectCommonAll = () => {
    kitchen.setEquipment(COMMON_KITCHEN_EQUIPMENT);
    onFlash?.('Selected common kitchen equipment');
  };

  const clearAll = () => {
    kitchen.setEquipment([]);
    onFlash?.('Cleared kitchen equipment');
  };

  const addCustom = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = canonicalEquipment(custom);
    if (!clean) return;
    if (!selectedCanon.has(clean.toLowerCase())) {
      kitchen.toggleEquipment(clean);
      onFlash?.(`Added ${clean}`);
    } else {
      onFlash?.(`${clean} is already selected`);
    }
    setCustom('');
  };

  return (
    <div className="rc-equip-editor">
      <div className="rc-equip-presets" role="group" aria-label="Equipment presets">
        <span className="rc-meta">
          {selected.length} {selected.length === 1 ? 'tool' : 'tools'} selected
        </span>
        <button type="button" className="rc-chip" onClick={addBasics}>
          + Basics
        </button>
        <button type="button" className="rc-chip" onClick={selectCommonAll}>
          Select common all
        </button>
        <button type="button" className="rc-chip" onClick={clearAll} disabled={selected.length === 0}>
          Clear
        </button>
      </div>

      <div className="rc-equip-grid" role="group" aria-label="Kitchen equipment">
        {allItems.map((item) => {
          const active = selectedCanon.has(canonicalEquipment(item).toLowerCase());
          return (
            <button
              key={item}
              type="button"
              className={`rc-chip rc-equip-chip${active ? ' is-active' : ''}`}
              aria-pressed={active}
              onClick={() => kitchen.toggleEquipment(item)}
            >
              {active ? `✓ ${item}` : item}
            </button>
          );
        })}
      </div>

      <form className="rc-equip-form" onSubmit={addCustom}>
        <input
          type="text"
          className="rc-input"
          placeholder="Add custom gear (e.g. Sous vide, Pizza oven, Mandoline)"
          aria-label="Add custom kitchen equipment"
          autoComplete="off"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
        />
        <button type="submit" className="btn btn-secondary" disabled={!canonicalEquipment(custom)}>
          Add
        </button>
      </form>
    </div>
  );
}

/** Modal sheet for managing the household's kitchen equipment. */
export default function KitchenEquipmentSheet({
  kitchen,
  onClose,
  onFlash,
}: {
  kitchen: Kitchen;
  onClose: () => void;
  onFlash?: (message: string) => void;
}) {
  return (
    <div className="rc-sheet-backdrop" onClick={onClose}>
      <div
        className="rc-sheet rc-equip-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Your kitchen equipment"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="rc-sheet-head">
          <h2>Your kitchen equipment</h2>
          <button type="button" className="rc-icon-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <p className="rc-meta">
          Filters recipes by what you own and tells AI meal &amp; recipe suggestions which tools to use. Leave empty to show all recipes.
        </p>
        <KitchenEquipmentEditor kitchen={kitchen} onFlash={onFlash} />
        <div className="rc-sheet-actions" style={{ gridTemplateColumns: '1fr' }}>
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

'use client';

import { useState } from 'react';
import { parseAmountText, type UnitMode } from '@/lib/recipes/recipes';
import { stockLabel } from './shared';
import type { Kitchen } from './useKitchen';

const isGone = (amount: { usQty: number | null; metricQty: number | null }) => [amount.usQty, amount.metricQty].every((q) => q === null || q <= 0);

/** One thing on the shelf: how much, running low, ran out. All of it optional. */
export default function PantrySheet({
  itemKey,
  name,
  kitchen,
  unitMode,
  onClose,
  onFlash,
}: {
  itemKey: string;
  name: string;
  kitchen: Kitchen;
  unitMode: UnitMode;
  onClose: () => void;
  onFlash: (message: string) => void;
}) {
  const item = kitchen.state.pantry[itemKey];
  const isMade = itemKey.startsWith('made:');
  const [text, setText] = useState(() => (item?.amount && !isGone(item.amount) ? stockLabel(item.amount, unitMode) : ''));
  const [low, setLow] = useState(Boolean(item?.low));
  const [error, setError] = useState('');

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const typed = text.trim();
    const amount = typed ? parseAmountText(typed, name) : null;
    if (typed && !amount) {
      setError('Start with a number, like 2 cups or 1 bag. Or leave it empty.');
      return;
    }
    kitchen.setPantry(itemKey, name, { amount, low });
    onClose();
  };

  return (
    <div className="rc-sheet-backdrop" onClick={onClose}>
      <form className="rc-sheet rc-pantry-sheet" role="dialog" aria-modal="true" aria-label={name} onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <div className="rc-sheet-head">
          <h2>{name}</h2>
          <button type="button" className="rc-icon-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {!isMade && (
          <label className="rc-field">
            How much is there?
            <input
              className="rc-input"
              placeholder="No need to say, e.g. 2 cups"
              autoComplete="off"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setError('');
              }}
            />
          </label>
        )}
        {error ? (
          <p className="rc-sheet-error" role="alert">{error}</p>
        ) : (
          !isMade && <p className="rc-meta">With an amount it counts down as you cook, and the list only asks for the difference. Without one it just stays until you say it’s gone.</p>
        )}

        <div className="rc-seg rc-seg-wide" role="group" aria-label="How it’s looking">
          <button type="button" className={!low ? 'is-active' : ''} aria-pressed={!low} onClick={() => setLow(false)}>
            Plenty
          </button>
          <button type="button" className={low ? 'is-active' : ''} aria-pressed={low} onClick={() => setLow(true)}>
            Running low
          </button>
        </div>

        <div className="rc-sheet-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              if (isMade) {
                kitchen.forgetPantry(itemKey);
                onFlash(`${name}: all eaten`);
              } else {
                kitchen.ranOut(itemKey, name);
                onFlash(`${name} is on the shopping list`);
              }
              onClose();
            }}
          >
            {isMade ? 'All eaten' : 'Ran out'}
          </button>
          <button type="submit" className="btn btn-primary">
            Done
          </button>
        </div>

        {!isMade && (
          <button
            type="button"
            className="rc-text-btn rc-muted-btn rc-pantry-forget"
            onClick={() => {
              kitchen.forgetPantry(itemKey);
              onClose();
            }}
          >
            Don’t keep track of this
          </button>
        )}
      </form>
    </div>
  );
}

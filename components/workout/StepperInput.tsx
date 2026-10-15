'use client';

import { useState } from 'react';

type StepperInputProps = {
  label: string;
  value: number;
  onChange: (value: number) => void;
  /** One step down (-1) or up (1), e.g. to the next weight the machine can do. */
  onStep: (direction: 1 | -1) => void;
  /** Allow decimals (weights) rather than whole numbers (reps). */
  decimal?: boolean;
};

/**
 * Big − value + control for gym use: thumb-sized buttons, and the number can
 * also be typed (any value, e.g. a weight the machine's ladder doesn't list).
 */
export default function StepperInput({ label, value, onChange, onStep, decimal = false }: StepperInputProps) {
  // While typing, keep the raw text (e.g. "" or "12.") so the box doesn't fight the keyboard.
  const [text, setText] = useState<string | null>(null);

  const type = (raw: string) => {
    setText(raw);
    const n = parseFloat(raw);
    if (Number.isFinite(n) && n >= 0) onChange(decimal ? Math.round(n * 100) / 100 : Math.round(n));
  };

  return (
    <div className="tracker-stepper">
      <span className="tracker-stepper-label">{label}</span>
      <div className="tracker-stepper-row">
        <button type="button" aria-label={`Less ${label.toLowerCase()}`} onClick={() => { setText(null); onStep(-1); }}>−</button>
        <input
          type="text"
          inputMode={decimal ? 'decimal' : 'numeric'}
          aria-label={label}
          value={text ?? String(value)}
          onFocus={(e) => { setText(String(value)); e.target.select(); }}
          onChange={(e) => type(e.target.value)}
          onBlur={() => setText(null)}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
        />
        <button type="button" aria-label={`More ${label.toLowerCase()}`} onClick={() => { setText(null); onStep(1); }}>+</button>
      </div>
    </div>
  );
}

'use client';

import { useRef, useState } from 'react';
import { Icon } from './Icon';

// A list she can add to and take from, one or two boxes to a line, for the parts of a
// mock patient and a Differential case.

export type ListField<T> = { key: keyof T & string; label: string; placeholder?: string; rows?: number };

export function ListEditor<T extends Record<string, string>>({ title, hint, items, fields, blank, addLabel, onChange, max = 40 }: {
  title: string;
  hint?: string;
  items: T[];
  fields: ListField<T>[];
  blank: T;
  addLabel: string;
  onChange: (items: T[]) => void;
  max?: number;
}) {
  // Keys for React that stay with each line as others come and go.
  const counter = useRef(items.length);
  const [keys, setKeys] = useState(() => items.map((_, i) => i));
  const remove = (at: number) => {
    setKeys(keys.filter((_, i) => i !== at));
    onChange(items.filter((_, i) => i !== at));
  };
  return (
    <fieldset className="ed-lines">
      <legend>{title}{hint && <small>{hint}</small>}</legend>
      {items.map((item, at) => (
        <div key={keys[at]} className="ed-line">
          <div className="ed-line-fields">
            {fields.map((field) => (
              <textarea key={field.key} rows={field.rows ?? 1} value={item[field.key]} aria-label={`${field.label} ${at + 1}`} placeholder={field.placeholder ?? field.label}
                onChange={(e) => onChange(items.map((x, i) => (i === at ? { ...x, [field.key]: e.target.value } : x)))} />
            ))}
          </div>
          <button type="button" className="hb-small-btn ed-remove" aria-label={`Remove ${title.toLowerCase()} line ${at + 1}`} onClick={() => remove(at)}><Icon name="x" /></button>
        </div>
      ))}
      {items.length < max && (
        <button type="button" className="hb-small-btn sd-self-start" onClick={() => { setKeys([...keys, counter.current++]); onChange([...items, { ...blank }]); }}><Icon name="plus" /> {addLabel}</button>
      )}
    </fieldset>
  );
}

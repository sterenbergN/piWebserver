'use client';

import { MathText, Tex } from './MathText';
import type { PublicInput } from '@/lib/daily/grade';
import type { Answer, PartResponse } from '@/lib/daily/types';

/** What's typed or picked so far for one part. */
export type Draft = {
  text?: string;
  option?: number;
  options?: number[];
  min?: string;
  max?: string;
  minOpen?: boolean;
  maxOpen?: boolean;
  num?: string;
  den?: string;
  items?: string[];
};

/** "1,234.5", "1.2e3", "−3" (typographic minus) all read as numbers. */
export function readNumber(text: string | undefined): number | null {
  if (!text) return null;
  const clean = text.replace(/[\s,]/g, '').replace(/[−–]/g, '-').replace(/[×x]10\^?(-?\d+)/i, 'e$1');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(clean)) return null;
  const n = Number(clean);
  return Number.isFinite(n) ? n : null;
}

function readList(text: string | undefined): number[] | null {
  if (!text?.trim()) return null;
  const parts = text.split(/[,;\s]+/).filter(Boolean).map(readNumber);
  return parts.every((p): p is number => p !== null) ? parts : null;
}

/** The response for a draft, or null if it isn't complete yet. */
export function toResponse(input: PublicInput, draft: Draft): PartResponse | null {
  switch (input.type) {
    case 'numeric': {
      const value = readNumber(draft.text);
      return value === null ? null : { type: 'numeric', value };
    }
    case 'choice':
      return draft.option === undefined ? null : { type: 'choice', option: draft.option };
    case 'multi':
      return draft.options?.length ? { type: 'multi', options: draft.options } : null;
    case 'range': {
      const min = draft.minOpen ? null : readNumber(draft.min);
      const max = draft.maxOpen ? null : readNumber(draft.max);
      if ((!draft.minOpen && min === null) || (!draft.maxOpen && max === null) || (draft.minOpen && draft.maxOpen)) return null;
      return { type: 'range', min, max };
    }
    case 'coefficients': {
      const numerator = readList(draft.num);
      const denominator = readList(draft.den);
      return numerator && denominator ? { type: 'coefficients', numerator, denominator } : null;
    }
    case 'order':
      return { type: 'order', items: draft.items ?? input.items };
  }
}

/** A polynomial in s from coefficients, highest power first. */
export function polyLatex(coeffs: number[], variable = 's') {
  const n = coeffs.length - 1;
  const terms = coeffs.map((c, i) => {
    const power = n - i;
    if (c === 0) return '';
    const abs = Math.abs(c);
    const coef = abs === 1 && power > 0 ? '' : String(+abs.toPrecision(6));
    const v = power === 0 ? '' : power === 1 ? variable : `${variable}^{${power}}`;
    return `${c < 0 ? '-' : '+'} ${coef}${v}`;
  }).filter(Boolean);
  if (!terms.length) return '0';
  const joined = terms.join(' ');
  return joined.startsWith('+ ') ? joined.slice(2) : joined;
}

const fmt = (n: number) => String(+n.toPrecision(6));

/** The correct answer, shown after answering. */
export function AnswerText({ answer }: { answer: Answer }) {
  switch (answer.type) {
    case 'numeric':
      return <strong>{fmt(answer.value)}{answer.unit ? ` ${answer.unit}` : ''}</strong>;
    case 'choice':
      return <MathText className="is-inline">{answer.options[answer.correct]}</MathText>;
    case 'multi':
      return <ul className="dq-answer-list">{answer.correct.map((i) => <li key={i}><MathText className="is-inline">{answer.options[i]}</MathText></li>)}</ul>;
    case 'range':
      return <Tex latex={`${answer.min === null ? '-\\infty' : fmt(answer.min)} < x < ${answer.max === null ? '\\infty' : fmt(answer.max)}`} />;
    case 'coefficients':
      return <Tex latex={`\\dfrac{${polyLatex(answer.numerator)}}{${polyLatex(answer.denominator)}}`} />;
    case 'order':
      return <ol className="dq-answer-list">{answer.items.map((item) => <li key={item}><MathText className="is-inline">{item}</MathText></li>)}</ol>;
  }
}

type Props = { id: string; input: PublicInput; draft: Draft; onChange: (draft: Draft) => void; locked: boolean };

export default function AnswerInput({ id, input, draft, onChange, locked }: Props) {
  const set = (patch: Draft) => onChange({ ...draft, ...patch });

  switch (input.type) {
    case 'numeric':
      return (
        <div className="dq-numeric">
          <input id={id} aria-labelledby={`${id}-label`} inputMode="decimal" autoComplete="off" placeholder="Your answer" value={draft.text ?? ''} disabled={locked}
            onChange={(e) => set({ text: e.target.value })} aria-invalid={!!draft.text && readNumber(draft.text) === null} />
          {input.unit && <span className="dq-unit">{input.unit}</span>}
        </div>
      );
    case 'choice':
    case 'multi': {
      const multi = input.type === 'multi';
      return (
        <div className="dq-options" role={multi ? 'group' : 'radiogroup'} aria-labelledby={`${id}-label`}>
          {multi && <p className="dq-hint">Select all that apply.</p>}
          {input.options.map((option, i) => {
            const picked = multi ? !!draft.options?.includes(i) : draft.option === i;
            return (
              <button key={i} type="button" role={multi ? 'checkbox' : 'radio'} aria-checked={picked} disabled={locked} className="dq-option"
                onClick={() => multi
                  ? set({ options: picked ? draft.options!.filter((o) => o !== i) : [...(draft.options ?? []), i].sort((a, b) => a - b) })
                  : set({ option: i })}>
                <span className="dq-option-mark" aria-hidden>{multi ? (picked ? '☑' : '☐') : String.fromCharCode(65 + i)}</span>
                <MathText className="is-inline">{option}</MathText>
              </button>
            );
          })}
        </div>
      );
    }
    case 'range':
      return (
        <div className="dq-range">
          <label className="dq-range-side">
            <span>Lower bound</span>
            <input inputMode="decimal" autoComplete="off" value={draft.minOpen ? '−∞' : draft.min ?? ''} disabled={locked || draft.minOpen} onChange={(e) => set({ min: e.target.value })} />
            <button type="button" className="dq-chip" aria-pressed={!!draft.minOpen} disabled={locked} onClick={() => set({ minOpen: !draft.minOpen })}>No lower bound</button>
          </label>
          <span className="dq-range-x" aria-hidden><Tex latex="< x <" /></span>
          <label className="dq-range-side">
            <span>Upper bound</span>
            <input inputMode="decimal" autoComplete="off" value={draft.maxOpen ? '+∞' : draft.max ?? ''} disabled={locked || draft.maxOpen} onChange={(e) => set({ max: e.target.value })} />
            <button type="button" className="dq-chip" aria-pressed={!!draft.maxOpen} disabled={locked} onClick={() => set({ maxOpen: !draft.maxOpen })}>No upper bound</button>
          </label>
        </div>
      );
    case 'coefficients': {
      const num = readList(draft.num);
      const den = readList(draft.den);
      return (
        <div className="dq-coeffs">
          <p className="dq-hint">Coefficients from the highest power of s down, separated by commas. For example, s² + 3s + 2 is <code>1, 3, 2</code>.</p>
          <label><span>Numerator</span><input autoComplete="off" placeholder="e.g. 10" value={draft.num ?? ''} disabled={locked} onChange={(e) => set({ num: e.target.value })} /></label>
          <label><span>Denominator</span><input autoComplete="off" placeholder="e.g. 1, 3, 2" value={draft.den ?? ''} disabled={locked} onChange={(e) => set({ den: e.target.value })} /></label>
          {num && den && <div className="dq-coeffs-preview" aria-label="Preview"><Tex display latex={`\\dfrac{${polyLatex(num)}}{${polyLatex(den)}}`} /></div>}
        </div>
      );
    }
    case 'order': {
      const items = draft.items ?? input.items;
      const move = (i: number, by: number) => {
        const next = [...items];
        [next[i], next[i + by]] = [next[i + by], next[i]];
        set({ items: next });
      };
      return (
        <ol className="dq-order">
          {items.map((item, i) => (
            <li key={item}>
              <MathText className="is-inline">{item}</MathText>
              <span className="dq-order-btns">
                <button type="button" aria-label="Move up" disabled={locked || i === 0} onClick={() => move(i, -1)}>↑</button>
                <button type="button" aria-label="Move down" disabled={locked || i === items.length - 1} onClick={() => move(i, 1)}>↓</button>
              </span>
            </li>
          ))}
        </ol>
      );
    }
  }
}

'use client';

import { useEffect, useRef, useState } from 'react';
import { evaluate, type AngleMode } from '@/lib/daily/expr';

const ANGLE_KEY = 'dq-calc-angle';
const fmt = (n: number) => String(+n.toPrecision(10));

type Key = { label: string; insert?: string; second?: { label: string; insert: string }; action?: 'second' | 'clear' | 'back' | 'equals'; kind?: 'fn' | 'op' | 'eq' };

const KEYS: Key[] = [
  { label: '2nd', action: 'second', kind: 'fn' },
  { label: 'sin', insert: 'sin(', second: { label: 'sin⁻¹', insert: 'asin(' }, kind: 'fn' },
  { label: 'cos', insert: 'cos(', second: { label: 'cos⁻¹', insert: 'acos(' }, kind: 'fn' },
  { label: 'tan', insert: 'tan(', second: { label: 'tan⁻¹', insert: 'atan(' }, kind: 'fn' },
  { label: 'AC', action: 'clear', kind: 'op' },
  { label: 'ln', insert: 'ln(', second: { label: 'eˣ', insert: 'e^(' }, kind: 'fn' },
  { label: 'log', insert: 'log(', second: { label: '10ˣ', insert: '10^(' }, kind: 'fn' },
  { label: '√', insert: '√(', second: { label: '∛', insert: '∛(' }, kind: 'fn' },
  { label: 'xʸ', insert: '^', second: { label: 'x²', insert: '^2' }, kind: 'fn' },
  { label: '⌫', action: 'back', kind: 'op' },
  { label: '7', insert: '7' }, { label: '8', insert: '8' }, { label: '9', insert: '9' },
  { label: '÷', insert: '÷', kind: 'op' },
  { label: '(', insert: '(', kind: 'op' },
  { label: '4', insert: '4' }, { label: '5', insert: '5' }, { label: '6', insert: '6' },
  { label: '×', insert: '×', kind: 'op' },
  { label: ')', insert: ')', kind: 'op' },
  { label: '1', insert: '1' }, { label: '2', insert: '2' }, { label: '3', insert: '3' },
  { label: '−', insert: '-', kind: 'op' },
  { label: 'π', insert: 'π', second: { label: 'e', insert: 'e' }, kind: 'fn' },
  { label: '0', insert: '0' },
  { label: '.', insert: '.' },
  { label: 'Ans', insert: 'Ans', kind: 'fn' },
  { label: '+', insert: '+', kind: 'op' },
  { label: '=', action: 'equals', kind: 'eq' },
];

/** A small scientific calculator that pops up from a corner of the question page. */
export default function Calculator() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [second, setSecond] = useState(false);
  const [angle, setAngle] = useState<AngleMode>('rad');
  const [ans, setAns] = useState(0);
  const [history, setHistory] = useState<{ expr: string; value: number }[]>([]);
  const [copied, setCopied] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  /** Where the next key goes (the caret, or the end). */
  const caret = useRef<number | null>(null);
  /** Just pressed =: typing a digit starts over, an operator carries on from the answer. */
  const fresh = useRef(false);

  useEffect(() => {
    try { if (localStorage.getItem(ANGLE_KEY) === 'deg') setAngle('deg'); } catch { /* storage blocked */ }
  }, []);
  const chooseAngle = (a: AngleMode) => {
    setAngle(a);
    try { localStorage.setItem(ANGLE_KEY, a); } catch { /* storage blocked */ }
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const result = text.trim() ? evaluate(text, { angle, vars: { ans } }) : null;

  const insert = (s: string) => {
    let base = text;
    let at = caret.current ?? text.length;
    if (fresh.current) {
      // After =, a number or function starts a new sum; an operator keeps going from the answer.
      if (!/^[-+×÷^)]/.test(s)) { base = ''; at = 0; }
      fresh.current = false;
    }
    const next = base.slice(0, at) + s + base.slice(at);
    setText(next);
    caret.current = at + s.length;
    setCopied(false);
  };

  const press = (k: Key) => {
    if (k.action === 'second') { setSecond((v) => !v); return; }
    if (k.action === 'clear') { setText(''); caret.current = null; fresh.current = false; return; }
    if (k.action === 'back') {
      const at = caret.current ?? text.length;
      if (at > 0) { setText(text.slice(0, at - 1) + text.slice(at)); caret.current = at - 1; }
      fresh.current = false;
      return;
    }
    if (k.action === 'equals') { equals(); return; }
    const s = second && k.second ? k.second.insert : k.insert!;
    insert(s);
    if (second) setSecond(false);
  };

  const equals = () => {
    if (!result || !('value' in result)) return;
    setHistory((h) => [{ expr: text, value: result.value }, ...h].slice(0, 3));
    setAns(result.value);
    setText(fmt(result.value));
    caret.current = null;
    fresh.current = true;
  };

  const copy = async () => {
    if (!result || !('value' in result)) return;
    try { await navigator.clipboard.writeText(fmt(result.value)); setCopied(true); } catch { /* not allowed */ }
  };

  if (!open) {
    return (
      <button type="button" className="dq-calc-fab" aria-label="Open calculator" title="Calculator" onClick={() => { setOpen(true); }}>
        🧮
      </button>
    );
  }

  return (
    <>
      {/* Room at the bottom of the page so the last answer box can scroll above the calculator. */}
      <div className="dq-calc-spacer" aria-hidden />
      <section className="dq-calc" role="dialog" aria-label="Calculator">
        <header className="dq-calc-head">
          <div className="dq-seg dq-calc-angle" role="radiogroup" aria-label="Angle unit">
            {(['rad', 'deg'] as const).map((a) => (
              <button key={a} type="button" role="radio" aria-checked={angle === a} onClick={() => chooseAngle(a)}>{a === 'rad' ? 'Rad' : 'Deg'}</button>
            ))}
          </div>
          <button type="button" className="dq-calc-close" aria-label="Close calculator" onClick={() => setOpen(false)}>✕</button>
        </header>

        {history.length > 0 && (
          <ol className="dq-calc-history" aria-label="Recent">
            {history.map((h, i) => (
              <li key={i}>
                <button type="button" title="Use this answer" onClick={() => insert(fmt(h.value))}>
                  <span>{h.expr}</span> <strong>= {fmt(h.value)}</strong>
                </button>
              </li>
            ))}
          </ol>
        )}

        <input ref={input} className="dq-calc-input" aria-label="Expression" autoComplete="off" autoCapitalize="off" spellCheck={false}
          placeholder="e.g. 2*sqrt(3)/pi" value={text}
          onChange={(e) => { setText(e.target.value); caret.current = e.target.selectionStart; fresh.current = false; setCopied(false); }}
          onSelect={(e) => { caret.current = e.currentTarget.selectionStart; }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); equals(); } }} />
        <div className="dq-calc-result" aria-live="polite">
          {result && 'value' in result ? (
            <button type="button" title="Copy" onClick={copy}>= {fmt(result.value)}<small>{copied ? ' copied' : ''}</small></button>
          ) : result ? <span className="is-bad">…</span> : <span>&nbsp;</span>}
        </div>

        <div className="dq-calc-keys">
          {KEYS.map((k) => {
            const label = second && k.second ? k.second.label : k.label;
            return (
              <button key={k.label} type="button" className={k.kind ? `is-${k.kind}` : undefined}
                aria-pressed={k.action === 'second' ? second : undefined}
                // Keep the caret in the box on desktop without popping up the phone keyboard.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => press(k)}>
                {label}
              </button>
            );
          })}
        </div>
      </section>
    </>
  );
}

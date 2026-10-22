'use client';

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { evaluate, type AngleMode } from '@/lib/daily/expr';
import { MathEditor, type MathNode, type MathRow } from '@/lib/daily/mathEditor';

const ANGLE_KEY = 'dq-calc-angle';
const fmt = (n: number) => String(+n.toPrecision(10));
/** How typed characters look on screen. */
const SHOW: Record<string, string> = { '*': '×', '-': '−', '/': '÷' };

type Act = (ed: MathEditor) => void;
const text = (s: string): Act => (ed) => ed.insertText(s);

type Key = {
  label: ReactNode;
  aria?: string;
  act?: Act;
  second?: { label: ReactNode; aria?: string; act: Act };
  special?: 'second' | 'clear' | 'equals';
  /** Carries on from the last answer after = (an operator), instead of starting over. */
  carries?: boolean;
  kind?: 'fn' | 'op' | 'eq' | 'nav';
  wide?: boolean;
  tall?: boolean;
};

const FRAC_ICON = <span className="dq-mf-frac is-icon" aria-hidden><span className="dq-mf-num">▫</span><span className="dq-mf-den">▫</span></span>;

const KEYS: Key[] = [
  { label: '2nd', special: 'second', kind: 'fn' },
  { label: 'sin', act: text('sin('), second: { label: 'sin⁻¹', act: text('asin(') }, kind: 'fn' },
  { label: 'cos', act: text('cos('), second: { label: 'cos⁻¹', act: text('acos(') }, kind: 'fn' },
  { label: 'tan', act: text('tan('), second: { label: 'tan⁻¹', act: text('atan(') }, kind: 'fn' },
  { label: 'AC', special: 'clear', kind: 'op' },

  { label: 'ln', act: text('ln('), second: { label: 'eˣ', act: (ed) => { ed.insertText('e'); ed.insertPower(); } }, kind: 'fn' },
  { label: 'log', act: text('log('), second: { label: '10ˣ', act: (ed) => { ed.insertText('10'); ed.insertPower(); } }, kind: 'fn' },
  { label: '√', aria: 'Square root', act: (ed) => ed.insertRoot(2), second: { label: '∛', aria: 'Cube root', act: (ed) => ed.insertRoot(3) }, kind: 'fn' },
  { label: 'xʸ', aria: 'Power', act: (ed) => ed.insertPower(), second: { label: 'x²', aria: 'Squared', act: (ed) => ed.insertPower('2') }, kind: 'fn', carries: true },
  { label: '⌫', aria: 'Backspace', act: (ed) => ed.backspace(), kind: 'op', carries: true },

  { label: '◀', aria: 'Move left', act: (ed) => ed.left(), kind: 'nav', carries: true },
  { label: '▶', aria: 'Move right', act: (ed) => ed.right(), kind: 'nav', carries: true },
  { label: '(', act: text('('), kind: 'op' },
  { label: ')', act: text(')'), kind: 'op' },
  { label: FRAC_ICON, aria: 'Fraction', act: (ed) => ed.insertFraction(), kind: 'fn', carries: true },

  { label: '7', act: text('7') }, { label: '8', act: text('8') }, { label: '9', act: text('9') },
  { label: '÷', act: text('/'), kind: 'op', carries: true },
  { label: 'π', act: text('π'), second: { label: 'e', act: text('e') }, kind: 'fn' },

  { label: '4', act: text('4') }, { label: '5', act: text('5') }, { label: '6', act: text('6') },
  { label: '×', act: text('*'), kind: 'op', carries: true },
  { label: 'Ans', act: text('Ans'), kind: 'fn' },

  { label: '1', act: text('1') }, { label: '2', act: text('2') }, { label: '3', act: text('3') },
  { label: '−', aria: 'Minus', act: text('-'), kind: 'op', carries: true },
  { label: '=', special: 'equals', kind: 'eq', tall: true },

  { label: '0', act: text('0'), wide: true },
  { label: '.', act: text('.') },
  { label: '+', act: text('+'), kind: 'op', carries: true },
];

/** Draws a row of the expression; `pick` (when editing) moves the cursor where you tap. */
function Row({ row, ed, pick }: { row: MathRow; ed?: MathEditor; pick?: (row: MathRow, i: number) => void }) {
  const here = ed && ed.cursor.row === row;
  const items: ReactNode[] = [];
  row.forEach((n, i) => {
    if (here && ed.cursor.i === i) items.push(<span key="caret" className="dq-mf-caret" />);
    items.push(<Node key={i} n={n} i={i} row={row} ed={ed} pick={pick} />);
  });
  if (here && ed.cursor.i === row.length) items.push(<span key="caret" className="dq-mf-caret" />);
  return (
    <span className={`dq-mf-row${row.length ? '' : ' is-empty'}`}
      onPointerDown={pick && ((e) => { e.stopPropagation(); pick(row, row.length); })}>
      {items}
    </span>
  );
}

function Node({ n, i, row, ed, pick }: { n: MathNode; i: number; row: MathRow; ed?: MathEditor; pick?: (row: MathRow, i: number) => void }) {
  switch (n.k) {
    case 'ch':
      return (
        <span className="dq-mf-ch" onPointerDown={pick && ((e) => {
          e.stopPropagation();
          const r = e.currentTarget.getBoundingClientRect();
          pick(row, e.clientX < r.left + r.width / 2 ? i : i + 1);
        })}>{SHOW[n.c] ?? n.c}</span>
      );
    case 'frac':
      return (
        <span className="dq-mf-frac">
          <span className="dq-mf-num"><Row row={n.num} ed={ed} pick={pick} /></span>
          <span className="dq-mf-den"><Row row={n.den} ed={ed} pick={pick} /></span>
        </span>
      );
    case 'root':
      return (
        <span className="dq-mf-root">
          <span className="dq-mf-radical" aria-hidden>{n.n === 3 ? '∛' : '√'}</span>
          <span className="dq-mf-radicand"><Row row={n.body} ed={ed} pick={pick} /></span>
        </span>
      );
    case 'pow':
      return <sup className="dq-mf-sup"><Row row={n.exp} ed={ed} pick={pick} /></sup>;
  }
}

/** A small scientific calculator that pops up from a corner of the question page. */
export default function Calculator() {
  const [open, setOpen] = useState(false);
  const [, setVersion] = useState(0);
  const [second, setSecond] = useState(false);
  const [angle, setAngle] = useState<AngleMode>('rad');
  const [ans, setAns] = useState(0);
  const [history, setHistory] = useState<{ tree: MathRow; value: number }[]>([]);
  const [copied, setCopied] = useState(false);
  // One editor for the calculator's life; it changes in place and `version` redraws it.
  const [ed] = useState(() => new MathEditor());
  const field = useRef<HTMLDivElement>(null);
  /** Just pressed =: typing a number starts over, an operator carries on from the answer. */
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

  // Keep the cursor in view when the expression is wider than the box.
  useLayoutEffect(() => {
    field.current?.querySelector('.dq-mf-caret')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });

  const result = ed.isEmpty() ? null : evaluate(ed.toExpression(), { angle, vars: { ans } });

  const run = (act: Act, carries = false) => {
    if (fresh.current && !carries) ed.clear();
    fresh.current = false;
    act(ed);
    setCopied(false);
    setVersion((v) => v + 1);
  };

  const equals = () => {
    if (!result || !('value' in result)) return;
    // Copy now: the updater runs later, after the display has been replaced by the answer.
    const entry = { tree: structuredClone(ed.root), value: result.value };
    setHistory((h) => [entry, ...h].slice(0, 3));
    setAns(result.value);
    ed.setText(fmt(result.value));
    fresh.current = true;
    setVersion((v) => v + 1);
  };

  const press = (k: Key) => {
    if (k.special === 'second') { setSecond((v) => !v); return; }
    if (k.special === 'clear') { run((e) => e.clear()); return; }
    if (k.special === 'equals') { equals(); return; }
    const use = second && k.second ? k.second.act : k.act!;
    run(use, k.carries);
    if (second) setSecond(false);
  };

  /** Typing on a keyboard: / makes a fraction, ^ a power, arrows move between boxes. */
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    let act: Act | null = null;
    let carries = true;
    if (k === 'Enter' || k === '=') { e.preventDefault(); equals(); return; }
    if (k === 'Backspace') act = (x) => x.backspace();
    else if (k === 'ArrowLeft') act = (x) => x.left();
    else if (k === 'ArrowRight') act = (x) => x.right();
    else if (k === 'ArrowUp') act = (x) => x.vertical('up');
    else if (k === 'ArrowDown') act = (x) => x.vertical('down');
    else if (k === 'Home') act = (x) => x.home();
    else if (k === 'End') act = (x) => x.end();
    else if (k === '/' || k === '÷') act = (x) => x.insertFraction();
    else if (k === '^') act = (x) => x.insertPower();
    else if (k === '√') { act = (x) => x.insertRoot(2); carries = false; }
    else if (k.length === 1 && /[0-9a-z.+\-*×()°π,]/i.test(k)) { act = text(k); carries = /[+\-*×]/.test(k); }
    if (!act) return;
    e.preventDefault();
    run(act, carries);
  };

  const onPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\s+/g, '');
    if (pasted) run(text(pasted));
  };

  const pick = (row: MathRow, i: number) => {
    fresh.current = false;
    ed.moveTo(row, i);
    setVersion((v) => v + 1);
    field.current?.focus({ preventScroll: true });
  };

  const copy = async () => {
    if (!result || !('value' in result)) return;
    try { await navigator.clipboard.writeText(fmt(result.value)); setCopied(true); } catch { /* not allowed */ }
  };

  if (!open) {
    return (
      <button type="button" className="dq-calc-fab" aria-label="Open calculator" title="Calculator" onClick={() => setOpen(true)}>
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
                <button type="button" title="Use this answer" onClick={() => run(text(fmt(h.value)))}>
                  <span className="dq-mf"><Row row={h.tree} /></span> <strong>= {fmt(h.value)}</strong>
                </button>
              </li>
            ))}
          </ol>
        )}

        <div ref={field} className="dq-mf dq-calc-input" role="textbox" tabIndex={0} aria-label={`Expression: ${ed.toExpression() || 'empty'}`}
          onKeyDown={onKeyDown} onPaste={onPaste} onPointerDown={() => pick(ed.root, ed.root.length)}>
          <Row row={ed.root} ed={ed} pick={pick} />
          {ed.isEmpty() && <span className="dq-mf-placeholder">Type or tap keys</span>}
        </div>
        <div className="dq-calc-result" aria-live="polite">
          {result && 'value' in result ? (
            <button type="button" title="Copy" onClick={copy}>= {fmt(result.value)}<small>{copied ? ' copied' : ''}</small></button>
          ) : result ? <span className="is-bad">…</span> : <span>&nbsp;</span>}
        </div>

        <div className="dq-calc-keys">
          {KEYS.map((k, i) => {
            const alt = second && k.second;
            return (
              <button key={i} type="button" aria-label={(alt ? k.second!.aria : k.aria) ?? undefined}
                className={[k.kind && `is-${k.kind}`, k.wide && 'is-wide', k.tall && 'is-tall'].filter(Boolean).join(' ') || undefined}
                aria-pressed={k.special === 'second' ? second : undefined}
                // Keep focus (and the cursor) in the expression without popping up the phone keyboard.
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => press(k)}>
                {alt ? k.second!.label : k.label}
              </button>
            );
          })}
        </div>
      </section>
    </>
  );
}

'use client';

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { usePathname } from 'next/navigation';
import { evaluate, formatCalcValue, type AngleMode, type CalcDisplayMode } from '@/lib/daily/expr';
import { MathEditor, type MathNode, type MathRow } from '@/lib/daily/mathEditor';
import './calculator.css';

const ANGLE_KEY = 'dq-calc-angle';
const STATE_KEY = 'dq-calc-state-v1';
const MAX_HISTORY = 10;

const DISPLAY_MODES: CalcDisplayMode[] = ['dec', 'frac', 'sci', 'eng'];
const MODE_LABEL: Record<CalcDisplayMode, string> = {
  dec: 'Dec',
  frac: 'Frac',
  sci: 'Sci',
  eng: 'Eng',
};

type Vars = { a: number; b: number; x: number };
type HistoryEntry = { tree: MathRow; value: number };
type Pos = { x: number; y: number };

const DEFAULT_VARS: Vars = { a: 0, b: 0, x: 0 };

/** How typed characters look on screen. */
const SHOW: Record<string, string> = { '*': '×', '-': '−', '/': '÷' };

const CONSTANTS: { label: string; insert: string; hint: string }[] = [
  { label: 'π', insert: 'π', hint: '3.14159' },
  { label: 'e', insert: 'e', hint: '2.71828' },
  { label: 'φ', insert: 'φ', hint: '1.61803' },
  { label: 'g', insert: 'g', hint: '9.80665' },
  { label: 'c', insert: 'c', hint: '2.998e8' },
  { label: 'Nₐ', insert: 'na', hint: '6.022e23' },
  { label: 'kB', insert: 'kb', hint: '1.381e-23' },
  { label: 'qₑ', insert: 'qe', hint: '1.602e-19' },
  { label: 'R', insert: 'rgas', hint: '8.31446' },
];

type Act = (ed: MathEditor) => void;
const text = (s: string): Act => (ed) => ed.insertText(s);

type Key = {
  label: ReactNode;
  aria?: string;
  act?: Act;
  second?: { label: ReactNode; aria?: string; act: Act; carries?: boolean };
  special?: 'second' | 'clear' | 'equals';
  /** Carries on from the last answer after = (an operator), instead of starting over. */
  carries?: boolean;
  kind?: 'fn' | 'op' | 'eq' | 'nav';
  wide?: boolean;
  tall?: boolean;
};

const FRAC_ICON = (
  <span className="dq-mf-frac is-icon" aria-hidden>
    <span className="dq-mf-num">▫</span>
    <span className="dq-mf-den">▫</span>
  </span>
);

const KEYS: Key[] = [
  // Row 1: Mode & trig/log
  { label: '2nd', special: 'second', kind: 'fn' },
  { label: 'sin', act: text('sin('), second: { label: 'sin⁻¹', act: text('asin(') }, kind: 'fn' },
  { label: 'cos', act: text('cos('), second: { label: 'cos⁻¹', act: text('acos(') }, kind: 'fn' },
  { label: 'tan', act: text('tan('), second: { label: 'tan⁻¹', act: text('atan(') }, kind: 'fn' },
  { label: 'ln', act: text('ln('), second: { label: 'eˣ', act: (ed) => { ed.insertText('e'); ed.insertPower(); } }, kind: 'fn' },
  { label: 'log', act: text('log('), second: { label: '10ˣ', act: (ed) => { ed.insertText('10'); ed.insertPower(); } }, kind: 'fn' },

  // Row 2: Roots, powers & engineering functions
  { label: '√', aria: 'Square root', act: (ed) => ed.insertRoot(2), second: { label: '∛', aria: 'Cube root', act: (ed) => ed.insertRoot(3) }, kind: 'fn' },
  { label: 'xʸ', aria: 'Power', act: (ed) => ed.insertPower(), second: { label: 'x²', aria: 'Squared', act: (ed) => ed.insertPower('2'), carries: true }, kind: 'fn', carries: true },
  { label: 'x⁻¹', aria: 'Reciprocal', act: (ed) => ed.insertPower('-1'), second: { label: 'sec', act: text('sec('), carries: false }, kind: 'fn', carries: true },
  { label: '|x|', aria: 'Absolute value', act: text('abs('), second: { label: 'csc', act: text('csc(') }, kind: 'fn' },
  { label: 'nCr', aria: 'Combinations nCr', act: text('ncr('), second: { label: 'nPr', aria: 'Permutations nPr', act: text('npr(') }, kind: 'fn' },
  { label: '∥', aria: 'Parallel combination', act: text('parallel('), second: { label: 'hypot', aria: 'Hypotenuse', act: text('hypot(') }, kind: 'fn' },

  // Row 3: Mod, factorial, percent, degrees, EE, constants
  { label: 'mod', aria: 'Modulo', act: text('mod('), second: { label: 'gcd', act: text('gcd(') }, kind: 'fn' },
  { label: '!', aria: 'Factorial', act: text('!'), second: { label: 'lcm', act: text('lcm('), carries: false }, kind: 'fn', carries: true },
  { label: '%', aria: 'Percent', act: text('%'), second: { label: 'dB', aria: 'Amplitude decibels', act: text('db('), carries: false }, kind: 'fn', carries: true },
  { label: '°', aria: 'Degrees', act: text('°'), second: { label: 'dB₁₀', aria: 'Power decibels', act: text('db10('), carries: false }, kind: 'fn', carries: true },
  { label: 'EE', aria: 'Scientific exponent E', act: text('e'), second: { label: 'cot', act: text('cot('), carries: false }, kind: 'fn', carries: true },
  { label: 'π', aria: 'Pi', act: text('π'), second: { label: 'φ', aria: 'Golden ratio phi', act: text('φ') }, kind: 'fn' },

  // Row 4: Cursor navigation, brackets, comma, clear
  { label: '◀', aria: 'Move left', act: (ed) => ed.left(), kind: 'nav', carries: true },
  { label: '▶', aria: 'Move right', act: (ed) => ed.right(), kind: 'nav', carries: true },
  { label: '(', act: text('('), kind: 'op' },
  { label: ')', act: text(')'), kind: 'op' },
  { label: ',', aria: 'Comma', act: text(','), kind: 'op' },
  { label: 'AC', aria: 'All clear', special: 'clear', kind: 'op' },

  // Row 5: 7 8 9 ÷ frac ⌫
  { label: '7', act: text('7') },
  { label: '8', act: text('8') },
  { label: '9', act: text('9') },
  { label: '÷', aria: 'Divide', act: text('/'), kind: 'op', carries: true },
  { label: FRAC_ICON, aria: 'Fraction', act: (ed) => ed.insertFraction(), kind: 'fn', carries: true },
  { label: '⌫', aria: 'Backspace', act: (ed) => ed.backspace(), kind: 'op', carries: true },

  // Row 6: 4 5 6 × Ans e
  { label: '4', act: text('4') },
  { label: '5', act: text('5') },
  { label: '6', act: text('6') },
  { label: '×', aria: 'Multiply', act: text('*'), kind: 'op', carries: true },
  { label: 'Ans', act: text('Ans'), kind: 'fn' },
  { label: 'e', aria: 'Euler constant e', act: text('e'), second: { label: 'g', aria: 'Gravity g', act: text('g') }, kind: 'fn' },

  // Row 7: 1 2 3 − round = (tall)
  { label: '1', act: text('1') },
  { label: '2', act: text('2') },
  { label: '3', act: text('3') },
  { label: '−', aria: 'Minus', act: text('-'), kind: 'op', carries: true },
  { label: 'round', act: text('round('), second: { label: 'floor', act: text('floor(') }, kind: 'fn' },
  { label: '=', aria: 'Equals', special: 'equals', kind: 'eq', tall: true },

  // Row 8: 0 (wide) . + ceil
  { label: '0', act: text('0'), wide: true },
  { label: '.', act: text('.') },
  { label: '+', aria: 'Plus', act: text('+'), kind: 'op', carries: true },
  { label: 'ceil', act: text('ceil('), second: { label: 'sign', act: text('sign(') }, kind: 'fn' },
];

function sanitizeRow(raw: unknown): MathRow | null {
  if (!Array.isArray(raw)) return null;
  const out: MathRow = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') return null;
    const node = item as Record<string, unknown>;
    if (node.k === 'ch' && typeof node.c === 'string') {
      out.push({ k: 'ch', c: node.c });
    } else if (node.k === 'frac') {
      const num = sanitizeRow(node.num);
      const den = sanitizeRow(node.den);
      if (!num || !den) return null;
      out.push({ k: 'frac', num, den });
    } else if (node.k === 'root' && (node.n === 2 || node.n === 3)) {
      const body = sanitizeRow(node.body);
      if (!body) return null;
      out.push({ k: 'root', n: node.n, body });
    } else if (node.k === 'pow') {
      const exp = sanitizeRow(node.exp);
      if (!exp) return null;
      out.push({ k: 'pow', exp });
    } else {
      return null;
    }
  }
  return out;
}

function isWritableTarget(el: Element | null): el is HTMLInputElement | HTMLTextAreaElement {
  if (!el || !el.isConnected) return false;
  if (el.closest('.dq-calc, .lc-panel')) return false;
  if (el instanceof HTMLTextAreaElement) return !el.disabled && !el.readOnly;
  if (el instanceof HTMLInputElement) {
    if (el.disabled || el.readOnly) return false;
    const type = (el.type || 'text').toLowerCase();
    return ['text', 'search', 'number', 'url', 'tel', 'email', 'password'].includes(type);
  }
  return false;
}

function insertIntoTarget(el: HTMLInputElement | HTMLTextAreaElement, valueText: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  const current = el.value ?? '';
  let nextValue = current + valueText;
  let nextCaret = nextValue.length;
  try {
    if (typeof el.selectionStart === 'number' && typeof el.selectionEnd === 'number') {
      const start = el.selectionStart;
      const end = el.selectionEnd;
      nextValue = current.slice(0, start) + valueText + current.slice(end);
      nextCaret = start + valueText.length;
    }
  } catch {
    nextValue = current + valueText;
  }
  if (setter) setter.call(el, nextValue);
  else el.value = nextValue;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.focus({ preventScroll: true });
  try {
    if (typeof el.setSelectionRange === 'function') el.setSelectionRange(nextCaret, nextCaret);
  } catch {
    /* type="number" does not support setSelectionRange */
  }
}

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
    <span
      className={`dq-mf-row${row.length ? '' : ' is-empty'}`}
      onPointerDown={pick && ((e) => { e.stopPropagation(); pick(row, row.length); })}
    >
      {items}
    </span>
  );
}

function Node({ n, i, row, ed, pick }: { n: MathNode; i: number; row: MathRow; ed?: MathEditor; pick?: (row: MathRow, i: number) => void }) {
  switch (n.k) {
    case 'ch':
      return (
        <span
          className="dq-mf-ch"
          onPointerDown={pick && ((e) => {
            e.stopPropagation();
            const r = e.currentTarget.getBoundingClientRect();
            pick(row, e.clientX < r.left + r.width / 2 ? i : i + 1);
          })}
        >
          {SHOW[n.c] ?? n.c}
        </span>
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

/** Universal floating scientific & engineering calculator widget mounted globally. */
export default function Calculator() {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [dockDailyFab, setDockDailyFab] = useState(false);

  const [, setVersion] = useState(0);
  const [second, setSecond] = useState(false);
  const [sto, setSto] = useState(false);
  const [showConsts, setShowConsts] = useState(false);
  const [angle, setAngle] = useState<AngleMode>('rad');
  const [displayMode, setDisplayMode] = useState<CalcDisplayMode>('dec');
  const [ans, setAns] = useState(0);
  const [vars, setVars] = useState<Vars>(DEFAULT_VARS);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [copied, setCopied] = useState(false);
  const [statusNote, setStatusNote] = useState('');
  const [targetInput, setTargetInput] = useState<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const [pos, setPos] = useState<Pos>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);

  // One editor for the calculator's life; it changes in place and `version` redraws it.
  const [ed] = useState(() => new MathEditor());
  const calcRef = useRef<HTMLElement>(null);
  const field = useRef<HTMLDivElement>(null);
  const targetInputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const openRef = useRef(open);
  const minimizedRef = useRef(minimized);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    minDx: number;
    maxDx: number;
    minDy: number;
    maxDy: number;
  } | null>(null);
  /** Just pressed =: typing a number starts over, an operator carries on from the answer. */
  const fresh = useRef(false);

  useEffect(() => {
    openRef.current = open;
    minimizedRef.current = minimized;
  }, [open, minimized]);

  // Mount + hydrate persisted calculator state client-side only.
  useEffect(() => {
    setMounted(true);
    try {
      const savedAngle = localStorage.getItem(ANGLE_KEY);
      if (savedAngle === 'deg' || savedAngle === 'rad') setAngle(savedAngle);

      const raw = localStorage.getItem(STATE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        if (parsed.angle === 'deg' || parsed.angle === 'rad') setAngle(parsed.angle);
        if (typeof parsed.displayMode === 'string' && DISPLAY_MODES.includes(parsed.displayMode as CalcDisplayMode)) {
          setDisplayMode(parsed.displayMode as CalcDisplayMode);
        }
        if (typeof parsed.ans === 'number' && Number.isFinite(parsed.ans)) {
          setAns(parsed.ans);
        }
        if (parsed.vars && typeof parsed.vars === 'object') {
          const v = parsed.vars as Record<string, unknown>;
          setVars({
            a: typeof v.a === 'number' && Number.isFinite(v.a) ? v.a : 0,
            b: typeof v.b === 'number' && Number.isFinite(v.b) ? v.b : 0,
            x: typeof v.x === 'number' && Number.isFinite(v.x) ? v.x : 0,
          });
        }
        if (Array.isArray(parsed.history)) {
          const validHistory: HistoryEntry[] = [];
          for (const item of parsed.history.slice(0, MAX_HISTORY)) {
            if (!item || typeof item !== 'object') continue;
            const entry = item as Record<string, unknown>;
            const tree = sanitizeRow(entry.tree);
            if (tree && typeof entry.value === 'number' && Number.isFinite(entry.value)) {
              validHistory.push({ tree, value: entry.value });
            }
          }
          setHistory(validHistory);
        }
      }
    } catch {
      /* storage blocked or corrupt */
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(ANGLE_KEY, angle);
      localStorage.setItem(
        STATE_KEY,
        JSON.stringify({ angle, displayMode, ans, vars, history: history.slice(0, MAX_HISTORY) }),
      );
    } catch {
      /* storage blocked */
    }
  }, [hydrated, angle, displayMode, ans, vars, history]);

  // Clear status note briefly.
  useEffect(() => {
    if (!statusNote) return;
    const t = window.setTimeout(() => setStatusNote(''), 1600);
    return () => window.clearTimeout(t);
  }, [statusNote]);

  // Remember the last writable page input/textarea focused before opening or interacting.
  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      const el = e.target as Element | null;
      if (isWritableTarget(el)) {
        targetInputRef.current = el;
        setTargetInput(el);
      }
    };
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, []);

  // Ensure /daily FAB does not stay visible if route changes away from /daily.
  useEffect(() => {
    if (pathname !== '/daily') setDockDailyFab(false);
    if (targetInputRef.current && !targetInputRef.current.isConnected) {
      targetInputRef.current = null;
      setTargetInput(null);
    }
  }, [pathname]);

  // Global open/close & /daily FAB events.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const active = document.activeElement;
      if (isWritableTarget(active)) {
        targetInputRef.current = active;
        setTargetInput(active);
      } else if (targetInputRef.current && !targetInputRef.current.isConnected) {
        targetInputRef.current = null;
        setTargetInput(null);
      }

      const detail = (e as CustomEvent<{ expression?: string; toggle?: boolean }> | undefined)?.detail;
      if (detail?.toggle && openRef.current && !minimizedRef.current) {
        setOpen(false);
        setMinimized(false);
        return;
      }

      setOpen(true);
      setMinimized(false);
      if (typeof detail?.expression === 'string' && detail.expression.trim()) {
        fresh.current = false;
        ed.setText(detail.expression.trim());
        setCopied(false);
        setVersion((v) => v + 1);
      }
      requestAnimationFrame(() => field.current?.focus({ preventScroll: true }));
    };

    const onClose = () => {
      setOpen(false);
      setMinimized(false);
    };

    const onDailyFab = (e: Event) => {
      const show = Boolean((e as CustomEvent<{ show?: boolean }> | undefined)?.detail?.show);
      setDockDailyFab(show);
    };

    window.addEventListener('site:open-calculator', onOpen);
    window.addEventListener('site:close-calculator', onClose);
    window.addEventListener('daily:calc-fab', onDailyFab);
    return () => {
      window.removeEventListener('site:open-calculator', onOpen);
      window.removeEventListener('site:close-calculator', onClose);
      window.removeEventListener('daily:calc-fab', onDailyFab);
    };
  }, [ed]);

  // Escape closes the expanded widget unless a modal overlay sits above/below.
  useEffect(() => {
    if (!open || minimized) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (document.querySelector('.lc-backdrop, .site-popup-backdrop, .signin-backdrop')) return;
      if (sto) {
        setSto(false);
        return;
      }
      setOpen(false);
      setMinimized(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, minimized, sto]);

  // Re-clamp dragged widget inside viewport on resize.
  useEffect(() => {
    if (!open || minimized) return;
    const onResize = () => {
      const el = calcRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const margin = 8;
      let dx = 0;
      let dy = 0;
      if (rect.left < margin) dx = margin - rect.left;
      else if (rect.right > window.innerWidth - margin) dx = window.innerWidth - margin - rect.right;
      if (rect.top < margin) dy = margin - rect.top;
      else if (rect.bottom > window.innerHeight - margin) dy = window.innerHeight - margin - rect.bottom;
      if (dx !== 0 || dy !== 0) {
        setPos((p) => ({ x: p.x + dx, y: p.y + dy }));
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [open, minimized]);

  // Keep the cursor in view when the expression is wider than the box.
  useLayoutEffect(() => {
    field.current?.querySelector('.dq-mf-caret')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });

  const result = ed.isEmpty() ? null : evaluate(ed.toExpression(), { angle, vars: { ans, ...vars } });
  const hasValue = !!result && 'value' in result;
  const formattedResult = hasValue ? formatCalcValue(result.value, displayMode) : '';
  const canInsert = isWritableTarget(targetInput);

  const run = (act: Act, carries = false) => {
    if (fresh.current && !carries) ed.clear();
    fresh.current = false;
    act(ed);
    setCopied(false);
    setStatusNote('');
    setVersion((v) => v + 1);
  };

  const equals = () => {
    if (!result || !('value' in result)) return;
    const entry: HistoryEntry = { tree: structuredClone(ed.root), value: result.value };
    setHistory((h) => [entry, ...h].slice(0, MAX_HISTORY));
    setAns(result.value);
    ed.setText(formatCalcValue(result.value, 'dec'));
    fresh.current = true;
    setCopied(false);
    setVersion((v) => v + 1);
  };

  /** Bring a past sum back into the display to change its numbers. */
  const reuse = (tree: MathRow) => {
    fresh.current = false;
    ed.load(tree);
    setCopied(false);
    setVersion((v) => v + 1);
    field.current?.focus({ preventScroll: true });
  };

  const press = (k: Key) => {
    if (k.special === 'second') { setSecond((v) => !v); return; }
    if (k.special === 'clear') { setSto(false); run((e) => e.clear()); return; }
    if (k.special === 'equals') { equals(); return; }
    const alt = second && k.second;
    const use = alt ? k.second!.act : k.act!;
    const carries = alt ? (k.second!.carries ?? k.carries) : k.carries;
    run(use, carries);
    if (second) setSecond(false);
  };

  const pressVar = (name: keyof Vars) => {
    if (sto) {
      const storeVal = hasValue ? result.value : ans;
      setVars((prev) => ({ ...prev, [name]: storeVal }));
      setSto(false);
      setStatusNote(`Stored ${formatCalcValue(storeVal, 'dec')} → ${name.toUpperCase()}`);
      return;
    }
    run(text(name));
  };

  const cycleDisplayMode = () => {
    const idx = DISPLAY_MODES.indexOf(displayMode);
    setDisplayMode(DISPLAY_MODES[(idx + 1) % DISPLAY_MODES.length]);
    setCopied(false);
  };

  /** Typing on a keyboard: / makes a fraction, ^ a power, arrows move between boxes. */
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    let act: Act | null = null;
    let carries = true;
    if (k === 'Enter' || k === '=') { e.preventDefault(); equals(); return; }
    // Like a calculator's entry recall: ↑ after = (or on an empty display) brings the last sum back.
    if (k === 'ArrowUp' && (fresh.current || ed.isEmpty()) && history[0]) { e.preventDefault(); reuse(history[0].tree); return; }
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
    else if (k.length === 1 && /[0-9a-z.+\-*×()°πφ,!%]/i.test(k)) {
      act = text(k);
      carries = /[+\-*×!%°]/.test(k);
    }
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
    if (!hasValue) return;
    try {
      await navigator.clipboard.writeText(formattedResult);
      setCopied(true);
    } catch {
      /* not allowed */
    }
  };

  const insertResult = () => {
    if (!hasValue) return;
    const el = targetInputRef.current;
    if (!isWritableTarget(el)) {
      setTargetInput(null);
      return;
    }
    const textToInsert =
      el instanceof HTMLInputElement && el.type.toLowerCase() === 'number'
        ? formatCalcValue(result.value, 'dec')
        : formattedResult;
    insertIntoTarget(el, textToInsert);
    setStatusNote('Inserted');
  };

  const onHeadPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button, a, input, [role="radio"], [role="button"]')) return;
    const el = calcRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const margin = 8;
    const rawMinDx = margin - rect.left;
    const rawMaxDx = window.innerWidth - margin - rect.right;
    const rawMinDy = margin - rect.top;
    const rawMaxDy = window.innerHeight - margin - rect.bottom;
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      origX: pos.x,
      origY: pos.y,
      minDx: Math.min(rawMinDx, rawMaxDx),
      maxDx: Math.max(rawMinDx, rawMaxDx),
      minDy: Math.min(rawMinDy, rawMaxDy),
      maxDy: Math.max(rawMinDy, rawMaxDy),
    };
    setDragging(true);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const onHeadPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const dx = Math.min(drag.maxDx, Math.max(drag.minDx, e.clientX - drag.startX));
    const dy = Math.min(drag.maxDy, Math.max(drag.minDy, e.clientY - drag.startY));
    setPos({ x: drag.origX + dx, y: drag.origY + dy });
  };

  const onHeadPointerEnd = (e: React.PointerEvent<HTMLElement>) => {
    if (!dragRef.current || dragRef.current.pointerId !== e.pointerId) return;
    dragRef.current = null;
    setDragging(false);
  };

  const onHeadDoubleClick = (e: React.MouseEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest('button, a, input, [role="radio"], [role="button"]')) return;
    setPos({ x: 0, y: 0 });
  };

  if (!mounted) return null;

  const openAndFocus = () => {
    const active = document.activeElement;
    if (isWritableTarget(active)) {
      targetInputRef.current = active;
      setTargetInput(active);
    }
    setOpen(true);
    setMinimized(false);
    requestAnimationFrame(() => field.current?.focus({ preventScroll: true }));
  };

  if (!open) {
    if (!dockDailyFab) return null;
    return createPortal(
      <button
        type="button"
        className="dq-calc-fab"
        aria-label="Open calculator"
        title="Calculator (Alt+C)"
        onClick={openAndFocus}
      >
        🧮
      </button>,
      document.body,
    );
  }

  if (minimized) {
    return createPortal(
      <div className="dq-calc-pill" role="region" aria-label="Calculator (minimized)">
        <button
          type="button"
          className="dq-calc-pill-restore"
          aria-label="Restore calculator"
          title="Restore calculator"
          onClick={() => {
            setMinimized(false);
            requestAnimationFrame(() => field.current?.focus({ preventScroll: true }));
          }}
        >
          <span aria-hidden>🧮</span>
          <span className="dq-calc-pill-val">{hasValue ? formattedResult : 'Calc'}</span>
        </button>
        <button
          type="button"
          className="dq-calc-pill-close"
          aria-label="Close calculator"
          title="Close calculator"
          onClick={() => {
            setOpen(false);
            setMinimized(false);
          }}
        >
          ✕
        </button>
      </div>,
      document.body,
    );
  }

  const posStyle =
    pos.x !== 0 || pos.y !== 0
      ? ({ '--calc-tx': `${pos.x}px`, '--calc-ty': `${pos.y}px` } as React.CSSProperties)
      : undefined;

  return createPortal(
    <>
      {/* Room at the bottom of /daily so the last answer box can scroll above the docked calculator. */}
      {dockDailyFab && <div className="dq-calc-spacer" aria-hidden />}
      <section
        ref={calcRef}
        className={`dq-calc${dragging ? ' is-dragging' : ''}`}
        style={posStyle}
        role="dialog"
        aria-label="Calculator"
      >
        <header
          className="dq-calc-head"
          onPointerDown={onHeadPointerDown}
          onPointerMove={onHeadPointerMove}
          onPointerUp={onHeadPointerEnd}
          onPointerCancel={onHeadPointerEnd}
          onDoubleClick={onHeadDoubleClick}
          title="Drag to move · Double-click to reset position"
        >
          <span className="dq-calc-grip" aria-hidden>⋮⋮ Calc</span>
          <div className="dq-calc-angle" role="radiogroup" aria-label="Angle unit">
            {(['rad', 'deg'] as const).map((a) => (
              <button key={a} type="button" role="radio" aria-checked={angle === a} onClick={() => setAngle(a)}>
                {a === 'rad' ? 'Rad' : 'Deg'}
              </button>
            ))}
          </div>
          <div className="dq-calc-head-actions">
            <button
              type="button"
              className="dq-calc-min"
              aria-label="Minimize calculator"
              title="Minimize"
              onClick={() => setMinimized(true)}
            >
              −
            </button>
            <button
              type="button"
              className="dq-calc-close"
              aria-label="Close calculator"
              title="Close"
              onClick={() => {
                setOpen(false);
                setMinimized(false);
              }}
            >
              ✕
            </button>
          </div>
        </header>

        <div className="dq-calc-vars" role="group" aria-label="Memory variables and constants">
          <button
            type="button"
            className="is-sto"
            aria-pressed={sto}
            title="Store current value into A, B, or x"
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => setSto((v) => !v)}
          >
            STO
          </button>
          {(['a', 'b', 'x'] as const).map((v) => {
            const label = v === 'x' ? 'x' : v.toUpperCase();
            const valStr = formatCalcValue(vars[v], 'dec');
            return (
              <button
                key={v}
                type="button"
                className={`is-var${vars[v] !== 0 ? ' has-val' : ''}`}
                title={sto ? `Store into ${label} (currently ${valStr})` : `${label} = ${valStr}`}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => pressVar(v)}
              >
                {label}
              </button>
            );
          })}
          <button
            type="button"
            className="is-const"
            aria-expanded={showConsts}
            title="Engineering & physics constants"
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => setShowConsts((v) => !v)}
          >
            Const
          </button>
          {(sto || statusNote) && (
            <span className="dq-calc-vars-note" role="status">
              {statusNote || 'Tap A/B/x…'}
            </span>
          )}
        </div>

        {showConsts && (
          <div className="dq-calc-consts" role="group" aria-label="Constants">
            {CONSTANTS.map((c) => (
              <button
                key={c.insert}
                type="button"
                title={`${c.insert} ≈ ${c.hint}`}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => {
                  run(text(c.insert));
                  setShowConsts(false);
                }}
              >
                <span>{c.label}</span>
                <small>{c.hint}</small>
              </button>
            ))}
          </div>
        )}

        {history.length > 0 && (
          <ol className="dq-calc-history" aria-label="Recent sums">
            {history.map((h, i) => {
              const histText = formatCalcValue(h.value, displayMode);
              return (
                <li key={i}>
                  <button
                    type="button"
                    className="dq-calc-hist-expr"
                    title="Edit this sum"
                    aria-label={`Edit this sum (= ${histText})`}
                    onClick={() => reuse(h.tree)}
                  >
                    <span className="dq-mf"><Row row={h.tree} /></span>
                    <span className="dq-calc-hist-edit" aria-hidden>edit</span>
                  </button>
                  <button
                    type="button"
                    className="dq-calc-hist-value"
                    title="Insert this answer"
                    aria-label={`Insert ${histText}`}
                    onClick={() => run(text(formatCalcValue(h.value, 'dec')))}
                  >
                    = {histText}
                  </button>
                </li>
              );
            })}
          </ol>
        )}

        <div
          ref={field}
          className="dq-mf dq-calc-input"
          role="textbox"
          tabIndex={0}
          aria-label={`Expression: ${ed.toExpression() || 'empty'}`}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onPointerDown={() => pick(ed.root, ed.root.length)}
        >
          <Row row={ed.root} ed={ed} pick={pick} />
          {ed.isEmpty() && <span className="dq-mf-placeholder">Type or tap keys</span>}
        </div>

        <div className="dq-calc-result" aria-live="polite">
          <button
            type="button"
            className="dq-calc-mode-pill"
            onPointerDown={(e) => e.preventDefault()}
            onClick={cycleDisplayMode}
            title="Cycle result format (Dec / Frac / Sci / Eng)"
            aria-label={`Display format: ${MODE_LABEL[displayMode]}. Click to cycle.`}
          >
            {MODE_LABEL[displayMode]}
          </button>
          <div className="dq-calc-result-val">
            {hasValue ? (
              <button type="button" title="Copy result" onPointerDown={(e) => e.preventDefault()} onClick={copy}>
                = {formattedResult}
              </button>
            ) : result ? (
              <span className="is-bad">…</span>
            ) : (
              <span>&nbsp;</span>
            )}
          </div>
          <div className="dq-calc-actions">
            {canInsert && (
              <button
                type="button"
                className="dq-calc-act-btn is-insert"
                disabled={!hasValue}
                title="Insert result into focused field"
                onPointerDown={(e) => e.preventDefault()}
                onClick={insertResult}
              >
                ↳ Insert
              </button>
            )}
            <button
              type="button"
              className="dq-calc-act-btn"
              disabled={!hasValue}
              title="Copy formatted result"
              onPointerDown={(e) => e.preventDefault()}
              onClick={copy}
            >
              {copied ? '✓ Copied' : 'Copy'}
            </button>
          </div>
        </div>

        <div className="dq-calc-keys">
          {KEYS.map((k, i) => {
            const alt = second && k.second;
            return (
              <button
                key={i}
                type="button"
                aria-label={(alt ? k.second!.aria : k.aria) ?? undefined}
                className={[k.kind && `is-${k.kind}`, k.wide && 'is-wide', k.tall && 'is-tall'].filter(Boolean).join(' ') || undefined}
                aria-pressed={k.special === 'second' ? second : undefined}
                // Keep focus (and the cursor) in the expression without popping up the phone keyboard.
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => press(k)}
              >
                {alt ? k.second!.label : k.label}
              </button>
            );
          })}
        </div>
      </section>
    </>,
    document.body,
  );
}

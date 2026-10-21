'use client';

import { useEffect, useRef, useState } from 'react';
import { CATEGORIES, convert, formatNumber } from '@/lib/tools/units';
import { evaluate, ExprError, loan, ohms, unitPrices, type OhmValues } from '@/lib/tools/calc';
import { addDays, dayOfWeek, daysBetween, eachDay, isDateKey, localToday } from '@/lib/habits/dates';
import { addMonths } from '@/lib/chores/chores';

const num = (s: string) => { const n = parseFloat(s.replace(/,/g, '')); return Number.isFinite(n) ? n : null; };
const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

/** Enter a value once, see it in every unit of the category. */
function UnitConverter() {
  const [catId, setCatId] = useState('length');
  const category = CATEGORIES.find(c => c.id === catId)!;
  const [from, setFrom] = useState('ft');
  const [value, setValue] = useState('1');
  const unit = category.units.find(u => u.id === from) || category.units[0];
  const v = num(value);

  const pickCategory = (id: string) => {
    const next = CATEGORIES.find(c => c.id === id)!;
    setCatId(id);
    setFrom(next.units[Math.min(2, next.units.length - 1)].id);
  };

  return (
    <>
      <div className="tl-chips" role="group" aria-label="Measure">
        {CATEGORIES.map(c => <button key={c.id} className="tl-chip" aria-pressed={c.id === catId} onClick={() => pickCategory(c.id)}>{c.label}</button>)}
      </div>

      <span className="tl-label">Convert</span>
      <div className="tl-row">
        <input className="tl-big-input" style={{ flex: 1 }} inputMode="decimal" value={value} onChange={e => setValue(e.target.value)} aria-label="Value" />
        <select value={unit.id} onChange={e => setFrom(e.target.value)} aria-label="From unit" style={{ width: 'auto', maxWidth: '45%' }}>
          {category.units.map(u => <option key={u.id} value={u.id}>{u.label}</option>)}
        </select>
      </div>

      <div className="tl-results" aria-live="polite">
        {category.units.filter(u => u.id !== unit.id).map(u => (
          <button key={u.id} className="tl-result" style={{ cursor: 'pointer', font: 'inherit', color: 'inherit', textAlign: 'left' }}
            title={`Convert from ${u.label} instead`}
            onClick={() => { if (v !== null) setValue(formatNumber(convert(v, category, unit.id, u.id)).replace(/,/g, '')); setFrom(u.id); }}>
            <span className="tl-muted">{u.label}</span>
            <strong>{v === null ? '—' : `${formatNumber(convert(v, category, unit.id, u.id))} ${u.short}`}</strong>
          </button>
        ))}
      </div>
      <p className="tl-muted" style={{ fontSize: '0.8rem', margin: '0.6rem 0 0' }}>Tap a row to convert from that unit instead.</p>
    </>
  );
}

/** Bill + tip, split between people. */
function TipSplit() {
  const [bill, setBill] = useState('');
  const [tip, setTip] = useState(20);
  const [custom, setCustom] = useState('');
  const [people, setPeople] = useState(2);
  const [roundUp, setRoundUp] = useState(false);
  const b = num(bill);
  const pct = custom !== '' ? num(custom) ?? 0 : tip;

  let perPerson = b !== null ? (b * (1 + pct / 100)) / people : null;
  if (perPerson !== null && roundUp) perPerson = Math.ceil(perPerson);
  const total = perPerson !== null ? perPerson * people : null;
  const tipAmount = total !== null && b !== null ? total - b : null;

  return (
    <>
      <span className="tl-label">Bill</span>
      <input className="tl-big-input" inputMode="decimal" placeholder="$0.00" value={bill} onChange={e => setBill(e.target.value.replace(/[^0-9.,]/g, ''))} aria-label="Bill amount" />

      <span className="tl-label">Tip</span>
      <div className="tl-chips">
        {[15, 18, 20, 22, 25].map(p => (
          <button key={p} className="tl-chip" aria-pressed={custom === '' && tip === p} onClick={() => { setTip(p); setCustom(''); }}>{p}%</button>
        ))}
        <input inputMode="decimal" placeholder="Other %" value={custom} onChange={e => setCustom(e.target.value.replace(/[^0-9.]/g, ''))} aria-label="Custom tip percent" style={{ width: '6.5rem', minHeight: 40, borderRadius: 999 }} />
      </div>

      <div className="tl-grid-2" style={{ marginTop: '1rem', alignItems: 'end' }}>
        <div>
          <span className="tl-label" style={{ marginTop: 0 }}>People</span>
          <div className="tl-stepper">
            <button className="tl-icon-btn" onClick={() => setPeople(p => Math.max(1, p - 1))} disabled={people <= 1} aria-label="Fewer people">−</button>
            <output aria-live="polite">{people}</output>
            <button className="tl-icon-btn" onClick={() => setPeople(p => Math.min(50, p + 1))} aria-label="More people">+</button>
          </div>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minHeight: 44, cursor: 'pointer' }}>
          <input type="checkbox" checked={roundUp} onChange={e => setRoundUp(e.target.checked)} /> Round up each share
        </label>
      </div>

      <div className="tl-results" aria-live="polite">
        <div className="tl-result is-main"><span>{people > 1 ? 'Each person pays' : 'Total'}</span><strong>{perPerson === null ? '—' : money(perPerson)}</strong></div>
        {people > 1 && <div className="tl-result"><span className="tl-muted">Total</span><strong>{total === null ? '—' : money(total)}</strong></div>}
        <div className="tl-result"><span className="tl-muted">Tip{roundUp ? ' (after rounding)' : ''}</span><strong>{tipAmount === null ? '—' : money(tipAmount)}</strong></div>
      </div>
    </>
  );
}

/** The three percentage questions people actually ask. */
function Percentages() {
  const [a, setA] = useState({ x: '15', y: '80' });
  const [b, setB] = useState({ x: '12', y: '48' });
  const [c, setC] = useState({ x: '80', y: '100' });
  const field = (value: string, onChange: (v: string) => void, label: string) => (
    <input inputMode="decimal" value={value} onChange={e => onChange(e.target.value)} aria-label={label} style={{ width: '5.5rem', textAlign: 'center', fontWeight: 700 }} />
  );
  const out = (n: number | null, suffix = '') => <strong style={{ fontSize: '1.2rem' }}>{n === null || !Number.isFinite(n) ? '—' : `${formatNumber(n)}${suffix}`}</strong>;
  const row: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem', padding: '0.8rem 0.9rem', borderRadius: 12, background: 'var(--input-bg)', border: '1px solid var(--surface-border)' };
  const ax = num(a.x), ay = num(a.y), bx = num(b.x), by = num(b.y), cx = num(c.x), cy = num(c.y);
  const change = cx !== null && cy !== null && cx !== 0 ? ((cy - cx) / Math.abs(cx)) * 100 : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
      <div style={row}>What is {field(a.x, x => setA({ ...a, x }), 'Percent')} % of {field(a.y, y => setA({ ...a, y }), 'Number')} ? → {out(ax !== null && ay !== null ? (ax / 100) * ay : null)}</div>
      <div style={row}>{field(b.x, x => setB({ ...b, x }), 'Part')} is what % of {field(b.y, y => setB({ ...b, y }), 'Whole')} ? → {out(bx !== null && by ? (bx / by) * 100 : null, '%')}</div>
      <div style={row}>From {field(c.x, x => setC({ ...c, x }), 'Old value')} to {field(c.y, y => setC({ ...c, y }), 'New value')} is → {out(change, '%')} {change !== null && Number.isFinite(change) && <span className="tl-muted">{change >= 0 ? 'increase' : 'decrease'}</span>}</div>
    </div>
  );
}


const HISTORY_KEY = 'tools:calc-history';
const KEYS = [
  ['C', '(', ')', '%', '÷'],
  ['7', '8', '9', '×', '⌫'],
  ['4', '5', '6', '−', '^'],
  ['1', '2', '3', '+', '√'],
  ['π', '0', '.', 'ans', '='],
];
const FN_KEYS = ['sin', 'cos', 'tan', 'log', 'ln', 'asin', 'acos', 'atan', '!', 'e'];

/** Type or tap an expression; the answer shows as you go, and = keeps it in the history. */
function ExpressionCalc() {
  const [expr, setExpr] = useState('');
  const [deg, setDeg] = useState(true);
  const [fx, setFx] = useState(false);
  const [history, setHistory] = useState<{ expr: string; value: number }[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try { const saved = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); if (Array.isArray(saved)) setHistory(saved.slice(0, 12)); } catch { /* no history */ }
  }, []);
  const ans = history[0]?.value ?? 0;

  let preview: string | null = null;
  let problem = '';
  if (expr.trim()) {
    try { preview = formatNumber(evaluate(expr, { deg, ans })); } catch (e) { problem = e instanceof ExprError ? e.message : 'Can’t work that out'; }
  }

  const commit = () => {
    try {
      const value = evaluate(expr, { deg, ans });
      const next = [{ expr, value }, ...history.filter((h) => h.expr !== expr)].slice(0, 12);
      setHistory(next);
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)); } catch { /* storage blocked */ }
      setExpr(String(Number(value.toPrecision(12))));
    } catch { /* the preview line already says what's wrong */ }
  };

  const press = (key: string) => {
    if (key === 'C') setExpr('');
    else if (key === '⌫') setExpr((e) => e.slice(0, -1));
    else if (key === '=') commit();
    else if (FN_KEYS.includes(key) && key.length > 1) setExpr((e) => `${e}${key}(`);
    else setExpr((e) => e + key);
    inputRef.current?.focus({ preventScroll: true });
  };

  return (
    <>
      <div className="tl-calc-display">
        <input ref={inputRef} className="tl-big-input" value={expr} onChange={(e) => setExpr(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
          placeholder="0" aria-label="Expression" spellCheck={false} autoComplete="off" />
        <div className={`tl-calc-preview${problem ? ' is-error' : ''}`} aria-live="polite">{preview !== null ? `= ${preview}` : problem || ' '}</div>
      </div>

      <div className="tl-calc-modes">
        <button type="button" className="tl-chip" aria-pressed={fx} onClick={() => setFx(!fx)}>ƒx functions</button>
        <button type="button" className="tl-chip" aria-pressed={deg} onClick={() => setDeg(!deg)} title="Angle unit for sin, cos and tan">{deg ? 'Degrees' : 'Radians'}</button>
      </div>
      {fx && (
        <div className="tl-keys is-fn">
          {FN_KEYS.map((k) => <button key={k} type="button" onClick={() => press(k)}>{k}</button>)}
        </div>
      )}
      <div className="tl-keys">
        {KEYS.flat().map((k) => (
          <button key={k} type="button" className={k === '=' ? 'is-equals' : /[÷×−+^√%()]/.test(k) || k === 'C' || k === '⌫' ? 'is-op' : ''} onClick={() => press(k)}
            aria-label={k === '⌫' ? 'Delete' : k === 'C' ? 'Clear' : undefined}>{k}</button>
        ))}
      </div>

      {history.length > 0 && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span className="tl-label">History</span>
            <button type="button" className="tl-link-btn" onClick={() => { setHistory([]); try { localStorage.removeItem(HISTORY_KEY); } catch { /* fine */ } }}>Clear</button>
          </div>
          <div className="tl-results" style={{ marginTop: 0 }}>
            {history.map((h, i) => (
              <button key={i} type="button" className="tl-result tl-result-btn" onClick={() => setExpr(String(Number(h.value.toPrecision(12))))} title="Use this answer">
                <span className="tl-muted" style={{ overflowWrap: 'anywhere' }}>{h.expr}</span>
                <strong>{formatNumber(h.value)}</strong>
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}

/** Monthly payment for a mortgage, car loan or the like, and what paying extra saves. */
function LoanCalc() {
  const [amount, setAmount] = useState('300000');
  const [rate, setRate] = useState('6.5');
  const [years, setYears] = useState('30');
  const [extra, setExtra] = useState('');
  const result = loan(num(amount) ?? 0, num(rate) ?? -1, num(years) ?? 0, num(extra) ?? 0);
  const span = (months: number) => `${Math.floor(months / 12)} yr${months % 12 ? ` ${months % 12} mo` : ''}`;

  return (
    <>
      <span className="tl-label">Loan amount</span>
      <input className="tl-big-input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.,]/g, ''))} aria-label="Loan amount" />
      <div className="tl-grid-2">
        <label><span className="tl-label">Interest rate (APR %)</span>
          <input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value.replace(/[^0-9.]/g, ''))} /></label>
        <label><span className="tl-label">Extra each month</span>
          <input inputMode="decimal" placeholder="$0" value={extra} onChange={(e) => setExtra(e.target.value.replace(/[^0-9.,]/g, ''))} /></label>
      </div>
      <span className="tl-label">Term</span>
      <div className="tl-chips">
        {['5', '10', '15', '20', '30'].map((y) => <button key={y} className="tl-chip" aria-pressed={years === y} onClick={() => setYears(y)}>{y} years</button>)}
        <input inputMode="decimal" value={years} onChange={(e) => setYears(e.target.value.replace(/[^0-9.]/g, ''))} aria-label="Years" style={{ width: '5rem', minHeight: 40, borderRadius: 999, textAlign: 'center' }} />
      </div>

      {result ? (
        <>
          <div className="tl-results" aria-live="polite">
            <div className="tl-result is-main"><span>Monthly payment{num(extra) ? ' (before extra)' : ''}</span><strong>{money(result.payment)}</strong></div>
            <div className="tl-result"><span className="tl-muted">Total interest</span><strong>{money(result.interest)}</strong></div>
            <div className="tl-result"><span className="tl-muted">Total paid</span><strong>{money(result.total)}</strong></div>
            {result.extra && (
              <div className="tl-result" style={{ borderColor: 'rgba(var(--success-rgb), 0.6)' }}>
                <span className="tl-muted">Paying {money(num(extra) ?? 0)} extra</span>
                <strong>Done in {span(result.extra.months)}, saves {money(result.extra.interestSaved)}</strong>
              </div>
            )}
          </div>
          <details className="tl-details">
            <summary>Year by year</summary>
            <div className="tl-card-scroll" style={{ marginTop: '0.6rem' }}>
              <table className="tl-scorecard tl-amort">
                <thead><tr><th>Year</th><th>Principal</th><th>Interest</th><th>Balance</th></tr></thead>
                <tbody>{result.yearly.map((y) => (
                  <tr key={y.year}><td>{y.year}</td><td>{money(y.principal)}</td><td>{money(y.interest)}</td><td>{money(y.balance)}</td></tr>
                ))}</tbody>
              </table>
            </div>
          </details>
        </>
      ) : <p className="tl-muted" style={{ marginTop: '1rem' }}>Enter an amount, a rate and a term.</p>}
    </>
  );
}

const fmtDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

/** Days between two dates (and working days), or a date some time from another. */
function DateCalc() {
  const today = localToday();
  const [mode, setMode] = useState<'between' | 'add'>('between');
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(addDays(today, 30));
  const [count, setCount] = useState('90');
  const [unit, setUnit] = useState<'day' | 'week' | 'month'>('day');
  const [sign, setSign] = useState<1 | -1>(1);

  const valid = isDateKey(from) && isDateKey(to);
  const days = valid ? daysBetween(from, to) : null;
  const [a, b] = valid && from <= to ? [from, to] : [to, from];
  // Weekdays after the start, up to and including the end.
  const workdays = valid ? eachDay(a, b).slice(1).filter((d) => dayOfWeek(d) % 6 !== 0).length : null;
  const n = Math.round(num(count) ?? 0) * sign;
  const added = isDateKey(from) ? (unit === 'month' ? addMonths(from, n) : addDays(from, unit === 'week' ? n * 7 : n)) : null;

  return (
    <>
      <div className="tl-seg" role="group" aria-label="Date question">
        <button aria-pressed={mode === 'between'} onClick={() => setMode('between')}>Days between</button>
        <button aria-pressed={mode === 'add'} onClick={() => setMode('add')}>Add or subtract</button>
      </div>
      {mode === 'between' ? (
        <>
          <div className="tl-grid-2">
            <label><span className="tl-label">From</span><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
            <label><span className="tl-label">To</span><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          </div>
          <div className="tl-chips" style={{ marginTop: '0.6rem' }}>
            <button className="tl-chip" onClick={() => setFrom(today)}>From today</button>
            <button className="tl-chip" onClick={() => { const y = Number(today.slice(0, 4)); setTo(`${today.slice(5) > '12-25' ? y + 1 : y}-12-25`); }}>To Christmas</button>
          </div>
          {days !== null && (
            <div className="tl-results" aria-live="polite">
              <div className="tl-result is-main"><span>{days < 0 ? 'Days before' : 'Days'}</span><strong>{Math.abs(days).toLocaleString()}</strong></div>
              <div className="tl-result"><span className="tl-muted">Weeks</span><strong>{Math.floor(Math.abs(days) / 7)} wk {Math.abs(days) % 7} d</strong></div>
              <div className="tl-result"><span className="tl-muted">Weekdays (Mon–Fri)</span><strong>{workdays?.toLocaleString()}</strong></div>
              <div className="tl-result"><span className="tl-muted">Hours</span><strong>{(Math.abs(days) * 24).toLocaleString()}</strong></div>
            </div>
          )}
        </>
      ) : (
        <>
          <span className="tl-label">Start</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <div className="tl-row" style={{ marginTop: '0.6rem' }}>
            <div className="tl-seg" style={{ flex: '0 0 6rem' }} role="group" aria-label="Add or subtract">
              <button aria-pressed={sign === 1} onClick={() => setSign(1)} aria-label="Add">+</button>
              <button aria-pressed={sign === -1} onClick={() => setSign(-1)} aria-label="Subtract">−</button>
            </div>
            <input inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value.replace(/[^0-9]/g, ''))} aria-label="How many" style={{ flex: 1 }} />
            <select value={unit} onChange={(e) => setUnit(e.target.value as typeof unit)} aria-label="Unit" style={{ width: 'auto' }}>
              <option value="day">days</option><option value="week">weeks</option><option value="month">months</option>
            </select>
          </div>
          {added && <div className="tl-results" aria-live="polite"><div className="tl-result is-main"><span>Date</span><strong>{fmtDate(added)}</strong></div></div>}
        </>
      )}
    </>
  );
}

const OHM_FIELDS: { k: keyof OhmValues; label: string; unit: string }[] = [
  { k: 'v', label: 'Voltage', unit: 'V' },
  { k: 'i', label: 'Current', unit: 'A' },
  { k: 'r', label: 'Resistance', unit: 'Ω' },
  { k: 'p', label: 'Power', unit: 'W' },
];

/** Fill in any two of V, I, R and P; the other two are worked out. */
function OhmCalc() {
  const [values, setValues] = useState<Record<string, string>>({ v: '12', i: '2' });
  const [order, setOrder] = useState<(keyof OhmValues)[]>(['v', 'i']);
  // The two fields edited most recently are the inputs; the rest are answers.
  const given = order.filter((k) => num(values[k] ?? '') !== null).slice(-2);
  const solved = given.length === 2 ? ohms(Object.fromEntries(given.map((k) => [k, num(values[k])!]))) : null;
  const edit = (k: keyof OhmValues, v: string) => {
    setValues({ ...values, [k]: v });
    setOrder([...order.filter((x) => x !== k), k]);
  };
  return (
    <>
      <p className="tl-sub">Fill in any two; the other two are worked out. V = I × R, P = V × I.</p>
      <div className="tl-grid-2">
        {OHM_FIELDS.map((f) => {
          const isInput = given.includes(f.k);
          const answer = solved && Number.isFinite(solved[f.k]) ? formatNumber(solved[f.k]).replace(/,/g, '') : '';
          return (
            <label key={f.k} className={`tl-ohm${isInput ? ' is-input' : ''}`}>
              <span className="tl-label">{f.label} ({f.unit})</span>
              <input inputMode="decimal" value={isInput ? values[f.k] ?? '' : answer}
                onChange={(e) => edit(f.k, e.target.value.replace(/[^0-9.eE-]/g, ''))} onFocus={(e) => e.target.select()} />
            </label>
          );
        })}
      </div>
      <p className="tl-muted" style={{ fontSize: '0.8rem', margin: '0.6rem 0 0' }}>Outlined boxes are what you typed; the others are answers. Type in an answer box to use it instead.</p>
    </>
  );
}

/** Which pack is the better deal: price per ounce, per roll, per anything. */
function UnitPriceCalc() {
  const [unit, setUnit] = useState('oz');
  const [items, setItems] = useState([{ price: '4.99', size: '16' }, { price: '7.49', size: '28' }]);
  const { per, best } = unitPrices(items.map((x) => ({ price: num(x.price), size: num(x.size) })));
  const compared = per.filter((p) => p !== null).length > 1;
  const set = (i: number, patch: Partial<(typeof items)[number]>) => setItems(items.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <>
      <span className="tl-label">Size is in</span>
      <div className="tl-chips">
        {['oz', 'lb', 'fl oz', 'ct', 'rolls', 'L'].map((u) => <button key={u} className="tl-chip" aria-pressed={unit === u} onClick={() => setUnit(u)}>{u}</button>)}
      </div>
      <div className="tl-results">
        {items.map((x, i) => (
          <div key={i} className={`tl-price-row${compared && i === best ? ' is-best' : ''}`}>
            <strong className="tl-price-tag">{String.fromCharCode(65 + i)}</strong>
            <input inputMode="decimal" value={x.price} onChange={(e) => set(i, { price: e.target.value.replace(/[^0-9.]/g, '') })} aria-label={`Price of ${String.fromCharCode(65 + i)}`} placeholder="$ price" />
            <input inputMode="decimal" value={x.size} onChange={(e) => set(i, { size: e.target.value.replace(/[^0-9.]/g, '') })} aria-label={`Size of ${String.fromCharCode(65 + i)}`} placeholder={unit} />
            <span className="tl-price-per">
              {per[i] === null ? '—' : `${money(per[i]!)}/${unit}`}
              {compared && i === best && <small>Best deal</small>}
              {compared && i !== best && per[i] !== null && <small className="tl-muted">+{Math.round((per[i]! / per[best]! - 1) * 100)}%</small>}
            </span>
            {items.length > 2 && <button className="tl-icon-btn" onClick={() => setItems(items.filter((_, j) => j !== i))} aria-label={`Remove ${String.fromCharCode(65 + i)}`}>✕</button>}
          </div>
        ))}
      </div>
      {items.length < 5 && <button className="btn btn-secondary" style={{ marginTop: '0.6rem' }} onClick={() => setItems([...items, { price: '', size: '' }])}>+ Add another</button>}
    </>
  );
}

const CALCS = [
  { id: 'calc', icon: '🧮', label: 'Calculator', render: () => <ExpressionCalc /> },
  { id: 'units', icon: '📏', label: 'Units', render: () => <UnitConverter /> },
  { id: 'tip', icon: '🧾', label: 'Tip & split', render: () => <TipSplit /> },
  { id: 'percent', icon: '％', label: 'Percent', render: () => <Percentages /> },
  { id: 'loan', icon: '🏠', label: 'Loan', render: () => <LoanCalc /> },
  { id: 'dates', icon: '📅', label: 'Dates', render: () => <DateCalc /> },
  { id: 'ohm', icon: '⚡', label: 'Ohm’s law', render: () => <OhmCalc /> },
  { id: 'price', icon: '🛒', label: 'Unit price', render: () => <UnitPriceCalc /> },
] as const;
type CalcId = (typeof CALCS)[number]['id'];
const LAST_KEY = 'tools:calc';

export default function CalculatorTool() {
  const [calc, setCalc] = useState<CalcId>('calc');
  // Come back to the calculator used last (on this device).
  useEffect(() => {
    try { const last = localStorage.getItem(LAST_KEY); if (CALCS.some((c) => c.id === last)) setCalc(last as CalcId); } catch { /* default */ }
  }, []);
  const choose = (id: CalcId) => { setCalc(id); try { localStorage.setItem(LAST_KEY, id); } catch { /* fine */ } };
  const current = CALCS.find((c) => c.id === calc)!;
  return (
    <section className="tl-card">
      <div className="tl-calc-pick" role="tablist" aria-label="Calculator">
        {CALCS.map((c) => (
          <button key={c.id} role="tab" aria-selected={calc === c.id} onClick={() => choose(c.id)}>
            <span aria-hidden>{c.icon}</span>{c.label}
          </button>
        ))}
      </div>
      <h2 className="tl-calc-title">{current.icon} {current.label}</h2>
      {current.render()}
    </section>
  );
}

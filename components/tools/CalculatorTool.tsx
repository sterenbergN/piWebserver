'use client';

import { useState } from 'react';
import { CATEGORIES, convert, formatNumber } from '@/lib/tools/units';

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
      <div className="tl-chips is-scroll" role="group" aria-label="Measure">
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

const CALCS = [
  { id: 'units', label: 'Units' },
  { id: 'tip', label: 'Tip & split' },
  { id: 'percent', label: 'Percent' },
] as const;

export default function CalculatorTool() {
  const [calc, setCalc] = useState<(typeof CALCS)[number]['id']>('units');
  return (
    <section className="tl-card">
      <div className="tl-seg" role="group" aria-label="Calculator" style={{ marginBottom: '1.1rem' }}>
        {CALCS.map(c => <button key={c.id} aria-pressed={calc === c.id} onClick={() => setCalc(c.id)}>{c.label}</button>)}
      </div>
      {calc === 'units' && <UnitConverter />}
      {calc === 'tip' && <TipSplit />}
      {calc === 'percent' && <Percentages />}
    </section>
  );
}

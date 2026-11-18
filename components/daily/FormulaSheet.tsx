'use client';

import { MathText, Tex } from './MathText';
import type { Formula } from '@/lib/daily/types';

/** "where t is time (s), …": what each symbol in a formula stands for. */
function Symbols({ formula }: { formula: Formula }) {
  if (!formula.where?.length) return null;
  return (
    <ul className="dq-symbols" aria-label="Where">
      {formula.where.map((s) => (
        <li key={s.symbol}><Tex latex={s.symbol} /><MathText className="is-inline">{s.meaning}</MathText></li>
      ))}
    </ul>
  );
}

export function FormulaOfTheDay({ formula }: { formula: Formula }) {
  return (
    <section className="dq-fotd">
      <span className="dq-eyebrow">Formula of the day</span>
      <h3>{formula.name}</h3>
      <Tex display latex={formula.latex} />
      <Symbols formula={formula} />
      {formula.note && <MathText>{formula.note}</MathText>}
      <p className="dq-source">Source: {formula.source}</p>
    </section>
  );
}

/** Today's formulas, each with where it comes from. Open by default, like the reference handbook in the exam. */
export default function FormulaSheet({ formulas }: { formulas: Formula[] }) {
  if (!formulas.length) return null;
  return (
    <details className="dq-sheet" open>
      <summary>📐 Formula sheet ({formulas.length})</summary>
      <dl>
        {formulas.map((f) => (
          <div key={f.id} className="dq-sheet-item">
            <dt>{f.name}</dt>
            <dd>
              <Tex display latex={f.latex} />
              <Symbols formula={f} />
              {f.note && <MathText className="dq-sheet-note">{f.note}</MathText>}
              <span className="dq-source">{f.source}</span>
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

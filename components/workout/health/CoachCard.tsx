'use client';

import './health.css';
import { useState } from 'react';
import type { CoachInsight } from '@/lib/workout/health-coach';

export const COACH_ICON: Record<CoachInsight['category'], string> = {
  sleep: '🌙', recovery: '♥', body: '⚖', rest: '⏱', activity: '👣',
  effort: '🔥', load: '🏋', progression: '📈', warmup: '☀', suggestions: '🎯', volume: '🧩',
};
const SHOWN = 4;

/** One finding: what was noticed, what to do about it, and what it's based on. */
export function CoachItem({ insight: i }: { insight: CoachInsight }) {
  return (
    <li className={`hc-coach-item is-${i.tone}`}>
      <span className="hc-coach-icon" aria-hidden>{COACH_ICON[i.category]}</span>
      <div>
        <strong>{i.title}</strong>
        {i.usesHealth && <span className="hc-coach-badge">♥ Uses Apple Health</span>}
        <p>{i.detail}</p>
        {i.steps?.length ? (
          <ol className="hc-coach-steps">{i.steps.map((step) => <li key={step}>{step}</li>)}</ol>
        ) : i.tip ? <p className="hc-coach-tip"><span aria-hidden>→ </span>{i.tip}</p> : null}
        <small>Based on {i.evidence}</small>
      </div>
    </li>
  );
}

/**
 * What the health data says about your training: each finding with what to
 * do about it and what it's based on. Warnings first.
 */
export default function CoachCard({ insights, building, more }: { insights: CoachInsight[]; building?: boolean; more?: React.ReactNode }) {
  const [all, setAll] = useState(false);
  const shown = all ? insights : insights.slice(0, SHOWN);
  return (
    <section className="workout-tile an-card hc-coach">
      <div className="an-card-head">
        <h2>What your data says</h2>
        {insights.length > 0 && <span className="workout-hint">{insights.length} finding{insights.length === 1 ? '' : 's'}</span>}
      </div>
      {insights.length === 0 ? (
        <p className="workout-hint" style={{ margin: 0 }}>
          {building
            ? 'Findings appear as data builds up: sleep vs strength needs a few workouts after both short and full nights, and trends need two to six weeks.'
            : 'Nothing stands out right now — sleep, recovery and your lifts are all in their normal range.'}
        </p>
      ) : (
        <ul className="hc-coach-list">
          {shown.map((i) => (
            <CoachItem key={i.id} insight={i} />
          ))}
        </ul>
      )}
      {insights.length > SHOWN && (
        <button type="button" className="workout-text-btn" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show ${insights.length - SHOWN} more`}</button>
      )}
      {more}
    </section>
  );
}

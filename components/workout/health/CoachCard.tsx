'use client';

import './health.css';
import { useState } from 'react';
import type { CoachInsight } from '@/lib/workout/health-coach';

const ICON: Record<CoachInsight['category'], string> = { sleep: '🌙', recovery: '♥', body: '⚖', rest: '⏱', activity: '👣' };
const SHOWN = 4;

/**
 * What the health data says about your training: each finding with what to
 * do about it and what it's based on. Warnings first.
 */
export default function CoachCard({ insights, building }: { insights: CoachInsight[]; building?: boolean }) {
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
            <li key={i.id} className={`hc-coach-item is-${i.tone}`}>
              <span className="hc-coach-icon" aria-hidden>{ICON[i.category]}</span>
              <div>
                <strong>{i.title}</strong>
                <p>{i.detail}</p>
                {i.tip && <p className="hc-coach-tip"><span aria-hidden>→ </span>{i.tip}</p>}
                <small>Based on {i.evidence}</small>
              </div>
            </li>
          ))}
        </ul>
      )}
      {insights.length > SHOWN && (
        <button type="button" className="workout-text-btn" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show ${insights.length - SHOWN} more`}</button>
      )}
    </section>
  );
}

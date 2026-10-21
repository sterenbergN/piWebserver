'use client';

import './health.css';
import type { Readiness } from '@/lib/workout/health-insights';

/**
 * Today's recovery: a headline, what to do about it, and the sleep / resting
 * HR / HRV readings behind it compared with your usual. On a low day it can
 * lower today's starting intensity.
 */
export default function ReadinessCard({ readiness, compact = false, todayIntensity, onUseIntensity, footer }: {
  readiness: Readiness;
  compact?: boolean;
  /** An intensity already chosen for today (from this card). */
  todayIntensity?: number | null;
  onUseIntensity?: (value: number | null) => void;
  footer?: React.ReactNode;
}) {
  const { level, title, advice, factors, suggestedIntensity } = readiness;
  return (
    <section className={`hc-ready is-${level}${compact ? ' is-compact' : ''}`} aria-label="Today's readiness">
      <div className="hc-ready-head">
        <span className="hc-ready-kicker"><span className="hc-dot" aria-hidden /> Today&apos;s readiness</span>
        <strong className="hc-ready-title">{title}</strong>
        <p className="hc-ready-advice">{advice}</p>
      </div>
      <div className="hc-ready-factors">
        {factors.map((f) => (
          <div key={f.key} className={`hc-factor is-${f.tone}`}>
            <span className="hc-factor-label">{f.label}</span>
            <strong className="hc-factor-value">{f.value}</strong>
            <span className="hc-factor-note">{f.note}</span>
            <span className="hc-factor-usual">usual {f.typical}</span>
          </div>
        ))}
      </div>
      {onUseIntensity && suggestedIntensity !== null && (
        todayIntensity === suggestedIntensity ? (
          <div className="hc-ready-action is-set">
            <span>✓ Today starts at intensity {suggestedIntensity.toFixed(2)}</span>
            <button type="button" className="workout-text-btn" onClick={() => onUseIntensity(null)}>Undo</button>
          </div>
        ) : (
          <button type="button" className="workout-button is-block hc-ready-action" onClick={() => onUseIntensity(suggestedIntensity)}>
            Start today at intensity {suggestedIntensity.toFixed(2)}
          </button>
        )
      )}
      {footer}
    </section>
  );
}

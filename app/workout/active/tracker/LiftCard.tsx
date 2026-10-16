'use client';

import { useState, type ReactNode } from 'react';
import IntensitySlider from '@/components/workout/IntensitySlider';
import { formatClock, type Suggestion } from '@/lib/workout/tracker-utils';
import RestTimer from './RestTimer';
import { photoUrl } from '@/components/workout/StationPhoto';
import type { useRestTimer } from './hooks';

// Performance score colour: green = too easy, yellow = about right, red = struggled.
function scoreColor(score: number) {
  if (score > 1.05) return 'var(--success)';
  if (score >= 0.95) return '#ecc94b';
  return 'var(--danger)';
}

type LiftCardProps = {
  lift: any;
  index: number;
  count: number;
  compact: boolean;
  /** Logged in and the lift's equipment is known, so ✏️ / ⚙️ can edit it. */
  canEdit: boolean;
  onEdit: (target: 'lift' | 'station') => void;
  plateau: boolean;
  onSwap: () => void;
  onHistory: () => void;
  onSuperset: () => void;
  /** Superset partner still to do, if any. */
  partner: { name: string; logged: number; target: number; upNext: boolean; onSwitch: () => void } | null;
  target: { loading: boolean; weight: number; reps: number; sets: number };
  deviated: boolean;
  onReset: () => void;
  suggestion?: Suggestion;
  calibrationNote: string;
  liftSecs: number;
  workoutSecs: number;
  intensity: number;
  onIntensity: (value: number) => void;
  rest: ReturnType<typeof useRestTimer>;
  /** Extra line under the title, e.g. progress toward a goal. */
  extra?: ReactNode;
};

/** The lift you're on: what and where, today's target, details and the rest timer. */
export default function LiftCard(props: LiftCardProps) {
  const { lift, index, count, compact, canEdit, onEdit, plateau, partner, target, suggestion, rest } = props;
  const [showDetails, setShowDetails] = useState(false);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const breakdown = suggestion?.breakdown;
  const metrics = suggestion?.metrics;
  const historic = suggestion?.historicStats;

  return (
    <div className={`tracker-summary-card${compact ? ' compact' : ''}`} style={{ textAlign: 'center', marginBottom: compact ? '0.6rem' : '1rem' }}>
      <p style={{ color: 'var(--accent)', textTransform: 'uppercase', fontWeight: 700, fontSize: compact ? '0.72rem' : '0.8rem', letterSpacing: compact ? '1px' : '2px', margin: '0 0 0.35rem 0' }}>
        {canEdit ? (
          <button type="button" className="tracker-station-link" title="Edit this equipment's weights and lifts" onClick={() => onEdit('station')}>
            {lift.station?.name || 'Equipment'} <span aria-hidden>⚙️</span>
          </button>
        ) : (lift.station?.name || 'Equipment')} • Lift {index + 1}/{count}
      </p>
      {lift.station?.photo && (
        <img className="tracker-station-photo" src={photoUrl(lift.station.photo)} alt={`${lift.station.name}`} />
      )}
      <h1 style={{ fontSize: compact ? '1.38rem' : '2rem', margin: '0 0 0.35rem 0', lineHeight: 1.1 }}>
        {lift.name}
        {canEdit && <button type="button" className="tracker-title-edit" aria-label={`Edit ${lift.name}`} title="Edit lift details" onClick={() => onEdit('lift')}>✏️</button>}
      </h1>
      {plateau && (
        <p style={{ fontSize: '0.75rem', color: 'var(--warning)', margin: '0 0 0.4rem' }}>
          ⚠️ Plateau: no new best in 3 sessions. Try fewer reps at a heavier weight, or{' '}
          <button className="workout-text-btn" style={{ fontSize: '0.75rem', textDecoration: 'underline' }} onClick={props.onSwap}>swap to a variation</button>.
        </p>
      )}
      {lift.notes ? (
        canEdit
          ? <button type="button" className="workout-text-btn workout-hint" style={{ margin: '-0.15rem 0 0.4rem' }} onClick={() => onEdit('lift')}>📝 {lift.notes}</button>
          : <p className="workout-hint" style={{ margin: '-0.15rem 0 0.4rem' }}>📝 {lift.notes}</p>
      ) : canEdit && (
        <button type="button" className="workout-text-btn workout-hint" style={{ margin: '-0.15rem 0 0.4rem' }} onClick={() => onEdit('lift')}>+ Setup note (seat, pin, grip…)</button>
      )}
      {props.extra}
      <div className="tracker-chip-row">
        <button type="button" className="tracker-chip" onClick={props.onSwap}>Change 🔄</button>
        <button type="button" className="tracker-chip" onClick={props.onHistory}>History 📈</button>
        <button type="button" className={`tracker-chip${lift.supersetId ? ' is-on' : ''}`} onClick={props.onSuperset}>{lift.supersetId ? 'Superset ✓' : 'Superset'}</button>
      </div>

      {partner && (
        <div className="tracker-superset">
          <div style={{ minWidth: 0, textAlign: 'left' }}>
            <div style={{ fontSize: '0.65rem', color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '1px' }}>Superset partner</div>
            <div style={{ fontWeight: 700, fontSize: compact ? '0.82rem' : '0.92rem' }}>{partner.name}</div>
            <div style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>
              {partner.logged}/{partner.target} sets logged{partner.upNext ? ' • up next after this set' : ''}
            </div>
          </div>
          <button className="btn btn-secondary" style={{ padding: '0.35rem 0.7rem', fontSize: '0.75rem', borderRadius: '999px', flexShrink: 0 }} onClick={partner.onSwitch}>Switch</button>
        </div>
      )}

      {/* Today's target in one line; the why, calibration and intensity sit under Details. */}
      <div className="tracker-target">
        <div style={{ minWidth: 0, textAlign: 'left' }}>
          <span className="tracker-target-label">Target</span>
          <strong>{target.loading ? 'Calculating…' : `${target.weight} lbs × ${target.reps} × ${target.sets} sets`}</strong>
        </div>
        <button type="button" className="tracker-target-toggle" aria-expanded={showDetails} onClick={() => setShowDetails((value) => !value)}>
          {showDetails ? 'Hide' : 'Details'} <span aria-hidden style={{ display: 'inline-block', transform: showDetails ? 'rotate(180deg)' : 'none' }}>▾</span>
        </button>
      </div>
      {props.deviated && (
        <p className="workout-hint" style={{ margin: '0.35rem 0 0' }}>
          Using your own numbers ·{' '}
          <button type="button" className="workout-text-btn" style={{ fontSize: 'inherit', textDecoration: 'underline' }} onClick={props.onReset}>back to target</button>
        </p>
      )}

      {showDetails && (
        <div className="tracker-details animate-fade-in">
          {suggestion?.reason && <div style={{ color: 'var(--accent)' }}>💡 {suggestion.reason}</div>}
          {props.calibrationNote && <div>{props.calibrationNote}</div>}
          {historic && (
            <div>Best last time: <strong>{historic.prevWeight} lbs × {historic.prevReps}</strong> ({historic.prevSets} sets) · est. 1RM <strong>{historic.est1RM} lbs</strong></div>
          )}
          <div>This lift {formatClock(props.liftSecs)} · workout {formatClock(props.workoutSecs)}</div>
          {breakdown && (
            <button type="button" className="workout-text-btn" style={{ fontSize: '0.7rem', textDecoration: 'underline', alignSelf: 'flex-start' }} onClick={() => setShowBreakdown(!showBreakdown)}>
              {showBreakdown ? 'Hide scoring' : 'How this was picked'}
            </button>
          )}
          {showBreakdown && breakdown && (
            <div style={{ padding: '0.5rem', background: 'rgba(0,0,0,0.15)', borderRadius: '8px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0.3rem 1rem' }}>
                <div>Overload: <strong style={{ color: breakdown.overloadRatio >= 1 ? 'var(--success)' : 'var(--danger)' }}>{((breakdown.overloadRatio - 1) * 100).toFixed(1)}%</strong></div>
                <div>e1RM: <strong>{Math.round(breakdown.e1RM)} lbs</strong></div>
                <div>Load: <strong>{Math.round(breakdown.totalLoad).toLocaleString()}</strong></div>
                <div>Candidates: <strong>{suggestion?.candidates || 0}</strong></div>
              </div>
              {metrics && (
                <div style={{ marginTop: '0.35rem' }}>
                  Performance: <strong style={{ color: scoreColor(metrics.performanceScore) }}>{metrics.performanceScore.toFixed(2)}</strong>{' '}
                  ({metrics.performanceScore > 1.05 ? 'too easy' : metrics.performanceScore < 0.95 ? 'too hard' : 'about right'})
                </div>
              )}
              {breakdown.performanceAdjustment && <div style={{ marginTop: '0.3rem', fontStyle: 'italic' }}>{breakdown.performanceAdjustment}</div>}
            </div>
          )}
          <div style={{ padding: '0.5rem 0.8rem', background: 'rgba(0,0,0,0.1)', borderRadius: '10px' }}>
            <IntensitySlider value={props.intensity} onChange={props.onIntensity} />
          </div>
        </div>
      )}

      <RestTimer rest={rest} />
    </div>
  );
}

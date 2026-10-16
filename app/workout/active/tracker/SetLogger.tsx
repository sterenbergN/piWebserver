'use client';

import PlateDiagram from '@/components/workout/PlateDiagram';
import StepperInput from '@/components/workout/StepperInput';
import { RIR_OPTIONS, rirLabel } from '@/components/workout/SetEditSheet';
import type { LoggedSet, WarmupSet } from '@/lib/workout/tracker-utils';

const sameSet = (a: WarmupSet, b: WarmupSet) => a.weight === b.weight && a.reps === b.reps;

type SetLoggerProps = {
  compact: boolean;
  sets: LoggedSet[];
  onEditSet: (index: number) => void;
  /** Suggested warm-up ramp for today's working weight. */
  warmups: WarmupSet[];
  warmupsDone: WarmupSet[];
  onToggleWarmup: (set: WarmupSet) => void;
  /** Last session on this lift (or exercise) and where it was. */
  lastTime: { sets: LoggedSet[]; date?: string; where?: string } | null;
  liftDone: boolean;
  nextLiftName: string | null;
  onNextUnfinished: () => void;
  onFinish: () => void;
  weight: number;
  reps: number;
  onWeight: (value: number) => void;
  onReps: (value: number) => void;
  onStepWeight: (direction: 1 | -1) => void;
  onLog: (rir: number) => void;
  canPrev: boolean;
  onPrev: () => void;
  hasNext: boolean;
  onNext: () => void;
  plates: { bar: number; plates: number[] | null } | null;
};

/** Sets done so far, the weight × reps for the next one, and the one-tap log buttons. */
export default function SetLogger(props: SetLoggerProps) {
  const { compact, sets, warmups, warmupsDone, lastTime, liftDone, weight } = props;
  const warmupsTicked = warmupsDone.length;

  return (
    <>
      <div className="workout-tile" style={{ background: 'rgba(0,0,0,0.1)', padding: compact ? '0.65rem' : undefined }}>
        {sets.length === 0 ? (warmups.length > 0 && (
          <div style={{ textAlign: 'center', marginBottom: '0.6rem' }}>
            <span className="workout-hint">Warm-up — tap each one as you do it</span>
            <div className="tracker-warmups">
              {warmups.map((w) => {
                const done = warmupsDone.some((d) => sameSet(d, w));
                return (
                  <button key={`${w.weight}x${w.reps}`} type="button" className="tracker-warmup" aria-pressed={done} onClick={() => props.onToggleWarmup(w)}>
                    {done ? '✓ ' : ''}{w.weight}×{w.reps}
                  </button>
                );
              })}
            </div>
          </div>
        )) : warmupsTicked > 0 && (
          <p className="workout-hint" style={{ textAlign: 'center', margin: '0 0 0.5rem' }}>✓ Warmed up ({warmupsTicked} set{warmupsTicked === 1 ? '' : 's'})</p>
        )}

        {sets.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', marginBottom: compact ? '0.6rem' : '0.75rem' }}>
            {sets.map((set, i) => (
              <button key={set.timestamp ?? i} type="button" className="tracker-set-row animate-fade-in" aria-label={`Edit set ${i + 1}`} onClick={() => props.onEditSet(i)}>
                <strong style={{ color: 'var(--accent)' }}>Set {i + 1}</strong>
                <span>{set.weight} lbs × {set.reps}{typeof set.rir === 'number' ? ` • RIR ${rirLabel(set.rir)}` : ''}</span>
                <span aria-hidden style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>✏️</span>
              </button>
            ))}
          </div>
        ) : warmups.length === 0 && (
          <p style={{ color: 'var(--muted)', fontSize: '0.9rem', margin: '0 0 0.9rem', textAlign: 'center' }}>No sets logged yet.</p>
        )}
        {lastTime && lastTime.sets.length > 0 && (
          <p className="workout-hint" style={{ textAlign: 'center', margin: '0 0 0.75rem' }}>
            Last time ({[lastTime.date, lastTime.where].filter(Boolean).join(', ')}): {lastTime.sets.map((s) => `${s.weight}×${s.reps}`).join(' · ')}
          </p>
        )}

        {liftDone && (
          <div className="tracker-done animate-fade-in">
            <strong>✓ All {sets.length} sets done</strong>
            {props.nextLiftName !== null ? (
              <button type="button" className="workout-btn-primary" style={{ margin: '0.5rem 0 0' }} onClick={props.onNextUnfinished}>Next: {props.nextLiftName} →</button>
            ) : (
              <button type="button" className="workout-btn-primary" style={{ margin: '0.5rem 0 0', background: 'var(--success)' }} onClick={props.onFinish}>Finish workout 🏆</button>
            )}
            <span className="workout-hint" style={{ display: 'block', marginTop: '0.4rem' }}>Or log an extra set below.</span>
          </div>
        )}

        <div className="tracker-steppers">
          <StepperInput label="Weight (lbs)" decimal value={weight} onChange={props.onWeight} onStep={props.onStepWeight} />
          <StepperInput label="Reps" value={props.reps} onChange={props.onReps} onStep={(d) => props.onReps(Math.max(0, props.reps + d))} />
        </div>
        <div style={{ marginTop: '0.8rem' }}>
          <p style={{ fontSize: '0.8rem', fontWeight: 700, textAlign: 'center', margin: '0 0 0.1rem' }}>
            {liftDone ? 'Log an extra set' : `Log set ${sets.length + 1}`} — tap how many more reps you had left
          </p>
          <p className="workout-hint" style={{ textAlign: 'center', margin: '0 0 0.4rem' }}>0 = couldn&apos;t do another rep</p>
          <div className="tracker-log-grid">
            {RIR_OPTIONS.map((rir) => (
              <button key={rir} type="button" className="tracker-log-btn" aria-label={`Log set with ${rirLabel(rir)} reps in reserve`} onClick={() => props.onLog(rir)}>
                {rirLabel(rir)}
                {rir === 0 && <small>failure</small>}
                {rir === 5 && <small>easy</small>}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
          {props.canPrev && (
            <button className="btn btn-secondary" style={{ flex: 1, padding: compact ? '0.7rem' : '0.9rem', borderRadius: '12px' }} onClick={props.onPrev}>Prev</button>
          )}
          {liftDone ? null : props.hasNext ? (
            <button className="btn btn-secondary" style={{ flex: 1, padding: compact ? '0.7rem' : '0.9rem', borderRadius: '12px' }} onClick={props.onNext}>Next Lift →</button>
          ) : (
            <button className="workout-btn-primary" style={{ flex: 1, margin: 0, padding: compact ? '0.7rem' : '0.9rem', background: 'var(--success)', boxShadow: '0 4px 15px rgba(var(--success-rgb), 0.3)' }} onClick={props.onFinish}>Finish 🏆</button>
          )}
        </div>
      </div>

      {props.plates && props.plates.plates === null && (
        <p className="animate-fade-in" style={{ textAlign: 'center', marginTop: '1.5rem', fontSize: '0.85rem', color: 'var(--warning)' }}>
          {weight} lbs can&apos;t be loaded exactly with this station&apos;s plates.
        </p>
      )}
      {props.plates && props.plates.plates && props.plates.plates.length > 0 && (
        <PlateDiagram plates={props.plates.plates} barWeight={props.plates.bar} totalWeight={weight} />
      )}
    </>
  );
}

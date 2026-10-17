'use client';

import { useMemo, useState } from 'react';
import { findPreviousSameType, workoutVolume } from '@/lib/workout/session-insights';
import { compareWithLastTime, formatClock, sessionVerdict, workoutTotals, type LoggedSet } from '@/lib/workout/tracker-utils';
import { shareWorkoutCard } from '@/lib/workout/share-card';
import { createWorkoutLink, shareLink } from '@/lib/workout/share-link';
import { rirLabel } from '@/components/workout/SetEditSheet';

type PR = { name: string; e1rm: number; previous: number; weight: number; reps: number };

type FinishScreenProps = {
  plan: any;
  logs: Record<string, LoggedSet[]>;
  pastHistory: any[];
  elapsedSecs: number;
  calories: number;
  prs: Record<string, PR>;
  /** Goals reached today, e.g. "Bench Press 225 × 1". */
  goalsHit: string[];
  canSaveTemplate: boolean;
  templateState: 'idle' | 'saving' | 'saved' | 'error';
  onSaveTemplate: () => void;
  saving: boolean;
  saveError: string;
  onSave: () => void;
  onBack: () => void;
  /** The save payload, for a link someone else can do this workout from (logged-in, own gym only). */
  getLinkPayload?: () => unknown;
};

const CHANGE_ICON = { up: '▲', down: '▼', same: '=', new: '★' } as const;

/** End of workout: how it went against last time, PRs, share card, save. */
export default function FinishScreen(props: FinishScreenProps) {
  const { plan, logs, pastHistory, elapsedSecs, prs } = props;
  const [shareState, setShareState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const [linkState, setLinkState] = useState<'idle' | 'busy' | 'shared' | 'copied' | 'error'>('idle');
  const [linkError, setLinkError] = useState('');
  const comparisons = useMemo(() => compareWithLastTime(plan, logs, pastHistory), [plan, logs, pastHistory]);
  const { volume, sets } = workoutTotals(logs);
  const prList = Object.values(prs);
  const prNames = new Set(prList.map((pr) => pr.name));
  const previousSameType = findPreviousSameType(pastHistory, plan.type);
  const previousVolume = previousSameType ? (previousSameType.volume ?? workoutVolume(previousSameType.logs)) : 0;
  const volumeChange = previousVolume > 0 ? Math.round(((volume - previousVolume) / previousVolume) * 100) : null;
  const allSets = Object.values(logs).flat();
  const rirSets = allSets.filter((s) => typeof s.rir === 'number');
  const avgRir = rirSets.length ? rirSets.reduce((sum, s) => sum + (s.rir as number), 0) / rirSets.length : null;
  const verdict = sessionVerdict(comparisons, prList.length);

  const share = async () => {
    setShareState('busy');
    try {
      await shareWorkoutCard({
        title: plan.type?.name || plan.name,
        date: new Date(),
        gymName: plan.gymName,
        duration: formatClock(elapsedSecs),
        sets,
        volume,
        verdict,
        lifts: comparisons.map((c) => ({ name: c.name, top: `${c.top.weight}×${c.top.reps}`, change: c.change, changeText: c.changeText, pr: prNames.has(c.name) })),
      });
      setShareState('done');
    } catch {
      setShareState('error');
    }
  };

  const sendLink = async () => {
    if (!props.getLinkPayload) return;
    setLinkState('busy');
    setLinkError('');
    try {
      const url = await createWorkoutLink({ workout: props.getLinkPayload() });
      const result = await shareLink(url, `${plan.type?.name || 'Workout'} — do it with me`);
      setLinkState(result === 'cancelled' ? 'idle' : result);
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : 'Could not create the link');
      setLinkState('error');
    }
  };

  return (
    <div className="workout-tile animate-fade-in tracker-finish">
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '2.6rem', lineHeight: 1 }}>🏆</div>
        <h2 style={{ margin: '0.5rem 0 0.2rem' }}>Workout complete</h2>
        <p className="workout-hint" style={{ margin: 0 }}>{plan.name}</p>
        <p className="tracker-verdict">{verdict}</p>
      </div>

      <div className="tracker-finish-stats">
        <div><span>Time</span><strong>{formatClock(elapsedSecs)}</strong></div>
        <div><span>Sets</span><strong>{sets}</strong></div>
        <div>
          <span>Volume</span>
          <strong>{Math.round(volume).toLocaleString()}</strong>
          {volumeChange !== null && (
            <small style={{ color: volumeChange >= 0 ? 'var(--success)' : 'var(--warning)' }}>{volumeChange >= 0 ? '+' : ''}{volumeChange}% vs last {plan.type?.name || 'time'}</small>
          )}
        </div>
        <div>
          <span>Effort</span>
          <strong>{avgRir === null ? '—' : `RIR ${avgRir.toFixed(1)}`}</strong>
          <small>{props.calories} kcal</small>
        </div>
      </div>

      {(prList.length > 0 || props.goalsHit.length > 0) && (
        <div className="tracker-finish-prs">
          {prList.map((pr) => (
            <div key={pr.name} className="workout-flex-between" style={{ fontSize: '0.85rem', padding: '0.15rem 0', gap: '0.5rem' }}>
              <span>🏆 {pr.name} — {pr.weight} × {pr.reps}</span>
              <span style={{ color: 'var(--success)', flexShrink: 0 }}>+{Math.round(pr.e1rm - pr.previous)} lbs e1RM</span>
            </div>
          ))}
          {props.goalsHit.map((goal) => (
            <div key={goal} style={{ fontSize: '0.85rem', padding: '0.15rem 0' }}>🎯 Goal reached: {goal}</div>
          ))}
        </div>
      )}

      <div className="workout-section-title">Lift by lift</div>
      <div className="workout-stack" style={{ marginBottom: '1.25rem' }}>
        {comparisons.map((c) => (
          <div key={c.uid} className="tracker-finish-lift">
            <div className="workout-flex-between" style={{ gap: '0.5rem' }}>
              <strong style={{ minWidth: 0 }}>{prNames.has(c.name) ? '🏆 ' : ''}{c.name}</strong>
              <span className={`tracker-change is-${c.change}`}>{CHANGE_ICON[c.change]} {c.changeText}</span>
            </div>
            <div className="workout-hint">
              {c.sets.map((s) => `${s.weight}×${s.reps}${typeof s.rir === 'number' ? ` @${rirLabel(s.rir)}` : ''}`).join(' · ')}
              {c.previousTop && <> · last time best {c.previousTop.weight}×{c.previousTop.reps}</>}
            </div>
          </div>
        ))}
      </div>

      {props.saveError && <p className="workout-error" style={{ margin: '0 0 1rem' }}>{props.saveError}</p>}
      <button className="workout-btn-primary" style={{ padding: '1.1rem', fontSize: '1.15rem', opacity: props.saving ? 0.6 : 1, marginTop: 0 }} onClick={props.onSave} disabled={props.saving}>
        {props.saving ? 'Saving…' : 'Save & exit'}
      </button>
      <div className="workout-grid-2" style={{ marginTop: '0.6rem' }}>
        <button className="workout-button" onClick={share} disabled={shareState === 'busy'}>
          {shareState === 'busy' ? 'Drawing…' : shareState === 'done' ? '✅ Shared' : shareState === 'error' ? 'Try sharing again' : '📤 Share card'}
        </button>
        {props.canSaveTemplate ? (
          <button className="workout-button" onClick={props.onSaveTemplate} disabled={props.templateState === 'saving' || props.templateState === 'saved'}>
            {props.templateState === 'saved' ? '📌 Saved' : props.templateState === 'saving' ? 'Saving…' : props.templateState === 'error' ? 'Retry template' : '📌 Save as template'}
          </button>
        ) : <span />}
      </div>
      {props.getLinkPayload && (<>
        <button className="workout-button is-block" style={{ marginTop: '0.6rem' }} onClick={sendLink} disabled={linkState === 'busy'}>
          {linkState === 'busy' ? 'Making link…' : linkState === 'copied' ? '✅ Link copied' : linkState === 'shared' ? '✅ Link sent' : '🔗 Send this workout to a friend'}
        </button>
        <p className="workout-hint" style={{ margin: '0.3rem 0 0', textAlign: 'center' }}>{linkError || 'They get these lifts and this gym, with their own weights.'}</p>
      </>)}
      <button className="workout-button is-block" style={{ marginTop: '0.6rem' }} onClick={props.onBack} disabled={props.saving}>Back to workout</button>
    </div>
  );
}

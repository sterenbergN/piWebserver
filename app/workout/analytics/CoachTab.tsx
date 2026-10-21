'use client';

import { CoachItem } from '@/components/workout/health/CoachCard';
import type { CoachInsight } from '@/lib/workout/health-coach';
import type { CoachPending } from '@/lib/workout/training-coach';

type Props = {
  insights: CoachInsight[];
  pending: CoachPending[];
  /** Checks that ran and found nothing to change. */
  fine: string[];
  /** Workouts in the coach's 6-week window. */
  workouts: number;
  healthConnected: boolean;
};

const GROUPS: { tone: CoachInsight['tone']; title: string; blurb: string }[] = [
  { tone: 'warn', title: 'Work on these', blurb: 'The changes most likely to help, most important first.' },
  { tone: 'info', title: 'Worth knowing', blurb: '' },
  { tone: 'good', title: 'Going well', blurb: '' },
];

/**
 * The coach: what an experienced lifting partner would point out after
 * watching the last six weeks of training (and health data, if synced),
 * each with concrete steps — plus the checks still waiting for data.
 */
export default function CoachTab({ insights, pending, fine, workouts, healthConnected }: Props) {
  return (
    <div className="an-stack">
      <section className="workout-tile an-card an-coach-intro">
        <h2>Your coach</h2>
        <p className="workout-hint" style={{ margin: 0 }}>
          Read from your last 6 weeks ({workouts} workout{workouts === 1 ? '' : 's'}): how hard and how heavy you train, whether you add weight when lifts get easy,
          how long you rest, warm-ups and how your sets are spread across muscles{healthConnected ? ', plus sleep and recovery from Apple Health' : ''}.
          Each point only appears once there&apos;s enough data to back it up.
        </p>
      </section>

      {insights.length === 0 && (
        <section className="workout-tile an-card">
          <strong>{pending.length ? 'Still learning how you train' : 'No red flags'}</strong>
          <p className="workout-hint" style={{ margin: '0.25rem 0 0' }}>
            {pending.length ? 'Keep logging workouts (and tapping the reps-left number on each set). Advice shows up here as the checks below fill in.' : 'Effort, load, progression and rest all look right. Keep it up.'}
          </p>
        </section>
      )}

      {GROUPS.map((g) => {
        const list = insights.filter((i) => i.tone === g.tone);
        if (!list.length) return null;
        return (
          <section key={g.tone} className="workout-tile an-card">
            <div className="an-card-head"><h2>{g.title}</h2>{g.blurb && <span className="workout-hint">{list.length}</span>}</div>
            {g.blurb && <p className="workout-hint" style={{ margin: '-0.25rem 0 0.6rem' }}>{g.blurb}</p>}
            <ul className="hc-coach-list">{list.map((i) => <CoachItem key={i.id} insight={i} />)}</ul>
          </section>
        );
      })}

      {fine.length > 0 && (
        <section className="workout-tile an-card">
          <h2>Looks fine</h2>
          <p className="workout-hint" style={{ margin: 0 }}>Checked, nothing to change: {fine.join(' · ')}.</p>
        </section>
      )}

      {pending.length > 0 && (
        <section className="workout-tile an-card">
          <h2>Still learning</h2>
          <p className="workout-hint" style={{ margin: '-0.25rem 0 0.6rem' }}>These checks start once there&apos;s enough recent data.</p>
          <ul className="an-pending">
            {pending.map((p) => (
              <li key={p.area}>
                <div className="workout-flex-between" style={{ gap: '0.5rem' }}>
                  <strong>{p.area}</strong>
                  <span className="workout-hint">{Math.min(p.have, p.of)}/{p.of}</span>
                </div>
                <div className="an-pending-bar" role="meter" aria-valuemin={0} aria-valuemax={p.of} aria-valuenow={Math.min(p.have, p.of)} aria-label={p.area}>
                  <div style={{ width: `${Math.min(100, (p.have / p.of) * 100)}%` }} />
                </div>
                <span className="workout-hint">Needs {p.of} {p.need}</span>
              </li>
            ))}
          </ul>
          {!healthConnected && (
            <p className="workout-hint" style={{ margin: '0.6rem 0 0' }}>
              <a href="/workout/health" className="workout-text-btn" style={{ textDecoration: 'underline' }}>Connect Apple Health</a> to add sleep, recovery and Watch heart rate to the advice.
            </p>
          )}
        </section>
      )}
    </div>
  );
}

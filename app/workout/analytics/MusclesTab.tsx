'use client';

import type { MuscleGroupFatigue } from '@/lib/workout/analytics';
import type { BalancePair, MuscleWeek } from '@/lib/workout/insights';

type MusclesTabProps = {
  muscles: MuscleWeek[];
  balance: BalancePair[];
  weeklySetGoal: number;
  periodLabel: string;
  fatigue: MuscleGroupFatigue[];
  recovery: { muscle: string; lastTrained: string; hoursSince: number }[];
};

const FATIGUE_LABEL = {
  ok: { icon: '●', text: 'Fresh', tone: 'is-good' },
  elevated: { icon: '▲', text: 'Elevated', tone: 'is-warn' },
  deload_recommended: { icon: '!', text: 'Deload suggested', tone: 'is-bad' },
} as const;

function ago(hours: number) {
  if (hours < 24) return 'today';
  const days = Math.floor(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

/** Sets per muscle per week against your goal, balance between muscle groups, and recovery. */
export default function MusclesTab({ muscles, balance, weeklySetGoal, periodLabel, fatigue, recovery }: MusclesTabProps) {
  const scaleMax = Math.max(weeklySetGoal * 1.5, ...muscles.map((m) => m.perWeek));
  const goalPct = (weeklySetGoal / scaleMax) * 100;
  const recoveryByMuscle = new Map(recovery.map((r) => [r.muscle, r]));

  return (
    <div className="an-stack">
      <section className="workout-tile an-card">
        <div className="an-card-head">
          <h2>Sets per week</h2>
          <span className="workout-hint">avg over {periodLabel.toLowerCase()} · goal {weeklySetGoal}</span>
        </div>
        {muscles.length === 0 ? <p className="workout-hint">No working sets in this period.</p> : (
          <div className="an-muscles" role="list">
            {muscles.map((m) => {
              const status = m.perWeek >= weeklySetGoal ? 'At goal' : m.perWeek >= weeklySetGoal / 2 ? 'Building' : 'Low';
              return (
                <div key={m.muscle} className="an-muscle" role="listitem" title={`${m.muscle}: ${m.perWeek} sets/week (${m.total} sets total)`}>
                  <span className="an-muscle-name">{m.muscle}</span>
                  <span className="an-muscle-track">
                    <span className={`an-muscle-bar${m.perWeek >= weeklySetGoal ? ' is-met' : ''}`} style={{ width: `${Math.max(2, (m.perWeek / scaleMax) * 100)}%` }} />
                    <span className="an-muscle-goal" style={{ left: `${goalPct}%` }} aria-hidden />
                  </span>
                  <span className="an-muscle-value">{m.perWeek}<small> {status}</small></span>
                </div>
              );
            })}
          </div>
        )}
        <p className="workout-hint an-chart-note">A set counts fully for the lift&apos;s main muscle and half for its second one. The line marks your weekly goal (change it on the home page). Deload weeks aren&apos;t counted.</p>
      </section>

      {balance.length > 0 && (
        <section className="workout-tile an-card">
          <h2>Balance</h2>
          <div className="workout-stack">
            {balance.map((pair) => {
              const total = pair.leftSets + pair.rightSets || 1;
              return (
                <div key={pair.label} className="an-balance">
                  <div className="workout-flex-between" style={{ gap: '0.5rem' }}>
                    <strong>{pair.label}</strong>
                    <span className={`an-status ${pair.ok ? 'is-good' : 'is-warn'}`}>{pair.ok ? '● Balanced' : '▲ Check'}</span>
                  </div>
                  <div className="an-split" aria-hidden>
                    <span style={{ width: `${(pair.leftSets / total) * 100}%` }} />
                    <span style={{ width: `${(pair.rightSets / total) * 100}%` }} />
                  </div>
                  <div className="workout-flex-between an-split-labels">
                    <span>{pair.left} {pair.leftSets}/wk</span>
                    <span>{pair.right} {pair.rightSets}/wk</span>
                  </div>
                  {!pair.ok && <span className="workout-hint">{pair.advice}</span>}
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="workout-tile an-card">
        <h2>Recovery</h2>
        {fatigue.length === 0 ? <p className="workout-hint">Train a couple of sessions and each muscle&apos;s fatigue shows up here.</p> : (
          <div className="workout-stack">
            {[...fatigue].sort((a, b) => b.fatigueScore / b.threshold - a.fatigueScore / a.threshold).map((f) => {
              const label = FATIGUE_LABEL[f.recommendation];
              const last = recoveryByMuscle.get(f.muscle);
              return (
                <div key={f.muscle} className="an-recovery">
                  <div className="workout-flex-between" style={{ gap: '0.5rem' }}>
                    <strong>{f.muscle}</strong>
                    <span className={`an-status ${label.tone}`}>{label.icon} {label.text}</span>
                  </div>
                  <div className="an-meter" role="meter" aria-valuemin={0} aria-valuemax={f.threshold} aria-valuenow={Math.round(f.fatigueScore)} aria-label={`${f.muscle} fatigue`}>
                    <div className={label.tone} style={{ width: `${Math.min(100, (f.fatigueScore / f.threshold) * 100)}%` }} />
                  </div>
                  <span className="workout-hint">Fatigue {Math.round(f.fatigueScore)} of {f.threshold}{last ? ` · last trained ${ago(last.hoursSince)}` : ''}</span>
                </div>
              );
            })}
          </div>
        )}
        <p className="workout-hint an-chart-note">Fatigue builds with hard sets and fades about 15% per rest day; past the line a deload is suggested on the home page.</p>
      </section>
    </div>
  );
}

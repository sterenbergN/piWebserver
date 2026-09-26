'use client';

import { useMemo } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatRelativeDay, liftSessions } from '@/lib/workout/session-insights';

type LiftHistorySheetProps = {
  liftId: string;
  liftName: string;
  history: any[];
  onClose: () => void;
};

const shortDate = (timestamp: string) =>
  new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/** Full-screen view of one lift's progress: e1RM trend, bests, and recent sessions. */
export default function LiftHistorySheet({ liftId, liftName, history, onClose }: LiftHistorySheetProps) {
  const sessions = useMemo(() => liftSessions(history, liftId, liftName), [history, liftId, liftName]);
  const chartData = sessions.map((session) => ({
    date: shortDate(session.timestamp),
    e1rm: Math.round(session.e1rm),
    top: `${session.topSet.weight} × ${session.topSet.reps}`,
  }));
  const best = sessions.reduce<(typeof sessions)[number] | null>((acc, s) => (!acc || s.e1rm > acc.e1rm ? s : acc), null);
  const first = sessions[0];
  const last = sessions[sessions.length - 1];
  const change = first && last && sessions.length > 1 ? Math.round(last.e1rm - first.e1rm) : null;
  const recent = [...sessions].reverse().slice(0, 8);

  return (
    <div className="workout-overlay animate-fade-in" style={{ zIndex: 130 }} role="dialog" aria-label={`${liftName} history`}>
      <div className="workout-overlay-header">
        <h2 style={{ fontSize: '1.3rem' }}>{liftName}</h2>
        <button className="workout-close-btn" aria-label="Close" onClick={onClose}>✕</button>
      </div>

      {sessions.length === 0 ? (
        <p style={{ color: 'var(--muted)' }}>No sessions logged for this lift yet. Its history will appear here after your first workout.</p>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '0.5rem', marginBottom: '1rem' }}>
            {[
              { label: 'Best e1RM', value: best ? `${Math.round(best.e1rm)}` : '—', sub: best ? `${best.topSet.weight} × ${best.topSet.reps}` : '' },
              { label: 'Sessions', value: String(sessions.length), sub: last ? formatRelativeDay(last.timestamp) : '' },
              { label: 'Change', value: change === null ? '—' : `${change >= 0 ? '+' : ''}${change}`, sub: 'since first' },
            ].map((stat) => (
              <div key={stat.label} style={{ background: 'var(--input-bg)', borderRadius: '12px', padding: '0.75rem 0.5rem', textAlign: 'center' }}>
                <div className="workout-hint" style={{ textTransform: 'uppercase', fontSize: '0.65rem' }}>{stat.label}</div>
                <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>{stat.value}</div>
                <div className="workout-hint">{stat.sub}</div>
              </div>
            ))}
          </div>

          {chartData.length > 1 && (
            <div className="workout-tile" style={{ padding: '1rem 0.5rem 0.5rem' }}>
              <h3 style={{ margin: '0 0 0.5rem 0.5rem', fontSize: '0.95rem' }}>Estimated 1RM (lbs)</h3>
              <div style={{ height: 200 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
                    <CartesianGrid stroke="var(--surface-border)" vertical={false} />
                    <XAxis dataKey="date" tick={{ fill: 'var(--muted)', fontSize: 11 }} tickLine={false} axisLine={{ stroke: 'var(--surface-border)' }} minTickGap={16} />
                    <YAxis tick={{ fill: 'var(--muted)', fontSize: 11 }} tickLine={false} axisLine={false} domain={['dataMin - 5', 'dataMax + 5']} allowDecimals={false} />
                    <Tooltip
                      cursor={{ stroke: 'var(--muted)', strokeDasharray: '3 3' }}
                      contentStyle={{ background: 'var(--background)', border: '1px solid var(--surface-border)', borderRadius: '10px', color: 'var(--foreground)', fontSize: '0.8rem' }}
                      formatter={(value, _name, item) => [`${value} lbs (top set ${item?.payload?.top})`, 'e1RM']}
                    />
                    <Line type="monotone" dataKey="e1rm" stroke="var(--accent)" strokeWidth={2} dot={{ r: 4, strokeWidth: 2, fill: 'var(--background)' }} activeDot={{ r: 5 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          <h3 style={{ fontSize: '0.95rem', margin: '1rem 0 0.5rem' }}>Recent sessions</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {recent.map((session) => (
              <div key={`${session.workoutId}-${session.timestamp}`} className="workout-list-row" style={{ alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{formatRelativeDay(session.timestamp)}</div>
                  <div className="workout-hint">{session.sets.map((set) => `${set.weight}×${set.reps}`).join(' · ')}</div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{Math.round(session.e1rm)}</div>
                  <div className="workout-hint">e1RM</div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

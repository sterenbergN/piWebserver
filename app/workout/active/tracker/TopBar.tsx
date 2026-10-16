'use client';

import { formatClock } from '@/lib/workout/tracker-utils';
import type { Peer } from './useSharedSession';

type TopBarProps = {
  name: string;
  elapsedSecs: number;
  compact: boolean;
  peer: Peer;
  live: boolean;
  onList: () => void;
  onAdd: () => void;
  onMenu: () => void;
};

/** Sticky header: workout name and time, partner status, List / ＋ / Menu. */
export default function TopBar({ name, elapsedSecs, compact, peer, live, onList, onAdd, onMenu }: TopBarProps) {
  const buttonPadding = compact ? '0.35rem 0.7rem' : '0.5rem 1rem';
  return (
    <div className={`workout-tile tracker-topbar${compact ? ' tracker-topbar-compact' : ''}`}>
      {peer && <PartnerStatus peer={peer} live={live} />}
      <div className="workout-flex-between tracker-topbar-row">
        <div>
          <h2 style={{ fontSize: compact ? '1.02rem' : '1.2rem', margin: '0 0 0.2rem 0' }}>{name}</h2>
          <p style={{ margin: 0, fontSize: compact ? '0.75rem' : '0.85rem', color: 'var(--muted)' }}>{formatClock(elapsedSecs)}</p>
        </div>
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          <button className="btn btn-secondary tracker-topbar-action" style={{ padding: buttonPadding }} onClick={onList}>List</button>
          <button className="btn btn-secondary tracker-topbar-action" aria-label="Add an exercise" title="Add an exercise" style={{ padding: buttonPadding }} onClick={onAdd}>＋</button>
          <button className="btn btn-secondary tracker-topbar-action" style={{ padding: buttonPadding }} onClick={onMenu}>Menu</button>
        </div>
      </div>
    </div>
  );
}

/** What your partner is doing right now. */
function PartnerStatus({ peer, live }: { peer: NonNullable<Peer>; live: boolean }) {
  const p = peer.progress;
  const done = p.completedSets || 0;
  const total = p.totalSets || 0;
  const resting = p.restingSince ? Math.max(0, Math.floor((Date.now() - p.restingSince) / 1000)) : null;
  const status = p.status && p.status !== 'active'
    ? { paused: 'paused', finished: 'finished 🏆', deleted: 'left the session' }[p.status]
    : resting !== null && resting < 15 * 60 ? `resting ${formatClock(resting)}`
    : p.currentWeight !== undefined ? `up next ${p.currentWeight}×${p.currentReps}` : 'starting';
  return (
    <div className="tracker-partner animate-fade-in">
      <div className="workout-flex-between" style={{ gap: '0.5rem', fontSize: '0.74rem' }}>
        <span style={{ minWidth: 0 }}>
          <span className={`tracker-live-dot${live ? ' is-live' : ''}`} title={live ? 'Live' : 'Reconnecting…'} aria-hidden />
          <strong>{peer.username}</strong> · {p.currentLiftName || 'Getting started'} · {status}
        </span>
        <strong style={{ flexShrink: 0 }}>{done}/{total}</strong>
      </div>
      {p.lastSet && (
        <div style={{ fontSize: '0.68rem', color: 'var(--muted)', margin: '0.15rem 0 0.25rem' }}>
          Last set {p.lastSet.liftName ? `${p.lastSet.liftName} ` : ''}{p.lastSet.weight}×{p.lastSet.reps} · {Math.max(0, Math.round((Date.now() - p.lastSet.at) / 60000))}m ago
        </div>
      )}
      <div className="tracker-partner-bar"><div style={{ width: `${total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0}%` }} /></div>
    </div>
  );
}

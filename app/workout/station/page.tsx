'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { Gym, Lift, Station } from '@/lib/workout/types';
import { formatRelativeDay, liftSessions } from '@/lib/workout/session-insights';
import { describeLift } from '@/components/workout/LiftForm';
import { hasPendingWorkout, queueLiftsForWorkout } from '@/lib/workout/station-link';

function equipmentSummary(station: Station) {
  switch (station.type) {
    case 'plates': return `Bar ${station.baseWeight ?? 45} lb · plates ${(station.plateSets || []).join(', ') || '—'}`;
    case 'stack':
    case 'cable': return `${station.minWeight ?? '?'}–${station.maxWeight ?? '?'} lb in ${station.increment ?? '?'} lb steps${station.attachments?.length ? ` · ${station.attachments.join(', ')}` : ''}`;
    case 'dumbbells': {
      const pairs = station.dumbbellPairs || [];
      return pairs.length ? `Dumbbells ${Math.min(...pairs)}–${Math.max(...pairs)} lb` : 'Dumbbells';
    }
    default: return 'Bodyweight';
  }
}

/** Landing page for a station's QR sticker: its lifts, your numbers, and a quick add. */
export default function StationPage() {
  const [ids, setIds] = useState<{ gym: string; station: string } | null>(null);
  const [gym, setGym] = useState<Gym | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [userId, setUserId] = useState<string | undefined>();
  const [status, setStatus] = useState<'loading' | 'ready' | 'login' | 'missing'>('loading');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setIds({ gym: params.get('gym') || '', station: params.get('station') || '' });
  }, []);

  useEffect(() => {
    if (!ids) return;
    (async () => {
      const auth = await fetch('/api/workout/auth').then((r) => r.json()).catch(() => ({}));
      if (!auth.authenticated) { setStatus('login'); return; }
      setUserId(auth.user?.id);
      setPending(hasPendingWorkout(auth.user?.id));
      const [gyms, hist] = await Promise.all([
        fetch('/api/workout/gyms?scope=all').then((r) => r.json()).catch(() => ({})),
        fetch('/api/workout/history').then((r) => r.json()).catch(() => ({})),
      ]);
      const found = (gyms.gyms || []).find((g: Gym) => g.id === ids.gym) || null;
      setGym(found);
      setHistory(hist.history || []);
      setStatus(found?.stations.some((s: Station) => s.id === ids.station) ? 'ready' : 'missing');
    })();
  }, [ids]);

  const station = gym?.stations.find((s) => s.id === ids?.station) || null;
  const stats = useMemo(() => {
    const out: Record<string, { last?: string; best?: string }> = {};
    for (const lift of station?.lifts || []) {
      const sessions = liftSessions(history, lift.id, lift.name);
      if (sessions.length === 0) continue;
      const latest = [...sessions].sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0];
      const best = sessions.reduce((a, b) => (b.e1rm > a.e1rm ? b : a));
      out[lift.id] = {
        last: `${latest.topSet.weight} × ${latest.topSet.reps} · ${formatRelativeDay(latest.timestamp)}`,
        best: `${best.topSet.weight} × ${best.topSet.reps} (e1RM ${Math.round(best.e1rm)})`,
      };
    }
    return out;
  }, [station, history]);

  if (status === 'loading') return <p style={{ color: 'var(--muted)', padding: '2rem 0' }}>Loading station…</p>;
  if (status === 'login') return (
    <div className="workout-tile" style={{ textAlign: 'center' }}>
      <h2 style={{ marginTop: 0 }}>Log in to see this station</h2>
      <Link className="workout-btn-primary" href="/workout" style={{ display: 'block', textDecoration: 'none' }}>Open Workout</Link>
    </div>
  );
  if (status === 'missing' || !gym || !station) return (
    <div className="workout-tile" style={{ textAlign: 'center' }}>
      <h2 style={{ marginTop: 0 }}>Station not found</h2>
      <p style={{ color: 'var(--muted)' }}>It may have been removed, or the gym isn&apos;t shared with you.</p>
      <Link className="btn btn-secondary" href="/workout">Back to Workout</Link>
    </div>
  );

  const own = gym.ownerId === userId;
  const toggle = (id: string) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const addToWorkout = () => {
    const lifts = station.lifts.filter((l: Lift) => picked.has(l.id));
    queueLiftsForWorkout(lifts.map((lift) => ({ lift: { ...lift }, station: { ...station, lifts: [] }, gymId: gym.id, gymName: gym.name })));
    window.location.href = '/workout/active?resume=true';
  };

  return (
    <div className="animate-fade-in" style={{ paddingBottom: '3rem' }}>
      <Link href="/workout" style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>← Workout</Link>
      <div className="workout-tile" style={{ marginTop: '0.75rem' }}>
        <div className="workout-hint">{gym.emoji} {gym.name}</div>
        <h1 style={{ margin: '0.2rem 0', fontSize: '1.5rem' }}>{station.name}</h1>
        <span className="workout-pill">{station.type}</span>
        <p className="workout-hint" style={{ marginTop: '0.6rem' }}>{equipmentSummary(station)}</p>
      </div>

      {station.lifts.length === 0 && <p className="workout-hint">No lifts are set up on this station yet.</p>}
      {station.lifts.map((lift) => (
        <label key={lift.id} className="workout-tile" style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start', cursor: pending ? 'pointer' : 'default', padding: '1rem' }}>
          {pending && <input type="checkbox" checked={picked.has(lift.id)} onChange={() => toggle(lift.id)} style={{ marginTop: '0.3rem', width: 20, height: 20 }} />}
          <div style={{ flex: 1 }}>
            <strong>{lift.name}</strong>
            <div className="workout-hint">{describeLift(lift)}</div>
            {lift.notes && <div style={{ fontSize: '0.85rem', marginTop: '0.3rem' }}>📝 {lift.notes}</div>}
            {stats[lift.id] ? (
              <div style={{ fontSize: '0.8rem', marginTop: '0.4rem', display: 'grid', gap: '0.15rem' }}>
                <span>Last: <strong>{stats[lift.id].last}</strong></span>
                <span>Best: <strong>{stats[lift.id].best}</strong></span>
              </div>
            ) : <div className="workout-hint" style={{ marginTop: '0.3rem' }}>Not logged yet</div>}
          </div>
        </label>
      ))}

      {pending ? (
        <button className="workout-btn-primary" disabled={picked.size === 0} onClick={addToWorkout}>
          {picked.size ? `Add ${picked.size} to my workout` : 'Pick lifts to add to your workout'}
        </button>
      ) : (
        <Link href="/workout" className="workout-btn-primary" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>Start a workout</Link>
      )}
      {own && (
        <Link href={`/workout/config?gym=${encodeURIComponent(gym.id)}`} className="btn btn-secondary" style={{ display: 'block', textAlign: 'center', marginTop: '0.75rem' }}>
          Edit this station
        </Link>
      )}
    </div>
  );
}

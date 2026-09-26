'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { Station } from '@/lib/workout/types';
import { newRecordId } from '@/lib/workout/stations';

type SharedGym = { name: string; emoji: string; stations: Station[] };

/** Preview a gym someone shared by link and import a copy of it. */
export default function SharedGymPage() {
  const [gym, setGym] = useState<SharedGym | null>(null);
  const [message, setMessage] = useState('');
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'login' | 'imported'>('loading');

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('token') || '';
    fetch(`/api/workout/gyms/share?token=${encodeURIComponent(token)}`).then(async (r) => {
      const d = await r.json().catch(() => ({}));
      if (r.status === 401) { setState('login'); return; }
      if (!d.success) { setMessage(d.message || 'This link does not work any more.'); setState('error'); return; }
      setGym(d.gym);
      setState('ready');
    }).catch(() => { setMessage('Could not load the shared gym.'); setState('error'); });
  }, []);

  const importGym = async () => {
    if (!gym) return;
    // Fresh ids so the copy is fully independent of the original.
    const stations = gym.stations.map((s) => ({ ...s, id: newRecordId(), lifts: (s.lifts || []).map((l) => ({ ...l, id: newRecordId() })) }));
    const res = await fetch('/api/workout/gyms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: gym.name, emoji: gym.emoji, stations, isPublic: false }),
    });
    const d = await res.json().catch(() => ({}));
    if (d.success) { setState('imported'); setMessage(d.gym.id); } else { setMessage(d.message || 'Import failed'); setState('error'); }
  };

  if (state === 'loading') return <p style={{ color: 'var(--muted)' }}>Opening shared gym…</p>;
  if (state === 'login') return (
    <div className="workout-tile" style={{ textAlign: 'center' }}>
      <h2 style={{ marginTop: 0 }}>Log in to import this gym</h2>
      <p className="workout-hint">Then open the link again.</p>
      <Link className="workout-btn-primary" href="/workout" style={{ display: 'block', textDecoration: 'none' }}>Open Workout</Link>
    </div>
  );
  if (state === 'error' || !gym) return (
    <div className="workout-tile" style={{ textAlign: 'center' }}>
      <h2 style={{ marginTop: 0 }}>Link unavailable</h2>
      <p className="workout-hint">{message}</p>
      <Link className="btn btn-secondary" href="/workout">Back to Workout</Link>
    </div>
  );

  const liftCount = gym.stations.reduce((n, s) => n + (s.lifts?.length || 0), 0);
  return (
    <div className="animate-fade-in" style={{ paddingBottom: '3rem' }}>
      <div className="workout-tile">
        <div className="workout-hint">Shared with you</div>
        <h1 style={{ margin: '0.2rem 0', fontSize: '1.5rem' }}>{gym.emoji} {gym.name}</h1>
        <p className="workout-hint">{gym.stations.length} stations · {liftCount} lifts</p>
      </div>
      {gym.stations.map((s) => (
        <div key={s.id} className="workout-list-row" style={{ marginBottom: '0.5rem', flexDirection: 'column', alignItems: 'flex-start' }}>
          <strong>{s.name} <span className="workout-pill">{s.type}</span></strong>
          <span className="workout-hint">{(s.lifts || []).map((l) => l.name).join(', ') || 'No lifts'}</span>
        </div>
      ))}
      {state === 'imported' ? (
        <Link className="workout-btn-primary" href={`/workout/config?gym=${encodeURIComponent(message)}`} style={{ display: 'block', textAlign: 'center', textDecoration: 'none', marginTop: '1rem' }}>
          ✅ Imported — open it
        </Link>
      ) : (
        <button className="workout-btn-primary" style={{ marginTop: '1rem' }} onClick={importGym}>Import a copy</button>
      )}
    </div>
  );
}

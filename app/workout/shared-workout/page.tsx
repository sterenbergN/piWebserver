'use client';

import { useEffect, useMemo, useState } from 'react';
import PageHeader from '@/components/workout/PageHeader';
import { planFromShare, type SharedWorkout } from '@/lib/workout/workout-share';
import { shareLink } from '@/lib/workout/share-link';
import type { Gym } from '@/lib/workout/types';

type Loaded = {
  share: SharedWorkout;
  isOwner: boolean;
  imported: { gymId: string; name: string; emoji?: string; missing: { stations: number; lifts: number } } | null;
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * A workout someone shared by link: what they did, and a one-tap way to do it
 * yourself with your own weights — importing their gym the first time, or
 * reusing the copy you imported before.
 */
export default function SharedWorkoutPage() {
  const [state, setState] = useState<'loading' | 'login' | 'error' | 'ready'>('loading');
  const [message, setMessage] = useState('');
  const [data, setData] = useState<Loaded | null>(null);
  const [gyms, setGyms] = useState<Gym[]>([]);
  const [useGym, setUseGym] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState('');
  const token = typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('token') || '';

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('token') || '';
    Promise.all([
      fetch(`/api/workout/shared-workouts?token=${encodeURIComponent(t)}`).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) })),
      fetch('/api/workout/gyms').then((r) => r.json()).catch(() => ({})),
    ]).then(([res, gymRes]) => {
      if (res.status === 401) { setState('login'); return; }
      if (!res.body.success) { setMessage(res.body.message || 'This link does not work any more.'); setState('error'); return; }
      setData(res.body);
      if (gymRes.success) setGyms(gymRes.gyms || []);
      setState('ready');
    }).catch(() => { setMessage('Could not open the shared workout.'); setState('error'); });
  }, []);

  const preview = useMemo(() => {
    const gym = gyms.find((g) => g.id === useGym);
    return data && gym ? planFromShare(data.share, gym) : null;
  }, [data, gyms, useGym]);

  const go = (gymId?: string) => {
    const params = new URLSearchParams({ sharedWorkout: token });
    if (gymId) params.set('gym', gymId);
    window.location.href = `/workout/active?${params.toString()}`;
  };

  const importAndStart = async () => {
    setBusy(true);
    setMessage('');
    try {
      const res = await fetch('/api/workout/shared-workouts/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) throw new Error(body.message || 'Could not add the gym');
      go(body.gym.id);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not add the gym');
      setBusy(false);
    }
  };

  if (state === 'loading') return <p className="workout-hint" style={{ padding: '2rem 0', textAlign: 'center' }}>Opening shared workout…</p>;
  if (state === 'login') return (
    <div className="workout-tile" style={{ textAlign: 'center' }}>
      <h2 style={{ marginTop: 0 }}>Log in to open this workout</h2>
      <p className="workout-hint">You need a workout account to do it with your own weights. Then open the link again.</p>
      <a className="workout-button is-primary is-block" href="/workout?showLogin=1">Log in</a>
    </div>
  );
  if (state === 'error' || !data) return (
    <div className="workout-tile" style={{ textAlign: 'center' }}>
      <h2 style={{ marginTop: 0 }}>Link unavailable</h2>
      <p className="workout-hint">{message}</p>
      <a className="workout-button is-block" href="/workout">Back to Workout</a>
    </div>
  );

  const { share, isOwner, imported } = data;
  const stationName = (id: string) => share.gym.stations.find((s) => s.id === id)?.name || '';
  const when = new Date(share.timestamp).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  const totalSets = share.lifts.reduce((n, l) => n + l.sets.length, 0);

  return (
    <div className="animate-fade-in" style={{ paddingBottom: '3rem' }}>
      <PageHeader title={share.title} subtitle={`${isOwner ? 'Your workout' : `Shared by ${share.ownerName}`} · ${when}`} />

      <div className="workout-tile">
        <div className="workout-flex-between" style={{ gap: '0.5rem', marginBottom: '0.6rem' }}>
          <strong>{share.gym.emoji || '🏋️'} {share.gym.name}</strong>
          <span className="workout-hint">{plural(share.lifts.length, 'lift')} · {plural(totalSets, 'set')}{share.durationSecs ? ` · ${Math.round(share.durationSecs / 60)} min` : ''}</span>
        </div>
        <div className="workout-stack">
          {share.lifts.map((lift) => (
            <div key={lift.liftId} className="workout-lift-row" style={{ cursor: 'default' }}>
              <span className="workout-card-text">
                <span className="workout-card-title">{lift.name}</span>
                <span className="workout-card-meta">{stationName(lift.stationId)} · {isOwner ? 'you did' : `${share.ownerName} did`} {lift.sets.map((s) => `${s.weight}×${s.reps}`).join(' · ')}</span>
              </span>
            </div>
          ))}
        </div>
      </div>

      {isOwner ? (
        <div className="workout-tile">
          <strong style={{ display: 'block', marginBottom: '0.3rem' }}>Send it to someone</strong>
          <p className="workout-hint" style={{ marginTop: 0 }}>They can add this gym to their account (once) and do the same lifts with their own weights.</p>
          <button className="workout-button is-primary is-block" onClick={async () => setCopied(await shareLink(window.location.href, share.title))}>{copied === 'copied' ? '✅ Link copied' : '📤 Share link'}</button>
        </div>
      ) : (
        <div className="workout-tile">
          <strong style={{ display: 'block', marginBottom: '0.3rem' }}>Do this workout</strong>
          <p className="workout-hint" style={{ marginTop: 0 }}>Same lifts, your own weights — the targets come from your history.</p>
          {message && <p className="workout-error">{message}</p>}

          {imported ? (<>
            <p style={{ fontSize: '0.88rem' }}>
              ✓ You already have this gym: <strong>{imported.emoji} {imported.name}</strong>.
              {imported.missing.stations + imported.missing.lifts > 0
                ? ` This workout adds ${[imported.missing.stations ? plural(imported.missing.stations, 'machine') : '', imported.missing.lifts ? plural(imported.missing.lifts, 'lift') : ''].filter(Boolean).join(' and ')} to it.`
                : ''}
            </p>
            <button className="workout-button is-primary is-block" disabled={busy} onClick={imported.missing.stations + imported.missing.lifts > 0 ? importAndStart : () => go(imported.gymId)}>
              {busy ? 'Getting ready…' : `Start at ${imported.name}`}
            </button>
          </>) : (<>
            <button className="workout-button is-primary is-block" disabled={busy} onClick={importAndStart}>
              {busy ? 'Adding gym…' : `Add “${share.gym.name}” to my gyms and start`}
            </button>
            <p className="workout-hint" style={{ margin: '0.5rem 0 0' }}>Adds {plural(share.gym.stations.length, 'machine')} with their weights. Next time {share.ownerName} shares a workout from this gym, it&apos;s recognised.</p>

            {gyms.length > 0 && (
              <div className="workout-field" style={{ marginTop: '1rem' }}>
                <span className="workout-label">Or do it at one of my gyms</span>
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  <select className="workout-input" style={{ marginBottom: 0 }} value={useGym} onChange={(e) => setUseGym(e.target.value)}>
                    <option value="">Pick a gym</option>
                    {gyms.map((g) => <option key={g.id} value={g.id}>{g.emoji ? `${g.emoji} ` : ''}{g.name}</option>)}
                  </select>
                  <button className="workout-button" disabled={!preview || preview.entries.length === 0} onClick={() => go(useGym)}>Start</button>
                </div>
                {preview && (
                  <span className="workout-hint" style={{ display: 'block', marginTop: '0.3rem' }}>
                    {preview.entries.length} of {share.lifts.length} lifts found{preview.missing.length ? ` — not there: ${preview.missing.join(', ')}` : ''}.
                  </span>
                )}
              </div>
            )}

            <button className="workout-text-btn" style={{ display: 'block', margin: '0.75rem auto 0', textDecoration: 'underline' }} onClick={() => go()}>
              Just this once, without saving the gym
            </button>
          </>)}
        </div>
      )}
    </div>
  );
}

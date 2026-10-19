'use client';

import { useEffect, useState } from 'react';
import { useSitePopup } from '@/components/SitePopup';
import { normalizeBirthdate } from '@/lib/workout/birthdate';

interface WorkoutUser { id: string; username: string; password?: string; birthdate: string; height: string; gender: string; weight: number; }
const EMPTY: WorkoutUser = { id: '', username: '', password: '', birthdate: '', height: '', gender: 'unspecified', weight: 0 };

/** Site admin: the accounts that can sign in to the workout tracker. */
export default function WorkoutUsersPanel() {
  const { confirm, popup } = useSitePopup();
  const [users, setUsers] = useState<WorkoutUser[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  // `id` '' = a new user; null = no editor open.
  const [editing, setEditing] = useState<WorkoutUser | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/workout/users').then(r => r.json())
      .then(d => { if (d.success) setUsers(d.users); else { setLoadError(true); setUsers([]); } })
      .catch(() => { setLoadError(true); setUsers([]); });
  }, []);

  const isNew = !!editing && !editing.id;
  const save = async () => {
    if (!editing || !users || !editing.username.trim() || (isNew && !editing.password)) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/workout/users', { method: isNew ? 'POST' : 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editing) });
      const data = await res.json();
      if (!data.success) throw new Error(data.message || 'Could not save');
      setUsers(isNew ? [...users, data.user] : users.map(u => (u.id === editing.id ? data.user : u)));
      setEditing(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (u: WorkoutUser) => {
    if (!(await confirm({ title: 'Delete workout user', message: `Delete ${u.username}? Their workout history stays in backups only.`, confirmLabel: 'Delete', danger: true }))) return;
    const res = await fetch('/api/workout/users?id=' + encodeURIComponent(u.id), { method: 'DELETE' }).catch(() => null);
    if (res?.ok) setUsers(prev => (prev || []).filter(x => x.id !== u.id));
    else setError(`Could not delete ${u.username}.`);
  };

  const describe = (u: WorkoutUser) => [
    u.gender !== 'unspecified' ? u.gender : '',
    u.weight ? `${u.weight} lb` : '',
    u.height,
    u.birthdate ? `born ${normalizeBirthdate(u.birthdate)}` : '',
  ].filter(Boolean).join(' · ') || 'No profile details';

  const set = (patch: Partial<WorkoutUser>) => editing && setEditing({ ...editing, ...patch });

  const editor = editing && (
    <div className="workout-tile animate-fade-in" style={{ borderColor: 'var(--accent)' }}>
      <h3 style={{ margin: '0 0 0.75rem', fontSize: '1.05rem' }}>{isNew ? 'New user' : `Edit ${editing.username}`}</h3>
      {error && <p className="workout-error">{error}</p>}
      <label className="workout-field">
        <span className="workout-label">Username *</span>
        <input className="workout-input" value={editing.username} autoComplete="off" onChange={e => set({ username: e.target.value })} autoFocus={isNew} />
      </label>
      <label className="workout-field">
        <span className="workout-label">{isNew ? 'Password *' : 'New password (leave blank to keep)'}</span>
        <input className="workout-input" type="password" autoComplete="new-password" value={editing.password || ''} onChange={e => set({ password: e.target.value })} />
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0 0.6rem' }}>
        <label className="workout-field">
          <span className="workout-label">Birthdate</span>
          <input className="workout-input" value={editing.birthdate} placeholder="MM-DD-YYYY" onChange={e => set({ birthdate: e.target.value })} />
        </label>
        <label className="workout-field">
          <span className="workout-label">Height</span>
          <input className="workout-input" value={editing.height} placeholder={`5'10 or 70`} onChange={e => set({ height: e.target.value })} />
        </label>
        <label className="workout-field">
          <span className="workout-label">Gender</span>
          <select className="workout-input" value={editing.gender} onChange={e => set({ gender: e.target.value })}>
            <option value="unspecified">Unspecified</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
          </select>
        </label>
        <label className="workout-field">
          <span className="workout-label">Weight (lb)</span>
          <input className="workout-input" type="number" inputMode="decimal" value={editing.weight || ''} onChange={e => set({ weight: parseFloat(e.target.value) || 0 })} />
        </label>
      </div>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button className="workout-button is-primary" style={{ flex: 2 }} onClick={save} disabled={saving || !editing.username.trim() || (isNew && !editing.password)}>{saving ? 'Saving…' : isNew ? 'Add user' : 'Save'}</button>
        <button className="workout-button" style={{ flex: 1 }} onClick={() => setEditing(null)} disabled={saving}>Cancel</button>
      </div>
    </div>
  );

  return (
    <>
      {!editing && (
        <button className="workout-button is-primary is-block" style={{ marginBottom: '1rem' }} onClick={() => { setError(''); setEditing(EMPTY); }}>＋ Add user</button>
      )}
      {isNew && editor}
      {!editing && error && <p className="workout-error">{error}</p>}
      {!users ? <p className="workout-hint">Loading users…</p> : loadError ? (
        <p className="workout-error">Could not load workout users. Is your admin sign-in still valid?</p>
      ) : (
        <div className="workout-stack">
          {users.map(u => (editing?.id === u.id ? <div key={u.id}>{editor}</div> : (
            <div key={u.id} className="workout-list-row" style={{ padding: '0.75rem 0.9rem' }}>
              <div style={{ minWidth: 0 }}>
                <strong style={{ display: 'block', overflowWrap: 'anywhere' }}>{u.username}</strong>
                <span className="workout-hint">{describe(u)}</span>
              </div>
              <div style={{ display: 'flex', gap: '0.35rem', flexShrink: 0 }}>
                <button className="workout-button is-small" onClick={() => { setError(''); setEditing({ ...u, password: '' }); }} aria-label={`Edit ${u.username}`}>Edit</button>
                <button className="workout-button is-small is-danger" onClick={() => remove(u)} aria-label={`Delete ${u.username}`}>Delete</button>
              </div>
            </div>
          )))}
          {users.length === 0 && !editing && <p className="workout-hint">No workout users yet.</p>}
        </div>
      )}
      {popup}
    </>
  );
}

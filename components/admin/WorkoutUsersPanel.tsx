'use client';

import { useEffect, useState } from 'react';
import { useSitePopup } from '@/components/SitePopup';
import { normalizeBirthdate } from '@/lib/workout/birthdate';
import ProgressBar from './ProgressBar';

interface WorkoutUser { id: string; username: string; password?: string; birthdate: string; height: string; gender: string; weight: number; }
const EMPTY: WorkoutUser = { id: '', username: '', password: '', birthdate: '', height: '', gender: 'unspecified', weight: 0 };

/** Admin panel: accounts for the workout tracker. */
export default function WorkoutUsersPanel() {
  const { confirm, popup } = useSitePopup();
  const [users, setUsers] = useState<WorkoutUser[] | null>(null);
  // `id` '' = a new user; null = no editor open.
  const [editing, setEditing] = useState<WorkoutUser | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/workout/users').then(r => r.json()).then(d => setUsers(d.success ? d.users : [])).catch(() => setUsers([]));
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
    await fetch('/api/workout/users?id=' + encodeURIComponent(u.id), { method: 'DELETE' });
    setUsers(prev => (prev || []).filter(x => x.id !== u.id));
  };

  const describe = (u: WorkoutUser) => [
    u.gender !== 'unspecified' ? u.gender : '',
    u.weight ? `${u.weight} lb` : '',
    u.height,
    u.birthdate ? `born ${normalizeBirthdate(u.birthdate)}` : '',
  ].filter(Boolean).join(' · ') || 'No profile details';

  const editor = editing && (
    <div className="adm-editor animate-fade-in" style={{ marginBottom: '0.75rem' }}>
      {error && <div className="adm-notice is-error">{error}</div>}
      <div className="adm-form">
        <label className="adm-field">Username *<input value={editing.username} autoComplete="off" onChange={e => setEditing({ ...editing, username: e.target.value })} autoFocus={isNew} /></label>
        <label className="adm-field">{isNew ? 'Password *' : 'New password (leave blank to keep)'}
          <input type="password" autoComplete="new-password" value={editing.password || ''} onChange={e => setEditing({ ...editing, password: e.target.value })} />
        </label>
        <label className="adm-field">Birthdate<input value={editing.birthdate} placeholder="MM-DD-YYYY" onChange={e => setEditing({ ...editing, birthdate: e.target.value })} /></label>
        <label className="adm-field">Height<input value={editing.height} placeholder={`e.g. 5'10 or 70`} onChange={e => setEditing({ ...editing, height: e.target.value })} /></label>
        <label className="adm-field">Gender
          <select value={editing.gender} onChange={e => setEditing({ ...editing, gender: e.target.value })}>
            <option value="unspecified">Unspecified</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
          </select>
        </label>
        <label className="adm-field">Weight (lb)<input type="number" inputMode="decimal" value={editing.weight || ''} onChange={e => setEditing({ ...editing, weight: parseFloat(e.target.value) || 0 })} /></label>
        <div className="adm-actions is-wide">
          <button className="btn btn-primary" onClick={save} disabled={saving || !editing.username.trim() || (isNew && !editing.password)}>{saving ? 'Saving…' : isNew ? 'Add user' : 'Save'}</button>
          <button className="btn btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
        </div>
      </div>
    </div>
  );

  return (
    <section className="adm-card" aria-labelledby="wusers-title">
      <div className="adm-card-head">
        <div>
          <h2 id="wusers-title">🏋️ Workout users</h2>
          <p>People who can sign in to the workout tracker.</p>
        </div>
        <button className="btn btn-primary" disabled={!!editing} onClick={() => { setError(''); setEditing(EMPTY); }}>+ Add user</button>
      </div>

      {isNew && editor}
      {!users ? <ProgressBar label="Loading…" /> : (
        <div className="adm-list">
          {users.map(u => (editing?.id === u.id ? <div key={u.id}>{editor}</div> : (
            <div key={u.id} className="adm-row">
              <div className="adm-row-main">
                <strong>{u.username}</strong>
                <div className="adm-row-sub">{describe(u)}</div>
              </div>
              <div className="adm-actions">
                <button className="adm-icon-btn" onClick={() => { setError(''); setEditing({ ...u, password: '' }); }} title="Edit" aria-label={`Edit ${u.username}`}>✏️</button>
                <button className="adm-icon-btn is-danger" onClick={() => remove(u)} title="Delete" aria-label={`Delete ${u.username}`}>✕</button>
              </div>
            </div>
          )))}
          {users.length === 0 && !editing && <p className="adm-muted">No workout users yet.</p>}
        </div>
      )}
      {popup}
    </section>
  );
}

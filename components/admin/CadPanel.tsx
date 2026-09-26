'use client';

import { useEffect, useState } from 'react';
import { useSitePopup } from '@/components/SitePopup';
import ProgressBar from './ProgressBar';

interface CADProject { id: string; name: string; description: string; link: string; }
const EMPTY = { id: '', name: '', description: '', link: '' };

/** Admin panel: the CAD models listed on the home page. */
export default function CadPanel() {
  const { confirm, popup } = useSitePopup();
  const [projects, setProjects] = useState<CADProject[] | null>(null);
  // `id` '' = a new project; null = no editor open.
  const [editing, setEditing] = useState<CADProject | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/cad').then(r => r.json()).then(d => setProjects(d.success ? d.projects : [])).catch(() => setProjects([]));
  }, []);

  const save = async () => {
    if (!editing?.name.trim() || !projects) return;
    setSaving(true);
    setError('');
    try {
      const isNew = !editing.id;
      const res = await fetch('/api/cad', { method: isNew ? 'POST' : 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editing) });
      const data = await res.json();
      if (!data.success) throw new Error(data.message || 'Could not save');
      setProjects(isNew ? [...projects, data.project] : projects.map(p => (p.id === editing.id ? editing : p)));
      setEditing(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (p: CADProject) => {
    if (!(await confirm({ title: 'Delete CAD project', message: `Delete “${p.name}”?`, confirmLabel: 'Delete', danger: true }))) return;
    await fetch('/api/cad', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: p.id }) });
    setProjects(prev => (prev || []).filter(x => x.id !== p.id));
  };

  const editor = editing && (
    <div className="adm-editor animate-fade-in" style={{ marginBottom: '0.75rem' }}>
      {error && <div className="adm-notice is-error">{error}</div>}
      <div className="adm-form">
        <label className="adm-field">Name *<input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} autoFocus /></label>
        <label className="adm-field">Link (e.g. Onshape)<input value={editing.link} onChange={e => setEditing({ ...editing, link: e.target.value })} placeholder="https://…" /></label>
        <label className="adm-field is-wide">Description<textarea value={editing.description} onChange={e => setEditing({ ...editing, description: e.target.value })} rows={3} /></label>
        <div className="adm-actions is-wide">
          <button className="btn btn-primary" onClick={save} disabled={saving || !editing.name.trim()}>{saving ? 'Saving…' : editing.id ? 'Save' : 'Add project'}</button>
          <button className="btn btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
        </div>
      </div>
    </div>
  );

  return (
    <section className="adm-card" aria-labelledby="cad-title">
      <div className="adm-card-head">
        <div>
          <h2 id="cad-title">📐 CAD projects</h2>
          <p>Models shown in the “CAD models &amp; designs” section of the home page.</p>
        </div>
        <button className="btn btn-primary" disabled={!!editing} onClick={() => { setError(''); setEditing(EMPTY); }}>+ Add project</button>
      </div>

      {editing && !editing.id && editor}
      {!projects ? <ProgressBar label="Loading…" /> : (
        <div className="adm-list">
          {projects.map(p => (editing?.id === p.id ? <div key={p.id}>{editor}</div> : (
            <div key={p.id} className="adm-row">
              <div className="adm-row-main">
                <strong>{p.name}</strong>
                {p.description && <div className="adm-row-sub">{p.description}</div>}
              </div>
              <div className="adm-actions">
                {p.link && <a className="adm-icon-btn" href={p.link} target="_blank" rel="noreferrer" title="Open model" aria-label={`Open ${p.name}`}>↗</a>}
                <button className="adm-icon-btn" onClick={() => { setError(''); setEditing(p); }} title="Edit" aria-label={`Edit ${p.name}`}>✏️</button>
                <button className="adm-icon-btn is-danger" onClick={() => remove(p)} title="Delete" aria-label={`Delete ${p.name}`}>✕</button>
              </div>
            </div>
          )))}
          {projects.length === 0 && !editing && <p className="adm-muted">No CAD projects yet.</p>}
        </div>
      )}
      {popup}
    </section>
  );
}

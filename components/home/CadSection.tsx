'use client';

import { useState } from 'react';
import type { CadProject } from '@/lib/site-content';
import { useSitePopup } from '@/components/SitePopup';

const PREVIEW = 4;
const EMPTY: CadProject = { id: '', name: '', description: '', link: '' };

/** CAD models: the first few, with a button to show the rest. Signed in as admin, models are added and edited here. */
export default function CadSection({ projects: initial, isAdmin = false }: { projects: CadProject[]; isAdmin?: boolean }) {
  const { confirm, popup } = useSitePopup();
  const [projects, setProjects] = useState(initial);
  const [expanded, setExpanded] = useState(false);
  // `id` '' = a new model; null = no editor open.
  const [editing, setEditing] = useState<CadProject | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const shown = expanded || isAdmin ? projects : projects.slice(0, PREVIEW);

  const save = async () => {
    if (!editing?.name.trim()) return;
    setSaving(true);
    setError('');
    try {
      const isNew = !editing.id;
      const body = { ...editing, name: editing.name.trim(), link: editing.link.trim() };
      const res = await fetch('/api/cad', { method: isNew ? 'POST' : 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.message || 'Could not save');
      setProjects((prev) => (isNew ? [...prev, data.project] : prev.map((p) => (p.id === body.id ? body : p))));
      setEditing(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (p: CadProject) => {
    if (!(await confirm({ title: 'Delete CAD model', message: `Delete “${p.name}” from the home page?`, confirmLabel: 'Delete', danger: true }))) return;
    const res = await fetch('/api/cad', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: p.id }) }).catch(() => null);
    if (res?.ok) setProjects((prev) => prev.filter((x) => x.id !== p.id));
  };

  const editor = editing && (
    <div className="home-cad-editor animate-fade-in">
      {error && <p role="alert" style={{ color: 'var(--danger)', margin: 0, fontSize: '0.9rem' }}>{error}</p>}
      <label>Name<input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} autoFocus /></label>
      <label>Link (e.g. Onshape)<input value={editing.link} onChange={(e) => setEditing({ ...editing, link: e.target.value })} placeholder="https://…" /></label>
      <label className="is-wide">Description<textarea value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} rows={3} /></label>
      <div className="is-wide" style={{ display: 'flex', gap: '0.5rem' }}>
        <button className="btn btn-primary" onClick={save} disabled={saving || !editing.name.trim()}>{saving ? 'Saving…' : editing.id ? 'Save' : 'Add model'}</button>
        <button className="btn btn-secondary" onClick={() => setEditing(null)} disabled={saving}>Cancel</button>
      </div>
    </div>
  );

  return (
    <section id="cad" className="premium-card home-cad">
      <div className="home-section-head" style={{ textAlign: 'center', display: 'block' }}>
        <h2>CAD models &amp; designs</h2>
        <p className="home-muted">3D parts and models, hosted externally.</p>
        {isAdmin && !editing && (
          <button className="btn btn-secondary home-cad-add" onClick={() => { setError(''); setEditing(EMPTY); }}>＋ Add model</button>
        )}
      </div>
      {editing && !editing.id && editor}
      {projects.length === 0 && !editing && <p className="home-muted" style={{ textAlign: 'center' }}>No models yet. Only you can see this section until one is added.</p>}
      <div className="home-cad-grid">
        {shown.map(cad => {
          if (editing?.id === cad.id) return <div key={cad.id} style={{ gridColumn: '1 / -1' }}>{editor}</div>;
          const Tag = cad.link ? 'a' : 'div';
          return (
            <div key={cad.id} className="home-cad-cell">
              <Tag className="home-cad-item" {...(cad.link ? { href: cad.link, target: '_blank', rel: 'noreferrer' } : {})}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem' }}>
                  <h3>{cad.name}</h3>
                  {cad.link && (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, color: 'var(--accent-light)' }} aria-hidden><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
                  )}
                </div>
                {cad.description && <p>{cad.description}</p>}
              </Tag>
              {isAdmin && (
                <div className="home-cad-admin">
                  <button onClick={() => { setError(''); setEditing(cad); }} title="Edit" aria-label={`Edit ${cad.name}`}>✏️</button>
                  <button onClick={() => remove(cad)} title="Delete" aria-label={`Delete ${cad.name}`} className="is-danger">✕</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {!isAdmin && projects.length > PREVIEW && (
        <div style={{ textAlign: 'center', marginTop: '1.5rem' }}>
          <button className="btn btn-secondary" style={{ borderRadius: '30px' }} onClick={() => setExpanded(!expanded)}>
            {expanded ? 'Show fewer' : `Show all ${projects.length}`}
          </button>
        </div>
      )}
      {popup}
    </section>
  );
}

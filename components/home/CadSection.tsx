'use client';

import { useState } from 'react';
import type { CadProject } from '@/lib/site-content';
import { useSitePopup } from '@/components/SitePopup';
import { MAX_MODEL_BYTES, MODEL_EXTENSIONS, formatBytes, modelExtension } from '@/lib/cad/models';
import ModelViewer from './ModelViewer';

const PREVIEW = 4;
const EMPTY: CadProject = { id: '', name: '', description: '', link: '' };

/**
 * CAD models: the first few, with a button to show the rest. A model with a 3D
 * file gets an interactive viewer. Signed in as admin, models (and their
 * files) are added and edited here.
 */
export default function CadSection({ projects: initial, isAdmin = false }: { projects: CadProject[]; isAdmin?: boolean }) {
  const { confirm, popup } = useSitePopup();
  const [projects, setProjects] = useState(initial);
  const [expanded, setExpanded] = useState(false);
  // `id` '' = a new model; null = no editor open.
  const [editing, setEditing] = useState<CadProject | null>(null);
  const [saving, setSaving] = useState(false);
  /** A 3D file picked in the editor, uploaded when it's saved. */
  const [modelFile, setModelFile] = useState<File | null>(null);
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
      let saved: CadProject = isNew ? data.project : body;
      setProjects((prev) => (isNew ? [...prev, saved] : prev.map((p) => (p.id === body.id ? saved : p))));
      if (modelFile) {
        const form = new FormData();
        form.append('id', saved.id);
        form.append('file', modelFile);
        const up = await fetch('/api/cad/model', { method: 'POST', body: form });
        const upData = await up.json().catch(() => ({}));
        if (!up.ok || !upData.success) {
          setEditing(saved);
          throw new Error(`Saved, but the 3D file didn’t upload: ${upData.message || 'try again'}`);
        }
        saved = upData.project;
        setProjects((prev) => prev.map((p) => (p.id === saved.id ? saved : p)));
      }
      setModelFile(null);
      setEditing(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const pickModel = (file: File | undefined) => {
    setError('');
    if (!file) return setModelFile(null);
    if (!modelExtension(file.name)) return setError(`3D files can be ${MODEL_EXTENSIONS.join(', ')}. Export STEP files as STL or 3MF first.`);
    if (file.size > MAX_MODEL_BYTES) return setError('That file is over 50 MB.');
    setModelFile(file);
  };

  const removeModel = async (p: CadProject) => {
    if (!(await confirm({ title: 'Remove 3D model', message: `Remove the 3D file from “${p.name}”?`, confirmLabel: 'Remove', danger: true }))) return;
    const res = await fetch('/api/cad/model', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: p.id }) }).catch(() => null);
    const data = await res?.json().catch(() => ({}));
    if (!data?.success) return setError('Could not remove the 3D file');
    setProjects((prev) => prev.map((x) => (x.id === p.id ? data.project : x)));
    setEditing((e) => (e ? data.project : e));
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
      <div className="is-wide home-cad-file">
        <span>3D model ({MODEL_EXTENSIONS.map((x) => x.slice(1).toUpperCase()).join(', ')} · up to 50 MB)</span>
        <div>
          <label className="btn btn-secondary">
            {modelFile ? 'Choose another file' : editing.model ? 'Replace 3D file' : 'Choose a 3D file'}
            <input type="file" accept={MODEL_EXTENSIONS.join(',')} hidden onChange={(e) => { pickModel(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          {modelFile ? <small>{modelFile.name} · {formatBytes(modelFile.size)} (uploads when you save)</small>
            : editing.model ? <small>{editing.modelName || 'Model'}{editing.modelSize ? ` · ${formatBytes(editing.modelSize)}` : ''}</small>
              : <small>None yet. STEP files: export as STL or 3MF first.</small>}
          {modelFile && <button type="button" className="btn btn-secondary" onClick={() => setModelFile(null)}>✕</button>}
          {!modelFile && editing.model && <button type="button" className="btn btn-secondary" onClick={() => removeModel(editing)}>Remove</button>}
        </div>
      </div>
      <div className="is-wide" style={{ display: 'flex', gap: '0.5rem' }}>
        <button className="btn btn-primary" onClick={save} disabled={saving || !editing.name.trim()}>{saving ? 'Saving…' : editing.id ? 'Save' : 'Add model'}</button>
        <button className="btn btn-secondary" onClick={() => { setEditing(null); setModelFile(null); }} disabled={saving}>Cancel</button>
      </div>
    </div>
  );

  return (
    <section id="cad" className="premium-card home-cad">
      <div className="home-section-head" style={{ textAlign: 'center', display: 'block' }}>
        <h2>CAD models &amp; designs</h2>
        <p className="home-muted">3D parts and models. Drag the ones with a 3D view to turn them.</p>
        {isAdmin && !editing && (
          <button className="btn btn-secondary home-cad-add" onClick={() => { setError(''); setModelFile(null); setEditing(EMPTY); }}>＋ Add model</button>
        )}
      </div>
      {editing && !editing.id && editor}
      {projects.length === 0 && !editing && <p className="home-muted" style={{ textAlign: 'center' }}>No models yet. Only you can see this section until one is added.</p>}
      <div className="home-cad-grid">
        {shown.map(cad => {
          if (editing?.id === cad.id) return <div key={cad.id} style={{ gridColumn: '1 / -1' }}>{editor}</div>;
          const Tag = cad.link ? 'a' : 'div';
          return (
            <div key={cad.id} className={`home-cad-cell${cad.model ? ' has-model' : ''}`}>
              {cad.model && <ModelViewer src={`/api/media${cad.model}`} name={cad.name} size={cad.modelSize} />}
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
                  <button onClick={() => { setError(''); setModelFile(null); setEditing(cad); }} title="Edit" aria-label={`Edit ${cad.name}`}>✏️</button>
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

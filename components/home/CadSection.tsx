'use client';

import { useEffect, useState } from 'react';
import type { CadProject } from '@/lib/site-content';
import { useSitePopup } from '@/components/SitePopup';
import { MAX_MODEL_BYTES, MODEL_EXTENSIONS, formatBytes, modelExtension } from '@/lib/cad/models';
import { parseOnshapeLink } from '@/lib/cad/onshape';
import { cadAnchor } from '@/lib/cad/embeds';
import CadCard from './CadCard';

const PREVIEW = 4;
const EMPTY: CadProject = { id: '', name: '', description: '', link: '' };

/**
 * CAD models: the first few, with a button to show the rest. A model with a 3D
 * file gets an interactive viewer. Signed in as admin, models (and their
 * files) are added and edited here; with Onshape API keys on the server
 * (`onshape`), a model linked to an Onshape Part Studio or assembly can have its 3D file
 * exported from Onshape instead of uploaded.
 */
export default function CadSection({ projects: initial, isAdmin = false, onshape = false }: { projects: CadProject[]; isAdmin?: boolean; onshape?: boolean }) {
  const { confirm, popup } = useSitePopup();
  const [projects, setProjects] = useState(initial);
  const [expanded, setExpanded] = useState(false);
  // `id` '' = a new model; null = no editor open.
  const [editing, setEditing] = useState<CadProject | null>(null);
  const [saving, setSaving] = useState(false);
  /** A 3D file picked in the editor, uploaded when it's saved. */
  const [modelFile, setModelFile] = useState<File | null>(null);
  /** Export the 3D model from the Onshape link when the editor is saved. */
  const [fromOnshape, setFromOnshape] = useState(false);
  /** The model being refreshed from Onshape. */
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const shown = expanded || isAdmin ? projects : projects.slice(0, PREVIEW);
  /** The model a link (/#cad-<id>, e.g. from a post) pointed at, glowing briefly. */
  const [linked, setLinked] = useState<string | null>(null);

  useEffect(() => {
    const open = () => {
      const m = window.location.hash.match(/^#cad-(.+)$/);
      const id = m ? decodeURIComponent(m[1]) : '';
      const at = initial.findIndex((p) => p.id === id);
      if (at < 0) return;
      if (at >= PREVIEW) setExpanded(true);
      setLinked(id);
      setTimeout(() => document.getElementById(cadAnchor(id))?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
      setTimeout(() => setLinked(null), 2600);
    };
    open();
    window.addEventListener('hashchange', open);
    return () => window.removeEventListener('hashchange', open);
  }, [initial]);

  /**
   * Ask the server to export a model's Onshape tab as its 3D file. A Part
   * Studio comes straight back; an assembly is a background export on
   * Onshape's side, checked every few seconds (for up to ten minutes).
   */
  const fetchFromOnshape = async (id: string) => {
    let translation: string | undefined;
    for (let checks = 0; checks < 120; checks++) {
      if (translation) await new Promise((r) => setTimeout(r, 5000));
      const res = await fetch('/api/cad/onshape', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, translation }) }).catch(() => null);
      const data = await res?.json().catch(() => ({}));
      if (!res?.ok || !data?.success) throw new Error(data?.message || 'Couldn’t reach the server');
      if (data.pending) { translation = data.translation; continue; }
      setProjects((prev) => prev.map((p) => (p.id === id ? data.project : p)));
      return data.project as CadProject;
    }
    throw new Error('Onshape is still exporting the assembly. Try 🔄 again in a few minutes.');
  };

  const refresh = async (p: CadProject) => {
    setRefreshing(p.id);
    setNotice('');
    try {
      await fetchFromOnshape(p.id);
      setNotice(`Updated the 3D model of “${p.name}” from Onshape.`);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'The Onshape export failed');
    } finally {
      setRefreshing(null);
    }
  };

  /** Open the editor; a new link (or no model yet) defaults to fetching from Onshape. */
  const edit = (p: CadProject) => {
    setError('');
    setNotice('');
    setModelFile(null);
    setFromOnshape(onshape && !p.model);
    setEditing(p);
  };

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
      } else if (fromOnshape && onshape && parseOnshapeLink(saved.link)) {
        try {
          await fetchFromOnshape(saved.id);
        } catch (err) {
          setEditing(saved);
          throw new Error(`Saved, but the Onshape export didn’t work: ${err instanceof Error ? err.message : 'try again'}`);
        }
      }
      setModelFile(null);
      setFromOnshape(false);
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
      <label>Link (e.g. Onshape)<input value={editing.link} onChange={(e) => { setEditing({ ...editing, link: e.target.value }); if (onshape && !modelFile && parseOnshapeLink(e.target.value) && e.target.value !== projects.find((p) => p.id === editing.id)?.link) setFromOnshape(true); }} placeholder="https://…" /></label>
      <label className="is-wide">Description<textarea value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} rows={3} /></label>
      {parseOnshapeLink(editing.link) && (
        onshape ? (
          <label className="is-wide home-cad-onshape">
            <input type="checkbox" checked={fromOnshape && !modelFile} disabled={!!modelFile} onChange={(e) => setFromOnshape(e.target.checked)} />
            <span>Get the 3D model from this Onshape tab (Part Studio or assembly) when I save{modelFile ? ' (off while a file is chosen below)' : ''}</span>
          </label>
        ) : (
          <p className="is-wide home-cad-onshape-hint">This is an Onshape link. With <code>ONSHAPE_ACCESS_KEY</code> and <code>ONSHAPE_SECRET_KEY</code> set on the server, the 3D model can come straight from it.</p>
        )
      )}
      <div className="is-wide home-cad-file">
        <span>3D model ({MODEL_EXTENSIONS.map((x) => x.slice(1).toUpperCase()).join(', ')} · up to 50 MB)</span>
        <div>
          <label className="btn btn-secondary">
            {modelFile ? 'Choose another file' : editing.model ? 'Replace 3D file' : 'Choose a 3D file'}
            <input type="file" accept={MODEL_EXTENSIONS.join(',')} hidden onChange={(e) => { pickModel(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          {modelFile ? <small>{modelFile.name} · {formatBytes(modelFile.size)} (uploads when you save)</small>
            : editing.model ? <small>{editing.modelSource === 'onshape' ? 'From Onshape' : editing.modelName || 'Model'}{editing.modelSize ? ` · ${formatBytes(editing.modelSize)}` : ''}{editing.modelUpdatedAt ? ` · ${new Date(editing.modelUpdatedAt).toLocaleDateString()}` : ''}</small>
              : <small>None yet. STEP files: export as STL or 3MF first.</small>}
          {modelFile && <button type="button" className="btn btn-secondary" onClick={() => setModelFile(null)}>✕</button>}
          {!modelFile && editing.model && <button type="button" className="btn btn-secondary" onClick={() => removeModel(editing)}>Remove</button>}
        </div>
      </div>
      <div className="is-wide" style={{ display: 'flex', gap: '0.5rem' }}>
        <button className="btn btn-primary" onClick={save} disabled={saving || !editing.name.trim()}>{saving ? (fromOnshape && !modelFile && onshape && parseOnshapeLink(editing.link) ? 'Exporting from Onshape…' : 'Saving…') : editing.id ? 'Save' : 'Add model'}</button>
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
          <button className="btn btn-secondary home-cad-add" onClick={() => edit(EMPTY)}>＋ Add model</button>
        )}
      </div>
      {notice && <p className="home-cad-notice" role="status">{notice} <button type="button" onClick={() => setNotice('')} aria-label="Dismiss">✕</button></p>}
      {editing && !editing.id && editor}
      {projects.length === 0 && !editing && <p className="home-muted" style={{ textAlign: 'center' }}>No models yet. Only you can see this section until one is added.</p>}
      <div className="home-cad-grid">
        {shown.map(cad => {
          if (editing?.id === cad.id) return <div key={cad.id} style={{ gridColumn: '1 / -1' }}>{editor}</div>;
          return (
            <CadCard key={cad.id} cad={cad} id={cadAnchor(cad.id)} className={linked === cad.id ? 'is-linked' : ''}>
              {isAdmin && (
                <div className="home-cad-admin">
                  <button onClick={() => edit(cad)} title="Edit" aria-label={`Edit ${cad.name}`}>✏️</button>
                  {onshape && parseOnshapeLink(cad.link) && (
                    <button onClick={() => refresh(cad)} disabled={refreshing !== null} title="Refresh the 3D model from Onshape (assemblies can take a minute)" aria-label={`Refresh ${cad.name} from Onshape`}>{refreshing === cad.id ? '…' : '🔄'}</button>
                  )}
                  <button onClick={() => remove(cad)} title="Delete" aria-label={`Delete ${cad.name}`} className="is-danger">✕</button>
                </div>
              )}
            </CadCard>
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

'use client';

import { useState } from 'react';
import ProgressBar from '@/components/ProgressBar';
import { uploadWithProgress } from '@/lib/upload-client';
import type { LibraryDocument } from '@/lib/site-content';

/** Admin: add a PDF to the library, with its shelf (category) and a public note. */
export default function LibraryUploadForm({ categories, onAdded, onCancel }: {
  categories: string[];
  onAdded: (doc: LibraryDocument) => void;
  onCancel: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [note, setNote] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState('');

  const pickFile = (picked: File | null) => {
    setFile(picked);
    // Start the title from the file name; it can be changed before uploading.
    if (picked && !name.trim()) setName(picked.name.replace(/\.pdf$/i, '').replace(/[-_]+/g, ' ').trim());
  };

  const upload = async () => {
    if (!file || !name.trim()) return;
    setError('');
    setProgress(0);
    const form = new FormData();
    form.append('type', 'library');
    form.append('file', file);
    form.append('name', name.trim());
    form.append('category', category.trim());
    form.append('note', note.trim());
    try {
      const data = await uploadWithProgress(form, setProgress);
      if (!data.success || typeof data.url !== 'string') throw new Error(data.message || 'Upload failed');
      onAdded({ url: data.url, name: name.trim(), category: category.trim() || 'Uncategorized', ...(note.trim() ? { note: note.trim() } : {}), date: new Date().toISOString() });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
      setProgress(null);
    }
  };

  const busy = progress !== null;
  return (
    <div className="glass-panel lib-editor lib-upload animate-fade-in">
      <h3 style={{ margin: 0 }}>Add a document</h3>
      {error && <p role="alert" style={{ color: 'var(--danger)', margin: 0, fontSize: '0.9rem' }}>{error}</p>}
      <label className="lib-file">
        <span className="lib-label">PDF (max 30 MB)</span>
        <input type="file" accept=".pdf,application/pdf" disabled={busy} onChange={(e) => pickFile(e.target.files?.[0] || null)} />
      </label>
      <label><span className="lib-label">Title</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="System Manual V2" disabled={busy} /></label>
      <label>
        <span className="lib-label">Category</span>
        <input value={category} list="lib-upload-categories" onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Hardware" disabled={busy} />
      </label>
      <datalist id="lib-upload-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
      <label><span className="lib-label">Public note</span><textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional description…" rows={3} disabled={busy} /></label>
      {busy && <ProgressBar value={progress} label={progress >= 100 ? 'Saving on the Pi…' : 'Uploading…'} detail={`${progress}%`} />}
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button className="btn btn-primary" onClick={upload} disabled={busy || !file || !name.trim()}>{busy ? 'Uploading…' : 'Upload'}</button>
        <button className="btn btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </div>
  );
}

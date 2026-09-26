'use client';

import { useEffect, useState } from 'react';
import { useSitePopup } from '@/components/SitePopup';
import ProgressBar from './ProgressBar';

type UploadType = 'gallery' | 'blog' | 'blog-photo' | 'library';

const TYPES: { id: UploadType; label: string; hint: string }[] = [
  { id: 'gallery', label: '📷 Photos', hint: 'Add photos to a gallery album. Pick several files to upload them all at once.' },
  { id: 'blog', label: '📝 Blog post', hint: 'Publish a post from a Markdown file with a cover image.' },
  { id: 'blog-photo', label: '🖼️ Post photo', hint: 'Add an extra photo to an existing post.' },
  { id: 'library', label: '📁 Library PDF', hint: 'Add a document to the library.' },
];

type Notice = { text: string; type: 'success' | 'error' } | null;

/** Send one form to /api/upload, reporting upload progress (fetch can't). */
function performUpload(fd: FormData, onProgress: (p: number) => void): Promise<{ success?: boolean; message?: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    });
    xhr.addEventListener('load', () => {
      try { resolve(JSON.parse(xhr.responseText)); } catch { reject(new Error('Invalid response')); }
    });
    xhr.addEventListener('error', () => reject(new Error('Network error')));
    xhr.open('POST', '/api/upload');
    xhr.send(fd);
  });
}

/** Admin panel: upload photos, blog posts, post photos and library PDFs. */
export default function UploadsPanel() {
  const { confirm, popup } = useSitePopup();
  const [type, setType] = useState<UploadType>('gallery');
  const [albums, setAlbums] = useState<{ id: string; name: string }[]>([]);
  const [posts, setPosts] = useState<{ slug: string; title: string }[]>([]);
  const [busy, setBusy] = useState<'' | 'upload' | 'repair'>('');
  const [progress, setProgress] = useState(0);
  const [batch, setBatch] = useState({ index: 0, total: 0 });
  const [notice, setNotice] = useState<Notice>(null);

  const loadAlbums = () => fetch('/api/gallery').then(r => r.json()).then(d => {
    if (d.success) {
      // Include sub-albums, labelled with their parent.
      const flat: { id: string; name: string }[] = [];
      const walk = (list: any[], prefix: string) => list.forEach(a => { flat.push({ id: a.id, name: prefix + a.name }); walk(a.albums || [], `${prefix}${a.name} › `); });
      walk(d.albums, '');
      setAlbums(flat);
    }
  }).catch(() => {});

  useEffect(() => {
    if (type === 'gallery') loadAlbums();
    if (type === 'blog-photo' || type === 'blog') {
      fetch('/api/blog').then(r => r.json()).then(d => { if (d.success) setPosts(d.posts.map((p: any) => ({ slug: p.slug, title: p.title }))); }).catch(() => {});
    }
  }, [type]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy('upload');
    setProgress(0);
    setNotice(null);
    const formData = new FormData(form);
    try {
      const files = type === 'gallery' ? (form.querySelector('input[name="image"]') as HTMLInputElement | null)?.files : null;
      if (files && files.length > 1) {
        // Several photos: one request each, so one bad file doesn't sink the batch.
        let saved = 0;
        for (let i = 0; i < files.length; i++) {
          setBatch({ index: i + 1, total: files.length });
          setProgress(0);
          const single = new FormData();
          single.append('type', 'gallery');
          single.append('albumId', formData.get('albumId') as string);
          single.append('caption', '');
          single.append('image', files[i]);
          try { if ((await performUpload(single, setProgress)).success) saved++; } catch { /* counted as failed */ }
        }
        setNotice({ text: `Uploaded ${saved} of ${files.length} photos.`, type: saved === files.length ? 'success' : 'error' });
        form.reset();
      } else {
        formData.set('type', type);
        const data = await performUpload(formData, setProgress);
        if (data.success) { setNotice({ text: 'Uploaded!', type: 'success' }); form.reset(); }
        else setNotice({ text: data.message || 'Upload failed', type: 'error' });
      }
    } catch (err) {
      setNotice({ text: err instanceof Error ? err.message : 'Network error.', type: 'error' });
    } finally {
      setBusy('');
      setProgress(0);
      setBatch({ index: 0, total: 0 });
    }
  };

  const repair = async () => {
    if (!(await confirm({ title: 'Repair gallery index', message: 'Re-scan the disk and add any photos missing from the gallery lists? Orphaned files go to General.', confirmLabel: 'Run repair' }))) return;
    setBusy('repair');
    setNotice(null);
    try {
      const data = await fetch('/api/gallery/repair', { method: 'POST' }).then(r => r.json());
      if (data.success) { setNotice({ text: `Repair complete — added ${data.added} missing photo${data.added === 1 ? '' : 's'}.`, type: 'success' }); loadAlbums(); }
      else setNotice({ text: data.message || 'Repair failed.', type: 'error' });
    } catch {
      setNotice({ text: 'Network error during repair.', type: 'error' });
    } finally {
      setBusy('');
    }
  };

  const disabled = !!busy;
  const current = TYPES.find(t => t.id === type)!;

  return (
    <section className="adm-card" aria-labelledby="uploads-title">
      <div className="adm-card-head">
        <div>
          <h2 id="uploads-title">⬆️ Upload</h2>
          <p>{current.hint}</p>
        </div>
        {type === 'gallery' && <button type="button" className="btn btn-secondary adm-small-btn" onClick={repair} disabled={disabled}>🛠️ Repair gallery index</button>}
      </div>

      <div className="adm-seg" role="group" aria-label="What to upload">
        {TYPES.map(t => (
          <button key={t.id} type="button" aria-pressed={type === t.id} disabled={disabled} onClick={() => { setType(t.id); setNotice(null); }}>{t.label}</button>
        ))}
      </div>

      {notice && <div className={`adm-notice ${notice.type === 'success' ? 'is-success' : 'is-error'}`}>{notice.text}</div>}

      {/* Keyed by type so switching clears the chosen files. */}
      <form key={type} onSubmit={handleSubmit} className="adm-form">
        {type === 'gallery' && (<>
          <label className="adm-field">
            Album
            <select name="albumId" disabled={disabled}>
              {albums.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              {albums.length === 0 && <option value="general">General</option>}
            </select>
          </label>
          <label className="adm-field">
            Caption (optional, single photo)
            <input type="text" name="caption" disabled={disabled} placeholder="A beautiful sunset…" />
          </label>
          <label className="adm-field is-wide">
            Photos (max 25 MB each)
            <div className="adm-file"><input type="file" name="image" accept="image/*" multiple required disabled={disabled} /></div>
          </label>
        </>)}

        {type === 'blog' && (<>
          <label className="adm-field">Title<input type="text" name="title" required disabled={disabled} placeholder="My blog post" /></label>
          <label className="adm-field">Category<input type="text" name="category" required disabled={disabled} placeholder="e.g. Infrastructure" /></label>
          <label className="adm-field is-wide">Description<input type="text" name="description" required disabled={disabled} placeholder="A short summary…" /></label>
          <label className="adm-field">Cover image<div className="adm-file"><input type="file" name="image" accept="image/*" required disabled={disabled} /></div></label>
          <label className="adm-field">Markdown file (.md)<div className="adm-file"><input type="file" name="markdown" accept=".md" required disabled={disabled} /></div></label>
        </>)}

        {type === 'blog-photo' && (<>
          <label className="adm-field">
            Post
            <select name="slug" required disabled={disabled}>
              {posts.map(p => <option key={p.slug} value={p.slug}>{p.title}</option>)}
              {posts.length === 0 && <option value="">No posts found</option>}
            </select>
          </label>
          <label className="adm-field">Photo description<input type="text" name="description" disabled={disabled} placeholder="What's in the photo…" /></label>
          <label className="adm-field is-wide">Photo (max 25 MB)<div className="adm-file"><input type="file" name="image" accept="image/*" required disabled={disabled} /></div></label>
        </>)}

        {type === 'library' && (<>
          <label className="adm-field">Document name<input type="text" name="name" required disabled={disabled} placeholder="System Manual V2" /></label>
          <label className="adm-field">Category (optional)<input type="text" name="category" disabled={disabled} placeholder="Hardware" /></label>
          <label className="adm-field is-wide">PDF (max 30 MB)<div className="adm-file"><input type="file" name="file" accept=".pdf" required disabled={disabled} /></div></label>
        </>)}

        {busy && (
          <div className="is-wide">
            {busy === 'repair'
              ? <ProgressBar label="Scanning the gallery folder…" />
              : <ProgressBar value={progress} label={batch.total ? `Uploading photo ${batch.index} of ${batch.total}…` : progress >= 100 ? 'Processing on the Pi…' : 'Uploading…'} detail={`${progress}%`} />}
          </div>
        )}

        <div className="is-wide">
          <button type="submit" className="btn btn-primary" disabled={disabled}>{busy === 'upload' ? 'Uploading…' : 'Upload'}</button>
        </div>
      </form>
      {popup}
    </section>
  );
}

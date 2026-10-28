'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';
import { useSitePopup } from '@/components/SitePopup';
import MarkdownWriter from '@/components/blog/MarkdownWriter';
import type { PrivatePost } from '@/lib/journal/private-posts';
import type { CadProject } from '@/lib/site-content';

type Fields = { title: string; description: string; markdown: string; cover: string };

const key = (f: Fields) => JSON.stringify([f.title, f.description, f.markdown, f.cover]);
const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

async function uploadImage(file: File): Promise<string> {
  const form = new FormData();
  form.append('image', file);
  const d = await fetch('/api/journal/posts/images', { method: 'POST', body: form }).then((r) => r.json()).catch(() => null);
  if (!d?.success) throw new Error(d?.message || 'Upload failed');
  return d.src;
}

/**
 * The blog's editor for a private post. There's no publishing: the post is
 * saved to the account a moment after typing stops, and that's it.
 */
export default function PrivatePostEditor({ post, cadProjects }: { post: PrivatePost | null; cadProjects: CadProject[] }) {
  const { confirm, popup } = useSitePopup();
  const start: Fields = { title: post?.title ?? '', description: post?.description ?? '', markdown: post?.markdown ?? '', cover: post?.cover ?? '' };
  const [fields, setFields] = useState<Fields>(start);
  const [id, setId] = useState(post?.id ?? '');
  const [savedKey, setSavedKey] = useState(() => key(start));
  const [savedAt, setSavedAt] = useState(post?.updatedAt ?? '');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'error'>('idle');
  const [uploads, setUploads] = useState(0);
  const [error, setError] = useState('');
  const saveChain = useRef<Promise<unknown>>(Promise.resolve());
  /** Set once we're navigating away on purpose: no more saves, no "leave site?" prompt. */
  const leaving = useRef(false);

  const unsaved = key(fields) !== savedKey;
  const empty = !id && !fields.title.trim() && !fields.markdown.trim() && !fields.description.trim() && !fields.cover;
  const set = (patch: Partial<Fields>) => setFields((f) => ({ ...f, ...patch }));
  const setMarkdown = useCallback((update: SetStateAction<string>) =>
    setFields((f) => ({ ...f, markdown: typeof update === 'function' ? update(f.markdown) : update })), []);

  /** Save now (queued behind any save already on its way). */
  const save = useCallback(() => {
    if (leaving.current || empty) return Promise.resolve(true);
    const postId = id || newId();
    if (!id) {
      setId(postId);
      // Keep the address pointing at this post so a reload carries on with it.
      window.history.replaceState(null, '', `/journal/posts/${postId}/edit`);
    }
    const sent = fields;
    setSaveState('saving');
    const run = saveChain.current.then(async () => {
      const d = await fetch('/api/journal/posts', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: postId, ...sent }) })
        .then((r) => r.json()).catch(() => null);
      if (!d?.success) { setSaveState('error'); return false; }
      setSavedKey(key(sent));
      setSavedAt((d.post as PrivatePost).updatedAt);
      setSaveState('idle');
      return true;
    });
    saveChain.current = run;
    return run;
  }, [id, fields, empty]);

  // Save a short while after typing stops (not while pictures are still uploading).
  useEffect(() => {
    if (!unsaved || empty || uploads > 0) return;
    const t = setTimeout(save, 1200);
    return () => clearTimeout(t);
  }, [unsaved, empty, uploads, save]);

  // Warn before leaving with changes that haven't reached the server yet.
  useEffect(() => {
    if (!unsaved || empty) return;
    const warn = (e: BeforeUnloadEvent) => { if (!leaving.current) e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsaved, empty]);

  const go = (href: string) => { leaving.current = true; window.location.href = href; };

  /** Save what's here, then go (to the post itself unless told otherwise). */
  const leave = async (href?: string) => {
    if (uploads > 0) { setError('Wait for the pictures to finish uploading.'); return; }
    if (unsaved && !(await save())) { setError('Couldn’t save, so the post stayed open.'); return; }
    await saveChain.current;
    go(href ?? (id ? `/journal/posts/${id}` : '/journal/posts'));
  };

  const remove = async () => {
    const ok = await confirm({ title: `Delete “${fields.title || 'Untitled'}”?`, message: 'The post and its pictures are removed for good.', confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    leaving.current = true;
    await saveChain.current;
    const d = await fetch(`/api/journal/posts?id=${encodeURIComponent(id)}`, { method: 'DELETE' }).then((r) => r.json()).catch(() => null);
    if (!d?.success) { leaving.current = false; setError('Couldn’t delete the post.'); return; }
    go('/journal/posts');
  };

  const pickCover = async (file: File | undefined) => {
    if (!file) return;
    setUploads((n) => n + 1);
    setError('');
    try { set({ cover: await uploadImage(file) }); }
    catch (err) { setError(err instanceof Error ? err.message : 'Upload failed'); }
    setUploads((n) => n - 1);
  };

  const statusText = uploads > 0 ? `Uploading ${uploads === 1 ? 'picture' : `${uploads} pictures`}…`
    : saveState === 'saving' ? 'Saving…'
    : saveState === 'error' ? 'Couldn’t save — check the connection'
    : unsaved && !empty ? 'Unsaved changes'
    : savedAt ? `Saved ${new Date(savedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
    : '';

  return (
    <div className="pe animate-fade-in">
      {popup}
      <div className="pe-top">
        <Link href="/journal/posts" className="btn btn-secondary" onClick={(e) => { if (unsaved && !empty) { e.preventDefault(); leave('/journal/posts'); } }}>← Posts</Link>
        <div className="pe-status" aria-live="polite" suppressHydrationWarning><span aria-hidden>🔒</span> Private · {statusText || 'Only you can see this'}</div>
        {id && <button className="btn btn-secondary" onClick={remove}>Delete</button>}
        <button className="btn btn-primary" onClick={() => leave()} disabled={uploads > 0}>Done</button>
      </div>

      {error && <div className="pe-error" role="alert">{error}</div>}

      <div className="pe-meta">
        <input className="pe-title" value={fields.title} onChange={(e) => set({ title: e.target.value })} placeholder="Title" aria-label="Title" />
        <input value={fields.description} onChange={(e) => set({ description: e.target.value })} placeholder="One-line summary (optional)" aria-label="Summary" />
        <div className="pe-row">
          <label className="btn btn-secondary pe-cover-btn">
            {fields.cover ? 'Change cover' : 'Add cover image'}
            <input type="file" accept="image/*" hidden onChange={(e) => { pickCover(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          {fields.cover && <button className="btn btn-secondary" onClick={() => set({ cover: '' })} title="Remove the cover">✕</button>}
        </div>
        {fields.cover && <img className="pe-cover" src={fields.cover} alt="Cover" />}
      </div>

      <MarkdownWriter markdown={fields.markdown} setMarkdown={setMarkdown} title={fields.title} setTitle={(title) => set({ title })}
        upload={uploadImage} setUploads={setUploads} setError={setError} cadProjects={cadProjects}
        onSave={() => { if (uploads === 0) save(); }} />
    </div>
  );
}

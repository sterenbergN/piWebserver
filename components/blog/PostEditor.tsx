'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from 'react';
import { createPortal } from 'react-dom';
import { mediaPath, mediaSrc } from '@/lib/media-url';
import type { PostDraft } from '@/lib/blog/drafts';
import { PROJECT_CATEGORIES, type Project, type Resume } from '@/lib/resume';
import MarkdownWriter from './MarkdownWriter';
import type { CadProject } from '@/lib/site-content';

type Fields = { title: string; description: string; category: string; markdown: string };
type Initial = Fields & { slug: string; cover: string | null };
type PostMedia = { src: string; caption: string };
type GalleryAlbumNode = { id: string; name: string; images: { src: string; caption: string }[]; albums: GalleryAlbumNode[] };
type PublishedSummary = {
  slug: string;
  title: string;
  description: string;
  category: string;
  images: PostMedia[];
};

const EMPTY: Fields = { title: '', description: '', category: '', markdown: '' };

const key = (f: Fields, cover: string, clearCover = false) => JSON.stringify([f.title, f.description, f.category, f.markdown, cover, clearCover]);
const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const editorHref = (d: { id: string; slug: string }) => `/admin/posts/${d.slug || 'new'}?draft=${d.id}`;

function extractPostImages(coverPath: string | null | undefined, markdown: string): PostMedia[] {
  const out: PostMedia[] = [];
  const seen = new Set<string>();
  const add = (rawSrc: string, caption: string) => {
    const clean = rawSrc.trim();
    if (!clean || (!clean.startsWith('/api/media/') && !clean.startsWith('/uploads/'))) return;
    const normalized = mediaPath(clean);
    if (seen.has(normalized)) return;
    seen.add(normalized);
    out.push({ src: normalized, caption });
  };

  if (coverPath) add(coverPath, '');
  const re = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g;
  for (const match of markdown.matchAll(re)) {
    const caption = (match[3] || match[1] || '').trim();
    add(match[2], caption);
  }
  return out;
}

function findMatchingAlbum(albums: GalleryAlbumNode[], slug: string, title: string): GalleryAlbumNode | null {
  const normTitle = title.trim().toLowerCase();
  for (const album of albums) {
    if (album.id === slug || (normTitle && album.name.trim().toLowerCase() === normTitle)) return album;
    const nested = findMatchingAlbum(album.albums || [], slug, title);
    if (nested) return nested;
  }
  return null;
}

function guessProjectCategory(postCategory: string): string {
  const lower = postCategory.trim().toLowerCase();
  return PROJECT_CATEGORIES.find((c) => c.toLowerCase() === lower) ?? 'Other';
}

function fileTail(src: string): string {
  return decodeURIComponent(src.split('?')[0].split('/').pop() || 'photo.jpg').replace(/^\d+-/, '').toLowerCase();
}

function ago(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

async function uploadImage(file: File): Promise<string> {
  const form = new FormData();
  form.append('type', 'blog-inline-image');
  form.append('image', file);
  const d = await fetch('/api/upload', { method: 'POST', body: form }).then((r) => r.json());
  if (!d.success) throw new Error(d.message || 'Upload failed');
  return d.src;
}

/**
 * Write or edit a blog post in the browser: Markdown with a formatting bar,
 * live preview and pictures uploaded in place. Work is saved as a draft on
 * the server while typing, so several posts can be on the go at once and
 * picked up again from any device.
 */
export default function PostEditor({ initial, categories, drafts: initialDrafts, postTitles, draft: openDraft, cadProjects = [] }: {
  initial?: Initial;
  categories: string[];
  /** The CAD section's models, to show or link to in the post. */
  cadProjects?: CadProject[];
  drafts: PostDraft[];
  postTitles: Record<string, string>;
  /** The saved draft being continued, if any. */
  draft: PostDraft | null;
}) {
  const [slug, setSlug] = useState(initial?.slug || '');
  const [publishedCover, setPublishedCover] = useState(initial?.cover || '');
  const legacyKey = `post-draft:${slug || 'new'}`;
  const published: Fields = initial ? { title: initial.title, description: initial.description, category: initial.category, markdown: initial.markdown } : EMPTY;
  const start: Fields = openDraft ? { title: openDraft.title, description: openDraft.description, category: openDraft.category, markdown: openDraft.markdown } : published;

  const [fields, setFields] = useState<Fields>(start);
  const [coverSrc, setCoverSrc] = useState(openDraft?.cover || '');
  const [clearCover, setClearCover] = useState(false);
  const [draftId, setDraftId] = useState(openDraft?.id || '');
  const [drafts, setDrafts] = useState(initialDrafts);
  const [savedKey, setSavedKey] = useState(() => key(start, openDraft?.cover || '', false));
  const [publishedSnapshot, setPublishedSnapshot] = useState(() => key(published, '', false));
  const [savedAt, setSavedAt] = useState(openDraft?.updatedAt || '');
  const [draftState, setDraftState] = useState<'idle' | 'saving' | 'error'>('idle');
  const [showDrafts, setShowDrafts] = useState(!openDraft && !slug && initialDrafts.length > 0);
  const [status, setStatus] = useState<'idle' | 'saving' | 'error'>('idle');
  const [uploads, setUploads] = useState(0);
  const [error, setError] = useState('');
  const [restorable, setRestorable] = useState<{ draft: Fields; at: string } | null>(null);
  const [publishedWizard, setPublishedWizard] = useState<PublishedSummary | null>(null);
  const [albumStatus, setAlbumStatus] = useState<{ state: 'idle' | 'working' | 'linked' | 'error'; albumId?: string; albumName?: string; message?: string }>({ state: 'idle' });
  const [resumeStatus, setResumeStatus] = useState<{ state: 'loading' | 'idle' | 'working' | 'linked' | 'error'; category: string; message?: string }>({ state: 'loading', category: 'Other' });
  const [copiedKind, setCopiedKind] = useState<'url' | 'json' | null>(null);
  const [mounted, setMounted] = useState(false);
  const saveChain = useRef<Promise<unknown>>(Promise.resolve());
  const pendingDraftId = useRef(openDraft?.id || '');
  /** Set once we're navigating away on purpose: no more saves, no "leave site?" prompt. */
  const leaving = useRef(false);

  const currentKey = key(fields, coverSrc, clearCover);
  const unsaved = currentKey !== savedKey;
  // Nothing worth keeping yet: an untouched new post, or a post with no changes.
  const worthSaving = draftId !== '' || currentKey !== publishedSnapshot;
  const otherDraftsOfThisPost = slug && !openDraft ? drafts.filter((d) => d.slug === slug && d.id !== draftId) : [];

  useEffect(() => { setMounted(true); }, []);

  // Drafts from before they were kept on the server lived in this browser; offer to bring one back.
  useEffect(() => {
    if (openDraft) return;
    try {
      const raw = localStorage.getItem(legacyKey);
      if (!raw) return;
      const stored = JSON.parse(raw) as { draft: Fields; at: string };
      if (key(stored.draft, '', false) !== key(start, '', false)) setRestorable(stored);
      else localStorage.removeItem(legacyKey);
    } catch { /* no draft */ }
    // Only on first load.
  }, []);

  /** Save the draft now (queued behind any save already on its way). */
  const saveDraft = useCallback(() => {
    if (leaving.current) return Promise.resolve(false);
    const id = draftId || pendingDraftId.current || newId();
    pendingDraftId.current = id;
    const body = { id, slug, ...fields, cover: coverSrc };
    const sentKey = key(fields, coverSrc, clearCover);
    setDraftState('saving');
    const run = saveChain.current.then(async () => {
      const res = await fetch('/api/blog/drafts', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
      const d = res && res.ok ? await res.json().catch(() => null) : null;
      if (!d?.success) {
        if (!draftId) pendingDraftId.current = '';
        setDraftState('error');
        return false;
      }
      const saved = d.draft as PostDraft;
      if (!draftId) {
        setDraftId(saved.id);
        // Keep the address pointing at this draft only after the server confirms it saved.
        window.history.replaceState(null, '', editorHref({ id: saved.id, slug }));
      }
      setSavedKey(sentKey);
      setSavedAt(saved.updatedAt);
      setDraftState('idle');
      setDrafts((all) => [saved, ...all.filter((x) => x.id !== saved.id)]);
      try { localStorage.removeItem(legacyKey); } catch { }
      return true;
    });
    saveChain.current = run;
    return run;
  }, [draftId, slug, fields, coverSrc, clearCover, legacyKey]);

  // Save a short while after typing stops (not while pictures are still uploading).
  useEffect(() => {
    if (!unsaved || !worthSaving || uploads > 0 || restorable || status === 'saving' || publishedWizard) return;
    const t = setTimeout(saveDraft, 1500);
    return () => clearTimeout(t);
  }, [unsaved, worthSaving, uploads, restorable, status, publishedWizard, saveDraft]);

  useEffect(() => {
    if (!publishedWizard) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPublishedWizard(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [publishedWizard]);

  // Warn before leaving with changes that haven't reached the server yet.
  useEffect(() => {
    if (!unsaved || !worthSaving) return;
    const warn = (e: BeforeUnloadEvent) => { if (!leaving.current) e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsaved, worthSaving]);

  const set = (patch: Partial<Fields>) => setFields((f) => ({ ...f, ...patch }));

  const setMarkdown = useCallback((update: SetStateAction<string>) =>
    setFields((f) => ({ ...f, markdown: typeof update === 'function' ? update(f.markdown) : update })), []);

  const pickCover = async (file: File | undefined) => {
    if (!file) return;
    setUploads((n) => n + 1);
    setError('');
    try {
      setCoverSrc(await uploadImage(file));
      setClearCover(false);
    }
    catch (err) { setError(err instanceof Error ? err.message : 'Upload failed'); }
    setUploads((n) => n - 1);
  };

  const inspectPublishedConnections = useCallback(async (summary: PublishedSummary) => {
    setAlbumStatus({ state: 'idle' });
    setResumeStatus({ state: 'loading', category: guessProjectCategory(summary.category) });
    setCopiedKind(null);

    try {
      const galRes = await fetch('/api/gallery').then((r) => r.json()).catch(() => null);
      if (galRes?.success && Array.isArray(galRes.albums)) {
        const existing = findMatchingAlbum(galRes.albums as GalleryAlbumNode[], summary.slug, summary.title);
        if (existing) {
          const existingTails = new Set(existing.images.map((i) => fileTail(i.src)));
          const missingCount = summary.images.filter((i) => !existingTails.has(fileTail(i.src))).length;
          setAlbumStatus({
            state: 'linked',
            albumId: existing.id,
            albumName: existing.name,
            message: missingCount > 0
              ? `✓ Linked to Gallery album “${existing.name}” (${existing.images.length} photo${existing.images.length === 1 ? '' : 's'}). ${missingCount} post image${missingCount === 1 ? '' : 's'} can be synced.`
              : `✓ Linked to Gallery album “${existing.name}” (${existing.images.length} photo${existing.images.length === 1 ? '' : 's'}).`,
          });
        }
      }
    } catch { /* ignore */ }

    try {
      const resData = await fetch('/api/resume').then((r) => r.json()).catch(() => null) as { success?: boolean; resume?: Resume } | null;
      if (resData?.success && resData.resume) {
        const normTitle = summary.title.trim().toLowerCase();
        const found = resData.resume.projects.find(
          (p) => p.blogSlug === summary.slug || p.id === summary.slug || p.name.trim().toLowerCase() === normTitle
        );
        if (found) {
          setResumeStatus({
            state: 'linked',
            category: found.category,
            message: `✓ Linked on Resume under “${found.name}” (${found.category}).`,
          });
          return;
        }
      }
    } catch { /* ignore */ }
    setResumeStatus({ state: 'idle', category: guessProjectCategory(summary.category) });
  }, []);

  const handleLinkGalleryAlbum = async () => {
    if (!publishedWizard || albumStatus.state === 'working') return;
    setAlbumStatus((prev) => ({ ...prev, state: 'working', message: 'Creating & linking Gallery album…' }));
    try {
      const galRes = await fetch('/api/gallery').then((r) => r.json());
      if (!galRes?.success || !Array.isArray(galRes.albums)) throw new Error(galRes?.message || 'Could not load gallery');

      let album = findMatchingAlbum(galRes.albums as GalleryAlbumNode[], publishedWizard.slug, publishedWizard.title);
      if (!album) {
        const createRes = await fetch('/api/gallery', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: publishedWizard.title, id: publishedWizard.slug }),
        }).then((r) => r.json());
        if (!createRes?.success || !createRes.album) throw new Error(createRes?.message || 'Could not create album');
        album = createRes.album as GalleryAlbumNode;
      }

      const existingTails = new Set((album.images || []).map((i) => fileTail(i.src)));
      let added = 0;
      let failed = 0;
      for (const img of publishedWizard.images) {
        if (existingTails.has(fileTail(img.src))) continue;
        try {
          const imgRes = await fetch(mediaPath(img.src));
          if (!imgRes.ok) throw new Error(`HTTP ${imgRes.status}`);
          const blob = await imgRes.blob();
          const filename = decodeURIComponent(img.src.split('?')[0].split('/').pop() || 'image.jpg');
          const file = new File([blob], filename, { type: blob.type || 'image/jpeg' });
          const form = new FormData();
          form.append('type', 'gallery');
          form.append('albumId', album.id);
          form.append('caption', img.caption);
          form.append('image', file);
          const upRes = await fetch('/api/upload', { method: 'POST', body: form }).then((r) => r.json());
          if (upRes?.success) {
            added++;
            existingTails.add(fileTail(img.src));
          } else {
            failed++;
          }
        } catch {
          failed++;
        }
      }

      const totalCount = (album.images?.length || 0) + added;
      setAlbumStatus({
        state: 'linked',
        albumId: album.id,
        albumName: album.name,
        message: failed > 0
          ? `✓ Linked to Gallery album “${album.name}” (${added} added, ${failed} failed).`
          : `✓ Linked to Gallery album “${album.name}” (${totalCount} photo${totalCount === 1 ? '' : 's'}).`,
      });
    } catch (err) {
      setAlbumStatus((prev) => ({
        ...prev,
        state: 'error',
        message: err instanceof Error ? err.message : 'Could not link Gallery album.',
      }));
    }
  };

  const handleAddToResume = async () => {
    if (!publishedWizard || resumeStatus.state === 'working') return;
    setResumeStatus((prev) => ({ ...prev, state: 'working', message: 'Adding project to Resume…' }));
    try {
      const resData = await fetch('/api/resume').then((r) => r.json()) as { success?: boolean; resume?: Resume; error?: string };
      if (!resData?.success || !resData.resume) throw new Error(resData?.error || 'Could not load resume');

      const currentResume = resData.resume;
      const normTitle = publishedWizard.title.trim().toLowerCase();
      const existing = currentResume.projects.find(
        (p) => p.blogSlug === publishedWizard.slug || p.id === publishedWizard.slug || p.name.trim().toLowerCase() === normTitle
      );

      let nextProjects: Project[];
      if (existing) {
        nextProjects = currentResume.projects.map((p) =>
          p.id === existing.id
            ? { ...p, blogSlug: publishedWizard.slug, description: p.description || publishedWizard.description }
            : p
        );
      } else {
        const entry: Project = {
          id: publishedWizard.slug,
          name: publishedWizard.title,
          description: publishedWizard.description,
          category: resumeStatus.category,
          blogSlug: publishedWizard.slug,
        };
        nextProjects = [...currentResume.projects, entry];
      }

      const saveRes = await fetch('/api/resume', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...currentResume, projects: nextProjects }),
      }).then((r) => r.json());
      if (!saveRes?.success) throw new Error(saveRes?.error || 'Could not update resume');

      setResumeStatus({
        state: 'linked',
        category: resumeStatus.category,
        message: `✓ Added “${publishedWizard.title}” to Resume (${resumeStatus.category}).`,
      });
    } catch (err) {
      setResumeStatus((prev) => ({
        ...prev,
        state: 'error',
        message: err instanceof Error ? err.message : 'Could not update Resume.',
      }));
    }
  };

  const copyWizardText = async (kind: 'url' | 'json', text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKind(kind);
      setTimeout(() => setCopiedKind((k) => (k === kind ? null : k)), 2000);
    } catch {
      setError('Could not copy to clipboard.');
    }
  };

  const publish = async () => {
    if (!fields.title.trim() || !fields.markdown.trim()) { setStatus('error'); setError('Add a title and some text first.'); return; }
    setStatus('saving');
    setError('');
    try {
      await saveChain.current;
      const form = new FormData();
      form.append('type', 'blog-editor');
      form.append('slug', slug);
      form.append('title', fields.title);
      form.append('description', fields.description);
      form.append('category', fields.category);
      form.append('markdown', fields.markdown);
      if (coverSrc) form.append('coverSrc', coverSrc);
      else if (clearCover) form.append('coverImage', '');
      if (draftId) form.append('draftId', draftId);
      const d = await fetch('/api/upload', { method: 'POST', body: form }).then((r) => r.json());
      if (!d.success) throw new Error(d.message || 'Could not publish');
      try { localStorage.removeItem(legacyKey); } catch { }
      try { localStorage.removeItem(`post-draft:${d.slug}`); } catch { }

      const finalCover = typeof d.post?.image === 'string' ? d.post.image : (!clearCover ? (coverSrc || publishedCover) : '');
      const nextKey = key(fields, '', false);
      setSlug(d.slug);
      setPublishedCover(finalCover);
      setCoverSrc('');
      setClearCover(false);
      if (draftId) {
        setDrafts((all) => all.filter((x) => x.id !== draftId));
        setDraftId('');
        pendingDraftId.current = '';
      }
      setSavedKey(nextKey);
      setPublishedSnapshot(nextKey);
      setSavedAt('');
      setStatus('idle');
      window.history.replaceState(null, '', `/admin/posts/${d.slug}`);

      const summary: PublishedSummary = {
        slug: d.slug,
        title: d.post?.title || fields.title.trim(),
        description: d.post?.description || fields.description.trim(),
        category: d.post?.category || fields.category.trim(),
        images: extractPostImages(finalCover, fields.markdown),
      };
      setPublishedWizard(summary);
      void inspectPublishedConnections(summary);
    } catch (err) {
      leaving.current = false;
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Could not publish');
    }
  };

  /** Go to another draft (or a blank post), saving this one first. */
  const open = async (href: string) => {
    if (uploads > 0) { setError('Wait for the pictures to finish uploading.'); return; }
    if (unsaved && worthSaving && !(await saveDraft())) { setError('Could not save this draft, so it stayed open.'); return; }
    leaving.current = true;
    window.location.href = href;
  };

  const removeDraft = async (d: PostDraft) => {
    if (!window.confirm(`Delete the draft “${d.title || 'Untitled'}”? This can't be undone.`)) return;
    const r = await fetch(`/api/blog/drafts?id=${encodeURIComponent(d.id)}`, { method: 'DELETE' }).then((x) => x.json()).catch(() => null);
    if (!r?.success) { setError('Could not delete that draft.'); return; }
    setDrafts((all) => all.filter((x) => x.id !== d.id));
    if (d.id === draftId) {
      // Throwing away the open draft: start again from the published post (or a blank page).
      leaving.current = true;
      window.location.href = slug ? `/admin/posts/${slug}` : '/admin/posts/new';
    }
  };

  const coverShown = coverSrc ? mediaSrc(coverSrc, 1280) : !clearCover && publishedCover ? mediaSrc(publishedCover, 1280) : null;
  const busy = status === 'saving' || uploads > 0;

  const statusText = status === 'saving' ? 'Publishing…'
    : uploads > 0 ? `Uploading ${uploads === 1 ? 'picture' : `${uploads} pictures`}…`
    : draftState === 'saving' ? 'Saving draft…'
    : draftState === 'error' ? 'Couldn’t save the draft — check the connection'
    : unsaved && worthSaving ? 'Unsaved changes'
    : savedAt ? `Draft saved ${new Date(savedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
    : slug ? 'No changes' : '';

  return (
    <div className="pe animate-fade-in">
      <div className="pe-top">
        <Link href={slug ? `/blog/${slug}` : '/blog'} className="btn btn-secondary">← {slug ? 'Post' : 'Posts'}</Link>
        <button className={`btn btn-secondary pe-drafts-btn${showDrafts ? ' is-on' : ''}`} onClick={() => setShowDrafts((s) => !s)} aria-expanded={showDrafts}>
          Drafts{drafts.length > 0 && <span className="pe-count">{drafts.length}</span>}
        </button>
        <div className="pe-status" aria-live="polite" suppressHydrationWarning>{statusText}</div>
        <button className="btn btn-secondary" onClick={() => saveDraft()} disabled={busy || !worthSaving || (!unsaved && draftId !== '')}>Save draft</button>
        <button className="btn btn-primary" onClick={publish} disabled={busy}>
          {slug ? 'Update post' : 'Publish'}
        </button>
      </div>

      {showDrafts && (
        <div className="glass-panel pe-drafts">
          <div className="pe-drafts-head">
            <strong>Drafts</strong>
            <button className="btn btn-secondary" onClick={() => open('/admin/posts/new')}>+ New post</button>
          </div>
          {drafts.length === 0 ? <p className="pe-muted">No drafts yet. Anything you write is kept here until you publish it.</p> : (
            <ul>
              {drafts.map((d) => (
                <li key={d.id} className={d.id === draftId ? 'is-current' : undefined}>
                  <button className="pe-draft-open" onClick={() => open(editorHref(d))} disabled={d.id === draftId}>
                    <span className="pe-draft-title">{d.title || 'Untitled'}</span>
                    <span className="pe-draft-meta" suppressHydrationWarning>
                      {d.slug ? `Changes to “${postTitles[d.slug] || d.slug}”` : 'New post'} · {ago(d.updatedAt)}
                      {d.id === draftId && ' · open now'}
                    </span>
                  </button>
                  <button className="pe-draft-del" onClick={() => removeDraft(d)} title="Delete draft" aria-label={`Delete draft ${d.title || 'Untitled'}`}>✕</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {otherDraftsOfThisPost.length > 0 && (
        <div className="pe-banner" role="status">
          <span suppressHydrationWarning>You have {otherDraftsOfThisPost.length === 1 ? 'a draft' : `${otherDraftsOfThisPost.length} drafts`} of this post (last edited {ago(otherDraftsOfThisPost[0].updatedAt)}).</span>
          <button className="btn btn-primary" onClick={() => open(editorHref(otherDraftsOfThisPost[0]))}>Open {otherDraftsOfThisPost.length === 1 ? 'it' : 'the latest'}</button>
        </div>
      )}

      {restorable && (
        <div className="pe-banner" role="status">
          <span>This browser has an unsaved draft from {new Date(restorable.at).toLocaleString()}.</span>
          <span style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="btn btn-primary" onClick={() => { setFields(restorable.draft); setRestorable(null); }}>Restore it</button>
            <button className="btn btn-secondary" onClick={() => { try { localStorage.removeItem(legacyKey); } catch { } setRestorable(null); }}>Discard</button>
          </span>
        </div>
      )}
      {error && <div className="pe-error" role="alert">{error}</div>}

      <div className="pe-meta">
        <input className="pe-title" value={fields.title} onChange={(e) => set({ title: e.target.value })} placeholder="Post title" aria-label="Title" />
        <input value={fields.description} onChange={(e) => set({ description: e.target.value })} placeholder="One-line summary (shown on cards and link previews)" aria-label="Summary" />
        <div className="pe-row">
          <CategoryPicker value={fields.category} categories={categories} onChange={(category) => set({ category })} />
          <label className="btn btn-secondary pe-cover-btn">
            {coverShown ? 'Change cover' : 'Add cover image'}
            <input type="file" accept="image/*" hidden onChange={(e) => { pickCover(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          {coverSrc && <button type="button" className="btn btn-secondary" onClick={() => setCoverSrc('')} title="Undo the new cover">✕</button>}
          {!coverSrc && publishedCover && !clearCover && (
            <button type="button" className="btn btn-secondary" onClick={() => setClearCover(true)} title="Remove cover image">Remove cover</button>
          )}
          {!coverSrc && publishedCover && clearCover && (
            <button type="button" className="btn btn-secondary" onClick={() => setClearCover(false)}>Restore cover</button>
          )}
        </div>
        {coverShown && <img className="pe-cover" src={coverShown} alt="Cover" />}
      </div>

      <MarkdownWriter markdown={fields.markdown} setMarkdown={setMarkdown} title={fields.title} setTitle={(title) => set({ title })}
        upload={uploadImage} setUploads={setUploads} setError={setError} cadProjects={cadProjects}
        onSave={() => { if (worthSaving && uploads === 0) saveDraft(); }} />

      {publishedWizard && mounted && createPortal(
        <div
          className="pe-wizard-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pe-wizard-title"
          onClick={(e) => { if (e.target === e.currentTarget) setPublishedWizard(null); }}
        >
          <div className="glass-panel animate-fade-in pe-wizard-card">
            <div className="pe-wizard-head">
              <div>
                <h2 id="pe-wizard-title">🎉 Post Published — Connect Across Your Site</h2>
                <p className="pe-muted">
                  <strong>{publishedWizard.title}</strong> is live at <code>/blog/{publishedWizard.slug}</code>.
                </p>
              </div>
              <button type="button" className="pe-wizard-close" aria-label="Close" onClick={() => setPublishedWizard(null)}>✕</button>
            </div>

            <div className="pe-wizard-sections">
              <div className="pe-wizard-box">
                <div className="pe-wizard-box-head">
                  <strong>🖼️ Gallery Album</strong>
                  <span className="pe-muted">
                    {publishedWizard.images.length} post image{publishedWizard.images.length === 1 ? '' : 's'} detected
                  </span>
                </div>
                <p className="pe-wizard-desc">
                  Create or sync a Gallery album for this post so photos can be browsed in the Gallery.
                </p>
                <div className="pe-wizard-actions">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={albumStatus.state === 'working'}
                    onClick={() => void handleLinkGalleryAlbum()}
                  >
                    {albumStatus.state === 'working'
                      ? 'Linking album…'
                      : albumStatus.state === 'linked'
                        ? '🖼️ Sync / Re-link Gallery Album'
                        : '🖼️ Create / Link Gallery Album'}
                  </button>
                  {albumStatus.albumId && (
                    <Link href={`/gallery?album=${encodeURIComponent(albumStatus.albumId)}`} className="btn btn-secondary">
                      Open Album →
                    </Link>
                  )}
                </div>
                {albumStatus.message && (
                  <p className={`pe-wizard-msg${albumStatus.state === 'error' ? ' is-error' : albumStatus.state === 'linked' ? ' is-ok' : ''}`} role="status">
                    {albumStatus.message}
                  </p>
                )}
              </div>

              <div className="pe-wizard-box">
                <div className="pe-wizard-box-head">
                  <strong>📄 Resume Project</strong>
                  <span className="pe-muted">
                    {resumeStatus.state === 'loading' ? 'Checking Resume…' : resumeStatus.state === 'linked' ? 'Connected' : 'Optional'}
                  </span>
                </div>
                <p className="pe-wizard-desc">
                  Feature this post as a project on your Resume & Home Page, or copy its JSON snippet.
                </p>
                <div className="pe-wizard-actions">
                  <select
                    className="pe-wizard-select"
                    aria-label="Resume project category"
                    value={resumeStatus.category}
                    disabled={resumeStatus.state === 'working' || resumeStatus.state === 'linked'}
                    onChange={(e) => setResumeStatus((prev) => ({ ...prev, category: e.target.value }))}
                  >
                    {PROJECT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={resumeStatus.state === 'working' || resumeStatus.state === 'loading' || resumeStatus.state === 'linked'}
                    onClick={() => void handleAddToResume()}
                  >
                    {resumeStatus.state === 'working'
                      ? 'Adding…'
                      : resumeStatus.state === 'linked'
                        ? '✓ On Resume'
                        : '📄 Add to Resume'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => void copyWizardText('json', JSON.stringify({
                      id: publishedWizard.slug,
                      name: publishedWizard.title,
                      description: publishedWizard.description,
                      category: resumeStatus.category,
                      blogSlug: publishedWizard.slug,
                    }, null, 2))}
                  >
                    {copiedKind === 'json' ? '✓ Copied JSON' : '📋 Copy Resume JSON'}
                  </button>
                  <Link href="/admin/resume" className="btn btn-secondary">
                    Open Resume Editor →
                  </Link>
                </div>
                {resumeStatus.message && (
                  <p className={`pe-wizard-msg${resumeStatus.state === 'error' ? ' is-error' : resumeStatus.state === 'linked' ? ' is-ok' : ''}`} role="status">
                    {resumeStatus.message}
                  </p>
                )}
              </div>
            </div>

            <div className="pe-wizard-foot">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => void copyWizardText('url', `${window.location.origin}/blog/${publishedWizard.slug}`)}
              >
                {copiedKind === 'url' ? '✓ Copied Post URL' : '🔗 Copy Post URL'}
              </button>
              <span style={{ flex: 1 }} />
              <button type="button" className="btn btn-secondary" onClick={() => setPublishedWizard(null)}>
                Keep Editing
              </button>
              <Link
                href={`/blog/${publishedWizard.slug}`}
                className="btn btn-primary"
                onClick={() => { leaving.current = true; }}
              >
                View Post →
              </Link>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

const NEW_CATEGORY = '__new-category__';

/**
 * Pick one of the categories the posts already use, or type a new one. A new
 * name that matches an existing category apart from case becomes that one.
 */
function CategoryPicker({ value, categories, onChange }: { value: string; categories: string[]; onChange: (category: string) => void }) {
  const [adding, setAdding] = useState(false);
  const [typed, setTyped] = useState('');
  // Includes a category that's only on this post so far (a new one, or from a draft).
  const options = useMemo(() => [...new Set([...categories, ...(value ? [value] : [])])].sort((a, b) => a.localeCompare(b)), [categories, value]);

  const finish = (name = typed) => {
    const trimmed = name.trim().replace(/\s+/g, ' ');
    if (trimmed) onChange(categories.find((c) => c.toLowerCase() === trimmed.toLowerCase()) ?? trimmed);
    setAdding(false);
    setTyped('');
  };

  if (adding) {
    return (
      <span className="pe-category is-new">
        <input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="New category name" aria-label="New category name" maxLength={60}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); finish(); }
            if (e.key === 'Escape') { e.preventDefault(); setAdding(false); setTyped(''); }
          }} />
        <button type="button" className="btn btn-primary" onClick={() => finish()} disabled={!typed.trim()}>Add</button>
        <button type="button" className="btn btn-secondary" onClick={() => { setAdding(false); setTyped(''); }} title="Back to the list">✕</button>
      </span>
    );
  }
  return (
    <span className="pe-category">
      <select value={value} aria-label="Category" onChange={(e) => (e.target.value === NEW_CATEGORY ? setAdding(true) : onChange(e.target.value))}>
        <option value="">No category</option>
        {options.map((c) => <option key={c} value={c}>{c}{categories.includes(c) ? '' : ' (new)'}</option>)}
        <option value={NEW_CATEGORY}>＋ New category…</option>
      </select>
    </span>
  );
}

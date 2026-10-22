'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import { mediaSrc } from '@/lib/media-url';
import { applyFormat, type FormatAction } from '@/lib/blog/markdown-format';
import type { PostDraft } from '@/lib/blog/drafts';
import PostImage from './PostImage';

type Fields = { title: string; description: string; category: string; markdown: string };
type Initial = Fields & { slug: string; cover: string | null };

const EMPTY: Fields = { title: '', description: '', category: '', markdown: '' };
const TOOLS: { action: FormatAction; label: string; title: string }[] = [
  { action: 'bold', label: 'B', title: 'Bold (Ctrl+B)' },
  { action: 'italic', label: 'I', title: 'Italic (Ctrl+I)' },
  { action: 'h2', label: 'H2', title: 'Heading' },
  { action: 'h3', label: 'H3', title: 'Subheading' },
  { action: 'link', label: '🔗', title: 'Link (Ctrl+K)' },
  { action: 'ul', label: '•', title: 'Bulleted list' },
  { action: 'ol', label: '1.', title: 'Numbered list' },
  { action: 'quote', label: '❝', title: 'Quote' },
  { action: 'code', label: '</>', title: 'Code' },
];

const key = (f: Fields, cover: string) => JSON.stringify([f.title, f.description, f.category, f.markdown, cover]);
const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const editorHref = (d: { id: string; slug: string }) => `/admin/posts/${d.slug || 'new'}?draft=${d.id}`;
const isImage = (f: File) => f.type.startsWith('image/');

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
export default function PostEditor({ initial, categories, drafts: initialDrafts, postTitles, draft: openDraft }: {
  initial?: Initial;
  categories: string[];
  drafts: PostDraft[];
  postTitles: Record<string, string>;
  /** The saved draft being continued, if any. */
  draft: PostDraft | null;
}) {
  const slug = initial?.slug || '';
  const legacyKey = `post-draft:${slug || 'new'}`;
  const published: Fields = initial ? { title: initial.title, description: initial.description, category: initial.category, markdown: initial.markdown } : EMPTY;
  const start: Fields = openDraft ? { title: openDraft.title, description: openDraft.description, category: openDraft.category, markdown: openDraft.markdown } : published;

  const [fields, setFields] = useState<Fields>(start);
  const [coverSrc, setCoverSrc] = useState(openDraft?.cover || '');
  const [draftId, setDraftId] = useState(openDraft?.id || '');
  const [drafts, setDrafts] = useState(initialDrafts);
  const [savedKey, setSavedKey] = useState(() => key(start, openDraft?.cover || ''));
  const [savedAt, setSavedAt] = useState(openDraft?.updatedAt || '');
  const [draftState, setDraftState] = useState<'idle' | 'saving' | 'error'>('idle');
  const [showDrafts, setShowDrafts] = useState(!openDraft && !slug && initialDrafts.length > 0);
  const [view, setView] = useState<'write' | 'preview'>('write');
  const [status, setStatus] = useState<'idle' | 'saving' | 'error'>('idle');
  const [uploads, setUploads] = useState(0);
  const [dropping, setDropping] = useState(false);
  const [error, setError] = useState('');
  const [restorable, setRestorable] = useState<{ draft: Fields; at: string } | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const mdInput = useRef<HTMLInputElement>(null);
  const saveChain = useRef<Promise<unknown>>(Promise.resolve());
  /** Set once we're navigating away on purpose: no more saves, no "leave site?" prompt. */
  const leaving = useRef(false);

  const currentKey = key(fields, coverSrc);
  const unsaved = currentKey !== savedKey;
  // Nothing worth keeping yet: an untouched new post, or a post with no changes.
  const worthSaving = draftId !== '' || currentKey !== key(published, '');
  const otherDraftsOfThisPost = slug && !openDraft ? drafts.filter((d) => d.slug === slug && d.id !== draftId) : [];

  // Drafts from before they were kept on the server lived in this browser; offer to bring one back.
  useEffect(() => {
    if (openDraft) return;
    try {
      const raw = localStorage.getItem(legacyKey);
      if (!raw) return;
      const stored = JSON.parse(raw) as { draft: Fields; at: string };
      if (key(stored.draft, '') !== key(start, '')) setRestorable(stored);
      else localStorage.removeItem(legacyKey);
    } catch { /* no draft */ }
    // Only on first load.
  }, []);

  /** Save the draft now (queued behind any save already on its way). */
  const saveDraft = useCallback(() => {
    if (leaving.current) return Promise.resolve(false);
    const id = draftId || newId();
    if (!draftId) {
      setDraftId(id);
      // Keep the address pointing at this draft so a reload carries on with it.
      window.history.replaceState(null, '', editorHref({ id, slug }));
    }
    const body = { id, slug, ...fields, cover: coverSrc };
    const sentKey = key(fields, coverSrc);
    setDraftState('saving');
    const run = saveChain.current.then(async () => {
      const d = await fetch('/api/blog/drafts', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        .then((r) => r.json()).catch(() => null);
      if (!d?.success) { setDraftState('error'); return false; }
      const saved = d.draft as PostDraft;
      setSavedKey(sentKey);
      setSavedAt(saved.updatedAt);
      setDraftState('idle');
      setDrafts((all) => [saved, ...all.filter((x) => x.id !== saved.id)]);
      try { localStorage.removeItem(legacyKey); } catch { }
      return true;
    });
    saveChain.current = run;
    return run;
  }, [draftId, slug, fields, coverSrc, legacyKey]);

  // Save a short while after typing stops (not while pictures are still uploading).
  useEffect(() => {
    if (!unsaved || !worthSaving || uploads > 0 || restorable) return;
    const t = setTimeout(saveDraft, 1500);
    return () => clearTimeout(t);
  }, [unsaved, worthSaving, uploads, restorable, saveDraft]);

  // Warn before leaving with changes that haven't reached the server yet.
  useEffect(() => {
    if (!unsaved || !worthSaving) return;
    const warn = (e: BeforeUnloadEvent) => { if (!leaving.current) e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsaved, worthSaving]);

  const set = (patch: Partial<Fields>) => setFields((f) => ({ ...f, ...patch }));

  /** Replace the textarea selection and keep the caret where the formatter says. */
  const edit = useCallback((next: { text: string; selStart: number; selEnd: number }) => {
    setFields((f) => ({ ...f, markdown: next.text }));
    requestAnimationFrame(() => {
      const el = textRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(next.selStart, next.selEnd);
    });
  }, []);

  const format = (action: FormatAction) => {
    const el = textRef.current;
    if (!el) return;
    setView('write');
    edit(applyFormat(fields.markdown, el.selectionStart, el.selectionEnd, action));
  };

  /**
   * Upload pictures and put them in the text at the cursor. A placeholder
   * holds each one's spot, so typing carries on while they upload.
   */
  const insertImages = async (files: File[]) => {
    const images = files.filter(isImage);
    if (images.length === 0) return;
    const el = textRef.current;
    const at = el ? el.selectionEnd : fields.markdown.length;
    const tag = Date.now().toString(36);
    const holders = images.map((f, i) => `![Uploading ${f.name.replace(/[[\]]/g, '')}…](uploading-${tag}-${i})`);
    const block = `\n\n${holders.join('\n\n')}\n\n`;
    edit({ text: fields.markdown.slice(0, at) + block + fields.markdown.slice(at), selStart: at + block.length, selEnd: at + block.length });
    setView('write');
    setError('');
    setUploads((n) => n + images.length);
    // One at a time: kinder to the Pi than several big photos at once.
    for (const [i, file] of images.entries()) {
      let replacement = '';
      try {
        const src = await uploadImage(file);
        const alt = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').replace(/[[\]]/g, '').trim();
        replacement = `![${alt}](${src})`;
      } catch (err) {
        setError(`${file.name}: ${err instanceof Error ? err.message : 'Upload failed'}`);
      }
      // A failed upload takes its placeholder (and the blank line before it) away again.
      setFields((f) => ({ ...f, markdown: replacement ? f.markdown.replace(holders[i], () => replacement) : f.markdown.replace(`\n\n${holders[i]}`, '').replace(holders[i], '') }));
      setUploads((n) => n - 1);
    }
  };

  /** Load a .md file written elsewhere; a leading "# Title" becomes the title if there isn't one yet. */
  const importMarkdown = async (file: File | undefined) => {
    if (!file) return;
    let text = (await file.text()).replace(/\r\n/g, '\n');
    if (fields.markdown.trim() && !window.confirm(`Replace the text with “${file.name}”?`)) return;
    const heading = text.match(/^\s*#\s+(.+)\n+/);
    const patch: Partial<Fields> = {};
    if (heading && !fields.title.trim()) {
      patch.title = heading[1].trim();
      text = text.slice(heading[0].length);
    }
    set({ ...patch, markdown: text });
    setView('write');
    setError('');
  };

  const pickCover = async (file: File | undefined) => {
    if (!file) return;
    setUploads((n) => n + 1);
    setError('');
    try { setCoverSrc(await uploadImage(file)); }
    catch (err) { setError(err instanceof Error ? err.message : 'Upload failed'); }
    setUploads((n) => n - 1);
  };

  const publish = async () => {
    if (!fields.title.trim() || !fields.markdown.trim()) { setStatus('error'); setError('Add a title and some text first.'); return; }
    setStatus('saving');
    setError('');
    try {
      await saveChain.current;
      leaving.current = true;
      const form = new FormData();
      form.append('type', 'blog-editor');
      form.append('slug', slug);
      form.append('title', fields.title);
      form.append('description', fields.description);
      form.append('category', fields.category);
      form.append('markdown', fields.markdown);
      if (coverSrc) form.append('coverSrc', coverSrc);
      if (draftId) form.append('draftId', draftId);
      const d = await fetch('/api/upload', { method: 'POST', body: form }).then((r) => r.json());
      if (!d.success) throw new Error(d.message || 'Could not publish');
      try { localStorage.removeItem(legacyKey); } catch { }
      window.location.href = `/blog/${d.slug}`;
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

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase();
    const action = k === 'b' ? 'bold' : k === 'i' ? 'italic' : k === 'k' ? 'link' : k === 's' ? 'save' : null;
    if (!action) return;
    e.preventDefault();
    if (action === 'save') { if (worthSaving && uploads === 0) saveDraft(); } else format(action);
  };

  const words = useMemo(() => fields.markdown.replace(/[#*_`>\[\]()!-]/g, ' ').split(/\s+/).filter(Boolean).length, [fields.markdown]);
  const coverShown = coverSrc ? mediaSrc(coverSrc, 1280) : initial?.cover ? mediaSrc(initial.cover, 1280) : null;
  const busy = status === 'saving' || uploads > 0;

  const statusText = status === 'saving' ? 'Publishing…'
    : uploads > 0 ? `Uploading ${uploads === 1 ? 'picture' : `${uploads} pictures`}…`
    : draftState === 'saving' ? 'Saving draft…'
    : draftState === 'error' ? 'Couldn’t save the draft — check the connection'
    : unsaved && worthSaving ? 'Unsaved changes'
    : savedAt ? `Draft saved ${new Date(savedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
    : slug ? 'No changes' : '';

  const preview = (
    <div className="glass-panel markdown-body post-body pe-preview">
      {fields.markdown.trim() ? (
        <Markdown components={{
          a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
          img: ({ node: _node, src, alt, title }) => typeof src === 'string' && src.startsWith('uploading-')
            ? <span className="pe-uploading">{alt}</span>
            : <PostImage src={src} alt={alt} title={title} />,
        }}>{fields.markdown}</Markdown>
      ) : <p className="pe-muted">Nothing to preview yet.</p>}
    </div>
  );

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
          {coverSrc && <button className="btn btn-secondary" onClick={() => setCoverSrc('')} title="Undo the new cover">✕</button>}
        </div>
        {coverShown && <img className="pe-cover" src={coverShown} alt="Cover" />}
      </div>

      <div className="pe-tabs" role="tablist" aria-label="Editor view">
        <button role="tab" aria-selected={view === 'write'} onClick={() => setView('write')}>Write</button>
        <button role="tab" aria-selected={view === 'preview'} onClick={() => setView('preview')}>Preview</button>
      </div>

      <div className={`pe-panes is-${view}`}>
        <div className="pe-write">
          <div className="pe-toolbar" role="toolbar" aria-label="Formatting">
            {TOOLS.map((t) => (
              <button key={t.action} type="button" title={t.title} aria-label={t.title} onMouseDown={(e) => e.preventDefault()} onClick={() => format(t.action)}>{t.label}</button>
            ))}
            <button type="button" className="pe-photo-btn" title="Insert photos at the cursor (or drag them in, or paste)" onMouseDown={(e) => e.preventDefault()} onClick={() => imageInput.current?.click()}>🖼️ Photos</button>
            <input ref={imageInput} type="file" accept="image/*" multiple hidden onChange={(e) => { insertImages([...(e.target.files || [])]); e.target.value = ''; }} />
            <button type="button" className="pe-md-btn" title="Load the text from a Markdown (.md) file" onMouseDown={(e) => e.preventDefault()} onClick={() => mdInput.current?.click()}>📄 Import .md</button>
            <input ref={mdInput} type="file" accept=".md,.markdown,text/markdown" hidden onChange={(e) => { importMarkdown(e.target.files?.[0]); e.target.value = ''; }} />
          </div>
          <textarea
            ref={textRef}
            className={`pe-text${dropping ? ' is-dropping' : ''}`}
            value={fields.markdown}
            onChange={(e) => set({ markdown: e.target.value })}
            onKeyDown={onKeyDown}
            onPaste={(e) => {
              // Pasting a screenshot uploads it and inserts it where the cursor is.
              const files = [...e.clipboardData.files].filter(isImage);
              if (files.length) { e.preventDefault(); insertImages(files); }
            }}
            onDragOver={(e) => {
              if (![...e.dataTransfer.items].some((i) => i.kind === 'file')) return;
              e.preventDefault();
              setDropping(true);
            }}
            onDragLeave={() => setDropping(false)}
            onDrop={(e) => {
              setDropping(false);
              const files = [...e.dataTransfer.files].filter(isImage);
              if (!files.length) return;
              e.preventDefault();
              insertImages(files);
            }}
            placeholder={'Write in Markdown…\n\n## A heading\n\nSome **bold** text, a [link](https://…), and a list:\n\n- one\n- two\n\nDrag photos in, paste them, or use 🖼️ Photos.'}
            aria-label="Post text (Markdown)"
            spellCheck
          />
          <div className="pe-foot">
            {words} words · {Math.max(1, Math.round(words / 220))} min read · Ctrl+S saves the draft · Caption a photo: <code>![alt](link &quot;Caption&quot;)</code>
          </div>
        </div>
        {preview}
      </div>
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

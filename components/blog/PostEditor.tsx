'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import { mediaSrc } from '@/lib/media-url';
import { applyFormat, type FormatAction } from '@/lib/blog/markdown-format';

type Draft = { title: string; description: string; category: string; markdown: string };
type Initial = Draft & { slug: string; cover: string | null };

const EMPTY: Draft = { title: '', description: '', category: '', markdown: '' };
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

/**
 * Write or edit a blog post in the browser: Markdown with a formatting bar,
 * live preview, pictures uploaded in place, and a draft kept on this device
 * so nothing is lost if the tab closes.
 */
export default function PostEditor({ initial, categories }: { initial?: Initial; categories: string[] }) {
  const slug = initial?.slug || '';
  const draftKey = `post-draft:${slug || 'new'}`;
  const start: Draft = initial ? { title: initial.title, description: initial.description, category: initial.category, markdown: initial.markdown } : EMPTY;

  const [draft, setDraft] = useState<Draft>(start);
  const [saved, setSaved] = useState<Draft>(start);
  const [cover, setCover] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [view, setView] = useState<'write' | 'preview'>('write');
  const [status, setStatus] = useState<'idle' | 'saving' | 'uploading' | 'error'>('idle');
  const [error, setError] = useState('');
  const [restorable, setRestorable] = useState<{ draft: Draft; at: string } | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);

  const dirty = cover !== null || JSON.stringify(draft) !== JSON.stringify(saved);

  // Offer a draft left over from an earlier visit (only if it differs from what's saved).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(draftKey);
      if (!raw) return;
      const stored = JSON.parse(raw) as { draft: Draft; at: string };
      if (JSON.stringify(stored.draft) !== JSON.stringify(start)) setRestorable(stored);
      else localStorage.removeItem(draftKey);
    } catch { /* no draft */ }
    // Only on first load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep a copy on this device while typing (after a short pause).
  useEffect(() => {
    if (!dirty || restorable) return;
    const t = setTimeout(() => {
      try { localStorage.setItem(draftKey, JSON.stringify({ draft, at: new Date().toISOString() })); } catch { }
    }, 800);
    return () => clearTimeout(t);
  }, [draft, dirty, draftKey, restorable]);

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  useEffect(() => () => { if (coverPreview) URL.revokeObjectURL(coverPreview); }, [coverPreview]);

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  /** Replace the textarea selection and keep the caret where the formatter says. */
  const edit = useCallback((next: { text: string; selStart: number; selEnd: number }) => {
    setDraft((d) => ({ ...d, markdown: next.text }));
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
    edit(applyFormat(draft.markdown, el.selectionStart, el.selectionEnd, action));
  };

  const insertImage = async (file: File | undefined) => {
    if (!file) return;
    const el = textRef.current;
    const at = el ? el.selectionEnd : draft.markdown.length;
    setStatus('uploading');
    setError('');
    try {
      const form = new FormData();
      form.append('type', 'blog-inline-image');
      form.append('image', file);
      const d = await fetch('/api/upload', { method: 'POST', body: form }).then((r) => r.json());
      if (!d.success) throw new Error(d.message || 'Upload failed');
      const alt = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
      const snippet = `\n\n![${alt}](${d.src})\n\n`;
      const text = draft.markdown.slice(0, at) + snippet + draft.markdown.slice(at);
      edit({ text, selStart: at + snippet.length, selEnd: at + snippet.length });
      setStatus('idle');
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Upload failed');
    }
  };

  const save = async () => {
    if (!draft.title.trim() || !draft.markdown.trim()) { setStatus('error'); setError('Add a title and some text first.'); return; }
    setStatus('saving');
    setError('');
    try {
      const form = new FormData();
      form.append('type', 'blog-editor');
      form.append('slug', slug);
      form.append('title', draft.title);
      form.append('description', draft.description);
      form.append('category', draft.category);
      form.append('markdown', draft.markdown);
      if (cover) form.append('cover', cover);
      const d = await fetch('/api/upload', { method: 'POST', body: form }).then((r) => r.json());
      if (!d.success) throw new Error(d.message || 'Could not save');
      try { localStorage.removeItem(draftKey); } catch { }
      setSaved(draft);
      setCover(null);
      window.location.href = `/blog/${d.slug}`;
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Could not save');
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const key = e.key.toLowerCase();
    const action = key === 'b' ? 'bold' : key === 'i' ? 'italic' : key === 'k' ? 'link' : key === 's' ? 'save' : null;
    if (!action) return;
    e.preventDefault();
    if (action === 'save') save(); else format(action);
  };

  const words = useMemo(() => draft.markdown.replace(/[#*_`>\[\]()!-]/g, ' ').split(/\s+/).filter(Boolean).length, [draft.markdown]);
  const coverShown = coverPreview || (initial?.cover ? mediaSrc(initial.cover, 1280) : null);

  const preview = (
    <div className="glass-panel markdown-body post-body pe-preview">
      {draft.markdown.trim() ? (
        <Markdown components={{
          a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
          img: ({ node: _node, src, alt }) => <img src={typeof src === 'string' ? mediaSrc(src, 1280) : undefined} alt={alt || ''} loading="lazy" />,
        }}>{draft.markdown}</Markdown>
      ) : <p className="pe-muted">Nothing to preview yet.</p>}
    </div>
  );

  return (
    <div className="pe animate-fade-in">
      <div className="pe-top">
        <Link href={slug ? `/blog/${slug}` : '/blog'} className="btn btn-secondary">← {slug ? 'Back to post' : 'Posts'}</Link>
        <div className="pe-status" aria-live="polite">
          {status === 'saving' ? 'Publishing…' : status === 'uploading' ? 'Uploading picture…' : dirty ? 'Draft kept on this device' : slug ? 'No changes' : ''}
        </div>
        <button className="btn btn-primary" onClick={save} disabled={status === 'saving' || status === 'uploading'}>
          {slug ? 'Save changes' : 'Publish'}
        </button>
      </div>

      {restorable && (
        <div className="pe-banner" role="status">
          <span>You have an unsaved draft from {new Date(restorable.at).toLocaleString()}.</span>
          <span style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="btn btn-primary" onClick={() => { setDraft(restorable.draft); setRestorable(null); }}>Restore it</button>
            <button className="btn btn-secondary" onClick={() => { try { localStorage.removeItem(draftKey); } catch { } setRestorable(null); }}>Discard</button>
          </span>
        </div>
      )}
      {error && <div className="pe-error" role="alert">{error}</div>}

      <div className="pe-meta">
        <input className="pe-title" value={draft.title} onChange={(e) => set({ title: e.target.value })} placeholder="Post title" aria-label="Title" />
        <input value={draft.description} onChange={(e) => set({ description: e.target.value })} placeholder="One-line summary (shown on cards and link previews)" aria-label="Summary" />
        <div className="pe-row">
          <input value={draft.category} onChange={(e) => set({ category: e.target.value })} placeholder="Category" list="pe-categories" aria-label="Category" />
          <datalist id="pe-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
          <label className="btn btn-secondary pe-cover-btn">
            {coverShown ? 'Change cover' : 'Add cover image'}
            <input type="file" accept="image/*" hidden onChange={(e) => {
              const f = e.target.files?.[0] || null;
              setCover(f);
              if (coverPreview) URL.revokeObjectURL(coverPreview);
              setCoverPreview(f ? URL.createObjectURL(f) : null);
              e.target.value = '';
            }} />
          </label>
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
            <button type="button" title="Insert a picture" aria-label="Insert a picture" onClick={() => imageInput.current?.click()}>🖼️</button>
            <input ref={imageInput} type="file" accept="image/*" hidden onChange={(e) => { insertImage(e.target.files?.[0]); e.target.value = ''; }} />
          </div>
          <textarea
            ref={textRef}
            className="pe-text"
            value={draft.markdown}
            onChange={(e) => set({ markdown: e.target.value })}
            onKeyDown={onKeyDown}
            onPaste={(e) => {
              // Pasting a screenshot uploads it and inserts it where the cursor is.
              const file = [...e.clipboardData.files].find((f) => f.type.startsWith('image/'));
              if (file) { e.preventDefault(); insertImage(file); }
            }}
            placeholder={'Write in Markdown…\n\n## A heading\n\nSome **bold** text, a [link](https://…), and a list:\n\n- one\n- two'}
            aria-label="Post text (Markdown)"
            spellCheck
          />
          <div className="pe-foot">{words} words · {Math.max(1, Math.round(words / 220))} min read · Ctrl+S publishes</div>
        </div>
        {preview}
      </div>
    </div>
  );
}

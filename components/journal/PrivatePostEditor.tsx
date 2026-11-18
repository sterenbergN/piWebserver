'use client';

import Link from 'next/link';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type KeyboardEvent,
  type SetStateAction,
} from 'react';
import { useSitePopup } from '@/components/SitePopup';
import { PostMarkdown, markdownWords } from '@/components/blog/MarkdownWriter';
import { cadPre } from '@/components/blog/CadEmbed';
import type { FormatAction } from '@/lib/blog/markdown-format';
import { cadBlock, cadHref } from '@/lib/cad/embeds';
import { applyJournalFormat, continueList } from '@/lib/journal/markdown';
import type { PrivatePost } from '@/lib/journal/private-posts';
import type { CadProject } from '@/lib/site-content';

type Fields = { title: string; description: string; markdown: string; cover: string };

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

const isImage = (f: File) => f.type.startsWith('image/');
const key = (f: Fields) => JSON.stringify([f.title, f.description, f.markdown, f.cover]);
const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

async function uploadImage(file: File): Promise<string> {
  const form = new FormData();
  form.append('image', file);
  const d = await fetch('/api/journal/posts/images', { method: 'POST', body: form }).then((r) => r.json()).catch(() => null);
  if (!d?.success) throw new Error(d?.message || 'Upload failed');
  return d.src;
}

function PrivateMarkdownWriter({
  markdown,
  setMarkdown,
  title,
  setTitle,
  upload,
  setUploads,
  setError,
  onSave,
  cadProjects = [],
}: {
  markdown: string;
  setMarkdown: Dispatch<SetStateAction<string>>;
  title: string;
  setTitle: (title: string) => void;
  upload: (file: File) => Promise<string>;
  setUploads: Dispatch<SetStateAction<number>>;
  setError: (message: string) => void;
  onSave?: () => void;
  cadProjects?: CadProject[];
}) {
  const [view, setView] = useState<'write' | 'preview'>('write');
  const [dropping, setDropping] = useState(false);
  const [cadMenu, setCadMenu] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const mdInput = useRef<HTMLInputElement>(null);
  const pendingSelection = useRef<[number, number] | null>(null);

  // Restore caret synchronously right after React commits the updated value so fast typing never loses characters.
  useLayoutEffect(() => {
    const el = textRef.current;
    const sel = pendingSelection.current;
    if (!el || !sel) return;
    pendingSelection.current = null;
    if (document.activeElement !== el) el.focus({ preventScroll: true });
    el.setSelectionRange(sel[0], sel[1]);
  }, [markdown]);

  const edit = useCallback((next: { text: string; selStart: number; selEnd: number }) => {
    pendingSelection.current = [next.selStart, next.selEnd];
    setMarkdown(next.text);
  }, [setMarkdown]);

  const cadPreview = useMemo(() => cadPre(cadProjects), [cadProjects]);

  const insertCad = (cad: CadProject, as: 'card' | 'link') => {
    const el = textRef.current;
    const start = el ? el.selectionStart : markdown.length;
    const end = el ? el.selectionEnd : start;
    const text = markdown;
    if (as === 'card') {
      const before = text.slice(0, start).replace(/\n*$/, '');
      const lead = before ? '\n\n' : '';
      const insert = `${lead}${cadBlock(cad.id)}\n\n`;
      const caret = before.length + insert.length;
      edit({ text: before + insert + text.slice(end).replace(/^\n*/, ''), selStart: caret, selEnd: caret });
    } else {
      const label = (text.slice(start, end) || cad.name).replace(/[[\]]/g, '');
      const insert = `[${label}](${cadHref(cad.id)})`;
      const caret = start + insert.length;
      edit({ text: text.slice(0, start) + insert + text.slice(end), selStart: caret, selEnd: caret });
    }
    setCadMenu(false);
    setView('write');
  };

  const format = (action: FormatAction) => {
    const el = textRef.current;
    if (!el) return;
    setView('write');
    edit(applyJournalFormat(el.value, el.selectionStart, el.selectionEnd, action));
  };

  const insertImages = async (files: File[]) => {
    const images = files.filter(isImage);
    if (images.length === 0) return;
    const el = textRef.current;
    const at = el ? el.selectionEnd : markdown.length;
    const tag = Date.now().toString(36);
    const holders = images.map((f, i) => `![Uploading ${f.name.replace(/[[\]]/g, '')}…](uploading-${tag}-${i})`);
    const block = `\n\n${holders.join('\n\n')}\n\n`;
    edit({ text: markdown.slice(0, at) + block + markdown.slice(at), selStart: at + block.length, selEnd: at + block.length });
    setView('write');
    setError('');
    setUploads((n) => n + images.length);
    for (const [i, file] of images.entries()) {
      let replacement = '';
      try {
        const src = await upload(file);
        const alt = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').replace(/[[\]]/g, '').trim();
        replacement = `![${alt}](${src})`;
      } catch (err) {
        setError(`${file.name}: ${err instanceof Error ? err.message : 'Upload failed'}`);
      }
      setMarkdown((md) => (replacement ? md.replace(holders[i], () => replacement) : md.replace(`\n\n${holders[i]}`, '').replace(holders[i], '')));
      setUploads((n) => n - 1);
    }
  };

  const importMarkdown = async (file: File | undefined) => {
    if (!file) return;
    let text = (await file.text()).replace(/\r\n/g, '\n');
    if (markdown.trim() && !window.confirm(`Replace the text with “${file.name}”?`)) return;
    const heading = text.match(/^\s*#\s+(.+)\n+/);
    if (heading && !title.trim()) {
      setTitle(heading[1].trim());
      text = text.slice(heading[0].length);
    }
    setMarkdown(text);
    setView('write');
    setError('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    if ((e.ctrlKey || e.metaKey)) {
      const k = e.key.toLowerCase();
      const action = k === 'b' ? 'bold' : k === 'i' ? 'italic' : k === 'k' ? 'link' : k === 's' ? 'save' : null;
      if (action) {
        e.preventDefault();
        if (action === 'save') onSave?.();
        else format(action);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && el.selectionStart === el.selectionEnd) {
      const next = continueList(el.value, el.selectionStart);
      if (next) {
        e.preventDefault();
        edit(next);
      }
    }
  };

  const words = useMemo(() => markdownWords(markdown), [markdown]);

  return (
    <>
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
            <span className="pe-cad">
              <button type="button" className="pe-cad-btn" title="Show a CAD model in the post, or link to it" aria-expanded={cadMenu} onMouseDown={(e) => e.preventDefault()} onClick={() => setCadMenu((v) => !v)}>🧊 CAD</button>
              {cadMenu && (
                <div className="pe-cad-menu" role="menu" aria-label="CAD models">
                  {cadProjects.length === 0 ? <p>No CAD models yet. Add them in the CAD section on the home page.</p> : (
                    <>
                      <p>From the CAD section: a card shows it as it is there (3D view included); a link goes to it.</p>
                      <ul>
                        {cadProjects.map((cad) => (
                          <li key={cad.id}>
                            <span>{cad.model ? '🧊' : '📐'} {cad.name}</span>
                            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => insertCad(cad, 'card')}>Card</button>
                            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => insertCad(cad, 'link')}>Link</button>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              )}
            </span>
            <button type="button" className="pe-photo-btn" title="Insert photos at the cursor (or drag them in, or paste)" onMouseDown={(e) => e.preventDefault()} onClick={() => imageInput.current?.click()}>🖼️ Photos</button>
            <input ref={imageInput} type="file" accept="image/*" multiple hidden onChange={(e) => { insertImages([...(e.target.files || [])]); e.target.value = ''; }} />
            <button type="button" className="pe-md-btn" title="Load the text from a Markdown (.md) file" onMouseDown={(e) => e.preventDefault()} onClick={() => mdInput.current?.click()}>📄 Import .md</button>
            <input ref={mdInput} type="file" accept=".md,.markdown,text/markdown" hidden onChange={(e) => { importMarkdown(e.target.files?.[0]); e.target.value = ''; }} />
          </div>
          <textarea
            ref={textRef}
            className={`pe-text${dropping ? ' is-dropping' : ''}`}
            value={markdown}
            onChange={(e) => setMarkdown(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={(e) => {
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
            {words} words · {Math.max(1, Math.round(words / 220))} min read · Ctrl+S saves · Caption a photo: <code>![alt](link &quot;Caption&quot;)</code>
          </div>
        </div>
        <div className="glass-panel markdown-body post-body pe-preview">
          {markdown.trim() ? <PostMarkdown markdown={markdown} cadProjects={cadProjects} cadPreview={cadPreview} /> : <p className="pe-muted">Nothing to preview yet.</p>}
        </div>
      </div>
    </>
  );
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
  const postIdRef = useRef(post?.id ?? '');
  const creatingRef = useRef(false);
  /** Set once we're navigating away on purpose: no more saves, no "leave site?" prompt. */
  const leaving = useRef(false);

  const unsaved = key(fields) !== savedKey;
  const empty = !id && !postIdRef.current && !fields.title.trim() && !fields.markdown.trim() && !fields.description.trim() && !fields.cover;
  const set = (patch: Partial<Fields>) => setFields((f) => ({ ...f, ...patch }));
  const setMarkdown = useCallback((update: SetStateAction<string>) =>
    setFields((f) => ({ ...f, markdown: typeof update === 'function' ? update(f.markdown) : update })), []);

  /** Save now (queued behind any save already on its way). */
  const save = useCallback((): Promise<boolean> => {
    if (leaving.current || empty) return Promise.resolve(true);
    let postId = postIdRef.current;
    if (!postId) {
      if (creatingRef.current) return saveChain.current.then(() => save());
      creatingRef.current = true;
      postId = newId();
      postIdRef.current = postId;
      setId(postId);
      // Keep the address pointing at this post so a reload carries on with it.
      window.history.replaceState(null, '', `/journal/posts/${postId}/edit`);
    }
    const sent = fields;
    const stableId = postId;
    setSaveState('saving');
    const run = saveChain.current.then(async () => {
      try {
        const d = await fetch('/api/journal/posts', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: stableId, ...sent }) })
          .then((r) => r.json()).catch(() => null);
        if (!d?.success) { setSaveState('error'); return false; }
        setSavedKey(key(sent));
        setSavedAt((d.post as PrivatePost).updatedAt);
        setSaveState('idle');
        return true;
      } finally {
        creatingRef.current = false;
      }
    });
    saveChain.current = run;
    return run;
  }, [fields, empty]);

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
    const activeId = postIdRef.current || id;
    go(href ?? (activeId ? `/journal/posts/${activeId}` : '/journal/posts'));
  };

  const remove = async () => {
    const activeId = postIdRef.current || id;
    if (!activeId) return;
    const ok = await confirm({ title: `Delete “${fields.title || 'Untitled'}”?`, message: 'The post and its pictures are removed for good.', confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    leaving.current = true;
    await saveChain.current;
    const d = await fetch(`/api/journal/posts?id=${encodeURIComponent(activeId)}`, { method: 'DELETE' }).then((r) => r.json()).catch(() => null);
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
    <div className="pe jr-pe animate-fade-in">
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

      <PrivateMarkdownWriter markdown={fields.markdown} setMarkdown={setMarkdown} title={fields.title} setTitle={(title) => set({ title })}
        upload={uploadImage} setUploads={setUploads} setError={setError} cadProjects={cadProjects}
        onSave={() => { if (uploads === 0) save(); }} />
    </div>
  );
}

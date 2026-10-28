'use client';

import { useCallback, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import Markdown from 'react-markdown';
import { applyFormat, type FormatAction } from '@/lib/blog/markdown-format';
import PostImage from './PostImage';
import { cadPre } from './CadEmbed';
import { cadBlock, cadHref } from '@/lib/cad/embeds';
import type { CadProject } from '@/lib/site-content';

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

/** Words in Markdown, ignoring its syntax. */
export const markdownWords = (md: string) => md.replace(/[#*_`>\[\]()!-]/g, ' ').split(/\s+/).filter(Boolean).length;

/**
 * The writing half of the post editor: Markdown with a formatting bar, a live
 * preview, CAD models and pictures uploaded in place (pasted, dropped or
 * picked). Where the pictures go and how the text is kept is up to the page using it.
 */
export default function MarkdownWriter({ markdown, setMarkdown, title, setTitle, upload, setUploads, setError, onSave, cadProjects = [] }: {
  markdown: string;
  setMarkdown: Dispatch<SetStateAction<string>>;
  /** A .md file's leading "# Title" becomes the title if there isn't one yet. */
  title: string;
  setTitle: (title: string) => void;
  /** Store a picture and return its src for the Markdown. */
  upload: (file: File) => Promise<string>;
  /** Counts pictures still uploading, so the page can hold off saving. */
  setUploads: Dispatch<SetStateAction<number>>;
  setError: (message: string) => void;
  /** Ctrl+S. */
  onSave?: () => void;
  /** The CAD section's models, to show or link to in the text. */
  cadProjects?: CadProject[];
}) {
  const [view, setView] = useState<'write' | 'preview'>('write');
  const [dropping, setDropping] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const mdInput = useRef<HTMLInputElement>(null);

  /** Replace the textarea selection and keep the caret where the formatter says. */
  const edit = useCallback((next: { text: string; selStart: number; selEnd: number }) => {
    setMarkdown(next.text);
    requestAnimationFrame(() => {
      const el = textRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(next.selStart, next.selEnd);
    });
  }, [setMarkdown]);

  /** The CAD model menu on the toolbar. */
  const [cadMenu, setCadMenu] = useState(false);
  const cadPreview = useMemo(() => cadPre(cadProjects), [cadProjects]);

  /** Put a CAD model's card (its own paragraph) or a link to it (around the selection) at the cursor. */
  const insertCad = (cad: CadProject, as: 'card' | 'link') => {
    const el = textRef.current;
    const start = el ? el.selectionStart : markdown.length;
    const end = el ? el.selectionEnd : start;
    const text = markdown;
    let insert: string;
    if (as === 'card') {
      const before = text.slice(0, start).replace(/\n*$/, '');
      const lead = before ? '\n\n' : '';
      insert = `${lead}${cadBlock(cad.id)}\n\n`;
      edit({ text: before + insert + text.slice(end).replace(/^\n*/, ''), selStart: before.length + insert.length, selEnd: before.length + insert.length });
    } else {
      const label = (text.slice(start, end) || cad.name).replace(/[[\]]/g, '');
      insert = `[${label}](${cadHref(cad.id)})`;
      edit({ text: text.slice(0, start) + insert + text.slice(end), selStart: start + insert.length, selEnd: start + insert.length });
    }
    setCadMenu(false);
    setView('write');
  };

  const format = (action: FormatAction) => {
    const el = textRef.current;
    if (!el) return;
    setView('write');
    edit(applyFormat(markdown, el.selectionStart, el.selectionEnd, action));
  };

  /**
   * Upload pictures and put them in the text at the cursor. A placeholder
   * holds each one's spot, so typing carries on while they upload.
   */
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
    // One at a time: kinder to the Pi than several big photos at once.
    for (const [i, file] of images.entries()) {
      let replacement = '';
      try {
        const src = await upload(file);
        const alt = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').replace(/[[\]]/g, '').trim();
        replacement = `![${alt}](${src})`;
      } catch (err) {
        setError(`${file.name}: ${err instanceof Error ? err.message : 'Upload failed'}`);
      }
      // A failed upload takes its placeholder (and the blank line before it) away again.
      setMarkdown((md) => (replacement ? md.replace(holders[i], () => replacement) : md.replace(`\n\n${holders[i]}`, '').replace(holders[i], '')));
      setUploads((n) => n - 1);
    }
  };

  /** Load a .md file written elsewhere; a leading "# Title" becomes the title if there isn't one yet. */
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

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase();
    const action = k === 'b' ? 'bold' : k === 'i' ? 'italic' : k === 'k' ? 'link' : k === 's' ? 'save' : null;
    if (!action) return;
    e.preventDefault();
    if (action === 'save') onSave?.(); else format(action);
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

/** A post's Markdown as readers see it (pictures still uploading show as a placeholder). */
export function PostMarkdown({ markdown, cadProjects = [], cadPreview }: { markdown: string; cadProjects?: CadProject[]; cadPreview?: ReturnType<typeof cadPre> }) {
  const pre = useMemo(() => cadPreview ?? cadPre(cadProjects), [cadPreview, cadProjects]);
  return (
    <Markdown components={{
      a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
      pre,
      img: ({ node: _node, src, alt, title }) => typeof src === 'string' && src.startsWith('uploading-')
        ? <span className="pe-uploading">{alt}</span>
        : <PostImage src={src} alt={alt} title={title} />,
    }}>{markdown}</Markdown>
  );
}

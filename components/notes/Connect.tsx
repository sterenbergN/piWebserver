'use client';

import { useEffect, useState } from 'react';
import { Icon } from '@/components/study/Icon';
import { cleanUrl, type MarkElement, type MarkRole, type MarkTarget, type Notebook } from '@/lib/notes/items';
import { liveNotebooks, pagesToLinkTo, readInk } from './notebooks';

// Connecting notes, Supernote-style: lasso some writing, then make it a link to another page, a
// heading in the notebook's outline, or a keyword to find it by, or turn it into typed text. The
// server reads the writing first, so the label is already filled in; it can always be corrected.

/** The few pictures these need that the shared icon set doesn't have. */
export function Glyph({ name }: { name: 'tag' | 'heading' | 'to-text' }) {
  const paths = {
    tag: <><path d="M12.6 2.6A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.7 8.7a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4z" /><circle cx="7.5" cy="7.5" r="1.5" /></>,
    heading: <path d="M6 4v16M18 4v16M6 12h12" />,
    'to-text': <><path d="M3 15c2-3 3-3 4 0s2 3 4 0" /><path d="M14 6h7M17.5 6v12" /></>,
  };
  return (
    <svg className="sd-icon" width="1.1em" height="1.1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

export type ConnectRequest = { role: MarkRole | 'text'; mark?: MarkElement };

type Ink = { id: string; p: number[]; width: number }[];

const TITLES: Record<ConnectRequest['role'], string> = { link: 'Link', heading: 'Heading', keyword: 'Keyword', text: 'Turn into typed text' };

export function ConnectDialog({ request, ink, notebook, onSave, onConvert, onCancel }: {
  request: ConnectRequest;
  ink: Ink;
  notebook: string;
  onSave: (label: string, extra: { level?: 1 | 2 | 3; target?: MarkTarget }) => void;
  onConvert: (text: string) => void;
  onCancel: () => void;
}) {
  const { role, mark } = request;
  const [label, setLabel] = useState(mark?.label ?? '');
  const [reading, setReading] = useState(!mark && ink.length > 0);
  const [problem, setProblem] = useState('');
  const [level, setLevel] = useState<1 | 2 | 3>(mark?.level ?? 1);
  const target = mark?.target;
  const [kind, setKind] = useState<'page' | 'web'>(target && 'url' in target ? 'web' : 'page');
  const [url, setUrl] = useState(target && 'url' in target ? target.url : '');
  const [toNotebook, setToNotebook] = useState(target && 'notebook' in target ? target.notebook : notebook);
  const [toPage, setToPage] = useState<string | null>(target && 'notebook' in target ? target.page ?? null : null);
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [pages, setPages] = useState<{ id: string; number: number; label: string }[]>([]);

  // Fill in what the writing says.
  useEffect(() => {
    if (mark || !ink.length) return;
    let live = true;
    readInk(ink).then((text) => {
      if (!live) return;
      setLabel((held) => held || (role === 'text' ? text : text.replace(/\n/g, ' ')));
    }).catch((error) => {
      if (live) setProblem(`${error instanceof Error ? error.message : 'It couldn’t be read.'} Type what it says instead.`);
    }).finally(() => { if (live) setReading(false); });
    return () => { live = false; };
  }, [ink, mark, role]);

  useEffect(() => {
    if (role !== 'link') return;
    void liveNotebooks().then((list) => setNotebooks(list.sort((a, b) => (a.id === notebook ? -1 : b.id === notebook ? 1 : a.title.localeCompare(b.title)))));
  }, [role, notebook]);

  useEffect(() => {
    if (role !== 'link') return;
    void pagesToLinkTo(toNotebook).then(setPages);
  }, [role, toNotebook]);

  const webTarget = cleanUrl(/^[a-z]+:/i.test(url.trim()) ? url.trim() : `https://${url.trim()}`);
  const ready = role === 'text' ? !!label.trim() : role === 'keyword' ? !!label.trim() : role === 'link' ? (kind === 'web' ? !!webTarget : true) : true;

  const save = () => {
    if (!ready) return;
    if (role === 'text') { onConvert(label); return; }
    if (role === 'heading') { onSave(label.trim(), { level }); return; }
    if (role === 'link') { onSave(label.trim(), { target: kind === 'web' ? { url: webTarget! } : { notebook: toNotebook, ...(toPage ? { page: toPage } : {}) } }); return; }
    onSave(label.trim(), {});
  };

  return (
    <div className="nt-menu is-wide" role="dialog" aria-label={TITLES[role]} onClick={(e) => e.stopPropagation()}>
      <label className="nt-menu-title">
        {mark ? `Change ${TITLES[role].toLowerCase()}` : TITLES[role]}
        {role === 'text' ? (
          <textarea className="nt-input" rows={4} value={label} placeholder={reading ? 'Reading your writing…' : 'What it says'} onChange={(e) => setLabel(e.target.value)} />
        ) : (
          <input
            className="nt-input" value={label} maxLength={200} autoFocus={!!mark}
            placeholder={reading ? 'Reading your writing…' : role === 'keyword' ? 'The word to find it by' : role === 'heading' ? 'What the section is about' : 'What the link says (optional)'}
            onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
          />
        )}
      </label>
      {reading && <p className="nt-hint">Reading your writing…</p>}
      {problem && <p className="nt-hint is-error">{problem}</p>}
      {role === 'text' && <p className="nt-hint">The handwriting is swapped for this text. Undo brings the handwriting back.</p>}
      {role === 'keyword' && <p className="nt-hint">Keywords are tags: find every page with this one under Tags in your notebooks.</p>}

      {role === 'heading' && (
        <>
          <div className="nt-label">Level</div>
          <div className="nt-tabs is-wide">
            {([1, 2, 3] as const).map((value) => (
              <button key={value} type="button" className={level === value ? 'is-on' : ''} aria-pressed={level === value} onClick={() => setLevel(value)}>{value === 1 ? 'Section' : value === 2 ? 'Part' : 'Detail'}</button>
            ))}
          </div>
        </>
      )}

      {role === 'link' && (
        <>
          <div className="nt-label">Goes to</div>
          <div className="nt-tabs is-wide">
            <button type="button" className={kind === 'page' ? 'is-on' : ''} aria-pressed={kind === 'page'} onClick={() => setKind('page')}>A page</button>
            <button type="button" className={kind === 'web' ? 'is-on' : ''} aria-pressed={kind === 'web'} onClick={() => setKind('web')}>A web address</button>
          </div>
          {kind === 'web' ? (
            <input className="nt-input nt-gap" type="url" inputMode="url" placeholder="https://…" aria-label="Web address" value={url} onChange={(e) => setUrl(e.target.value)} />
          ) : (
            <>
              <select className="nt-select nt-gap" aria-label="Notebook" value={toNotebook} onChange={(e) => { setToNotebook(e.target.value); setToPage(null); }}>
                {notebooks.map((n) => <option key={n.id} value={n.id}>{n.id === notebook ? `${n.title} (this one)` : n.title}</option>)}
              </select>
              <div className="nt-menu-list nt-link-pages">
                <button type="button" className={!toPage ? 'is-on' : ''} onClick={() => setToPage(null)}><Icon name="book" /> The notebook itself</button>
                {pages.map((page) => (
                  <button type="button" key={page.id} className={toPage === page.id ? 'is-on' : ''} onClick={() => setToPage(page.id)}>
                    <span className="nt-link-number">{page.number}</span> {page.label || <span className="nt-muted">Page {page.number}</span>}
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      )}

      <div className="nt-row">
        <button type="button" className="nt-btn" onClick={onCancel}>Cancel</button>
        <span className="nt-grow" />
        <button type="button" className="nt-btn is-primary" disabled={!ready} onClick={save}>{role === 'text' ? 'Replace with text' : mark ? 'Save' : 'Make it'}</button>
      </div>
    </div>
  );
}

/** Tags on a page: add with the keyboard, take one off with its ×. */
export function TagEditor({ tags, known, onChange }: { tags: string[]; known: string[]; onChange: (tags: string[]) => void }) {
  const [draft, setDraft] = useState('');
  const add = (value: string) => {
    const tag = value.replace(/^#+/, '').trim();
    if (!tag || tags.some((t) => t.toLowerCase() === tag.toLowerCase())) { setDraft(''); return; }
    onChange([...tags, tag]);
    setDraft('');
  };
  const suggestions = known.filter((tag) => !tags.some((t) => t.toLowerCase() === tag.toLowerCase()) && (!draft || tag.toLowerCase().includes(draft.toLowerCase()))).slice(0, 8);
  return (
    <div className="nt-tags">
      <div className="nt-swatches">
        {tags.map((tag) => (
          <span key={tag} className="nt-tag">#{tag}<button type="button" aria-label={`Remove ${tag}`} onClick={() => onChange(tags.filter((t) => t !== tag))}><Icon name="x" size="0.9em" /></button></span>
        ))}
      </div>
      <input
        className="nt-input nt-gap" value={draft} placeholder="Add a tag" aria-label="Add a tag" maxLength={40} autoFocus
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(draft); } }}
      />
      {suggestions.length > 0 && (
        <div className="nt-swatches nt-gap">
          {suggestions.map((tag) => <button type="button" key={tag} className="nt-chip" onClick={() => add(tag)}>#{tag}</button>)}
        </div>
      )}
    </div>
  );
}

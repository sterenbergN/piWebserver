'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSitePopup } from '@/components/SitePopup';
import type { LibraryDocument } from '@/lib/site-content';

type EditState = { url: string; name: string; category: string; note: string };
type ViewMode = 'cards' | 'list';

const UNCATEGORIZED = 'Uncategorized';
const HUES = [262, 210, 160, 30, 340, 190, 100, 0];

/** A stable colour per category so the same shelf always looks the same. */
function categoryHue(category: string) {
  let h = 0;
  for (const ch of category) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return HUES[h % HUES.length];
}

const formatDate = (date?: string) => (date ? new Date(date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '');

function DocIcon({ category }: { category: string }) {
  const hue = categoryHue(category);
  return (
    <span className="lib-icon" style={{ background: `hsla(${hue}, 70%, 55%, 0.16)`, color: `hsl(${hue}, 70%, 65%)` }} aria-hidden>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
      </svg>
    </span>
  );
}

type LibraryClientProps = { initialDocuments: LibraryDocument[]; initialIsAdmin: boolean };

export default function LibraryClient({ initialDocuments, initialIsAdmin }: LibraryClientProps) {
  const { confirm, popup } = useSitePopup();
  const [documents, setDocuments] = useState<LibraryDocument[]>(initialDocuments);
  const isAdmin = initialIsAdmin;
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>('cards');
  const [openNotes, setOpenNotes] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    try { if (localStorage.getItem('lib_view') === 'list') setView('list'); } catch { }
  }, []);
  const changeView = (next: ViewMode) => { setView(next); try { localStorage.setItem('lib_view', next); } catch { } };

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const d of documents) counts.set(d.category || UNCATEGORIZED, (counts.get(d.category || UNCATEGORIZED) || 0) + 1);
    return [...counts].sort((a, b) => a[0].localeCompare(b[0]));
  }, [documents]);

  const q = query.trim().toLowerCase();
  const visible = documents.filter(d =>
    (!category || (d.category || UNCATEGORIZED) === category) &&
    (!q || [d.name, d.category, d.note].some(f => String(f || '').toLowerCase().includes(q))));

  // Grouped into shelves when browsing everything; a flat list while filtering.
  const groups: [string, LibraryDocument[]][] = category || q
    ? [['', visible]]
    : categories.map(([cat]) => [cat, visible.filter(d => (d.category || UNCATEGORIZED) === cat)]);

  const handleDelete = async (doc: LibraryDocument) => {
    if (!(await confirm({ title: 'Delete document', message: `Delete “${doc.name}”?`, confirmLabel: 'Delete', danger: true }))) return;
    const res = await fetch('/api/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'library', id: doc.url }) });
    if ((await res.json()).success) setDocuments(prev => prev.filter(d => d.url !== doc.url));
  };

  const handleSaveEdit = async () => {
    if (!editing) return;
    setSaving(true);
    const res = await fetch('/api/edit', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'library', ...editing }) });
    if ((await res.json()).success) {
      setDocuments(prev => prev.map(d => (d.url === editing.url ? { ...d, name: editing.name, category: editing.category, note: editing.note } : d)));
      setEditing(null);
    }
    setSaving(false);
  };

  const toggleNote = (url: string) => setOpenNotes(prev => {
    const next = new Set(prev);
    if (next.has(url)) next.delete(url); else next.add(url);
    return next;
  });

  const renderEditor = () => editing && (
    <div className="glass-panel lib-editor animate-fade-in">
      <h3 style={{ margin: 0 }}>Edit document</h3>
      <label><span className="lib-label">Title</span><input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} /></label>
      <label><span className="lib-label">Category</span><input value={editing.category} list="lib-categories" onChange={e => setEditing({ ...editing, category: e.target.value })} placeholder="e.g. Hardware" /></label>
      <datalist id="lib-categories">{categories.map(([c]) => <option key={c} value={c} />)}</datalist>
      <label><span className="lib-label">Public note</span><textarea value={editing.note} onChange={e => setEditing({ ...editing, note: e.target.value })} placeholder="Optional description…" rows={3} /></label>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button className="btn btn-primary" onClick={handleSaveEdit} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        <button className="btn btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
      </div>
    </div>
  );

  const renderDoc = (doc: LibraryDocument) => {
    if (editing?.url === doc.url) return <div key={doc.url} style={{ gridColumn: '1 / -1' }}>{renderEditor()}</div>;
    const cat = doc.category || UNCATEGORIZED;
    const noteOpen = openNotes.has(doc.url);
    return (
      <article key={doc.url} className="lib-doc">
        <DocIcon category={cat} />
        <div className="lib-doc-body">
          <a className="lib-doc-title" href={doc.url} target="_blank" rel="noreferrer">{doc.name}</a>
          <div className="lib-doc-meta">
            {(category || q) && <span>{cat}</span>}
            {doc.date && <span>{formatDate(doc.date)}</span>}
          </div>
          {doc.note && (
            <button type="button" className={`lib-note${noteOpen ? ' is-open' : ''}`} onClick={() => toggleNote(doc.url)} aria-expanded={noteOpen}>
              {doc.note}
            </button>
          )}
        </div>
        <div className="lib-doc-actions">
          <a className="btn lib-open" href={doc.url} target="_blank" rel="noreferrer">Open</a>
          <a className="lib-icon-btn" href={doc.url} download title="Download" aria-label={`Download ${doc.name}`}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
          </a>
          {isAdmin && (<>
            <button className="lib-icon-btn" title="Edit" aria-label={`Edit ${doc.name}`} onClick={() => setEditing({ url: doc.url, name: doc.name, category: doc.category || '', note: doc.note || '' })}>✏️</button>
            <button className="lib-icon-btn is-danger" title="Delete" aria-label={`Delete ${doc.name}`} onClick={() => handleDelete(doc)}>✕</button>
          </>)}
        </div>
      </article>
    );
  };

  return (
    <div className="lib-page">
      <header className="lib-header">
        <div>
          <h1 style={{ marginBottom: 0 }}>Library</h1>
          <p className="lib-sub">Books, manuals and papers worth keeping — {documents.length} document{documents.length === 1 ? '' : 's'}.</p>
        </div>
        {documents.length > 0 && (
          <div className="lib-view" role="group" aria-label="Layout">
            <button aria-pressed={view === 'cards'} onClick={() => changeView('cards')}>Cards</button>
            <button aria-pressed={view === 'list'} onClick={() => changeView('list')}>List</button>
          </div>
        )}
      </header>

      {documents.length > 0 && (<>
        <div className="lib-search">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
          {/* Inline padding: the global input rule is more specific than a class. */}
          <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search by title, category or note" aria-label="Search library" style={{ paddingLeft: '2.6rem' }} />
        </div>
        {categories.length > 1 && (
          <div className="lib-chips" role="group" aria-label="Category">
            <button aria-pressed={!category} onClick={() => setCategory(null)}>All <span>{documents.length}</span></button>
            {categories.map(([cat, n]) => (
              <button key={cat} aria-pressed={category === cat} onClick={() => setCategory(category === cat ? null : cat)}>{cat} <span>{n}</span></button>
            ))}
          </div>
        )}
      </>)}

      {documents.length === 0 ? (
        <div className="glass-panel" style={{ textAlign: 'center', padding: '3rem 1.5rem' }}>
          <h3>No documents yet</h3>
          <p style={{ margin: '0.5rem 0 0' }}>{isAdmin ? 'Upload PDFs from the admin dashboard to see them here.' : 'Manuals and reference files will appear here once they are added.'}</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="glass-panel" style={{ textAlign: 'center', padding: '2.5rem 1.5rem' }}>
          <h3>Nothing matches{q ? ` “${query.trim()}”` : ''}</h3>
          <button className="btn btn-secondary" style={{ marginTop: '1rem' }} onClick={() => { setQuery(''); setCategory(null); }}>Show everything</button>
        </div>
      ) : (
        groups.filter(([, docs]) => docs.length).map(([cat, docs]) => (
          <section key={cat || 'all'} className="lib-shelf">
            {cat && <h2 className="lib-shelf-title" style={{ color: `hsl(${categoryHue(cat)}, 70%, 65%)` }}>{cat}<span>{docs.length}</span></h2>}
            <div className={view === 'list' ? 'lib-list' : 'lib-cards'}>{docs.map(renderDoc)}</div>
          </section>
        ))
      )}
      {popup}
    </div>
  );
}

'use client';

import { useState, useEffect } from 'react';

export default function LibraryPage() {
  const [documents, setDocuments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  const [showSettings, setShowSettings] = useState(false);
  const [columns, setColumns] = useState(3);
  const [groupBy, setGroupBy] = useState(true);
  const [displayMode, setDisplayMode] = useState<'compact' | 'detailed'>('detailed');
  const [expandedDoc, setExpandedDoc] = useState<string | null>(null);

  // Edit state
  const [editingDoc, setEditingDoc] = useState<{ url: string; name: string; category: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const savedCols = localStorage.getItem('lib_cols');
    const savedGroup = localStorage.getItem('lib_group');
    const savedMode = localStorage.getItem('lib_mode');
    if (savedCols) setColumns(Number(savedCols));
    if (savedGroup) setGroupBy(savedGroup === 'true');
    if (savedMode === 'compact' || savedMode === 'detailed') setDisplayMode(savedMode);

    fetch('/api/library').then(res => res.json()).then(data => {
      if (data.success) { setDocuments(data.documents); setIsAdmin(data.isAdmin || false); }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const saveSetting = (key: string, val: string) => localStorage.setItem(key, val);

  const groupDocsByCategory = () => {
    const map: Record<string, any[]> = {};
    documents.forEach(doc => {
      const cat = doc.category || 'Uncategorized';
      if (!map[cat]) map[cat] = [];
      map[cat].push(doc);
    });
    return map;
  };

  const handleDelete = async (url: string) => {
    if (!confirm('Delete this document?')) return;
    const res = await fetch('/api/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'library', id: url }) });
    const data = await res.json();
    if (data.success) setDocuments(documents.filter(d => d.url !== url));
  };

  const handleSaveEdit = async () => {
    if (!editingDoc) return;
    setSaving(true);
    const res = await fetch('/api/edit', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'library', url: editingDoc.url, name: editingDoc.name, category: editingDoc.category }) });
    const data = await res.json();
    if (data.success) {
      setDocuments(documents.map(d => d.url === editingDoc.url ? { ...d, name: editingDoc.name, category: editingDoc.category } : d));
      setEditingDoc(null);
    }
    setSaving(false);
  };

  const renderDocumentCard = (doc: any, i: number) => {
    const isCompact = displayMode === 'compact' && expandedDoc !== doc.url;
    const isExpanded = displayMode === 'compact' && expandedDoc === doc.url;

    if (editingDoc && editingDoc.url === doc.url) {
      return (
        <div key={`${doc.url}-${i}`} className="glass-panel animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <h3 style={{ marginBottom: 0 }}>Edit Document</h3>
          <div>
            <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.82rem', color: 'var(--muted)' }}>Title</label>
            <input value={editingDoc.name} onChange={e => { const d = editingDoc; setEditingDoc({ url: d.url, name: e.target.value, category: d.category }); }} placeholder="Document title" />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.82rem', color: 'var(--muted)' }}>Category</label>
            <input value={editingDoc.category} onChange={e => { const d = editingDoc; setEditingDoc({ url: d.url, name: d.name, category: e.target.value }); }} placeholder="e.g. Hardware, Specifications" />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <button className="btn btn-primary" onClick={handleSaveEdit} disabled={saving}>{saving ? 'Saving...' : 'Save Changes'}</button>
            <button className="btn btn-secondary" onClick={() => setEditingDoc(null)}>Cancel</button>
          </div>
        </div>
      );
    }

    return (
      <div key={`${doc.url}-${i}`} className="glass-panel"
        style={{ position: 'relative', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: isCompact ? '1rem' : '1.5rem', transition: 'all 0.2s ease', cursor: isCompact ? 'pointer' : 'default', gridColumn: isExpanded ? '1 / -1' : 'auto' }}
        onClick={() => { if (displayMode === 'compact') setExpandedDoc(isExpanded ? null : doc.url); }}
        onMouseEnter={e => { if (!isExpanded) e.currentTarget.style.transform = 'translateY(-5px)'; }}
        onMouseLeave={e => { if (!isExpanded) e.currentTarget.style.transform = ''; }}
      >
        {isAdmin && !isCompact && (
          <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.75rem', justifyContent: 'flex-end' }}>
            <button onClick={e => { e.stopPropagation(); setEditingDoc({ url: doc.url, name: doc.name, category: doc.category || '' }); }}
              style={{ background: 'transparent', color: 'var(--accent-light)', border: '1px solid var(--surface-border)', borderRadius: '6px', padding: '0.2rem 0.55rem', cursor: 'pointer', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>✏️ Edit</button>
            <button onClick={e => { e.stopPropagation(); handleDelete(doc.url); }}
              style={{ background: 'transparent', color: '#fc8181', border: '1px solid #fc8181', borderRadius: '6px', padding: '0.2rem 0.55rem', cursor: 'pointer', fontSize: '0.78rem' }}>✕ Delete</button>
          </div>
        )}

        {isCompact ? (
          <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: '0.5rem' }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--accent)' }}>
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            </svg>
            <h3 style={{ fontSize: '0.95rem', lineHeight: 1.2, margin: 0 }}>{doc.name}</h3>
            {!groupBy && doc.category && <span style={{ fontSize: '0.72rem', color: 'var(--accent-light)' }}>{doc.category}</span>}
          </div>
        ) : (
          <>
            <div className="animate-fade-in" style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem', marginBottom: '2rem' }}>
              <div style={{ background: 'rgba(255,255,255,0.04)', padding: '1.25rem', borderRadius: '12px', color: 'var(--accent)', flexShrink: 0 }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                </svg>
              </div>
              <div>
                <h3 style={{ fontSize: '1.1rem', marginBottom: '0.3rem', lineHeight: 1.3 }}>{doc.name}</h3>
                <p style={{ fontSize: '0.82rem', color: 'var(--accent-light)', opacity: 0.8, marginBottom: '0.25rem' }}>
                  Uploaded: {new Date(doc.date).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}
                </p>
                {!groupBy && doc.category && (
                  <span style={{ display: 'inline-block', padding: '0.2rem 0.5rem', background: 'rgba(255,255,255,0.1)', borderRadius: '4px', fontSize: '0.72rem' }}>{doc.category}</span>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', marginTop: 'auto', flexWrap: 'wrap' }}>
              <a href={doc.url} download target="_blank" rel="noreferrer" className="btn btn-primary"
                onClick={e => e.stopPropagation()}
                style={{ flex: 1, textAlign: 'center', display: 'flex', justifyContent: 'center', gap: '0.5rem', alignItems: 'center', minWidth: '140px' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                Download
              </a>
              {displayMode === 'compact' && (
                <button className="btn btn-secondary" onClick={e => { e.stopPropagation(); setExpandedDoc(null); }}>Close</button>
              )}
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <div className="animate-fade-in" style={{ padding: '2rem 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1>Reference Library</h1>
          <p style={{ marginTop: '0.5rem', marginBottom: 0 }}>Securely access and download system manuals and files.</p>
        </div>
        <button
          onClick={() => setShowSettings(!showSettings)}
          title="Display Settings"
          style={{
            padding: '0.4rem 0.55rem', fontSize: '1rem', lineHeight: 1, borderRadius: '8px',
            border: '1px solid var(--surface-border)',
            background: showSettings ? 'var(--accent)' : 'var(--surface-glass)',
            color: showSettings ? 'white' : 'var(--foreground)',
            cursor: 'pointer', transition: 'all 0.2s', flexShrink: 0,
          }}>⚙</button>
      </div>

      {showSettings && (
        <div className="glass-panel animate-fade-in" style={{ marginBottom: '3rem', display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--muted)' }}>Columns:</label>
            <select value={columns} onChange={e => { setColumns(Number(e.target.value)); saveSetting('lib_cols', e.target.value); }}
              style={{ background: 'var(--input-bg)', color: 'var(--foreground)', padding: '0.5rem', borderRadius: '8px', border: '1px solid var(--surface-border)' }}>
              <option value={1}>1</option><option value={2}>2</option><option value={3}>3</option><option value={4}>4</option>
            </select>
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--muted)' }}>Display Mode:</label>
            <select value={displayMode} onChange={e => { const m = e.target.value as 'compact' | 'detailed'; setDisplayMode(m); saveSetting('lib_mode', m); }}
              style={{ background: 'var(--input-bg)', color: 'var(--foreground)', padding: '0.5rem', borderRadius: '8px', border: '1px solid var(--surface-border)' }}>
              <option value="detailed">Detailed Blocks</option>
              <option value="compact">Compact Icons</option>
            </select>
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--muted)' }}>Group by Category:</label>
            <button className={groupBy ? 'btn btn-primary' : 'btn btn-secondary'} onClick={() => { const n = !groupBy; setGroupBy(n); saveSetting('lib_group', n.toString()); }}>
              {groupBy ? 'Enabled' : 'Disabled'}
            </button>
          </div>
        </div>
      )}

      {loading ? <p>Loading library assets...</p>
        : documents.length === 0 ? (
          <div className="glass-panel" style={{ textAlign: 'center', padding: '4rem' }}><h3>No PDF Documents Available</h3></div>
        ) : (
          <>
            {!groupBy && (
              <div className="grid animate-fade-in" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: '2rem' }}>
                {documents.map((doc, i) => renderDocumentCard(doc, i))}
              </div>
            )}
            {groupBy && (
              <div className="animate-fade-in">
                {Object.entries(groupDocsByCategory()).map(([cat, docs]) => (
                  <div key={cat} style={{ marginBottom: '4rem' }}>
                    <h2 style={{ borderBottom: '1px solid var(--surface-border)', paddingBottom: '0.75rem', marginBottom: '2rem', color: 'var(--accent-light)', fontSize: '1.4rem', letterSpacing: '0.5px' }}>{cat}</h2>
                    <div className="grid" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: '2rem' }}>
                      {docs.map((doc, i) => renderDocumentCard(doc, i))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
    </div>
  );
}

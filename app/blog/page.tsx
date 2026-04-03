'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';

interface BlogPost { slug: string; title: string; description: string; image: string; date: string; category?: string; }
interface EditState { slug: string; title: string; description: string; category?: string; }

const ICON_BTN: React.CSSProperties = {
  padding: '0.4rem 0.55rem', fontSize: '1rem', lineHeight: 1, borderRadius: '8px',
  border: '1px solid var(--surface-border)', background: 'var(--surface-glass)',
  cursor: 'pointer', transition: 'all 0.2s', color: 'var(--foreground)', flexShrink: 0,
};

export default function BlogPage() {
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [editing, setEditing] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);

  // Display settings
  const [showSettings, setShowSettings] = useState(false);
  const [sortBy, setSortBy] = useState<'date-desc' | 'date-asc' | 'name'>('date-desc');
  const [viewMode, setViewMode] = useState<'list' | 'tile'>('list');
  const [tileColumns, setTileColumns] = useState(3);
  const [groupCategory, setGroupCategory] = useState(false);

  const saveSetting = (k: string, v: string) => localStorage.setItem(k, v);

  const fetchPosts = () => {
    fetch('/api/blog').then(r => r.json()).then(data => {
      if (data.success && data.posts) { setPosts(data.posts); setIsAdmin(data.isAdmin || false); }
      setLoading(false);
    });
  };

  useEffect(() => {
    const sv = localStorage.getItem('blog_sort') as typeof sortBy | null;
    const vv = localStorage.getItem('blog_view') as typeof viewMode | null;
    const cv = localStorage.getItem('blog_cols');
    const gv = localStorage.getItem('blog_group');
    if (sv) setSortBy(sv);
    if (vv) setViewMode(vv);
    if (cv) setTileColumns(Number(cv));
    if (gv) setGroupCategory(gv === 'true');
    fetchPosts();
  }, []);

  const sortedPosts = useMemo(() => {
    const copy = [...posts];
    if (sortBy === 'date-desc') copy.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    else if (sortBy === 'date-asc') copy.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    else copy.sort((a, b) => a.title.localeCompare(b.title));
    return copy;
  }, [posts, sortBy]);

  const handleDelete = async (slug: string) => {
    if (!confirm(`Delete post: ${slug}?`)) return;
    const res = await fetch('/api/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'blog', id: slug }) });
    if ((await res.json()).success) setPosts(posts.filter(p => p.slug !== slug));
  };

  const handleSaveEdit = async () => {
    if (!editing) return;
    setSaving(true);
    const res = await fetch('/api/edit', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'blog', slug: editing.slug, title: editing.title, description: editing.description, category: editing.category || 'Uncategorized' }) });
    if ((await res.json()).success) {
      setPosts(posts.map(p => p.slug === editing.slug ? { ...p, title: editing.title, description: editing.description, category: editing.category || 'Uncategorized' } : p));
      setEditing(null);
    }
    setSaving(false);
  };

  const imgSrc = (img: string) => img.startsWith('/api/media') ? img : '/api/media' + img;

  const renderCard = (post: BlogPost) => {
    if (editing?.slug === post.slug) {
      return (
        <div key={post.slug} className="glass-panel animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <h3 style={{ marginBottom: 0 }}>Editing Post</h3>
          <div>
            <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.82rem', color: 'var(--muted)' }}>Title</label>
            <input value={editing.title} onChange={e => setEditing({ ...editing, title: e.target.value })} placeholder="Post title" />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.82rem', color: 'var(--muted)' }}>Description</label>
            <input value={editing.description} onChange={e => setEditing({ ...editing, description: e.target.value })} placeholder="Brief description" />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.82rem', color: 'var(--muted)' }}>Category</label>
            <input value={editing.category || ''} onChange={e => setEditing({ ...editing, category: e.target.value })} placeholder="e.g. Infrastructure" />
          </div>
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button className="btn btn-primary" onClick={handleSaveEdit} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
            <button className="btn btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </div>
      );
    }

    const isTile = viewMode === 'tile';
    return (
      <div key={post.slug} style={{ position: 'relative' }}>
        <Link href={`/blog/${post.slug}`}>
          <div className="glass-panel"
            style={{ display: 'flex', gap: '1.5rem', cursor: 'pointer', flexDirection: isTile ? 'column' : 'row', flexWrap: 'wrap', transition: 'transform 0.2s', height: isTile ? '100%' : undefined }}
            onMouseEnter={e => (e.currentTarget.style.transform = 'translateY(-3px)')}
            onMouseLeave={e => (e.currentTarget.style.transform = '')}>
            {post.image && (
              <div style={{ flex: isTile ? 'none' : '0 0 180px', width: isTile ? '100%' : '180px', height: isTile ? '160px' : '130px', borderRadius: isTile ? '8px 8px 0 0' : '8px', overflow: 'hidden', margin: isTile ? '-1.5rem -1.5rem 0' : 0 }}>
                <img src={imgSrc(post.image)} alt={post.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </div>
            )}
            <div style={{ flex: 1, minWidth: '200px' }}>
              <h2 style={{ marginBottom: '0.4rem', fontSize: isTile ? '1.05rem' : '1.3rem' }}>{post.title}</h2>
              <p style={{ color: 'var(--accent-light)', fontSize: '0.82rem', marginBottom: '0.75rem' }}>
                {new Date(post.date).toLocaleDateString()}
              </p>
              <p style={{ margin: 0, fontSize: '0.92rem' }}>{post.description}</p>
            </div>
          </div>
        </Link>
        {isAdmin && !editing && (
          <div style={{ position: 'absolute', top: '10px', right: '10px', display: 'flex', gap: '0.35rem' }}>
            <button onClick={e => { e.preventDefault(); setEditing({ slug: post.slug, title: post.title, description: post.description, category: post.category }); }}
              style={{ background: '#3182ce', color: 'white', border: 'none', borderRadius: '4px', padding: '0.28rem 0.5rem', cursor: 'pointer', fontSize: '0.75rem' }}>✏️</button>
            <button onClick={e => { e.preventDefault(); handleDelete(post.slug); }}
              style={{ background: '#eb4d4b', color: 'white', border: 'none', borderRadius: '4px', padding: '0.28rem 0.5rem', cursor: 'pointer', fontSize: '0.75rem' }}>✕</button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="animate-fade-in" style={{ padding: '2rem 0' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <h1>Blog</h1>
        <button onClick={() => setShowSettings(!showSettings)} title="Display Settings" style={{ ...ICON_BTN, background: showSettings ? 'var(--accent)' : 'var(--surface-glass)', color: showSettings ? 'white' : 'var(--foreground)' }}>⚙</button>
      </div>

      {/* Settings panel */}
      {showSettings && (
        <div className="glass-panel animate-fade-in" style={{ marginBottom: '2rem', display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--muted)', fontSize: '0.82rem' }}>Sort by</label>
            <select value={sortBy} onChange={e => { const v = e.target.value as typeof sortBy; setSortBy(v); saveSetting('blog_sort', v); }}
              style={{ background: 'var(--input-bg)', color: 'var(--foreground)', padding: '0.5rem 0.75rem', borderRadius: '8px', border: '1px solid var(--surface-border)' }}>
              <option value="date-desc">Date (Newest First)</option>
              <option value="date-asc">Date (Oldest First)</option>
              <option value="name">Name (A–Z)</option>
            </select>
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--muted)', fontSize: '0.82rem' }}>Group</label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem', cursor: 'pointer', padding: '0.5rem 0' }}>
              <input type="checkbox" checked={groupCategory} onChange={e => { setGroupCategory(e.target.checked); saveSetting('blog_group', String(e.target.checked)); }} />
              By Category
            </label>
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--muted)', fontSize: '0.82rem' }}>View</label>
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              {(['list', 'tile'] as const).map(v => (
                <button key={v} onClick={() => { setViewMode(v); saveSetting('blog_view', v); }}
                  className={viewMode === v ? 'btn btn-primary' : 'btn btn-secondary'}
                  style={{ padding: '0.45rem 1rem', fontSize: '0.85rem' }}>
                  {v === 'list' ? '☰ List' : '⊞ Tile'}
                </button>
              ))}
            </div>
          </div>
          {viewMode === 'tile' && (
            <div>
              <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--muted)', fontSize: '0.82rem' }}>Columns</label>
              <div style={{ display: 'flex', gap: '0.4rem' }}>
                {[2, 3, 4].map(n => (
                  <button key={n} onClick={() => { setTileColumns(n); saveSetting('blog_cols', String(n)); }}
                    className={tileColumns === n ? 'btn btn-primary' : 'btn btn-secondary'}
                    style={{ padding: '0.45rem 0.75rem', fontSize: '0.85rem' }}>
                    {n}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {loading ? <p>Loading posts...</p>
        : sortedPosts.length === 0 ? (
          <div className="glass-panel" style={{ textAlign: 'center', padding: '4rem' }}>
            <h3>No Posts Yet</h3>
            <p>Login and use the Admin panel to publish your first blog post.</p>
          </div>
        ) : groupCategory ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3rem' }}>
            {Object.entries(
              sortedPosts.reduce((acc, obj) => {
                const cat = obj.category || 'Uncategorized';
                acc[cat] = acc[cat] || [];
                acc[cat].push(obj);
                return acc;
              }, {} as Record<string, BlogPost[]>)
            ).sort(([a], [b]) => a.localeCompare(b)).map(([cat, groupedPosts]) => (
              <div key={cat}>
                <h2 style={{ fontSize: '1.4rem', marginBottom: '1.5rem', borderBottom: '1px solid var(--surface-border)', paddingBottom: '0.5rem', display: 'inline-block' }}>{cat}</h2>
                {viewMode === 'list' ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                    {groupedPosts.map(renderCard)}
                  </div>
                ) : (
                  <div className="grid" style={{ gridTemplateColumns: `repeat(${tileColumns}, minmax(0, 1fr))`, gap: '1.5rem' }}>
                    {groupedPosts.map(renderCard)}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : viewMode === 'list' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            {sortedPosts.map(renderCard)}
          </div>
        ) : (
          <div className="grid" style={{ gridTemplateColumns: `repeat(${tileColumns}, minmax(0, 1fr))`, gap: '1.5rem' }}>
            {sortedPosts.map(renderCard)}
          </div>
        )}
    </div>
  );
}

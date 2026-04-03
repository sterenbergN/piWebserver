'use client';

import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

interface AlbumImage { src: string; caption: string; }
interface Album { id: string; name: string; images: AlbumImage[]; albums: Album[]; }

export default function GalleryPage() {
  const [rootAlbums, setRootAlbums] = useState<Album[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  // Navigation — breadcrumb is the stack of albums navigated into
  const [breadcrumb, setBreadcrumb] = useState<Album[]>([]);
  const currentAlbum: Album | null = breadcrumb[breadcrumb.length - 1] ?? null;

  // View / settings
  const [viewMode, setViewMode] = useState<'albums' | 'all'>('albums');
  const [columns, setColumns] = useState(3);
  const [showCaptions, setShowCaptions] = useState(true);
  const [cycleTime, setCycleTime] = useState(5000);
  const [showSettings, setShowSettings] = useState(false);

  // Grid
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  // Picture frame
  const [frameMode, setFrameMode] = useState(false);
  const [frameIndex, setFrameIndex] = useState(0);
  const [mounted, setMounted] = useState(false);

  // Admin: album creation
  const [addingAlbum, setAddingAlbum] = useState(false);
  const [newAlbumName, setNewAlbumName] = useState('');
  const [albumCreating, setAlbumCreating] = useState(false);

  // Admin: inline caption / album rename editing
  const [editingCaption, setEditingCaption] = useState<{ albumId: string; src: string; value: string } | null>(null);
  const [editingAlbumName, setEditingAlbumName] = useState<{ albumId: string; value: string } | null>(null);
  const [editorSaving, setEditorSaving] = useState(false);

  const saveSetting = (key: string, val: string) => localStorage.setItem(key, val);

  const loadAlbums = useCallback(async () => {
    setLoading(true);
    const data = await fetch('/api/gallery').then(r => r.json());
    if (data.success) {
      setRootAlbums(data.albums);
      setIsAdmin(data.isAdmin || false);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    setMounted(true);
    const savedCols = localStorage.getItem('gal_cols');
    const savedCaps = localStorage.getItem('gal_caps');
    const savedCycle = localStorage.getItem('gal_cycle');
    const savedView = localStorage.getItem('gal_view') as 'albums' | 'all' | null;
    if (savedCols) setColumns(Number(savedCols));
    if (savedCaps) setShowCaptions(savedCaps === 'true');
    if (savedCycle) setCycleTime(Number(savedCycle));
    if (savedView) setViewMode(savedView);
    loadAlbums();
  }, [loadAlbums]);

  // Keep breadcrumb in sync when rootAlbums reloads
  useEffect(() => {
    if (breadcrumb.length === 0) return;
    // Re-find each album in the updated tree
    const resync = (albums: Album[], crumb: Album[]): Album[] => {
      if (crumb.length === 0) return [];
      const found = findAlbum(albums, crumb[0].id);
      if (!found) return [];
      return [found, ...resync(found.albums || [], crumb.slice(1))];
    };
    setBreadcrumb(prev => resync(rootAlbums, prev));
  }, [rootAlbums]);

  function findAlbum(albums: Album[], id: string): Album | null {
    for (const a of albums) {
      if (a.id === id) return a;
      const found = findAlbum(a.albums || [], id);
      if (found) return found;
    }
    return null;
  }

  function collectAllImages(album: Album): (AlbumImage & { albumId: string })[] {
    const imgs = album.images.map(i => ({ ...i, albumId: album.id }));
    for (const sub of (album.albums || [])) imgs.push(...collectAllImages(sub));
    return imgs;
  }

  // Build a map of albumId → full breadcrumb path string for "View All" labels
  function buildAlbumPathMap(albums: Album[], prefix = ''): Record<string, string> {
    const map: Record<string, string> = {};
    for (const a of albums) {
      const p = prefix ? `${prefix} › ${a.name}` : a.name;
      map[a.id] = p;
      Object.assign(map, buildAlbumPathMap(a.albums || [], p));
    }
    return map;
  }
  const albumPathMap = buildAlbumPathMap(rootAlbums);

  const navigateInto = (album: Album) => {
    setBreadcrumb(prev => [...prev, album]);
    setExpandedIndex(null);
  };
  const navigateTo = (index: number) => {
    setBreadcrumb(prev => prev.slice(0, index + 1));
    setExpandedIndex(null);
  };
  const navigateRoot = () => {
    setBreadcrumb([]);
    setExpandedIndex(null);
  };

  // Frame images: if inside an album collect recursively, else all images from all
  const frameImages: (AlbumImage & { albumId: string })[] = currentAlbum
    ? collectAllImages(currentAlbum)
    : rootAlbums.flatMap(a => collectAllImages(a));

  useEffect(() => {
    if (!frameMode || frameImages.length === 0) return;
    const interval = setInterval(() => setFrameIndex(p => (p + 1) % frameImages.length), cycleTime);
    return () => clearInterval(interval);
  }, [frameMode, frameImages.length, cycleTime]);

  const startFrameMode = async () => {
    if (frameImages.length === 0) return;
    setFrameIndex(0); setFrameMode(true); setExpandedIndex(null);
    try { await document.documentElement.requestFullscreen(); } catch { }
  };
  const exitFrameMode = async () => {
    setFrameMode(false);
    try { if (document.fullscreenElement) await document.exitFullscreen(); } catch { }
  };
  useEffect(() => {
    const handler = () => { if (!document.fullscreenElement && frameMode) setFrameMode(false); };
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, [frameMode]);

  // ── Album creation ────────────────────────────────────────────────────────
  const handleCreateAlbum = async () => {
    if (!newAlbumName.trim()) return;
    setAlbumCreating(true);
    const res = await fetch('/api/gallery', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newAlbumName.trim(), parentId: currentAlbum?.id || undefined })
    });
    const data = await res.json();
    if (data.success) {
      await loadAlbums();
      setNewAlbumName('');
      setAddingAlbum(false);
    }
    setAlbumCreating(false);
  };

  // ── Album deletion ────────────────────────────────────────────────────────
  const handleDeleteAlbum = async (albumId: string, albumName: string) => {
    if (!confirm(`Delete album "${albumName}" and ALL its contents? This cannot be undone.`)) return;
    const res = await fetch('/api/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'gallery-album', id: albumId })
    });
    const data = await res.json();
    if (data.success) {
      // If we're inside the deleted album, navigate up
      if (breadcrumb.some(b => b.id === albumId)) navigateRoot();
      await loadAlbums();
    }
  };

  // ── Photo deletion ────────────────────────────────────────────────────────
  const handleDeletePhoto = async (src: string) => {
    if (!confirm('Delete this photo permanently?')) return;
    const res = await fetch('/api/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'gallery', id: src })
    });
    const data = await res.json();
    if (data.success) { setExpandedIndex(null); await loadAlbums(); }
  };

  const saveCaptionEdit = async () => {
    if (!editingCaption) return;
    setEditorSaving(true);
    const res = await fetch('/api/edit', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'gallery-photo', albumId: editingCaption.albumId, src: editingCaption.src, caption: editingCaption.value })
    });
    if ((await res.json()).success) { await loadAlbums(); setEditingCaption(null); }
    setEditorSaving(false);
  };

  const saveAlbumNameEdit = async () => {
    if (!editingAlbumName) return;
    setEditorSaving(true);
    const res = await fetch('/api/edit', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'gallery-album', albumId: editingAlbumName.albumId, name: editingAlbumName.value })
    });
    if ((await res.json()).success) { await loadAlbums(); setEditingAlbumName(null); }
    setEditorSaving(false);
  };

  // ── Photo grid ────────────────────────────────────────────────────────────
  const renderPhotoGrid = (images: (AlbumImage & { albumId: string })[]) => (
    <div className="grid" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: '1.5rem' }}>
      {images.map((img, i) => {
        const isExpanded = expandedIndex === i;
        return (
          <div key={`${img.src}-${i}`}
            onClick={() => { if (!editingCaption) setExpandedIndex(isExpanded ? null : i); }}
            style={{
              cursor: 'pointer',
              gridColumn: (isExpanded || (editingCaption && editingCaption.src === img.src)) ? '1 / -1' : 'auto',
              transition: 'all 0.3s ease',
              position: 'relative',
              overflow: 'hidden'
            }}>

            {isAdmin && !(editingCaption && editingCaption.src === img.src) && (
              <div style={{ position: 'absolute', top: 8, right: 8, display: 'flex', gap: '0.3rem', zIndex: 10 }}>
                <a href={`/api/download-album?photo=${encodeURIComponent(img.src)}`} download
                  style={{ background: '#48bb78', color: 'white', border: 'none', borderRadius: '4px', padding: '0.3rem 0.55rem', cursor: 'pointer', fontSize: '0.75rem', display: 'flex', alignItems: 'center' }}>⬇</a>
                <button onClick={e => { e.stopPropagation(); setEditingCaption({ albumId: img.albumId, src: img.src, value: img.caption }); }}
                  style={{ background: '#3182ce', color: 'white', border: 'none', borderRadius: '4px', padding: '0.25rem 0.5rem', cursor: 'pointer', fontSize: '0.75rem' }}>✏️</button>
                <button onClick={e => { e.stopPropagation(); handleDeletePhoto(img.src); }}
                  style={{ background: '#eb4d4b', color: 'white', border: 'none', borderRadius: '4px', padding: '0.25rem 0.5rem', cursor: 'pointer', fontSize: '0.75rem' }}>✕</button>
              </div>
            )}

            {editingCaption && editingCaption.src === img.src ? (
              <div className="glass-panel animate-fade-in" onClick={e => e.stopPropagation()}
                style={{ display: 'flex', flexDirection: 'row', gap: '2rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <div style={{ flex: '0 0 auto', maxWidth: '360px', width: '100%' }}>
                  <img src={img.src.startsWith('/api') || img.src.startsWith('http') ? img.src : `/api/media${img.src.startsWith('/') ? '' : '/'}${img.src}`} alt="" style={{ width: '100%', maxHeight: '260px', objectFit: 'contain', borderRadius: '8px', display: 'block' }} />
                </div>
                <div style={{ flex: 1, minWidth: '200px', display: 'flex', flexDirection: 'column', gap: '1rem', justifyContent: 'center' }}>
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--muted)', fontSize: '0.85rem' }}>Caption</label>
                    <input value={editingCaption.value} onChange={e => setEditingCaption({ ...editingCaption, value: e.target.value })} placeholder="Caption..." />
                  </div>
                  <div style={{ display: 'flex', gap: '0.75rem' }}>
                    <button className="btn btn-primary" onClick={saveCaptionEdit} disabled={editorSaving}>{editorSaving ? 'Saving...' : 'Save Caption'}</button>
                    <button className="btn btn-secondary" onClick={() => setEditingCaption(null)}>Cancel</button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="glass-panel" style={{ padding: isExpanded ? '2rem' : '0.5rem', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div style={{ position: 'relative', width: '100%', aspectRatio: isExpanded ? 'auto' : '1/1', height: isExpanded ? '72vh' : 'auto', borderRadius: '8px', overflow: 'hidden' }}>
                  <img src={img.src.startsWith('/api') || img.src.startsWith('http') ? img.src : `/api/media${img.src.startsWith('/') ? '' : '/'}${img.src}`} alt={img.caption}
                    style={{ width: '100%', height: '100%', objectFit: isExpanded ? 'contain' : 'cover', transition: 'transform 0.3s' }}
                    onMouseEnter={e => { if (!isExpanded) e.currentTarget.style.transform = 'scale(1.05)'; }}
                    onMouseLeave={e => { if (!isExpanded) e.currentTarget.style.transform = ''; }} />
                </div>
                {viewMode === 'all' && !currentAlbum && albumPathMap[img.albumId] && (
                  <p style={{ textAlign: 'center', fontSize: '0.7rem', opacity: 0.45, margin: '0.6rem 0 0', fontStyle: 'italic', letterSpacing: '0.02em' }}>
                    {albumPathMap[img.albumId]}
                  </p>
                )}
                {showCaptions && img.caption && (
                  <p style={{ textAlign: 'center', fontSize: isExpanded ? '1.2rem' : '0.85rem', margin: '0.4rem 0 0' }}>{img.caption}</p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  // ── Album card ────────────────────────────────────────────────────────────
  const renderAlbumCard = (album: Album) => {
    const isEditingThis = editingAlbumName && editingAlbumName.albumId === album.id;
    return (
      <div key={album.id} style={{ position: 'relative', gridColumn: isEditingThis ? '1 / -1' : 'auto' }}>
        {isEditingThis ? (
          <div className="glass-panel animate-fade-in" style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ color: 'var(--muted)', fontSize: '0.9rem', flexShrink: 0 }}>Rename Album:</span>
            <input
              value={editingAlbumName.value}
              onChange={e => setEditingAlbumName({ albumId: album.id, value: e.target.value })}
              onKeyDown={e => e.key === 'Enter' && saveAlbumNameEdit()}
              style={{ flex: 1, minWidth: '160px', maxWidth: '340px' }}
              autoFocus
            />
            <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
              <button className="btn btn-primary" onClick={saveAlbumNameEdit} disabled={editorSaving}>
                {editorSaving ? 'Saving...' : 'Save'}
              </button>
              <button className="btn btn-secondary" onClick={() => setEditingAlbumName(null)}>Cancel</button>
            </div>
          </div>
        ) : (
          <div className="glass-panel" onClick={() => navigateInto(album)} style={{ cursor: 'pointer', padding: '0', overflow: 'hidden', transition: 'transform 0.2s' }}
            onMouseEnter={e => (e.currentTarget.style.transform = 'translateY(-4px)')}
            onMouseLeave={e => (e.currentTarget.style.transform = '')}>
            <div style={{ width: '100%', height: '150px', background: 'var(--card-bg)', overflow: 'hidden', position: 'relative' }}>
              {album.images[0]
                ? <img src={album.images[0].src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : album.albums?.[0]?.images[0]
                ? <img src={album.albums[0].images[0].src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.3, fontSize: '2.5rem' }}>📷</div>
              }
              {album.albums?.length > 0 && (
                <div style={{ position: 'absolute', bottom: 6, right: 8, background: 'rgba(0,0,0,0.6)', borderRadius: '8px', padding: '0.2rem 0.5rem', fontSize: '0.72rem', color: 'white' }}>
                  📁 {album.albums.length} sub-album{album.albums.length !== 1 ? 's' : ''}
                </div>
              )}
            </div>
            <div style={{ padding: '0.9rem 1rem' }}>
              <h3 style={{ fontSize: '0.95rem', marginBottom: '0.2rem' }}>{album.name}</h3>
              <p style={{ fontSize: '0.78rem', margin: 0, opacity: 0.55 }}>
                {album.images.length} photo{album.images.length !== 1 ? 's' : ''}
                {album.albums?.length > 0 ? ` · ${album.albums.length} sub-album${album.albums.length !== 1 ? 's' : ''}` : ''}
              </p>
            </div>
          </div>
        )}

        {isAdmin && !isEditingThis && (
          <div style={{ position: 'absolute', top: 8, right: 8, display: 'flex', gap: '0.3rem', zIndex: 10 }}>
            <button onClick={e => { e.stopPropagation(); setEditingAlbumName({ albumId: album.id, value: album.name }); }}
              style={{ background: '#3182ce', color: 'white', border: 'none', borderRadius: '4px', padding: '0.25rem 0.5rem', cursor: 'pointer', fontSize: '0.75rem' }}>✏️</button>
            <button onClick={e => { e.stopPropagation(); handleDeleteAlbum(album.id, album.name); }}
              style={{ background: '#eb4d4b', color: 'white', border: 'none', borderRadius: '4px', padding: '0.25rem 0.5rem', cursor: 'pointer', fontSize: '0.75rem' }}>🗑</button>
          </div>
        )}
      </div>
    );
  };
  // ── What to display in the current view ──────────────────────────────────
  const shownAlbums: Album[] = currentAlbum ? (currentAlbum.albums || []) : rootAlbums;
  const shownImages: (AlbumImage & { albumId: string })[] = (() => {
    if (viewMode === 'all') return rootAlbums.flatMap(a => collectAllImages(a));
    if (currentAlbum) return currentAlbum.images.map(i => ({ ...i, albumId: currentAlbum.id }));
    return [];
  })();

  return (
    <div style={{ padding: '2rem 0' }}>

      {/* Header */}
      <div className="animate-fade-in" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          {/* Breadcrumb */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', fontSize: '0.9rem', marginBottom: '0.5rem', opacity: 0.7 }}>
            <button onClick={navigateRoot} style={{ background: 'none', border: 'none', color: breadcrumb.length === 0 ? 'var(--accent-light)' : 'var(--muted)', cursor: 'pointer', padding: 0, fontFamily: 'inherit', fontWeight: breadcrumb.length === 0 ? 600 : 400 }}>
              Gallery
            </button>
            {breadcrumb.map((b, i) => (
              <span key={b.id}>
                <span style={{ opacity: 0.4 }}> / </span>
                <button onClick={() => navigateTo(i)} style={{ background: 'none', border: 'none', color: i === breadcrumb.length - 1 ? 'var(--accent-light)' : 'var(--muted)', cursor: 'pointer', padding: 0, fontFamily: 'inherit', fontWeight: i === breadcrumb.length - 1 ? 600 : 400 }}>
                  {b.name}
                </button>
              </span>
            ))}
          </div>
          <h1 style={{ marginBottom: 0 }}>{currentAlbum?.name ?? 'Gallery'}</h1>
        </div>

        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
          
          {/* Admin & Tooling Group */}
          <div style={{ display: 'flex', background: 'var(--card-bg)', border: '1px solid var(--surface-border)', borderRadius: '10px', padding: '0.25rem', gap: '0.25rem' }}>
            {isAdmin && (
              <button 
                onClick={() => setAddingAlbum(!addingAlbum)}
                style={{ padding: '0.4rem 0.75rem', fontSize: '0.85rem', borderRadius: '6px', border: 'none', background: addingAlbum ? 'var(--accent)' : 'transparent', color: addingAlbum ? 'white' : 'var(--foreground)', cursor: 'pointer', transition: 'all 0.2s' }}>
                {addingAlbum ? '✕ Cancel' : '+ New Album'}
              </button>
            )}
            {isAdmin && (
              <button 
                onClick={() => window.location.href = `/api/download-album?id=${currentAlbum ? currentAlbum.id : 'all'}`} 
                title="Download Album ZIP"
                style={{ padding: '0.4rem 0.6rem', fontSize: '1rem', lineHeight: 1, borderRadius: '6px', border: 'none', background: 'transparent', color: 'var(--foreground)', cursor: 'pointer', transition: 'all 0.2s', flexShrink: 0 }}>
                ⬇
              </button>
            )}
            <button 
              onClick={() => setShowSettings(!showSettings)} 
              title="Display Settings"
              style={{
                padding: '0.4rem 0.6rem', fontSize: '1rem', lineHeight: 1, borderRadius: '6px', border: 'none',
                background: showSettings ? 'var(--accent)' : 'transparent',
                color: showSettings ? 'white' : 'var(--foreground)',
                cursor: 'pointer', transition: 'all 0.2s', flexShrink: 0
              }}>
              ⚙
            </button>
          </div>

          <button className="btn btn-primary" onClick={startFrameMode} disabled={frameImages.length === 0}>📷 Picture Frame</button>
        </div>
      </div>

      {/* New Album form */}
      {addingAlbum && isAdmin && (
        <div className="glass-panel animate-fade-in" style={{ marginBottom: '1.5rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>
            New {currentAlbum ? `sub-album inside "${currentAlbum.name}"` : 'root album'}:
          </span>
          <input value={newAlbumName} onChange={e => setNewAlbumName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCreateAlbum()}
            placeholder="Album name..." style={{ flex: 1, minWidth: '180px', maxWidth: '300px' }} />
          <button className="btn btn-primary" onClick={handleCreateAlbum} disabled={albumCreating || !newAlbumName.trim()}>
            {albumCreating ? 'Creating...' : 'Create'}
          </button>
        </div>
      )}

      {/* Settings */}
      {showSettings && (
        <div className="glass-panel animate-fade-in" style={{ marginBottom: '2rem', display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
          {breadcrumb.length === 0 && (
            <div>
              <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--muted)' }}>View Mode:</label>
              <select value={viewMode} onChange={e => { const v = e.target.value as 'albums' | 'all'; setViewMode(v); saveSetting('gal_view', v); }}
                style={{ background: 'var(--input-bg)', color: 'var(--foreground)', padding: '0.5rem', borderRadius: '8px', border: '1px solid var(--surface-border)' }}>
                <option value="albums">View Albums</option><option value="all">View All Photos</option>
              </select>
            </div>
          )}
          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--muted)' }}>Columns:</label>
            <select value={columns} onChange={e => { setColumns(Number(e.target.value)); saveSetting('gal_cols', e.target.value); }}
              style={{ background: 'var(--input-bg)', color: 'var(--foreground)', padding: '0.5rem', borderRadius: '8px', border: '1px solid var(--surface-border)' }}>
              <option value={2}>2</option><option value={3}>3</option><option value={4}>4</option><option value={5}>5</option>
            </select>
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--muted)' }}>Frame Cycle:</label>
            <select value={cycleTime} onChange={e => { setCycleTime(Number(e.target.value)); saveSetting('gal_cycle', e.target.value); }}
              style={{ background: 'var(--input-bg)', color: 'var(--foreground)', padding: '0.5rem', borderRadius: '8px', border: '1px solid var(--surface-border)' }}>
              <option value={3000}>3s</option><option value={5000}>5s</option><option value={10000}>10s</option><option value={30000}>30s</option>
            </select>
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--muted)' }}>Captions:</label>
            <button className={showCaptions ? 'btn btn-primary' : 'btn btn-secondary'} onClick={() => { setShowCaptions(!showCaptions); saveSetting('gal_caps', (!showCaptions).toString()); }}>
              {showCaptions ? 'On' : 'Off'}
            </button>
          </div>
        </div>
      )}

      {loading ? <p className="animate-fade-in">Loading gallery...</p> : (
        <div className="animate-fade-in">
          {/* Album grid (shown when not "view all" mode, always shown inside an album) */}
          {viewMode !== 'all' && shownAlbums.length > 0 && (
            <div>
              {currentAlbum && <h2 style={{ marginBottom: '1rem', fontSize: '1.1rem', color: 'var(--muted)' }}>Sub-Albums</h2>}
              <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1.5rem', marginBottom: shownImages.length > 0 ? '3rem' : 0 }}>
                {shownAlbums.map(album => renderAlbumCard(album))}
              </div>
            </div>
          )}

          {/* Photo grid */}
          {shownImages.length > 0 && (
            <div>
              {currentAlbum && shownAlbums.length > 0 && <h2 style={{ marginBottom: '1rem', fontSize: '1.1rem', color: 'var(--muted)' }}>Photos in this Album</h2>}
              {renderPhotoGrid(shownImages)}
            </div>
          )}

          {/* Empty state */}
          {shownAlbums.length === 0 && shownImages.length === 0 && (
            <div className="glass-panel" style={{ textAlign: 'center', padding: '4rem' }}>
              <h3>Nothing here yet</h3>
              <p>{isAdmin ? 'Use "+ New Album" to create an album, or upload photos in Admin.' : 'No photos or albums available.'}</p>
            </div>
          )}
        </div>
      )}

      {/* Picture Frame Portal */}
      {frameMode && mounted && frameImages.length > 0 && createPortal(
        (() => {
          const img = frameImages[frameIndex];
          const currentAlbumPathStr = currentAlbum ? albumPathMap[currentAlbum.id] || '' : '';
          const imgAlbumPathStr = img ? albumPathMap[img.albumId] || '' : '';
          
          let relativeAlbumPath = '';
          if (imgAlbumPathStr && imgAlbumPathStr !== currentAlbumPathStr && currentAlbumPathStr) {
            if (imgAlbumPathStr.startsWith(currentAlbumPathStr + ' › ')) {
              relativeAlbumPath = imgAlbumPathStr.substring((currentAlbumPathStr + ' › ').length);
            } else {
              relativeAlbumPath = imgAlbumPathStr;
            }
          } else if (!currentAlbumPathStr) {
            relativeAlbumPath = imgAlbumPathStr;
          }

          return (
            <div style={{ position: 'fixed', inset: 0, background: '#000', zIndex: 999999, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
              onClick={exitFrameMode}>
              {frameImages.map((imgItem, i) => (
                <img key={imgItem.src} src={imgItem.src} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', opacity: frameIndex === i ? 1 : 0, transition: 'opacity 1.5s ease-in-out', pointerEvents: 'none' }} />
              ))}
              {(img?.caption || relativeAlbumPath) && showCaptions && (
                <div style={{ position: 'absolute', bottom: '3rem', background: 'rgba(0,0,0,0.6)', padding: '0.75rem 2.5rem', borderRadius: '30px', color: 'white', display: 'flex', flexDirection: 'column', alignItems: 'center', pointerEvents: 'none' }}>
                  {relativeAlbumPath && (
                    <div style={{ fontSize: '0.85rem', opacity: 0.7, fontStyle: 'italic', marginBottom: img?.caption ? '0.2rem' : 0 }}>
                      {relativeAlbumPath}
                    </div>
                  )}
                  {img?.caption && (
                    <div style={{ fontSize: '1.4rem' }}>
                      {img.caption}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })(),
        document.body
      )}
    </div>
  );
}

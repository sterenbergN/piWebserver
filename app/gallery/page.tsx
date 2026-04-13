'use client';

import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useSitePopup } from '@/components/SitePopup';

interface AlbumImage { src: string; caption: string; }
interface Album { id: string; name: string; images: AlbumImage[]; albums: Album[]; }

export default function GalleryPage() {
  const { confirm, popup } = useSitePopup();
  const [rootAlbums, setRootAlbums] = useState<Album[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  // Navigation — breadcrumb is the stack of albums navigated into
  const [breadcrumb, setBreadcrumb] = useState<Album[]>([]);
  const currentAlbum: Album | null = breadcrumb[breadcrumb.length - 1] ?? null;

  // View / settings
  const [viewMode, setViewMode] = useState<'albums' | 'all' | 'downloads'>('albums');
  const [availableDownloads, setAvailableDownloads] = useState<any[]>([]);
  const [columns, setColumns] = useState(3);
  const [showCaptions, setShowCaptions] = useState(true);
  const [cycleTime, setCycleTime] = useState(5000);
  const [shuffleMode, setShuffleMode] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // Grid
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [visibleCount, setVisibleCount] = useState(60); // Basic virtualization: show 60 images at a time

  // Picture frame
  const [frameMode, setFrameMode] = useState(false);
  const [frameIndex, setFrameIndex] = useState(0);
  const [activeFrameImages, setActiveFrameImages] = useState<(AlbumImage & { albumId: string })[]>([]);
  const [mounted, setMounted] = useState(false);

  // Admin: album creation
  const [addingAlbum, setAddingAlbum] = useState(false);
  const [newAlbumName, setNewAlbumName] = useState('');
  const [albumCreating, setAlbumCreating] = useState(false);

  // Admin: inline caption / album rename editing
  const [editingCaption, setEditingCaption] = useState<{ albumId: string; src: string; value: string; newAlbumId: string } | null>(null);
  const [editingAlbumName, setEditingAlbumName] = useState<{ albumId: string; value: string } | null>(null);
  const [editorSaving, setEditorSaving] = useState(false);

  // Download Job State
  const [downloadJobId, setDownloadJobId] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<{ status: string, progress: number, total: number, url?: string | null, error?: string | null, startTime: number } | null>(null);

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
    const savedShuffle = localStorage.getItem('gal_shuffle');
    const savedJob = localStorage.getItem('gal_download_job');
    
    if (savedCols) setColumns(Number(savedCols));
    if (savedCaps) setShowCaptions(savedCaps === 'true');
    if (savedCycle) setCycleTime(Number(savedCycle));
    if (savedView === 'albums' || savedView === 'all') setViewMode(savedView);
    if (savedShuffle) setShuffleMode(savedShuffle === 'true');
    if (savedJob) setDownloadJobId(savedJob);
    
    loadAlbums();
  }, [loadAlbums]);

  const loadDownloads = useCallback(async () => {
    const res = await fetch('/api/download-album/list');
    const data = await res.json();
    if (data.success) {
      setAvailableDownloads(data.downloads);
    }
  }, []);

  useEffect(() => {
    if (viewMode === 'downloads') loadDownloads();
  }, [viewMode, loadDownloads]);

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

  function flattenAlbums(albums: Album[], prefix = ''): { id: string; path: string }[] {
    const list: { id: string; path: string }[] = [];
    for (const a of albums) {
      const p = prefix ? `${prefix} › ${a.name}` : a.name;
      list.push({ id: a.id, path: p });
      list.push(...flattenAlbums(a.albums || [], p));
    }
    return list;
  }
  const flattenedAlbums = flattenAlbums(rootAlbums);

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

  // Picture Frame Preload & Transition Fix
  useEffect(() => {
    if (!frameMode || activeFrameImages.length === 0) return;
    let isCancelled = false;

    const loadAndNext = () => {
      const nextIndex = (frameIndex + 1) % activeFrameImages.length;
      const imgSrc = activeFrameImages[nextIndex].src;
      
      const img = new Image();
      img.onload = () => {
        if (!isCancelled) setFrameIndex(nextIndex);
      };
      img.onerror = () => {
        if (!isCancelled) setFrameIndex(nextIndex);
      };
      // Initiate background load of the upcoming image
      img.src = imgSrc;
    };

    // Wait the full cycle time displaying current image, then begin loading the next image
    // Note: The total time will be cycleTime + network_load_time for the next image,
    // guaranteeing no halfway-loaded skipping.
    const timer: NodeJS.Timeout = setTimeout(loadAndNext, cycleTime);

    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [frameMode, activeFrameImages, frameIndex, cycleTime]);

  const startFrameMode = async () => {
    if (frameImages.length === 0) return;

    // Proper Fisher-Yates shuffle
    const list = [...frameImages];
    if (shuffleMode) {
      for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
      }
    }

    setActiveFrameImages(list);
    setFrameIndex(0);
    setFrameMode(true);
    setExpandedIndex(null);
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

  // ── Download Polling ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!downloadJobId) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/download-album/progress?id=${downloadJobId}`);
        const data = await res.json();
        if (data.success && data.data) {
          setDownloadProgress(data.data);
          if (data.data.status === 'completed' || data.data.status === 'error') {
            clearInterval(interval);
            // Notice: auto redirect removed to prevent crashing and interrupting navigation. 
            // User explores downloads in Downloads tab.
            if (data.data.status === 'completed' && viewMode === 'downloads') {
               loadDownloads(); // refresh list if they happen to be on it
            }
          }
        } else {
           clearInterval(interval);
           localStorage.removeItem('gal_download_job');
           setDownloadJobId(null);
           setDownloadProgress(null);
        }
      } catch { } // Ignore network errors during polling
    }, 1500);
    return () => clearInterval(interval);
  }, [downloadJobId]);

  const handleDownloadAlbum = async () => {
    const id = currentAlbum ? currentAlbum.id : 'all';
    const res = await fetch('/api/download-album/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    const data = await res.json();
    if (data.success) {
      setDownloadJobId(data.jobId);
      localStorage.setItem('gal_download_job', data.jobId);
      setDownloadProgress({ status: 'processing', progress: 0, total: 100, startTime: Date.now() });
    }
  };

  const closeDownloadModal = () => {
    setDownloadJobId(null);
    setDownloadProgress(null);
    localStorage.removeItem('gal_download_job');
  };

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
    if (!(await confirm({
      title: 'Delete Album',
      message: `Delete album "${albumName}" and ALL its contents? This cannot be undone.`,
      confirmLabel: 'Delete Album',
      danger: true
    }))) return;
    const res = await fetch('/api/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'gallery-album', id: albumId })
    });
    const data = await res.json();
    if (data.success) {
      if (breadcrumb.some(b => b.id === albumId)) navigateRoot();
      await loadAlbums();
    }
  };

  const handleDeleteDownload = async (filename: string) => {
    if (!(await confirm({ title: 'Delete Download', message: 'Delete this download archive?', confirmLabel: 'Delete', danger: true }))) return;
    const res = await fetch('/api/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'download', id: filename })
    });
    if ((await res.json()).success) {
      loadDownloads();
    }
  };

  // ── Photo deletion ────────────────────────────────────────────────────────
  const handleDeletePhoto = async (src: string) => {
    if (!(await confirm({ title: 'Delete Photo', message: 'Delete this photo permanently?', confirmLabel: 'Delete', danger: true }))) return;
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
      body: JSON.stringify({
        type: 'gallery-photo',
        albumId: editingCaption.albumId,
        src: editingCaption.src,
        caption: editingCaption.value,
        newAlbumId: editingCaption.newAlbumId
      })
    });
    if ((await res.json()).success) {
      await loadAlbums();
      setEditingCaption(null);
      setExpandedIndex(null); // Close expansion as album may have changed
    }
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
                <button onClick={e => { e.stopPropagation(); setEditingCaption({ albumId: img.albumId, src: img.src, value: img.caption, newAlbumId: img.albumId }); }}
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
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--muted)', fontSize: '0.85rem' }}>Move to Album</label>
                    <select
                      value={editingCaption.newAlbumId}
                      onChange={e => setEditingCaption({ ...editingCaption, newAlbumId: e.target.value })}
                      style={{ background: 'var(--input-bg)', color: 'var(--foreground)', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--surface-border)', width: '100%' }}
                    >
                      {flattenedAlbums.map(a => (
                        <option key={a.id} value={a.id}>{a.path}</option>
                      ))}
                    </select>
                  </div>
                  <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
                    <button className="btn btn-primary" onClick={saveCaptionEdit} disabled={editorSaving}>{editorSaving ? 'Saving...' : 'Save Changes'}</button>
                    <button className="btn btn-secondary" onClick={() => setEditingCaption(null)}>Cancel</button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="glass-panel" style={{ padding: isExpanded ? '2rem' : '0.5rem', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div style={{ position: 'relative', width: '100%', aspectRatio: isExpanded ? 'auto' : '1/1', height: isExpanded ? '72vh' : 'auto', borderRadius: '8px', overflow: 'hidden' }}>
                  <img
                    src={(img.src.startsWith('/api') || img.src.startsWith('http') ? img.src : `/api/media${img.src.startsWith('/') ? '' : '/'}${img.src}`) + (isExpanded ? '' : '?w=400')}
                    alt={img.caption}
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
        
          <div style={{ display: 'flex', background: 'var(--surface-bg)', border: '1px solid var(--surface-border)', borderRadius: '10px', padding: '0.25rem', overflow: 'hidden' }}>
            {['albums', 'all', ...(isAdmin ? ['downloads'] : [])].map(mode => (
              <button key={mode} onClick={() => { setViewMode(mode as any); saveSetting('gal_view', mode); }} style={{
                  padding: '0.4rem 0.8rem', fontSize: '0.85rem', borderRadius: '6px', border: 'none', cursor: 'pointer', transition: 'all 0.2s', textTransform: 'capitalize',
                  background: viewMode === mode ? 'var(--accent)' : 'transparent',
                  color: viewMode === mode ? 'white' : 'var(--foreground)',
                  fontWeight: viewMode === mode ? 600 : 400
              }}>{mode === 'all' ? 'All Photos' : mode}</button>
            ))}
          </div>

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
                onClick={handleDownloadAlbum}
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
          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--muted)' }}>Columns:</label>
            <select value={columns} onChange={e => { setColumns(Number(e.target.value)); saveSetting('gal_cols', e.target.value); }}
              style={{ background: 'var(--input-bg)', color: 'var(--foreground)', padding: '0.5rem', borderRadius: '8px', border: '1px solid var(--surface-border)' }}>
              {[2, 3, 4, 5, 6, 7, 8].map(n => <option key={n} value={n}>{n}</option>)}
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
          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--muted)' }}>Shuffle Mode:</label>
            <button className={shuffleMode ? 'btn btn-primary' : 'btn btn-secondary'} onClick={() => { setShuffleMode(!shuffleMode); saveSetting('gal_shuffle', (!shuffleMode).toString()); }}>
              {shuffleMode ? 'On' : 'Off'}
            </button>
          </div>
        </div>
      )}

      {loading ? <p className="animate-fade-in">Loading gallery...</p> : (
        <div className="animate-fade-in">
          {/* Downloads grid */}
          {viewMode === 'downloads' && (
            <div className="animate-fade-in">
              {availableDownloads.length === 0 ? (
                  <div className="glass-panel" style={{ textAlign: 'center', padding: '4rem' }}>
                    <h3>No downloads available</h3>
                    <p>Generated album ZIP files will appear here.</p>
                  </div>
              ) : (
                  <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1.5rem' }}>
                      {availableDownloads.map((dl, i) => (
                          <div key={i} className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                              <div>
                                  <h3 style={{ margin: '0 0 0.2rem', fontSize: '1.05rem', wordBreak: 'break-all' }}>{dl.name}</h3>
                                  <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--muted)' }}>
                                    {(dl.sizeBytes / 1024 / 1024).toFixed(2)} MB • {new Date(dl.createdAt).toLocaleDateString()}
                                  </p>
                              </div>
                              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                                <a href={dl.url} download className="btn btn-primary" style={{ flex: 1, textAlign: 'center', padding: '0.6rem' }}>⬇ Download</a>
                                <button onClick={() => handleDeleteDownload(dl.filename)} className="btn btn-secondary" style={{ color: '#fc8181', borderColor: 'rgba(252,129,129,0.3)', padding: '0.6rem' }}>🗑 Delete</button>
                              </div>
                          </div>
                      ))}
                  </div>
              )}
            </div>
          )}

          {/* Album grid (shown when not "view all" mode, always shown inside an album) */}
          {viewMode !== 'all' && viewMode !== 'downloads' && shownAlbums.length > 0 && (
            <div>
              {currentAlbum && <h2 style={{ marginBottom: '1rem', fontSize: '1.1rem', color: 'var(--muted)' }}>Sub-Albums</h2>}
              <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1.5rem', marginBottom: shownImages.length > 0 ? '3rem' : 0 }}>
                {shownAlbums.map(album => renderAlbumCard(album))}
              </div>
            </div>
          )}

          {/* Photo grid */}
          {viewMode !== 'downloads' && shownImages.length > 0 && (
            <div>
              {currentAlbum && shownAlbums.length > 0 && <h2 style={{ marginBottom: '1rem', fontSize: '1.1rem', color: 'var(--muted)' }}>Photos in this Album</h2>}
              {renderPhotoGrid(shownImages.slice(0, visibleCount))}
              {shownImages.length > visibleCount && (
                <div style={{ display: 'flex', justifyContent: 'center', marginTop: '2rem', marginBottom: '3rem' }}>
                  <button className="btn btn-secondary" onClick={() => setVisibleCount(p => p + 60)}>
                    Show More ({shownImages.length - visibleCount} remaining)
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Empty state */}
          {viewMode !== 'downloads' && shownAlbums.length === 0 && shownImages.length === 0 && (
            <div className="glass-panel" style={{ textAlign: 'center', padding: '4rem' }}>
              <h3>Nothing here yet</h3>
              <p>{isAdmin ? 'Use "+ New Album" to create an album, or upload photos in Admin.' : 'No photos or albums available.'}</p>
            </div>
          )}
        </div>
      )}

      {/* Download Progress Toast */}
      {downloadProgress && mounted && createPortal(
          <div className="glass-panel animate-fade-in" style={{ position: 'fixed', bottom: '2rem', right: '2rem', zIndex: 999999, width: '320px', padding: '1.25rem', boxShadow: '0 10px 30px rgba(0,0,0,0.4)', border: '1px solid var(--surface-border)' }}>
            <h4 style={{ margin: '0 0 0.75rem', fontSize: '0.95rem', display: 'flex', justifyContent: 'space-between', color: 'var(--foreground)' }}>
               <span>{downloadProgress.status === 'processing' ? 'Generating ZIP...' : downloadProgress.status === 'error' ? 'Error' : 'Ready'}</span>
               <button onClick={closeDownloadModal} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', padding: 0 }}>✕</button>
            </h4>
            
            {downloadProgress.status === 'processing' && (
              <>
                <div style={{ background: 'var(--input-bg)', borderRadius: '6px', height: '8px', width: '100%', overflow: 'hidden', marginBottom: '0.5rem' }}>
                  <div style={{ height: '100%', background: 'var(--accent)', width: `${Math.max(2, (downloadProgress.progress / Math.max(downloadProgress.total, 1)) * 100)}%`, transition: 'width 0.4s ease-out' }}></div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--muted)', opacity: 0.8 }}>
                   <span>{downloadProgress.progress} / {downloadProgress.total}</span>
                   <span>
                     {(()=>{
                        const elapsedSeconds = (Date.now() - downloadProgress.startTime) / 1000;
                        if(elapsedSeconds < 2 || downloadProgress.progress === 0) return 'Estimating...';
                        const itemsPerSecond = downloadProgress.progress / elapsedSeconds;
                        const remainingItems = downloadProgress.total - downloadProgress.progress;
                        const estimatedSecondsRemaining = remainingItems / itemsPerSecond;
                        return `${Math.max(1, Math.ceil(estimatedSecondsRemaining))}s left`;
                     })()}
                   </span>
                </div>
              </>
            )}

            {downloadProgress.status === 'completed' && (
              <p style={{ fontSize: '0.85rem', margin: '0.25rem 0 0', color: 'var(--accent-light)' }}>The download is now ready in the <strong>Downloads</strong> tab.</p>
            )}

            {downloadProgress.status === 'error' && (
              <p style={{ color: '#fc8181', margin: 0, fontSize: '0.85rem' }}>{downloadProgress.error || 'A problem occurred.'}</p>
            )}
          </div>,
        document.body
      )}

      {/* Picture Frame Portal */}
      {frameMode && mounted && activeFrameImages.length > 0 && createPortal(
        (() => {
          const img = activeFrameImages[frameIndex];
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
              {activeFrameImages.map((imgItem, i) => {
                // Optimization: Only render the current, next, and previous image for cross-fading speed
                const isCurrent = frameIndex === i;
                const isNext = (frameIndex + 1) % activeFrameImages.length === i;
                const isPrev = (frameIndex - 1 + activeFrameImages.length) % activeFrameImages.length === i;

                // If not in the active window of 3, don't render to save memory
                if (!isCurrent && !isNext && !isPrev) return null;

                return (
                  <img
                    key={`${imgItem.src}-${i}`}
                    src={imgItem.src}
                    alt=""
                    style={{
                      position: 'absolute',
                      inset: 0,
                      width: '100%',
                      height: '100%',
                      objectFit: 'contain',
                      opacity: isCurrent ? 1 : 0,
                      transition: 'opacity 1s ease-in-out', // Slower, smoother transition
                      pointerEvents: 'none'
                    }}
                  />
                );
              })}
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
      {popup}
    </div>
  );
}

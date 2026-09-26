'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useSitePopup } from '@/components/SitePopup';
import Lightbox from '@/components/gallery/Lightbox';
import { mediaSrc, mediaSrcSet } from '@/lib/media-url';

interface AlbumImage { src: string; caption: string; }
interface Album { id: string; name: string; images: AlbumImage[]; albums: Album[]; }
type Photo = AlbumImage & { albumId: string };

const PAGE_SIZE = 60;
/** Grid "sizes" for srcset: roughly one column's width. */
const TILE_SIZES = '(max-width: 600px) 50vw, (max-width: 1100px) 33vw, 300px';

function findAlbum(albums: Album[], id: string): Album | null {
  for (const a of albums) {
    if (a.id === id) return a;
    const found = findAlbum(a.albums || [], id);
    if (found) return found;
  }
  return null;
}

function collectAllImages(album: Album): Photo[] {
  const imgs = album.images.map(i => ({ ...i, albumId: album.id }));
  for (const sub of (album.albums || [])) imgs.push(...collectAllImages(sub));
  return imgs;
}

function countPhotos(album: Album): number {
  return album.images.length + (album.albums || []).reduce((n, a) => n + countPhotos(a), 0);
}

/** First photo in the album or, failing that, in its sub-albums. */
function coverOf(album: Album): string | null {
  if (album.images[0]) return album.images[0].src;
  for (const sub of album.albums || []) {
    const cover = coverOf(sub);
    if (cover) return cover;
  }
  return null;
}

/** albumId → "Parent › Child" labels. */
function buildAlbumPathMap(albums: Album[], prefix = '', map: Record<string, string> = {}) {
  for (const a of albums) {
    const p = prefix ? `${prefix} › ${a.name}` : a.name;
    map[a.id] = p;
    buildAlbumPathMap(a.albums || [], p, map);
  }
  return map;
}

type GalleryClientProps = { initialAlbums: Album[]; initialIsAdmin: boolean };

export default function GalleryClient({ initialAlbums, initialIsAdmin }: GalleryClientProps) {
  const { confirm, popup } = useSitePopup();
  const [rootAlbums, setRootAlbums] = useState<Album[]>(initialAlbums);
  const [isAdmin, setIsAdmin] = useState(initialIsAdmin);

  // Navigation — breadcrumb is the stack of albums navigated into
  const [breadcrumb, setBreadcrumb] = useState<Album[]>([]);
  const currentAlbum: Album | null = breadcrumb[breadcrumb.length - 1] ?? null;

  // View / settings
  const [viewMode, setViewMode] = useState<'albums' | 'all' | 'downloads'>('albums');
  const [availableDownloads, setAvailableDownloads] = useState<any[]>([]);
  const [columns, setColumns] = useState(0); // 0 = fit to screen
  const [showCaptions, setShowCaptions] = useState(true);
  const [cycleTime, setCycleTime] = useState(5000);
  const [shuffleMode, setShuffleMode] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // Grid & viewer
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const sentinel = useRef<HTMLDivElement>(null);

  // Picture frame
  const [frameMode, setFrameMode] = useState(false);
  const [frameIndex, setFrameIndex] = useState(0);
  const [activeFrameImages, setActiveFrameImages] = useState<Photo[]>([]);
  const [frameWidth, setFrameWidth] = useState(1920);
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

  const saveSetting = (key: string, val: string) => { try { localStorage.setItem(key, val); } catch { } };

  const loadAlbums = useCallback(async () => {
    const data = await fetch('/api/gallery').then(r => r.json()).catch(() => null);
    if (data?.success) {
      setRootAlbums(data.albums);
      setIsAdmin(data.isAdmin || false);
    }
  }, []);

  useEffect(() => {
    setMounted(true);
    try {
      const savedCols = localStorage.getItem('gal_cols');
      const savedCaps = localStorage.getItem('gal_caps');
      const savedCycle = localStorage.getItem('gal_cycle');
      const savedView = localStorage.getItem('gal_view');
      const savedShuffle = localStorage.getItem('gal_shuffle');
      const savedJob = localStorage.getItem('gal_download_job');
      if (savedCols) setColumns(Number(savedCols) || 0);
      if (savedCaps) setShowCaptions(savedCaps === 'true');
      if (savedCycle) setCycleTime(Number(savedCycle));
      if (savedView === 'albums' || savedView === 'all') setViewMode(savedView);
      if (savedShuffle) setShuffleMode(savedShuffle === 'true');
      if (savedJob) setDownloadJobId(savedJob);
    } catch { }
  }, []);

  const loadDownloads = useCallback(async () => {
    const res = await fetch('/api/download-album/list');
    const data = await res.json();
    if (data.success) setAvailableDownloads(data.downloads);
  }, []);

  useEffect(() => {
    if (viewMode === 'downloads') loadDownloads();
  }, [viewMode, loadDownloads]);

  // Deep link: /gallery?album=ID opens that album (e.g. from a project card).
  const [deepLinked, setDeepLinked] = useState(false);
  useEffect(() => {
    if (deepLinked || rootAlbums.length === 0) return;
    setDeepLinked(true);
    const wanted = new URLSearchParams(window.location.search).get('album');
    if (!wanted) return;
    const pathTo = (albums: Album[], trail: Album[]): Album[] | null => {
      for (const a of albums) {
        if (a.id === wanted) return [...trail, a];
        const found = pathTo(a.albums || [], [...trail, a]);
        if (found) return found;
      }
      return null;
    };
    const path = pathTo(rootAlbums, []);
    if (path) { setViewMode('albums'); setBreadcrumb(path); }
  }, [rootAlbums, deepLinked]);

  // Keep breadcrumb in sync when rootAlbums reloads
  useEffect(() => {
    const resync = (albums: Album[], crumb: Album[]): Album[] => {
      if (crumb.length === 0) return [];
      const found = findAlbum(albums, crumb[0].id);
      if (!found) return [];
      return [found, ...resync(found.albums || [], crumb.slice(1))];
    };
    setBreadcrumb(prev => (prev.length ? resync(rootAlbums, prev) : prev));
  }, [rootAlbums]);

  const albumPathMap = useMemo(() => buildAlbumPathMap(rootAlbums), [rootAlbums]);
  const flattenedAlbums = useMemo(() => Object.entries(albumPathMap).map(([id, path]) => ({ id, path })), [albumPathMap]);

  const resetView = () => { setViewerIndex(null); setVisibleCount(PAGE_SIZE); window.scrollTo({ top: 0 }); };
  const navigateInto = (album: Album) => { setBreadcrumb(prev => [...prev, album]); resetView(); };
  const navigateTo = (index: number) => { setBreadcrumb(prev => prev.slice(0, index + 1)); resetView(); };
  const navigateRoot = () => { setBreadcrumb([]); resetView(); };

  // ── What to display in the current view ──────────────────────────────────
  const shownAlbums: Album[] = currentAlbum ? (currentAlbum.albums || []) : rootAlbums;
  const shownImages: Photo[] = useMemo(() => {
    if (viewMode === 'all' && !currentAlbum) return rootAlbums.flatMap(a => collectAllImages(a));
    if (currentAlbum) return currentAlbum.images.map(i => ({ ...i, albumId: currentAlbum.id }));
    return [];
  }, [viewMode, currentAlbum, rootAlbums]);

  // Frame images: if inside an album collect recursively, else all images from all
  const frameImages: Photo[] = currentAlbum ? collectAllImages(currentAlbum) : rootAlbums.flatMap(a => collectAllImages(a));

  // Load the next page of photos as the end of the grid scrolls into view.
  const hasMore = shownImages.length > visibleCount;
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) setVisibleCount(n => n + PAGE_SIZE);
    }, { rootMargin: '800px 0px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, visibleCount]);

  // Picture Frame Preload & Transition Fix
  useEffect(() => {
    if (!frameMode || activeFrameImages.length === 0) return;
    let isCancelled = false;

    const loadAndNext = () => {
      const nextIndex = (frameIndex + 1) % activeFrameImages.length;
      const img = new Image();
      img.onload = () => { if (!isCancelled) setFrameIndex(nextIndex); };
      img.onerror = () => { if (!isCancelled) setFrameIndex(nextIndex); };
      // Load the upcoming photo in the background; it shows once it's fully loaded.
      img.src = mediaSrc(activeFrameImages[nextIndex].src, frameWidth);
    };

    const timer: NodeJS.Timeout = setTimeout(loadAndNext, cycleTime);
    return () => { isCancelled = true; clearTimeout(timer); };
  }, [frameMode, activeFrameImages, frameIndex, cycleTime, frameWidth]);

  const startFrameMode = async () => {
    if (frameImages.length === 0) return;
    const list = [...frameImages];
    if (shuffleMode) {
      for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
      }
    }
    // A 1080p TV needs 1920px; a 4K one gets the largest cached size too.
    const needed = Math.max(window.screen.width, window.screen.height) * Math.min(window.devicePixelRatio || 1, 2);
    setFrameWidth(needed <= 1280 ? 1280 : 1920);
    setActiveFrameImages(list);
    setFrameIndex(0);
    setFrameMode(true);
    setViewerIndex(null);
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
            if (data.data.status === 'completed' && viewMode === 'downloads') loadDownloads();
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
  }, [downloadJobId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDownloadAlbum = async () => {
    const id = currentAlbum ? currentAlbum.id : 'all';
    const res = await fetch('/api/download-album/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    const data = await res.json();
    if (data.success) {
      setDownloadJobId(data.jobId);
      saveSetting('gal_download_job', data.jobId);
      setDownloadProgress({ status: 'processing', progress: 0, total: 100, startTime: Date.now() });
    }
  };

  const closeDownloadModal = () => {
    setDownloadJobId(null);
    setDownloadProgress(null);
    localStorage.removeItem('gal_download_job');
  };

  // ── Admin actions ─────────────────────────────────────────────────────────
  const handleCreateAlbum = async () => {
    if (!newAlbumName.trim()) return;
    setAlbumCreating(true);
    const res = await fetch('/api/gallery', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newAlbumName.trim(), parentId: currentAlbum?.id || undefined }) });
    const data = await res.json();
    if (data.success) { await loadAlbums(); setNewAlbumName(''); setAddingAlbum(false); }
    setAlbumCreating(false);
  };

  const handleDeleteAlbum = async (albumId: string, albumName: string) => {
    if (!(await confirm({ title: 'Delete Album', message: `Delete album "${albumName}" and ALL its contents? This cannot be undone.`, confirmLabel: 'Delete Album', danger: true }))) return;
    const res = await fetch('/api/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'gallery-album', id: albumId }) });
    const data = await res.json();
    if (data.success) {
      if (breadcrumb.some(b => b.id === albumId)) navigateRoot();
      await loadAlbums();
    }
  };

  const handleDeleteDownload = async (filename: string) => {
    if (!(await confirm({ title: 'Delete Download', message: 'Delete this download archive?', confirmLabel: 'Delete', danger: true }))) return;
    const res = await fetch('/api/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'download', id: filename }) });
    if ((await res.json()).success) loadDownloads();
  };

  const handleDeletePhoto = async (src: string) => {
    if (!(await confirm({ title: 'Delete Photo', message: 'Delete this photo permanently?', confirmLabel: 'Delete', danger: true }))) return;
    const res = await fetch('/api/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'gallery', id: src }) });
    const data = await res.json();
    if (data.success) { setViewerIndex(null); await loadAlbums(); }
  };

  const saveCaptionEdit = async () => {
    if (!editingCaption) return;
    setEditorSaving(true);
    const res = await fetch('/api/edit', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'gallery-photo', albumId: editingCaption.albumId, src: editingCaption.src, caption: editingCaption.value, newAlbumId: editingCaption.newAlbumId }),
    });
    if ((await res.json()).success) { await loadAlbums(); setEditingCaption(null); }
    setEditorSaving(false);
  };

  const saveAlbumNameEdit = async () => {
    if (!editingAlbumName) return;
    setEditorSaving(true);
    const res = await fetch('/api/edit', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'gallery-album', albumId: editingAlbumName.albumId, name: editingAlbumName.value }) });
    if ((await res.json()).success) { await loadAlbums(); setEditingAlbumName(null); }
    setEditorSaving(false);
  };

  // ── Photo grid ────────────────────────────────────────────────────────────
  const gridStyle: React.CSSProperties = columns > 0 ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : {};

  const renderPhotoGrid = (images: Photo[]) => (
    <div className="gal-grid" style={gridStyle}>
      {images.map((img, i) => {
        if (editingCaption && editingCaption.src === img.src) {
          return (
            <div key={`${img.src}-${i}`} className="glass-panel gal-edit animate-fade-in">
              <img src={mediaSrc(img.src, 640)} alt="" />
              <div style={{ flex: 1, minWidth: '200px', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <label>
                  <span className="gal-label">Caption</span>
                  <input value={editingCaption.value} onChange={e => setEditingCaption({ ...editingCaption, value: e.target.value })} placeholder="Caption..." autoFocus />
                </label>
                <label>
                  <span className="gal-label">Move to album</span>
                  <select className="gal-select" value={editingCaption.newAlbumId} onChange={e => setEditingCaption({ ...editingCaption, newAlbumId: e.target.value })}>
                    {flattenedAlbums.map(a => <option key={a.id} value={a.id}>{a.path}</option>)}
                  </select>
                </label>
                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  <button className="btn btn-primary" onClick={saveCaptionEdit} disabled={editorSaving}>{editorSaving ? 'Saving...' : 'Save'}</button>
                  <button className="btn btn-secondary" onClick={() => setEditingCaption(null)}>Cancel</button>
                </div>
              </div>
            </div>
          );
        }
        const label = viewMode === 'all' && !currentAlbum ? albumPathMap[img.albumId] : '';
        return (
          <figure key={`${img.src}-${i}`} className="gal-tile">
            <button className="gal-photo" onClick={() => setViewerIndex(i)} aria-label={img.caption || `Photo ${i + 1}`}>
              <img
                src={mediaSrc(img.src, 400)}
                srcSet={mediaSrcSet(img.src, [400, 640])}
                sizes={TILE_SIZES}
                alt={img.caption}
                loading={i < 8 ? 'eager' : 'lazy'}
                decoding="async"
              />
            </button>
            {isAdmin && (
              <div className="gal-admin">
                <a href={`/api/download-album?photo=${encodeURIComponent(img.src)}`} download title="Download original" aria-label="Download original">⬇</a>
                <button onClick={() => setEditingCaption({ albumId: img.albumId, src: img.src, value: img.caption, newAlbumId: img.albumId })} title="Edit caption / move" aria-label="Edit">✏️</button>
                <button onClick={() => handleDeletePhoto(img.src)} title="Delete photo" aria-label="Delete">✕</button>
              </div>
            )}
            {showCaptions && (img.caption || label) && (
              <figcaption>
                {label && <span className="gal-tile-label">{label}</span>}
                {img.caption}
              </figcaption>
            )}
          </figure>
        );
      })}
    </div>
  );

  // ── Album card ────────────────────────────────────────────────────────────
  const renderAlbumCard = (album: Album, i: number) => {
    if (editingAlbumName && editingAlbumName.albumId === album.id) {
      return (
        <div key={album.id} className="glass-panel animate-fade-in" style={{ gridColumn: '1 / -1', display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>Rename album:</span>
          <input value={editingAlbumName.value} onChange={e => setEditingAlbumName({ albumId: album.id, value: e.target.value })}
            onKeyDown={e => e.key === 'Enter' && saveAlbumNameEdit()} style={{ flex: 1, minWidth: '160px', maxWidth: '340px' }} autoFocus />
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="btn btn-primary" onClick={saveAlbumNameEdit} disabled={editorSaving}>{editorSaving ? 'Saving...' : 'Save'}</button>
            <button className="btn btn-secondary" onClick={() => setEditingAlbumName(null)}>Cancel</button>
          </div>
        </div>
      );
    }
    const cover = coverOf(album);
    const photos = countPhotos(album);
    const subs = album.albums?.length || 0;
    return (
      <div key={album.id} className="gal-album">
        <button className="gal-album-btn" onClick={() => navigateInto(album)}>
          {cover
            ? <img src={mediaSrc(cover, 640)} srcSet={mediaSrcSet(cover, [400, 640, 960])} sizes="(max-width: 600px) 100vw, 360px" alt="" loading={i < 6 ? 'eager' : 'lazy'} decoding="async" />
            : <span className="gal-album-empty" aria-hidden>📷</span>}
          <span className="gal-album-info">
            <strong>{album.name}</strong>
            <span>{photos} photo{photos !== 1 ? 's' : ''}{subs ? ` · ${subs} album${subs !== 1 ? 's' : ''}` : ''}</span>
          </span>
        </button>
        {isAdmin && (
          <div className="gal-admin">
            <button onClick={() => setEditingAlbumName({ albumId: album.id, value: album.name })} title="Rename album" aria-label="Rename album">✏️</button>
            <button onClick={() => handleDeleteAlbum(album.id, album.name)} title="Delete album" aria-label="Delete album">🗑</button>
          </div>
        )}
      </div>
    );
  };

  const modes: ('albums' | 'all' | 'downloads')[] = ['albums', 'all', ...(isAdmin ? ['downloads' as const] : [])];
  const totalPhotos = useMemo(() => rootAlbums.reduce((n, a) => n + countPhotos(a), 0), [rootAlbums]);

  return (
    <div className="gal-page">
      {/* Header */}
      <header className="gal-header">
        <div style={{ minWidth: 0 }}>
          {breadcrumb.length > 0 && (
            <nav className="gal-crumbs" aria-label="Albums">
              <button onClick={navigateRoot}>Gallery</button>
              {breadcrumb.map((b, i) => (
                <span key={b.id}>
                  <span aria-hidden> / </span>
                  <button onClick={() => navigateTo(i)} aria-current={i === breadcrumb.length - 1 ? 'page' : undefined}>{b.name}</button>
                </span>
              ))}
            </nav>
          )}
          <h1 style={{ marginBottom: 0 }}>{currentAlbum?.name ?? 'Gallery'}</h1>
          <p className="gal-sub">
            {currentAlbum ? `${countPhotos(currentAlbum)} photos` : `${totalPhotos} photos in ${rootAlbums.length} album${rootAlbums.length === 1 ? '' : 's'}`}
          </p>
        </div>

        <div className="gal-toolbar">
          {!currentAlbum && (
            <div className="gal-segmented" role="tablist">
              {modes.map(mode => (
                <button key={mode} role="tab" aria-selected={viewMode === mode} onClick={() => { setViewMode(mode); saveSetting('gal_view', mode); resetView(); }}>
                  {mode === 'all' ? 'All photos' : mode === 'albums' ? 'Albums' : 'Downloads'}
                </button>
              ))}
            </div>
          )}
          {isAdmin && <button className="gal-icon-btn" aria-pressed={addingAlbum} onClick={() => setAddingAlbum(!addingAlbum)} title="New album">＋</button>}
          {isAdmin && <button className="gal-icon-btn" onClick={handleDownloadAlbum} title="Download album as ZIP">⬇</button>}
          <button className="gal-icon-btn" aria-pressed={showSettings} onClick={() => setShowSettings(!showSettings)} title="Display settings">⚙</button>
          <button className="btn btn-primary gal-frame-btn" onClick={startFrameMode} disabled={frameImages.length === 0} title="Full-screen slideshow" aria-label="Slideshow">▶<span className="gal-frame-label"> Slideshow</span></button>
        </div>
      </header>

      {/* New Album form */}
      {addingAlbum && isAdmin && (
        <div className="glass-panel animate-fade-in gal-panel">
          <span style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>New {currentAlbum ? `album inside "${currentAlbum.name}"` : 'album'}:</span>
          <input value={newAlbumName} onChange={e => setNewAlbumName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleCreateAlbum()}
            placeholder="Album name..." style={{ flex: 1, minWidth: '180px', maxWidth: '300px' }} autoFocus />
          <button className="btn btn-primary" onClick={handleCreateAlbum} disabled={albumCreating || !newAlbumName.trim()}>{albumCreating ? 'Creating...' : 'Create'}</button>
        </div>
      )}

      {/* Settings */}
      {showSettings && (
        <div className="glass-panel animate-fade-in gal-panel">
          <label>
            <span className="gal-label">Columns</span>
            <select className="gal-select" value={columns} onChange={e => { setColumns(Number(e.target.value)); saveSetting('gal_cols', e.target.value); }}>
              <option value={0}>Fit to screen</option>
              {[2, 3, 4, 5, 6, 7, 8].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label>
            <span className="gal-label">Slideshow speed</span>
            <select className="gal-select" value={cycleTime} onChange={e => { setCycleTime(Number(e.target.value)); saveSetting('gal_cycle', e.target.value); }}>
              <option value={3000}>3s</option><option value={5000}>5s</option><option value={10000}>10s</option><option value={30000}>30s</option>
            </select>
          </label>
          <div>
            <span className="gal-label">Captions</span>
            <button className={showCaptions ? 'btn btn-primary' : 'btn btn-secondary'} onClick={() => { setShowCaptions(!showCaptions); saveSetting('gal_caps', (!showCaptions).toString()); }}>{showCaptions ? 'On' : 'Off'}</button>
          </div>
          <div>
            <span className="gal-label">Shuffle slideshow</span>
            <button className={shuffleMode ? 'btn btn-primary' : 'btn btn-secondary'} onClick={() => { setShuffleMode(!shuffleMode); saveSetting('gal_shuffle', (!shuffleMode).toString()); }}>{shuffleMode ? 'On' : 'Off'}</button>
          </div>
        </div>
      )}

      {/* Downloads */}
      {viewMode === 'downloads' && !currentAlbum && (
        availableDownloads.length === 0 ? (
          <div className="glass-panel" style={{ textAlign: 'center', padding: '4rem 1.5rem' }}>
            <h3>No downloads available</h3>
            <p>Generated album ZIP files will appear here.</p>
          </div>
        ) : (
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '1rem' }}>
            {availableDownloads.map((dl, i) => (
              <div key={i} className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div>
                  <h3 style={{ margin: '0 0 0.2rem', fontSize: '1.05rem', wordBreak: 'break-all' }}>{dl.name}</h3>
                  <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--muted)' }}>{(dl.sizeBytes / 1024 / 1024).toFixed(2)} MB • {new Date(dl.createdAt).toLocaleDateString()}</p>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <a href={dl.url} download className="btn btn-primary" style={{ flex: 1 }}>⬇ Download</a>
                  <button onClick={() => handleDeleteDownload(dl.filename)} className="btn btn-secondary" style={{ color: 'var(--danger)' }}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {/* Albums (always shown inside an album; on top level unless "All photos") */}
      {viewMode !== 'downloads' && (viewMode !== 'all' || currentAlbum) && shownAlbums.length > 0 && (
        <section style={{ marginBottom: shownImages.length > 0 ? '2.5rem' : 0 }}>
          {currentAlbum && <h2 className="gal-section-title">Albums</h2>}
          <div className="gal-albums">{shownAlbums.map((album, i) => renderAlbumCard(album, i))}</div>
        </section>
      )}

      {/* Photos */}
      {(viewMode !== 'downloads' || currentAlbum) && shownImages.length > 0 && (
        <section>
          {currentAlbum && shownAlbums.length > 0 && <h2 className="gal-section-title">Photos</h2>}
          {renderPhotoGrid(shownImages.slice(0, visibleCount))}
          {hasMore && (
            <div ref={sentinel} style={{ display: 'flex', justifyContent: 'center', margin: '2rem 0' }}>
              <button className="btn btn-secondary" onClick={() => setVisibleCount(p => p + PAGE_SIZE)}>
                Show more ({shownImages.length - visibleCount} left)
              </button>
            </div>
          )}
        </section>
      )}

      {/* Empty state */}
      {viewMode !== 'downloads' && shownAlbums.length === 0 && shownImages.length === 0 && (
        <div className="glass-panel" style={{ textAlign: 'center', padding: '4rem 1.5rem' }}>
          <h3>Nothing here yet</h3>
          <p>{isAdmin ? 'Use ＋ to create an album, or upload photos in Admin.' : 'No photos or albums available.'}</p>
        </div>
      )}

      {viewerIndex !== null && shownImages[viewerIndex] && (
        <Lightbox
          images={shownImages.map(img => ({ src: img.src, caption: img.caption, label: viewMode === 'all' && !currentAlbum ? albumPathMap[img.albumId] : undefined }))}
          index={viewerIndex}
          onIndex={i => { setViewerIndex(i); if (i >= visibleCount) setVisibleCount(i + 1); }}
          onClose={() => setViewerIndex(null)}
          showCaptions={showCaptions}
        />
      )}

      {/* Download Progress Toast */}
      {downloadProgress && mounted && createPortal(
        <div className="glass-panel animate-fade-in gal-toast">
          <h4 style={{ margin: '0 0 0.75rem', fontSize: '0.95rem', display: 'flex', justifyContent: 'space-between', color: 'var(--foreground)' }}>
            <span>{downloadProgress.status === 'processing' ? 'Generating ZIP...' : downloadProgress.status === 'error' ? 'Error' : 'Ready'}</span>
            <button onClick={closeDownloadModal} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', padding: 0 }} aria-label="Close">✕</button>
          </h4>
          {downloadProgress.status === 'processing' && (
            <>
              <div style={{ background: 'var(--input-bg)', borderRadius: '6px', height: '8px', width: '100%', overflow: 'hidden', marginBottom: '0.5rem' }}>
                <div style={{ height: '100%', background: 'var(--accent)', width: `${Math.max(2, (downloadProgress.progress / Math.max(downloadProgress.total, 1)) * 100)}%`, transition: 'width 0.4s ease-out' }}></div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--muted)' }}>
                <span>{downloadProgress.progress} / {downloadProgress.total}</span>
                <span>
                  {(() => {
                    const elapsedSeconds = (Date.now() - downloadProgress.startTime) / 1000;
                    if (elapsedSeconds < 2 || downloadProgress.progress === 0) return 'Estimating...';
                    const remaining = (downloadProgress.total - downloadProgress.progress) / (downloadProgress.progress / elapsedSeconds);
                    return `${Math.max(1, Math.ceil(remaining))}s left`;
                  })()}
                </span>
              </div>
            </>
          )}
          {downloadProgress.status === 'completed' && (
            <p style={{ fontSize: '0.85rem', margin: '0.25rem 0 0', color: 'var(--accent-light)' }}>The download is now ready in the <strong>Downloads</strong> tab.</p>
          )}
          {downloadProgress.status === 'error' && (
            <p style={{ color: 'var(--danger)', margin: 0, fontSize: '0.85rem' }}>{downloadProgress.error || 'A problem occurred.'}</p>
          )}
        </div>,
        document.body
      )}

      {/* Picture Frame */}
      {frameMode && mounted && activeFrameImages.length > 0 && createPortal(
        (() => {
          const img = activeFrameImages[frameIndex];
          const currentAlbumPathStr = currentAlbum ? albumPathMap[currentAlbum.id] || '' : '';
          const imgAlbumPathStr = img ? albumPathMap[img.albumId] || '' : '';
          let relativeAlbumPath = '';
          if (imgAlbumPathStr && imgAlbumPathStr !== currentAlbumPathStr && currentAlbumPathStr) {
            relativeAlbumPath = imgAlbumPathStr.startsWith(currentAlbumPathStr + ' › ')
              ? imgAlbumPathStr.substring((currentAlbumPathStr + ' › ').length)
              : imgAlbumPathStr;
          } else if (!currentAlbumPathStr) {
            relativeAlbumPath = imgAlbumPathStr;
          }

          return (
            <div style={{ position: 'fixed', inset: 0, background: '#000', zIndex: 999999, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }} onClick={exitFrameMode}>
              {activeFrameImages.map((imgItem, i) => {
                // Only the current, next and previous photo are in the page (for the cross-fade).
                const isCurrent = frameIndex === i;
                const isNext = (frameIndex + 1) % activeFrameImages.length === i;
                const isPrev = (frameIndex - 1 + activeFrameImages.length) % activeFrameImages.length === i;
                if (!isCurrent && !isNext && !isPrev) return null;
                return (
                  <img key={`${imgItem.src}-${i}`} src={mediaSrc(imgItem.src, frameWidth)} alt=""
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', opacity: isCurrent ? 1 : 0, transition: 'opacity 1s ease-in-out', pointerEvents: 'none' }} />
                );
              })}
              {(img?.caption || relativeAlbumPath) && showCaptions && (
                <div style={{ position: 'absolute', bottom: '3rem', background: 'rgba(0,0,0,0.6)', padding: '0.75rem 2.5rem', borderRadius: '30px', color: 'white', display: 'flex', flexDirection: 'column', alignItems: 'center', pointerEvents: 'none' }}>
                  {relativeAlbumPath && <div style={{ fontSize: '0.85rem', opacity: 0.7, fontStyle: 'italic', marginBottom: img?.caption ? '0.2rem' : 0 }}>{relativeAlbumPath}</div>}
                  {img?.caption && <div style={{ fontSize: '1.4rem' }}>{img.caption}</div>}
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

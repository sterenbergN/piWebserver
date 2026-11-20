'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { zipSync } from 'fflate';
import { useSitePopup } from '@/components/SitePopup';
import Lightbox from '@/components/gallery/Lightbox';
import GalleryUploadPanel from './GalleryUploadPanel';
import GalleryPopover from './GalleryPopover';
import { mediaPath, mediaSrc, mediaSrcSet } from '@/lib/media-url';

interface AlbumImage { src: string; caption: string; }
interface Album { id: string; name: string; images: AlbumImage[]; albums: Album[]; }
type Photo = AlbumImage & { albumId: string };

const PAGE_SIZE = 60;
const COLUMN_CHOICES = [0, 2, 3, 4, 5, 6]; // 0 = fit to screen
const SPEEDS = [3000, 5000, 10000, 30000];
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
  const { confirm, showAlert, popup } = useSitePopup();
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
  const [repairing, setRepairing] = useState(false);

  // Grid & viewer
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const sentinel = useRef<HTMLDivElement>(null);

  // Picture frame
  const [frameMode, setFrameMode] = useState(false);
  const [framePaused, setFramePaused] = useState(false);
  const [frameIndex, setFrameIndex] = useState(0);
  const [activeFrameImages, setActiveFrameImages] = useState<Photo[]>([]);
  const [frameWidth, setFrameWidth] = useState(1920);
  const [mounted, setMounted] = useState(false);

  // Admin: album creation
  const [addingAlbum, setAddingAlbum] = useState(false);
  const [newAlbumName, setNewAlbumName] = useState('');
  const [albumCreating, setAlbumCreating] = useState(false);
  const [showUpload, setShowUpload] = useState(false);

  // Admin: inline caption / album rename editing
  const [editingCaption, setEditingCaption] = useState<{ albumId: string; src: string; value: string; newAlbumId: string } | null>(null);
  const [editingAlbumName, setEditingAlbumName] = useState<{ albumId: string; value: string } | null>(null);
  const [editorSaving, setEditorSaving] = useState(false);

  // Download Job State
  const [downloadJobId, setDownloadJobId] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<{ status: string, progress: number, total: number, url?: string | null, error?: string | null, startTime: number } | null>(null);

  // Multi-select bulk actions
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const [bulkMoveTarget, setBulkMoveTarget] = useState('');
  const [bulkBusy, setBulkBusy] = useState<null | { kind: 'zip' | 'move' | 'delete'; done: number; total: number }>(null);
  const [bulkNotice, setBulkNotice] = useState('');

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

  useEffect(() => {
    if (flattenedAlbums.length === 0) return;
    if (!bulkMoveTarget || !flattenedAlbums.some(a => a.id === bulkMoveTarget)) {
      const alt = currentAlbum ? flattenedAlbums.find(a => a.id !== currentAlbum.id) : undefined;
      setBulkMoveTarget((alt ?? flattenedAlbums[0]).id);
    }
  }, [flattenedAlbums, bulkMoveTarget, currentAlbum]);

  const resetView = () => { setViewerIndex(null); setVisibleCount(PAGE_SIZE); setSelectedKeys(new Set()); setBulkNotice(''); window.scrollTo({ top: 0 }); };
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

  const photoKey = (img: Photo) => `${img.albumId}::${img.src}`;
  const selectedPhotos = useMemo(
    () => shownImages.filter(img => selectedKeys.has(photoKey(img))),
    [shownImages, selectedKeys]
  );

  const togglePhotoSelection = (img: Photo) => {
    const key = photoKey(img);
    setBulkNotice('');
    setSelectedKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleSelectionMode = () => {
    setBulkNotice('');
    if (selectionMode) {
      setSelectionMode(false);
      setSelectedKeys(new Set());
      return;
    }
    if (!currentAlbum && viewMode === 'albums') {
      saveSetting('gal_view', 'all');
      setViewMode('all');
      setViewerIndex(null);
      setVisibleCount(PAGE_SIZE);
    }
    setSelectionMode(true);
  };

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
    if (!frameMode || framePaused || activeFrameImages.length <= 1) return;
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
  }, [frameMode, framePaused, activeFrameImages, frameIndex, cycleTime, frameWidth]);

  const frameStep = useCallback((step: number) => {
    setFrameIndex((i) => (activeFrameImages.length ? (i + step + activeFrameImages.length) % activeFrameImages.length : 0));
  }, [activeFrameImages.length]);

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
    setFramePaused(false);
    setFrameMode(true);
    setViewerIndex(null);
    try { await document.documentElement.requestFullscreen(); } catch { }
  };
  const exitFrameMode = useCallback(async () => {
    setFrameMode(false);
    setFramePaused(false);
    try { if (document.fullscreenElement) await document.exitFullscreen(); } catch { }
  }, []);
  useEffect(() => {
    const handler = () => { if (!document.fullscreenElement && frameMode) setFrameMode(false); };
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, [frameMode]);
  useEffect(() => {
    if (!frameMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); void exitFrameMode(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); frameStep(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); frameStep(-1); }
      else if (e.key === ' ') { e.preventDefault(); setFramePaused((p) => !p); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [frameMode, exitFrameMode, frameStep]);

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

  const handleRepair = async () => {
    if (!(await confirm({ title: 'Repair gallery index', message: 'Re-scan the disk and add any photos missing from the gallery lists? Orphaned files go to General.', confirmLabel: 'Run repair' }))) return;
    setRepairing(true);
    try {
      const data = await fetch('/api/gallery/repair', { method: 'POST' }).then(r => r.json());
      if (data.success) {
        await loadAlbums();
        showAlert({ title: 'Repair complete', message: `Added ${data.added} missing photo${data.added === 1 ? '' : 's'}.` });
      } else showAlert({ title: 'Repair failed', message: data.message || 'Repair failed.' });
    } catch {
      showAlert({ title: 'Repair failed', message: 'Network error during repair.' });
    } finally {
      setRepairing(false);
    }
  };

  const chooseMode = (mode: 'albums' | 'all' | 'downloads') => {
    if (mode !== 'downloads') saveSetting('gal_view', mode);
    if (mode === 'downloads') setSelectionMode(false);
    setBreadcrumb([]);
    setViewMode(mode);
    resetView();
  };

  const handleBulkDownloadZip = async () => {
    if (selectedPhotos.length === 0 || bulkBusy) return;
    const uniqueBySrc = new Map<string, Photo>();
    for (const p of selectedPhotos) {
      if (!uniqueBySrc.has(p.src)) uniqueBySrc.set(p.src, p);
    }
    const list = [...uniqueBySrc.values()];
    setBulkBusy({ kind: 'zip', done: 0, total: list.length });
    setBulkNotice('');

    const entries: Record<string, Uint8Array> = {};
    const usedNames = new Map<string, number>();
    let failed = 0;

    for (let i = 0; i < list.length; i++) {
      const photo = list[i];
      try {
        const res = await fetch(mediaPath(photo.src));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const bytes = new Uint8Array(await res.arrayBuffer());
        const rawBase = decodeURIComponent(photo.src.split('?')[0].split('/').pop() || `photo-${i + 1}.jpg`);
        const dot = rawBase.lastIndexOf('.');
        const stem = dot > 0 ? rawBase.slice(0, dot) : rawBase;
        const ext = dot > 0 ? rawBase.slice(dot) : '.jpg';
        const count = (usedNames.get(rawBase.toLowerCase()) ?? 0) + 1;
        usedNames.set(rawBase.toLowerCase(), count);
        const filename = count === 1 ? rawBase : `${stem}-${count}${ext}`;
        entries[filename] = bytes;
      } catch {
        failed++;
      }
      setBulkBusy({ kind: 'zip', done: i + 1, total: list.length });
    }

    const included = Object.keys(entries).length;
    if (included === 0) {
      setBulkBusy(null);
      await showAlert({ title: 'Download failed', message: 'Could not download the selected photos.' });
      return;
    }

    try {
      const zipped = zipSync(entries, { level: 0 });
      const blob = new Blob([zipped], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const albumSlug = (currentAlbum?.name || 'gallery').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'gallery';
      a.download = `${albumSlug}-selected-${included}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      if (failed > 0) {
        await showAlert({ title: 'Partial ZIP ready', message: `Downloaded ${included} photo${included === 1 ? '' : 's'}; ${failed} failed to fetch.` });
      } else {
        setBulkNotice(`Downloaded ${included} photo${included === 1 ? '' : 's'} as ZIP.`);
      }
    } catch {
      await showAlert({ title: 'ZIP error', message: 'Could not create the ZIP archive in your browser.' });
    } finally {
      setBulkBusy(null);
    }
  };

  const handleBulkMove = async () => {
    if (!isAdmin || selectedPhotos.length === 0 || !bulkMoveTarget || bulkBusy) return;
    const toMove = selectedPhotos.filter(p => p.albumId !== bulkMoveTarget);
    if (toMove.length === 0) {
      await showAlert({ title: 'Already in album', message: 'All selected photos are already in that album.' });
      return;
    }
    setBulkBusy({ kind: 'move', done: 0, total: toMove.length });
    setBulkNotice('');
    let moved = 0;
    let failed = 0;

    for (let i = 0; i < toMove.length; i++) {
      const photo = toMove[i];
      try {
        const res = await fetch('/api/edit', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'gallery-photo',
            albumId: photo.albumId,
            src: photo.src,
            caption: photo.caption,
            newAlbumId: bulkMoveTarget,
          }),
        });
        const data = await res.json().catch(() => null);
        if (res.ok && data?.success) moved++;
        else failed++;
      } catch {
        failed++;
      }
      setBulkBusy({ kind: 'move', done: i + 1, total: toMove.length });
    }

    await loadAlbums();
    setSelectedKeys(new Set());
    setBulkBusy(null);
    const destName = albumPathMap[bulkMoveTarget] || 'album';
    if (failed > 0) {
      await showAlert({ title: 'Move partially completed', message: `Moved ${moved} photo${moved === 1 ? '' : 's'} to ${destName}; ${failed} failed.` });
    } else {
      setBulkNotice(`Moved ${moved} photo${moved === 1 ? '' : 's'} to ${destName}.`);
    }
  };

  const handleBulkDelete = async () => {
    if (!isAdmin || selectedPhotos.length === 0 || bulkBusy) return;
    const uniqueSrcs = [...new Set(selectedPhotos.map(p => p.src))];
    const ok = await confirm({
      title: 'Delete Selected Photos',
      message: `Delete ${uniqueSrcs.length} selected photo${uniqueSrcs.length === 1 ? '' : 's'} permanently? This cannot be undone.`,
      confirmLabel: `Delete (${uniqueSrcs.length})`,
      danger: true,
    });
    if (!ok) return;

    setBulkBusy({ kind: 'delete', done: 0, total: uniqueSrcs.length });
    setBulkNotice('');
    let deleted = 0;
    let failed = 0;

    for (let i = 0; i < uniqueSrcs.length; i++) {
      const src = uniqueSrcs[i];
      try {
        const res = await fetch('/api/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'gallery', id: src }),
        });
        const data = await res.json().catch(() => null);
        if (res.ok && data?.success) deleted++;
        else failed++;
      } catch {
        failed++;
      }
      setBulkBusy({ kind: 'delete', done: i + 1, total: uniqueSrcs.length });
    }

    await loadAlbums();
    setSelectedKeys(new Set());
    setBulkBusy(null);
    if (failed > 0) {
      await showAlert({ title: 'Delete partially completed', message: `Deleted ${deleted} photo${deleted === 1 ? '' : 's'}; ${failed} failed.` });
    } else {
      setBulkNotice(`Deleted ${deleted} photo${deleted === 1 ? '' : 's'}.`);
    }
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
        const selected = selectionMode && selectedKeys.has(photoKey(img));
        return (
          <figure key={`${img.src}-${i}`} className={`gal-tile${selectionMode ? ' is-selecting' : ''}${selected ? ' is-selected' : ''}`}>
            <button
              type="button"
              className="gal-photo"
              aria-pressed={selectionMode ? selected : undefined}
              onClick={() => (selectionMode ? togglePhotoSelection(img) : setViewerIndex(i))}
              aria-label={selectionMode ? `${selected ? 'Deselect' : 'Select'} ${img.caption || `Photo ${i + 1}`}` : (img.caption || `Photo ${i + 1}`)}
            >
              <img
                src={mediaSrc(img.src, 400)}
                srcSet={mediaSrcSet(img.src, [400, 640])}
                sizes={TILE_SIZES}
                alt={img.caption}
                loading={i < 8 ? 'eager' : 'lazy'}
                decoding="async"
              />
              {selectionMode && (
                <span className={`gal-select-check${selected ? ' is-checked' : ''}`} aria-hidden="true">
                  {selected ? '✓' : ''}
                </span>
              )}
            </button>
            {isAdmin && !selectionMode && (
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

  const totalPhotos = useMemo(() => rootAlbums.reduce((n, a) => n + countPhotos(a), 0), [rootAlbums]);
  const allShownSelected = shownImages.length > 0 && selectedPhotos.length === shownImages.length;

  return (
    <div className={`gal-page${selectionMode ? ' has-bulk-bar' : ''}`}>
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
          <h1 style={{ marginBottom: 0 }}>{currentAlbum?.name ?? (viewMode === 'downloads' ? 'Album downloads' : 'Gallery')}</h1>
          <p className="gal-sub">
            {(() => {
              const n = currentAlbum ? countPhotos(currentAlbum) : totalPhotos;
              const photos = `${n} photo${n === 1 ? '' : 's'}`;
              return currentAlbum ? photos : `${photos} in ${rootAlbums.length} album${rootAlbums.length === 1 ? '' : 's'}`;
            })()}
          </p>
        </div>

        <div className="gal-toolbar">
          {!currentAlbum && (
            <div className="gal-segmented" role="tablist" aria-label="Show">
              {(['albums', 'all'] as const).map(mode => (
                <button key={mode} role="tab" aria-selected={viewMode === mode} onClick={() => chooseMode(mode)}>
                  {mode === 'all' ? 'All photos' : 'Albums'}
                </button>
              ))}
            </div>
          )}

          {viewMode !== 'downloads' && (
            <button
              type="button"
              className={`gal-tool-btn${selectionMode ? ' is-active' : ''}`}
              aria-pressed={selectionMode}
              disabled={!selectionMode && (currentAlbum ? shownImages.length === 0 : totalPhotos === 0)}
              onClick={toggleSelectionMode}
              title={selectionMode ? 'Done selecting photos' : 'Select photos'}
              aria-label={selectionMode ? 'Done selecting photos' : 'Select photos'}
            >
              <span aria-hidden>{selectionMode ? '✕' : '☑️'}</span>
              <span className="gal-tool-label">{selectionMode ? 'Done' : 'Select photos'}</span>
            </button>
          )}

          <GalleryPopover label="View" icon="⚙" kind="dialog">
            {() => (
              <div className="gal-options">
                <div className="gal-option">
                  <span className="gal-option-name">Columns</span>
                  <div className="gal-chips" role="radiogroup" aria-label="Columns">
                    {COLUMN_CHOICES.map(n => (
                      <button key={n} role="radio" aria-checked={columns === n} onClick={() => { setColumns(n); saveSetting('gal_cols', String(n)); }}>{n === 0 ? 'Auto' : n}</button>
                    ))}
                  </div>
                </div>
                <label className="gal-option is-row">
                  <span className="gal-option-name">Captions</span>
                  <input type="checkbox" role="switch" className="switch" checked={showCaptions} onChange={e => { setShowCaptions(e.target.checked); saveSetting('gal_caps', String(e.target.checked)); }} />
                </label>
                <div className="gal-option-group">Slideshow</div>
                <div className="gal-option">
                  <span className="gal-option-name">Each photo for</span>
                  <div className="gal-chips" role="radiogroup" aria-label="Slideshow speed">
                    {SPEEDS.map(ms => (
                      <button key={ms} role="radio" aria-checked={cycleTime === ms} onClick={() => { setCycleTime(ms); saveSetting('gal_cycle', String(ms)); }}>{ms / 1000}s</button>
                    ))}
                  </div>
                </div>
                <label className="gal-option is-row">
                  <span className="gal-option-name">Shuffle</span>
                  <input type="checkbox" role="switch" className="switch" checked={shuffleMode} onChange={e => { setShuffleMode(e.target.checked); saveSetting('gal_shuffle', String(e.target.checked)); }} />
                </label>
              </div>
            )}
          </GalleryPopover>

          {isAdmin && (
            <GalleryPopover label="Manage" icon="＋" kind="menu">
              {close => {
                const item = (icon: string, text: string, onClick: () => void, disabled = false) => (
                  <button role="menuitem" className="gal-menu-item" disabled={disabled} onClick={() => { close(); onClick(); }}>
                    <span aria-hidden>{icon}</span>{text}
                  </button>
                );
                return (
                  <>
                    {item('📷', currentAlbum ? `Add photos to “${currentAlbum.name}”` : 'Add photos', () => { setShowUpload(true); setAddingAlbum(false); })}
                    {item('📁', currentAlbum ? `New album inside “${currentAlbum.name}”` : 'New album', () => { setAddingAlbum(true); setShowUpload(false); })}
                    <div className="gal-menu-sep" role="separator" />
                    {item('⬇', currentAlbum ? 'Download this album (ZIP)' : 'Download everything (ZIP)', handleDownloadAlbum)}
                    {item('🗂', 'Saved downloads', () => chooseMode('downloads'))}
                    {item('🛠', repairing ? 'Repairing index…' : 'Repair index', handleRepair, repairing)}
                  </>
                );
              }}
            </GalleryPopover>
          )}

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
          <button className="btn btn-secondary" onClick={() => { setAddingAlbum(false); setNewAlbumName(''); }} disabled={albumCreating}>Cancel</button>
        </div>
      )}

      {/* Upload photos (admin) */}
      {showUpload && isAdmin && (
        <GalleryUploadPanel
          album={currentAlbum ? { id: currentAlbum.id, name: currentAlbum.name } : null}
          albums={flattenedAlbums}
          onUploaded={loadAlbums}
          onClose={() => setShowUpload(false)}
        />
      )}

      {/* Downloads */}
      {viewMode === 'downloads' && !currentAlbum && (
        availableDownloads.length === 0 ? (
          <div className="glass-panel" style={{ textAlign: 'center', padding: '4rem 1.5rem' }}>
            <h3>No downloads available</h3>
            <p>Generated album ZIP files will appear here.</p>
          </div>
        ) : (
          <div className="gal-downloads-grid">
            {availableDownloads.map((dl, i) => (
              <div key={i} className="glass-panel gal-download-card">
                <div>
                  <h3 style={{ margin: '0 0 0.2rem', fontSize: '1.05rem', wordBreak: 'break-all' }}>{dl.name}</h3>
                  <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--muted)' }}>{(dl.sizeBytes / 1024 / 1024).toFixed(2)} MB • {new Date(dl.createdAt).toLocaleDateString()}</p>
                </div>
                <div className="gal-download-actions">
                  <a href={dl.url} download className="btn btn-primary">⬇ Download</a>
                  <button type="button" onClick={() => handleDeleteDownload(dl.filename)} className="btn btn-secondary" style={{ color: 'var(--danger)' }}>Delete</button>
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
          <p>{isAdmin ? 'Use ＋ Manage to add an album or photos.' : 'No photos or albums available.'}</p>
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
            <p style={{ fontSize: '0.85rem', margin: '0.25rem 0 0', color: 'var(--accent-light)' }}>The download is now ready under <strong>＋ Manage → Saved downloads</strong>.</p>
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
            <div
              className="gal-frame"
              role="dialog"
              aria-modal="true"
              aria-label="Slideshow"
              onClick={() => void exitFrameMode()}
            >
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
              <div className="gal-frame-bar" onClick={(e) => e.stopPropagation()}>
                <span className="gal-frame-counter">{frameIndex + 1} / {activeFrameImages.length}</span>
                <div className="gal-frame-actions">
                  {activeFrameImages.length > 1 && (
                    <button type="button" className="lightbox-btn" onClick={() => frameStep(-1)} aria-label="Previous slide">‹ Prev</button>
                  )}
                  {activeFrameImages.length > 1 && (
                    <button type="button" className="lightbox-btn" onClick={() => setFramePaused((p) => !p)} aria-pressed={framePaused} aria-label={framePaused ? 'Play slideshow' : 'Pause slideshow'}>
                      {framePaused ? '▶ Play' : '⏸ Pause'}
                    </button>
                  )}
                  {activeFrameImages.length > 1 && (
                    <button type="button" className="lightbox-btn" onClick={() => frameStep(1)} aria-label="Next slide">Next ›</button>
                  )}
                  <button type="button" className="lightbox-btn" onClick={() => void exitFrameMode()} aria-label="Exit slideshow">✕ Exit</button>
                </div>
              </div>
              {(img?.caption || relativeAlbumPath) && showCaptions && (
                <div style={{ position: 'absolute', bottom: '2rem', background: 'rgba(0,0,0,0.65)', padding: '0.75rem 2.5rem', borderRadius: '30px', color: 'white', display: 'flex', flexDirection: 'column', alignItems: 'center', pointerEvents: 'none', maxWidth: 'calc(100vw - 2rem)', textAlign: 'center' }}>
                  {relativeAlbumPath && <div style={{ fontSize: '0.85rem', opacity: 0.85, fontStyle: 'italic', marginBottom: img?.caption ? '0.2rem' : 0 }}>{relativeAlbumPath}</div>}
                  {img?.caption && <div style={{ fontSize: '1.25rem' }}>{img.caption}</div>}
                </div>
              )}
            </div>
          );
        })(),
        document.body
      )}
      {selectionMode && mounted && createPortal(
        <div className="glass-panel animate-fade-in gal-bulk-bar" role="toolbar" aria-label="Selected photo actions">
          <div className="gal-bulk-summary">
            <strong>{selectedPhotos.length} selected</strong>
            <div className="gal-bulk-sel-btns">
              <button
                type="button"
                className="btn btn-secondary gal-bulk-btn"
                disabled={shownImages.length === 0 || allShownSelected || !!bulkBusy}
                onClick={() => { setBulkNotice(''); setSelectedKeys(new Set(shownImages.map(photoKey))); }}
              >
                Select all ({shownImages.length})
              </button>
              <button
                type="button"
                className="btn btn-secondary gal-bulk-btn"
                disabled={selectedPhotos.length === 0 || !!bulkBusy}
                onClick={() => { setBulkNotice(''); setSelectedKeys(new Set()); }}
              >
                Clear
              </button>
            </div>
            {bulkNotice && <span className="gal-bulk-notice" role="status">{bulkNotice}</span>}
          </div>

          <div className="gal-bulk-actions">
            <button
              type="button"
              className="btn btn-primary gal-bulk-btn"
              disabled={selectedPhotos.length === 0 || !!bulkBusy}
              onClick={() => void handleBulkDownloadZip()}
            >
              {bulkBusy?.kind === 'zip'
                ? `Zipping ${bulkBusy.done}/${bulkBusy.total}…`
                : '📦 Download ZIP'}
            </button>

            {isAdmin && (
              <>
                <div className="gal-bulk-move">
                  <select
                    className="gal-select gal-bulk-select"
                    aria-label="Destination album"
                    value={bulkMoveTarget}
                    disabled={!!bulkBusy || flattenedAlbums.length === 0}
                    onChange={e => setBulkMoveTarget(e.target.value)}
                  >
                    {flattenedAlbums.map(a => (
                      <option key={a.id} value={a.id}>{a.path}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn btn-secondary gal-bulk-btn"
                    disabled={selectedPhotos.length === 0 || !bulkMoveTarget || !!bulkBusy}
                    onClick={() => void handleBulkMove()}
                  >
                    {bulkBusy?.kind === 'move'
                      ? `Moving ${bulkBusy.done}/${bulkBusy.total}…`
                      : '📁 Move to album'}
                  </button>
                </div>

                <button
                  type="button"
                  className="btn gal-bulk-btn gal-bulk-danger"
                  disabled={selectedPhotos.length === 0 || !!bulkBusy}
                  onClick={() => void handleBulkDelete()}
                >
                  {bulkBusy?.kind === 'delete'
                    ? `Deleting ${bulkBusy.done}/${bulkBusy.total}…`
                    : `🗑️ Delete (${selectedPhotos.length})`}
                </button>
              </>
            )}

            <button
              type="button"
              className="btn btn-secondary gal-bulk-btn"
              disabled={!!bulkBusy}
              onClick={toggleSelectionMode}
            >
              Done
            </button>
          </div>
        </div>,
        document.body
      )}
      {popup}
    </div>
  );
}

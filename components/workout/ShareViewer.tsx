'use client';

import { useCallback, useEffect, useRef, useState, type TouchEvent } from 'react';
import { createPortal } from 'react-dom';
import { canCopyImages, canShareImages, copyImage, shareImages } from '@/lib/workout/share-card';

type ShareViewerProps = {
  title: string;
  /** Draws the images; called once when the viewer opens. */
  render: () => Promise<Blob[]>;
  /** File name without extension; several images get -1, -2… */
  fileBase: string;
  /** Title passed to the phone's share sheet. */
  shareTitle: string;
  onClose: () => void;
};

type Image = { blob: Blob; url: string };

/**
 * Full-screen viewer for share images (a workout card, or the recap's story
 * slides): one image at a time, swipe / tap the sides / arrow keys to move,
 * and share or save the one on screen.
 */
export default function ShareViewer({ title, render, fileBase, shareTitle, onClose }: ShareViewerProps) {
  const [mounted, setMounted] = useState(false);
  const [images, setImages] = useState<Image[]>([]);
  const [error, setError] = useState('');
  const [index, setIndex] = useState(0);
  const [drag, setDrag] = useState(0);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [can, setCan] = useState({ share: false, copy: false });
  const touch = useRef<{ x: number; y: number; horizontal: boolean | null } | null>(null);
  const thumbs = useRef<HTMLDivElement>(null);
  const renderRef = useRef(render);

  useEffect(() => {
    setMounted(true);
    setCan({ share: canShareImages(), copy: canCopyImages() });
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let made: Image[] = [];
    renderRef.current()
      .then((blobs) => {
        made = blobs.map((blob) => ({ blob, url: URL.createObjectURL(blob) }));
        if (cancelled) made.forEach((m) => URL.revokeObjectURL(m.url));
        else setImages(made);
      })
      .catch(() => { if (!cancelled) setError('Could not draw the image on this device.'); });
    return () => {
      cancelled = true;
      made.forEach((m) => URL.revokeObjectURL(m.url));
    };
  }, []);

  const count = images.length;
  const go = useCallback((next: number) => {
    setIndex(Math.max(0, Math.min(count - 1, next)));
    setStatus('');
  }, [count]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('.site-popup-backdrop')) return;
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') go(index + 1);
      else if (e.key === 'ArrowLeft') go(index - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, index, onClose]);

  // Keep the selected thumbnail in view.
  useEffect(() => {
    thumbs.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }, [index]);

  const onTouchStart = (e: TouchEvent) => {
    touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, horizontal: null };
  };
  const onTouchMove = (e: TouchEvent) => {
    const t = touch.current;
    if (!t) return;
    const dx = e.touches[0].clientX - t.x;
    const dy = e.touches[0].clientY - t.y;
    if (t.horizontal === null && Math.abs(dx) + Math.abs(dy) > 8) t.horizontal = Math.abs(dx) > Math.abs(dy);
    if (t.horizontal) {
      // Resist past the first and last image.
      const edge = (index === 0 && dx > 0) || (index === count - 1 && dx < 0);
      setDrag(edge ? dx / 3 : dx);
    }
  };
  const onTouchEnd = () => {
    const t = touch.current;
    touch.current = null;
    if (t?.horizontal && Math.abs(drag) > 50) go(index + (drag < 0 ? 1 : -1));
    setDrag(0);
  };

  const share = async (blobs: Blob[], several: boolean) => {
    setBusy(true);
    setStatus('');
    try {
      const name = several ? fileBase : count > 1 ? `${fileBase}-${index + 1}` : fileBase;
      const result = await shareImages(blobs, name, shareTitle);
      if (result === 'downloaded') setStatus(blobs.length > 1 ? `Saved ${blobs.length} images to your downloads.` : 'Saved to your downloads.');
      if (result === 'shared') setStatus('Shared.');
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    try {
      await copyImage(images[index].blob);
      setStatus('Copied — paste it into a chat.');
    } catch {
      setStatus('Could not copy here — use Save instead.');
    }
  };

  if (!mounted) return null;
  const current = images[index];
  const shareLabel = can.share ? 'Share' : 'Save';

  return createPortal(
    <div className="share-viewer" role="dialog" aria-modal="true" aria-label={title}>
      <div className="share-viewer-top">
        <div style={{ minWidth: 0 }}>
          <div className="share-viewer-title">{title}</div>
          {count > 1 && <div className="share-viewer-count">{index + 1} of {count}</div>}
        </div>
        <button type="button" className="share-viewer-close" aria-label="Close" onClick={onClose}>✕</button>
      </div>

      <div className="share-viewer-stage" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd}>
        {error && <p className="share-viewer-note">{error}</p>}
        {!error && count === 0 && <p className="share-viewer-note">Drawing…</p>}
        {count > 0 && (
          <div className="share-viewer-track" style={{ transform: `translateX(calc(${-index * 100}% + ${drag}px))`, transition: drag ? 'none' : undefined }}>
            {images.map((image, i) => (
              <div key={image.url} className="share-viewer-slide" aria-hidden={i !== index}>
                <img src={image.url} alt={`${title}${count > 1 ? ` — ${i + 1} of ${count}` : ''}`} draggable={false} />
              </div>
            ))}
          </div>
        )}
        {count > 1 && (<>
          <button type="button" className="share-viewer-nav is-prev" aria-label="Previous image" disabled={index === 0} onClick={() => go(index - 1)}><span aria-hidden>‹</span></button>
          <button type="button" className="share-viewer-nav is-next" aria-label="Next image" disabled={index === count - 1} onClick={() => go(index + 1)}><span aria-hidden>›</span></button>
        </>)}
      </div>

      {count > 1 && (
        <div className="share-viewer-thumbs" ref={thumbs}>
          {images.map((image, i) => (
            <button key={image.url} type="button" data-index={i} className={i === index ? 'is-active' : ''} aria-label={`Show image ${i + 1}`} aria-pressed={i === index} onClick={() => go(i)}>
              <img src={image.url} alt="" draggable={false} />
            </button>
          ))}
        </div>
      )}

      <div className="share-viewer-actions">
        <button type="button" className="workout-button is-primary" disabled={!current || busy} onClick={() => share([current.blob], false)}>
          {can.share ? '📤' : '⬇️'} {shareLabel}{count > 1 ? ' this one' : ''}
        </button>
        {count > 1 ? (
          <button type="button" className="workout-button" disabled={busy} onClick={() => share(images.map((i) => i.blob), true)}>
            {shareLabel} all {count}
          </button>
        ) : can.copy && !can.share && current ? (
          <button type="button" className="workout-button" onClick={copy}>📋 Copy</button>
        ) : null}
      </div>
      <p className="share-viewer-status" aria-live="polite">{status}</p>
    </div>,
    document.body,
  );
}

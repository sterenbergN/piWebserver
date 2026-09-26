'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { mediaPath, mediaSrc } from '@/lib/media-url';

export type LightboxImage = { src: string; caption?: string; label?: string };

type LightboxProps = {
  images: LightboxImage[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
  showCaptions?: boolean;
};

/** Screen-sized copy: enough pixels for this display, never the multi-MB original. */
function viewerWidth() {
  const needed = Math.max(window.innerWidth, window.innerHeight) * Math.min(window.devicePixelRatio || 1, 2);
  return needed <= 960 ? 960 : needed <= 1280 ? 1280 : 1920;
}

/**
 * Full-screen photo viewer: arrows / swipe to move, Esc or tap the backdrop
 * to close. Shows the already-loaded thumbnail instantly, then swaps in a
 * screen-sized copy, and preloads the neighbours so paging feels instant.
 */
export default function Lightbox({ images, index, onIndex, onClose, showCaptions = true }: LightboxProps) {
  const [loaded, setLoaded] = useState<string | null>(null);
  const touchX = useRef<number | null>(null);
  const [width] = useState(viewerWidth);
  const img = images[index];
  const count = images.length;
  const go = (step: number) => onIndex((index + step + count) % count);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') onIndex((index + 1) % count);
      else if (e.key === 'ArrowLeft') onIndex((index - 1 + count) % count);
    };
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = overflow; };
  }, [index, count, onIndex, onClose]);

  // Warm the cache for the photos either side.
  useEffect(() => {
    for (const step of [1, -1]) {
      const next = images[(index + step + count) % count];
      if (next) new Image().src = mediaSrc(next.src, width);
    }
  }, [index, images, count, width]);

  if (!img) return null;
  const full = mediaSrc(img.src, width);

  return createPortal(
    <div
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={img.caption || 'Photo'}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onTouchStart={(e) => { touchX.current = e.touches[0].clientX; }}
      onTouchEnd={(e) => {
        if (touchX.current === null) return;
        const dx = e.changedTouches[0].clientX - touchX.current;
        touchX.current = null;
        if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
      }}
    >
      <div className="lightbox-stage" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        {/* Thumbnail first (already cached from the grid), sharp copy fades in over it. */}
        <img key={`t-${img.src}`} className={`lightbox-img is-placeholder${loaded === full ? ' is-hidden' : ''}`} src={mediaSrc(img.src, 400)} alt="" aria-hidden />
        <img
          key={img.src}
          className={`lightbox-img${loaded === full ? ' is-loaded' : ''}`}
          src={full}
          alt={img.caption || ''}
          decoding="async"
          onLoad={() => setLoaded(full)}
        />
      </div>

      <div className="lightbox-bar lightbox-top">
        <span>{index + 1} / {count}</span>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <a className="lightbox-btn" href={mediaPath(img.src)} target="_blank" rel="noreferrer" title="Open the full-resolution original">Original</a>
          <button className="lightbox-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
      </div>

      {count > 1 && (<>
        <button className="lightbox-nav is-prev" onClick={() => go(-1)} aria-label="Previous photo">‹</button>
        <button className="lightbox-nav is-next" onClick={() => go(1)} aria-label="Next photo">›</button>
      </>)}

      {showCaptions && (img.caption || img.label) && (
        <div className="lightbox-caption">
          {img.label && <div className="lightbox-label">{img.label}</div>}
          {img.caption && <div>{img.caption}</div>}
        </div>
      )}
    </div>,
    document.body,
  );
}

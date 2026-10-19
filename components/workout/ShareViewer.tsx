'use client';

import { useCallback, useEffect, useRef, useState, type TouchEvent } from 'react';
import { createPortal } from 'react-dom';
import { canCopyImages, canShareImages, copyImage, shareImages } from '@/lib/workout/share-card';
import { readPref, savePref } from '@/lib/workout/device-prefs';

type ShareViewerProps = {
  title: string;
  /** Draws the images: when the viewer opens, and again for another option or photo. */
  render: (option?: string, photo?: ImageBitmap | null) => Promise<Blob[]>;
  /** Offer "Add photo": the image is drawn under the card (it never leaves the phone). */
  allowPhoto?: boolean;
  /** Layouts to choose between (e.g. post / story); passed to render. */
  options?: { key: string; label: string }[];
  /** Device pref that remembers the chosen option. */
  optionPref?: string;
  /** Play through the images like a story, this many ms each. */
  autoplay?: number;
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
export default function ShareViewer({ title, render, options, optionPref, autoplay, allowPhoto, fileBase, shareTitle, onClose }: ShareViewerProps) {
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
  useEffect(() => { renderRef.current = render; });
  const [option, setOption] = useState(() => {
    const saved = optionPref ? readPref(optionPref) : null;
    return options?.find((o) => o.key === saved)?.key ?? options?.[0]?.key;
  });
  const [photo, setPhoto] = useState<ImageBitmap | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const [playing, setPlaying] = useState(false);
  const [held, setHeld] = useState(false);

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
    setError('');
    setImages([]);
    renderRef.current(option, photo)
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
  }, [option, photo]);

  const pickPhoto = async (file: File | undefined) => {
    if (!file) return;
    try {
      const bitmap = await createImageBitmap(file);
      setPhoto(bitmap);
      setStatus('');
    } catch {
      setStatus('Could not open that photo.');
    }
  };
  useEffect(() => () => photo?.close(), [photo]);

  const chooseOption = (key: string) => {
    setOption(key);
    if (optionPref) savePref(optionPref, key);
    setStatus('');
  };

  const count = images.length;
  const go = useCallback((next: number) => {
    setIndex(Math.max(0, Math.min(count - 1, next)));
    setStatus('');
  }, [count]);

  // Story mode starts once the images are drawn (not with reduced motion).
  useEffect(() => {
    if (autoplay && count > 1 && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) setPlaying(true);
  }, [autoplay, count]);
  const paused = !playing || held || busy;
  useEffect(() => {
    if (!autoplay || paused) return;
    if (index >= count - 1) { setPlaying(false); return; }
    const timer = setTimeout(() => setIndex((i) => i + 1), autoplay);
    return () => clearTimeout(timer);
  }, [autoplay, paused, index, count]);

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
    setHeld(true);
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
    setHeld(false);
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
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="share-viewer-title">{title}</div>
          {count > 1 && <div className="share-viewer-count">{index + 1} of {count}{autoplay ? (playing ? ' · hold to pause' : '') : ''}</div>}
        </div>
        {autoplay && count > 1 && (
          <button type="button" className="share-viewer-close" aria-label={playing ? 'Pause' : 'Play'} onClick={() => { if (!playing && index >= count - 1) setIndex(0); setPlaying(!playing); }}>
            {playing ? '❚❚' : '▶'}
          </button>
        )}
        <button type="button" className="share-viewer-close" aria-label="Close" onClick={onClose}>✕</button>
      </div>
      {autoplay && count > 1 && (
        <div className="share-viewer-progress" aria-hidden>
          {images.map((image, i) => (
            <span key={image.url}>
              <i
                key={`${i}-${index}`}
                className={i < index ? 'is-done' : i === index && playing ? 'is-playing' : ''}
                style={{ animationDuration: `${autoplay}ms`, animationPlayState: paused ? 'paused' : 'running' }}
              />
            </span>
          ))}
        </div>
      )}
      {((options && options.length > 1) || allowPhoto) && (
        <div className="share-viewer-options">
          {options && options.length > 1 && (
            <div role="radiogroup" aria-label="Layout" style={{ display: 'contents' }}>
              {options.map((o) => (
                <button key={o.key} type="button" role="radio" aria-checked={option === o.key} onClick={() => chooseOption(o.key)}>{o.label}</button>
              ))}
            </div>
          )}
          {allowPhoto && (<>
            <button type="button" aria-pressed={!!photo} onClick={() => (photo ? setPhoto(null) : photoInput.current?.click())}>
              {photo ? '✕ Photo' : '📷 Photo'}
            </button>
            <input ref={photoInput} type="file" accept="image/*" hidden onChange={(e) => { pickPhoto(e.target.files?.[0]); e.target.value = ''; }} />
          </>)}
        </div>
      )}

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

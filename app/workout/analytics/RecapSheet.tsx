'use client';

import { useEffect, useState } from 'react';
import Sheet from '@/components/workout/Sheet';
import { renderRecap, shareImages } from '@/lib/workout/recap-cards';
import type { RecapSlide } from '@/lib/workout/recap';

type RecapSheetProps = {
  slides: RecapSlide[];
  periodLabel: string;
  onClose: () => void;
};

/** The Wrapped-style recap: swipe through the story images, share one or all. */
export default function RecapSheet({ slides, periodLabel, onClose }: RecapSheetProps) {
  const [images, setImages] = useState<{ blob: Blob; url: string }[]>([]);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    let cancelled = false;
    let made: { blob: Blob; url: string }[] = [];
    renderRecap(slides)
      .then((blobs) => {
        made = blobs.map((blob) => ({ blob, url: URL.createObjectURL(blob) }));
        if (cancelled) made.forEach((m) => URL.revokeObjectURL(m.url));
        else setImages(made);
      })
      .catch(() => { if (!cancelled) setError('Could not draw the recap on this device.'); });
    return () => {
      cancelled = true;
      made.forEach((m) => URL.revokeObjectURL(m.url));
    };
  }, [slides]);

  const baseName = `workout-recap-${new Date().toISOString().slice(0, 10)}`;
  const share = async (blobs: Blob[]) => {
    setStatus('');
    const result = await shareImages(blobs, baseName, `My ${periodLabel.toLowerCase()} workout recap`);
    if (result === 'downloaded') setStatus(blobs.length > 1 ? 'Saved the images to your downloads.' : 'Saved to your downloads.');
  };

  return (
    <Sheet
      title="Your recap"
      subtitle={`${slides.length} story images for the last ${periodLabel.toLowerCase()} — swipe, then share.`}
      onClose={onClose}
      footer={(
        <button type="button" className="workout-button is-primary is-block" disabled={images.length === 0} onClick={() => share(images.map((i) => i.blob))}>
          📤 Share all {images.length || ''}
        </button>
      )}
    >
      {error && <p className="workout-error">{error}</p>}
      {!error && images.length === 0 && <p className="workout-hint" style={{ textAlign: 'center', padding: '2rem 0' }}>Drawing your recap…</p>}
      {images.length > 0 && (
        <div className="an-recap-strip">
          {images.map((image, i) => (
            <figure key={image.url} className="an-recap-slide">
              <img src={image.url} alt={`Recap ${i + 1} of ${images.length}`} />
              <button type="button" className="workout-button is-small" onClick={() => share([image.blob])}>Share this one</button>
            </figure>
          ))}
        </div>
      )}
      {status && <p className="workout-hint" style={{ textAlign: 'center' }}>{status}</p>}
    </Sheet>
  );
}

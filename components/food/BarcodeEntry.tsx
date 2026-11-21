'use client';

import { useEffect, useRef, useState } from 'react';
import { canScanBarcodes, foodApi } from '@/lib/food/client';
import type { Food } from '@/lib/food/types';

type BarcodeDetectorLike = { detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]> };

/**
 * Look a packaged food up by its barcode. Typing the number is the main way
 * (iPhone Safari can't read barcodes from the camera); where the browser can,
 * a camera button scans it instead.
 */
export default function BarcodeEntry({ onFound, onNotFound, onBack }: {
  onFound: (food: Food) => void;
  /** Nothing anywhere has it: offer to make the food from its label, with the barcode filled in. */
  onNotFound: (barcode: string) => void;
  onBack: () => void;
}) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [missing, setMissing] = useState('');
  const [notices, setNotices] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);
  const [canScan, setCanScan] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => { setCanScan(canScanBarcodes()); }, []);
  useEffect(() => () => stopCamera(), []);

  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setScanning(false);
  }

  async function lookup(value: string) {
    const digits = value.replace(/\D/g, '');
    if (digits.length < 6) { setError('Type the numbers under the barcode.'); return; }
    setBusy(true);
    setError('');
    setMissing('');
    setNotices([]);
    try {
      const res = await foodApi<{ food: Food | null; barcode: string; notices: string[] }>(`/api/food/barcode?code=${digits}`);
      setNotices(res.notices || []);
      if (res.food) onFound(res.food);
      else setMissing(res.barcode);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t look that up.');
    } finally {
      setBusy(false);
    }
  }

  async function startCamera() {
    setError('');
    try {
      const Detector = (window as unknown as { BarcodeDetector: new (o: { formats: string[] }) => BarcodeDetectorLike }).BarcodeDetector;
      const detector = new Detector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      streamRef.current = stream;
      setScanning(true);
      await new Promise((r) => requestAnimationFrame(r));
      const video = videoRef.current;
      if (!video) { stopCamera(); return; }
      video.srcObject = stream;
      await video.play();
      const tick = async () => {
        if (!streamRef.current) return;
        try {
          const found = await detector.detect(video);
          if (found[0]?.rawValue) {
            stopCamera();
            setCode(found[0].rawValue);
            void lookup(found[0].rawValue);
            return;
          }
        } catch { /* a frame that couldn't be read; try the next */ }
        setTimeout(tick, 250);
      };
      void tick();
    } catch {
      stopCamera();
      setError('The camera isn’t available here. Type the number instead.');
    }
  }

  return (
    <div>
      <button type="button" className="workout-text-btn food-back" onClick={() => { stopCamera(); onBack(); }}>‹ Back</button>
      <form onSubmit={(e) => { e.preventDefault(); void lookup(code); }}>
        <label className="workout-field" style={{ display: 'block' }}>
          <span className="workout-label">Barcode number</span>
          <input
            className="workout-input" inputMode="numeric" pattern="[0-9 -]*" autoComplete="off" placeholder="e.g. 0 16000 27528 7"
            value={code} maxLength={20} onChange={(e) => setCode(e.target.value)} autoFocus
          />
        </label>
        <button type="submit" className="workout-btn-primary" style={{ marginTop: 0 }} disabled={busy}>{busy ? 'Looking…' : 'Look up'}</button>
      </form>
      {canScan && !scanning && <button type="button" className="food-more" onClick={() => void startCamera()}>📷 Scan with the camera</button>}
      {scanning && (
        <div style={{ marginTop: '0.75rem' }}>
          <video ref={videoRef} className="food-video" muted playsInline />
          <button type="button" className="food-more" style={{ marginTop: 0 }} onClick={stopCamera}>Stop camera</button>
        </div>
      )}
      {notices.map((n) => <p key={n} className="food-notice" style={{ marginTop: '0.75rem' }}>{n}</p>)}
      {error && <p className="workout-error">{error}</p>}
      {missing && (
        <div className="food-notice" style={{ marginTop: '0.75rem' }}>
          No food has barcode {missing} yet.{' '}
          <button type="button" className="workout-text-btn" onClick={() => onNotFound(missing)}>Add it from the label</button>
        </div>
      )}
    </div>
  );
}

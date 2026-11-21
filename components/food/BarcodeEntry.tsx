'use client';

import { useEffect, useRef, useState } from 'react';
import { canScanBarcodes, foodApi } from '@/lib/food/client';
import type { Food } from '@/lib/food/types';
import type { Camera } from '@/lib/food/scanner';
import './scanner.css';

/**
 * Look a packaged food up by its barcode: type the number, or scan it with the
 * camera. iPhone Safari has no BarcodeDetector, so lib/food/scanner.ts brings
 * a WebAssembly reader there, loaded only when Scan is tapped.
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
  const [torch, setTorch] = useState<{ available: boolean; on: boolean }>({ available: false, on: false });
  const [flash, setFlash] = useState(false);
  const [camera, setCamera] = useState<Camera | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraRef = useRef<Camera | null>(null);

  useEffect(() => { setCanScan(canScanBarcodes()); }, []);
  useEffect(() => () => { cameraRef.current?.stop(); }, []);

  function stopCamera() {
    cameraRef.current?.stop();
    cameraRef.current = null;
    setCamera(null);
    setScanning(false);
    setTorch({ available: false, on: false });
  }

  // A camera left running behind a hidden page drains the battery and iOS keeps the green dot on.
  useEffect(() => {
    if (!camera) return;
    const onHide = () => { if (document.hidden) stopCamera(); };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, [camera]);

  // Once the camera is open and the video is on screen: play it and read frames until a code repeats.
  useEffect(() => {
    const video = videoRef.current;
    if (!camera || !video) return;
    const abort = new AbortController();
    video.srcObject = camera.stream;
    (async () => {
      try {
        await video.play();
        const { startScan } = await import('@/lib/food/scanner');
        await startScan(video, (gtin) => {
          navigator.vibrate?.(60);
          setFlash(true);
          stopCamera();
          setCode(gtin);
          void lookup(gtin);
        }, { signal: abort.signal });
      } catch {
        if (abort.signal.aborted) return;
        stopCamera();
        setError('Couldn’t start the scanner. Type the number instead.');
      }
    })();
    return () => { abort.abort(); video.srcObject = null; };
    // lookup only uses state setters and props, so it's safe to leave out.
  }, [camera]);

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
    setFlash(false);
    try {
      // The camera is requested right here in the tap, which iOS needs; the decoder loads afterwards.
      const { openCamera } = await import('@/lib/food/scanner');
      const cam = await openCamera();
      cameraRef.current = cam;
      setTorch({ available: cam.hasTorch, on: false });
      setCamera(cam);
      setScanning(true);
    } catch (e) {
      const reason = (e as { reason?: string }).reason;
      setError(reason === 'denied'
        ? 'Camera access is off for this site. Allow it in Settings → Safari → Camera, or type the number.'
        : 'No camera found here. Type the number instead.');
    }
  }

  async function toggleTorch() {
    if (!camera) return;
    const on = await camera.setTorch(!torch.on);
    setTorch((t) => ({ ...t, on }));
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
        <div className="food-scan">
          <div className={`food-scan-view${flash ? ' food-scan-hit' : ''}`}>
            <video ref={videoRef} className="food-scan-video" muted playsInline autoPlay />
            <div className="food-scan-frame" aria-hidden="true" />
          </div>
          <p className="food-scan-hint">Hold the barcode inside the box</p>
          <div className="food-scan-actions">
            {torch.available && <button type="button" className="food-more" onClick={() => void toggleTorch()}>{torch.on ? 'Light off' : 'Light on'}</button>}
            <button type="button" className="food-more" onClick={stopCamera}>Stop camera</button>
          </div>
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

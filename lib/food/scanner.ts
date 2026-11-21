// Camera barcode scanning for the food log, client-only. Chrome has a native BarcodeDetector;
// iPhone Safari doesn't, so there a ZXing WebAssembly build (the `barcode-detector` package) stands
// in. It's loaded only when someone taps Scan, and its .wasm is served from our own public/ folder.
import { toGtin13 } from '@/lib/food/barcode';

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'];
/** Copied from node_modules/zxing-wasm; scanner.test.ts fails if an upgrade leaves the copy behind. */
export const WASM_URL = '/vendor/zxing/zxing_reader.wasm';
const FRAMES_PER_SECOND = 5;
const MAX_SIDE = 1280;

type Detector = { detect: (source: ImageData) => Promise<{ rawValue: string }[]> };
type DetectorCtor = new (o: { formats: string[] }) => Detector;

let detectorPromise: Promise<Detector> | null = null;

async function loadDetector(): Promise<Detector> {
  const Native = (globalThis as unknown as { BarcodeDetector?: DetectorCtor & { getSupportedFormats?: () => Promise<string[]> } }).BarcodeDetector;
  if (Native) {
    try {
      const supported = (await Native.getSupportedFormats?.()) ?? FORMATS;
      const formats = FORMATS.filter((f) => supported.includes(f));
      // Some desktop builds define the class but can't read anything.
      if (formats.length) return new Native({ formats });
    } catch { /* fall through to the WebAssembly reader */ }
  }
  // The ponyfill entry doesn't touch window.BarcodeDetector.
  const mod = await import('barcode-detector/ponyfill');
  mod.prepareZXingModule({
    overrides: { locateFile: (name: string, prefix: string) => (name.endsWith('.wasm') ? WASM_URL : prefix + name) },
    fireImmediately: false,
  });
  return new mod.BarcodeDetector({ formats: FORMATS as never }) as unknown as Detector;
}

function getDetector(): Promise<Detector> {
  // A failed load shouldn't be remembered, so the next tap tries again.
  detectorPromise ??= loadDetector().catch((e) => { detectorPromise = null; throw e; });
  return detectorPromise;
}

/** The 13-digit GTIN for a read, or null when it isn't a valid product barcode (a misread, or some other code). */
export function normaliseRead(raw: string): string | null {
  return toGtin13(raw);
}

/** Wants the same code twice running before trusting it. */
export function makeConfirmer(): (code: string | null) => string | null {
  let last: string | null = null;
  return (code) => {
    if (!code) { last = null; return null; }
    if (code === last) return code;
    last = code;
    return null;
  };
}

/** Reads frames from a playing video until a barcode reads twice running (then calls onCode once) or the signal aborts. */
export async function startScan(video: HTMLVideoElement, onCode: (gtin13: string) => void, { signal }: { signal?: AbortSignal } = {}): Promise<void> {
  const detector = await getDetector();
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('No canvas');
  const confirm = makeConfirmer();
  const interval = 1000 / FRAMES_PER_SECOND;

  while (!signal?.aborted) {
    const started = performance.now();
    if (video.readyState >= 2 && video.videoWidth > 0) {
      const scale = Math.min(1, MAX_SIDE / Math.max(video.videoWidth, video.videoHeight));
      const w = Math.round(video.videoWidth * scale);
      const h = Math.round(video.videoHeight * scale);
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      try {
        ctx.drawImage(video, 0, 0, w, h);
        const found = await detector.detect(ctx.getImageData(0, 0, w, h));
        const code = confirm(found.map((f) => normaliseRead(f.rawValue)).find(Boolean) ?? null);
        if (code && !signal?.aborted) { onCode(code); return; }
      } catch { /* a frame that couldn't be read; try the next */ }
    }
    await new Promise((r) => setTimeout(r, Math.max(0, interval - (performance.now() - started))));
  }
}

export type CameraError = 'denied' | 'none' | 'failed';

export class CameraFailure extends Error {
  constructor(public reason: CameraError) { super(reason); }
}

export type Camera = {
  stream: MediaStream;
  /** Whether the phone has a torch to switch on. */
  hasTorch: boolean;
  setTorch: (on: boolean) => Promise<boolean>;
  stop: () => void;
};

/** Opens the back camera. Call it straight from a tap so iOS counts it as the user's doing. */
export async function openCamera(): Promise<Camera> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
  } catch (e) {
    const name = e instanceof DOMException ? e.name : '';
    if (name === 'NotAllowedError' || name === 'SecurityError') throw new CameraFailure('denied');
    if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') throw new CameraFailure('none');
    throw new CameraFailure('failed');
  }
  const track = stream.getVideoTracks()[0];
  // Optional extras: not every browser lets a page ask for these.
  const caps = (track?.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean; focusMode?: string[] };
  if (track && caps.focusMode?.includes('continuous')) {
    void track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] }).catch(() => {});
  }
  return {
    stream,
    hasTorch: Boolean(caps.torch),
    setTorch: async (on) => {
      try {
        await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
        return on;
      } catch { return !on; }
    },
    stop: () => stream.getTracks().forEach((t) => t.stop()),
  };
}

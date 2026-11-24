'use client';

import { ConvertError, type Conversion } from '@/lib/convert/formats';
import type { OfficeOptions } from '@/lib/convert/office-options';
import type { Output } from './run-browser';

// Sending a file to the Pi to convert (ffmpeg, LibreOffice) and waiting for the result.
// Used by Tools › File converter, and by AI attachments that turn slides into a PDF.

export type PiTools = { signedIn: boolean; ffmpeg: boolean; office: boolean };

let cached: Promise<PiTools> | null = null;

/** What the Pi can convert for this visitor. Asked once per page load. */
export function loadPiTools(refresh = false): Promise<PiTools> {
  if (!cached || refresh) {
    cached = fetch('/api/tools/convert', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => ({ signedIn: !!d.signedIn, ffmpeg: !!d.ffmpeg, office: !!d.office }))
      .catch(() => ({ signedIn: false, ffmpeg: false, office: false }));
  }
  return cached;
}

/** Send one file to the Pi and wait for the result, reporting how it's going. */
export async function runOnPi(conversion: Conversion, file: File, onStatus: (text: string) => void, signal?: AbortSignal, options: OfficeOptions = {}): Promise<Output> {
  const form = new FormData();
  form.append('conversion', conversion.id);
  form.append('options', JSON.stringify(options));
  form.append('file', file);
  onStatus(`Sending ${file.name} to the Pi…`);
  const start = await fetch('/api/tools/convert', { method: 'POST', body: form, signal });
  const started = await start.json().catch(() => ({}));
  if (!start.ok || !started.success) throw new ConvertError(started.error || 'The Pi wouldn’t take that file.');
  const id: string = started.job.id;
  const stop = () => { void fetch(`/api/tools/convert?id=${encodeURIComponent(id)}`, { method: 'DELETE' }); };
  signal?.addEventListener('abort', stop, { once: true });
  try {
    for (;;) {
      await new Promise((r) => setTimeout(r, 1500));
      if (signal?.aborted) throw new ConvertError('Stopped.');
      const res = await fetch(`/api/tools/convert?id=${encodeURIComponent(id)}`, { cache: 'no-store', signal }).then((r) => r.json()).catch(() => null);
      const job = res?.job;
      if (!job) continue;
      if (job.status === 'queued') onStatus(`${file.name}: waiting for the Pi${job.ahead ? ` (${job.ahead} ahead)` : ''}…`);
      if (job.status === 'running') onStatus(`${file.name}: converting on the Pi…`);
      if (job.status === 'error') throw new ConvertError(job.error || 'The Pi couldn’t convert that.');
      if (job.status === 'done') {
        onStatus(`${file.name}: fetching the result…`);
        const dl = await fetch(`/api/tools/convert?id=${encodeURIComponent(id)}&download=1`, { signal });
        if (!dl.ok) throw new ConvertError('The result couldn’t be fetched from the Pi.');
        return { name: job.outName, blob: await dl.blob() };
      }
    }
  } finally {
    signal?.removeEventListener('abort', stop);
    // Got it (or gave up): the Pi can delete its copy now.
    stop();
  }
}

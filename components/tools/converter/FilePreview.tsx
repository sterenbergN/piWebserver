'use client';

import { useEffect, useRef, useState } from 'react';
import { kindOf, type FileKind } from '@/lib/convert/formats';

// A look at a file before and after converting: a small thumbnail in the list, and a
// bigger view when opened (pictures, PDF pages, a player for sound and video, the
// start of text files, a zip's contents). All drawn here, from the file itself.

export const KIND_ICON: Record<FileKind, string> = { image: '🖼️', heic: '🖼️', pdf: '📄', audio: '🎵', video: '🎬', doc: '📝', slides: '📊', sheet: '📈', csv: '🧾', json: '🧾', zip: '🗜️', other: '📦' };
const TEXT = /\.(txt|csv|json|md|tsv|log|xml|html?)$/i;

/** An object URL for a blob, let go when it changes or the preview goes. */
function useObjectUrl(blob: Blob | null) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) return;
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}

/** One PDF page drawn into a canvas `width` pixels wide; how many pages there are. */
function PdfPage({ blob, page, width, onPages }: { blob: Blob; page: number; width: number; onPages?: (n: number) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    let destroy: (() => void) | null = null;
    void (async () => {
      try {
        const lib = await import('pdfjs-dist/legacy/build/pdf.mjs');
        if (!lib.GlobalWorkerOptions.workerSrc) lib.GlobalWorkerOptions.workerSrc = `/reader-assets/pdfjs-${lib.version}/pdf.worker.min.mjs`;
        const task = lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) });
        destroy = () => { void task.destroy(); };
        const doc = await task.promise;
        if (!live) return;
        onPages?.(doc.numPages);
        const p = await doc.getPage(Math.min(page, doc.numPages));
        const base = p.getViewport({ scale: 1 });
        const viewport = p.getViewport({ scale: (width * (window.devicePixelRatio || 1)) / base.width });
        const c = canvas.current;
        if (!c || !live) return;
        c.width = viewport.width;
        c.height = viewport.height;
        const ctx = c.getContext('2d')!;
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, c.width, c.height);
        await p.render({ canvas: c, canvasContext: ctx, viewport }).promise;
      } catch {
        if (live) setFailed(true);
      }
    })();
    return () => { live = false; destroy?.(); };
  }, [blob, page, width, onPages]);
  if (failed) return <span className="tl-prev-icon" aria-hidden>📄</span>;
  return <canvas ref={canvas} className="tl-prev-pdf" style={{ width }} aria-label={`Page ${page}`} />;
}

/** The small square in a file row. */
export function Thumb({ blob, name }: { blob: Blob; name: string }) {
  const kind = kindOf(name, blob.type);
  const url = useObjectUrl(kind === 'image' || kind === 'heic' || kind === 'video' ? blob : null);
  const [broken, setBroken] = useState(false);
  if ((kind === 'image' || kind === 'heic') && url && !broken) return <img className="tl-prev-thumb" src={url} alt="" onError={() => setBroken(true)} />;
  if (kind === 'video' && url) return <video className="tl-prev-thumb" src={`${url}#t=0.5`} muted preload="metadata" aria-hidden />;
  if (kind === 'pdf') return <span className="tl-prev-thumb"><PdfPage blob={blob} page={1} width={44} /></span>;
  return <span className="tl-prev-thumb tl-prev-icon" aria-hidden>{KIND_ICON[kind]}</span>;
}

/** The bigger view, opened from a row. */
export function FilePreview({ blob, name }: { blob: Blob; name: string }) {
  const kind = kindOf(name, blob.type);
  const url = useObjectUrl(['image', 'heic', 'audio', 'video'].includes(kind) ? blob : null);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [text, setText] = useState<string | null>(null);
  const [entries, setEntries] = useState<string[] | null>(null);
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    if (TEXT.test(name) || kind === 'csv' || kind === 'json') void blob.slice(0, 6000).text().then((t) => setText(t.split(/\r?\n/).slice(0, 40).join('\n')));
    if (kind === 'zip') {
      void (async () => {
        // Names only: the filter says no to every file, so nothing is unpacked.
        const { unzipSync } = await import('fflate');
        const names: string[] = [];
        try { unzipSync(new Uint8Array(await blob.arrayBuffer()), { filter: (f) => { if (!f.name.endsWith('/')) names.push(f.name); return false; } }); } catch { /* not a zip */ }
        setEntries(names);
      })();
    }
  }, [blob, name, kind]);

  let body: React.ReactNode;
  if ((kind === 'image' || kind === 'heic') && url && !broken) body = <img className="tl-prev-image" src={url} alt={name} onError={() => setBroken(true)} />;
  else if (kind === 'heic') body = <p className="tl-conv-note">This browser can’t show HEIC photos. Convert it to JPEG to see it.</p>;
  else if (kind === 'video' && url) body = <video className="tl-prev-image" src={url} controls preload="metadata" />;
  else if (kind === 'audio' && url) body = <audio src={url} controls preload="metadata" />;
  else if (kind === 'pdf') {
    body = (
      <div className="tl-prev-pdf-wrap">
        <PdfPage blob={blob} page={page} width={320} onPages={setPages} />
        {pages > 1 && (
          <div className="tl-prev-pages">
            <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Previous page">‹</button>
            <span>Page {page} of {pages}</span>
            <button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)} aria-label="Next page">›</button>
          </div>
        )}
      </div>
    );
  } else if (text !== null) body = <pre className="tl-prev-text">{text || '(empty)'}</pre>;
  else if (entries) body = entries.length ? <ul className="tl-prev-zip">{entries.slice(0, 30).map((n) => <li key={n}>{n}</li>)}{entries.length > 30 && <li>…and {entries.length - 30} more</li>}</ul> : <p className="tl-conv-note">Empty, or not a zip this can read.</p>;
  else if (kind === 'doc' || kind === 'slides' || kind === 'sheet') body = <p className="tl-conv-note">Office files can’t be shown here. Turn it into a PDF to see it.</p>;
  else body = <p className="tl-conv-note">No preview for this kind of file.</p>;
  return <div className="tl-prev">{body}</div>;
}

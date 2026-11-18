import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api';
import type { FixedSource, TocEntry } from '../source';

// PDFs through pdf.js. The legacy build runs on iPhones a few years old. The file is
// read in pieces as pages need them, so a 500 MB textbook doesn't fill a phone's memory.
// It can be a file kept on this device, or one still on the Pi: then the pieces are asked
// for over the connection, and the first page shows without the whole file coming down.
// The worker, fonts and character maps are copied into public/ by scripts/run-next.mjs.

export const PDF_ASSETS = `/reader-assets/pdfjs-${pdfjs.version}/`;

pdfjs.GlobalWorkerOptions.workerSrc = `${PDF_ASSETS}pdf.worker.min.mjs`;

const PIECE_BYTES = 256 * 1024;
/** Over a connection each piece is a round trip, so they're bigger. */
const REMOTE_PIECE_BYTES = 1024 * 1024;

/** A file that's read from the server a piece at a time: its address, and how long it is. */
export type RemoteFile = { url: string; size: number };
export type PdfFile = Blob | RemoteFile;

/** The server wouldn't give a piece of the file: `status` says why (401 is a sign-in that ran out). */
export class RemoteFileError extends Error {
  constructor(readonly status: number) {
    super(status === 404 ? 'That file isn’t on the Pi any more.' : 'The Pi wouldn’t send that file.');
  }
}

class BlobRange extends pdfjs.PDFDataRangeTransport {
  constructor(private blob: Blob, first: Uint8Array) {
    super(blob.size, first);
  }

  requestDataRange(begin: number, end: number) {
    void this.blob.slice(begin, end).arrayBuffer().then((buffer) => this.onDataRange(begin, new Uint8Array(buffer)));
  }
}

/** Bytes `begin` up to (not including) `end` of a file on the server, and how long the file says it is. */
async function fetchPiece(url: string, begin: number, end: number) {
  const res = await fetch(url, { headers: { Range: `bytes=${begin}-${end - 1}` } });
  if (!res.ok) throw new RemoteFileError(res.status);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const total = Number(/\/(\d+)$/.exec(res.headers.get('content-range') ?? '')?.[1]);
  // A server that ignores the range sends everything: take the part that was asked for.
  return { bytes: res.status === 206 ? bytes : bytes.subarray(begin, end), total: res.status === 206 && total > 0 ? total : bytes.length };
}

class HttpRange extends pdfjs.PDFDataRangeTransport {
  private stopped = false;

  constructor(private url: string, size: number, first: Uint8Array, private onFatal?: (error: Error) => void) {
    super(size, first);
  }

  /** A dropped connection is waited out briefly, then surfaces a clear error instead of hanging forever. */
  requestDataRange(begin: number, end: number) {
    void (async () => {
      for (let attempt = 0; !this.stopped; attempt++) {
        try {
          const { bytes } = await fetchPiece(this.url, begin, end);
          if (!this.stopped) this.onDataRange(begin, bytes);
          return;
        } catch (error) {
          const permanent = error instanceof RemoteFileError && error.status < 500;
          const offline = typeof navigator !== 'undefined' && !navigator.onLine;
          if (permanent || offline || attempt >= 2) {
            this.stopped = true;
            const err = error instanceof Error
              ? (error instanceof TypeError ? new Error('No connection to fetch the rest of this PDF.') : error)
              : new Error('Could not load this PDF.');
            this.onFatal?.(err);
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, Math.min(3000, 500 * 2 ** attempt)));
        }
      }
    })();
  }

  abort() {
    this.stopped = true;
  }
}

export async function loadDocument(file: PdfFile, onError?: (error: Error) => void) {
  const remote = !(file instanceof Blob);
  const piece = remote ? REMOTE_PIECE_BYTES : PIECE_BYTES;
  let range: InstanceType<typeof pdfjs.PDFDataRangeTransport>;
  let loadingTask: ReturnType<typeof pdfjs.getDocument> | null = null;
  let failed = false;
  const fail = (err: Error) => {
    if (failed) return;
    failed = true;
    void loadingTask?.destroy().catch(() => {});
    onError?.(err);
  };
  if (remote) {
    const first = await fetchPiece(file.url, 0, Math.min(piece, Math.max(1, file.size)));
    range = new HttpRange(file.url, first.total, first.bytes, fail);
  } else {
    range = new BlobRange(file, new Uint8Array(await file.slice(0, piece).arrayBuffer()));
  }
  loadingTask = pdfjs.getDocument({
    range,
    rangeChunkSize: piece,
    disableAutoFetch: true,
    disableStream: true,
    cMapUrl: `${PDF_ASSETS}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${PDF_ASSETS}standard_fonts/`,
    wasmUrl: `${PDF_ASSETS}wasm/`,
    iccUrl: `${PDF_ASSETS}iccs/`,
  });
  return loadingTask.promise;
}

async function readOutline(doc: PDFDocumentProxy) {
  const outline = await doc.getOutline().catch(() => null);
  if (!outline) return [];
  const entries: TocEntry[] = [];
  const walk = async (items: NonNullable<typeof outline>, depth: number) => {
    for (const item of items) {
      try {
        const dest = typeof item.dest === 'string' ? await doc.getDestination(item.dest) : item.dest;
        const ref = dest?.[0];
        if (ref) {
          const index = typeof ref === 'number' ? ref : await doc.getPageIndex(ref);
          entries.push({ label: item.title.trim() || `Page ${index + 1}`, depth, section: 0, page: index + 1 });
        }
      } catch { /* A link to nowhere: leave it out. */ }
      if (item.items?.length) await walk(item.items, depth + 1);
    }
  };
  await walk(outline, 0);
  // Out-of-order outlines would confuse which chapter a page is in.
  return entries.sort((a, b) => (a.page ?? 0) - (b.page ?? 0));
}

export async function openPdf(file: PdfFile, onError?: (error: Error) => void): Promise<FixedSource> {
  const doc = await loadDocument(file, onError);
  const toc = await readOutline(doc);
  const sizes = new Map<number, { width: number; height: number }>();
  return {
    pageCount: doc.numPages,
    toc,
    invertable: true,
    size: async (index) => {
      const known = sizes.get(index);
      if (known) return known;
      const { width, height } = (await doc.getPage(index + 1)).getViewport({ scale: 1 });
      const size = { width, height };
      sizes.set(index, size);
      return size;
    },
    render: (index, canvas, pixelWidth) => {
      let cancelled = false;
      let cancelTask = () => {};
      const promise = doc.getPage(index + 1).then((page) => {
        if (cancelled) return;
        const viewport = page.getViewport({ scale: pixelWidth / page.getViewport({ scale: 1 }).width });
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        const task = page.render({ canvas, viewport });
        cancelTask = () => task.cancel();
        return task.promise;
      });
      return { promise: promise.then(() => {}), cancel: () => { cancelled = true; cancelTask(); } };
    },
    getText: async (index) => {
      const page = await doc.getPage(index + 1);
      const content = await page.getTextContent();
      let out = '';
      let prevEndX: number | null = null;
      let prevY: number | null = null;
      for (const item of content.items) {
        if (!('str' in item)) continue;
        const tx = typeof item.transform?.[4] === 'number' ? item.transform[4] : null;
        const ty = typeof item.transform?.[5] === 'number' ? item.transform[5] : null;
        if (prevY !== null && ty !== null && Math.abs(ty - prevY) > 2) {
          if (out && !out.endsWith('\n')) out += '\n';
          prevEndX = null;
        } else if (
          prevEndX !== null &&
          tx !== null &&
          tx - prevEndX > Math.max(1.5, (item.height || 10) * 0.12) &&
          out &&
          !/\s$/.test(out) &&
          !/^\s/.test(item.str)
        ) {
          out += ' ';
        }
        out += item.str;
        if (item.hasEOL) {
          if (!out.endsWith('\n')) out += '\n';
          prevEndX = null;
          prevY = null;
        } else {
          prevEndX = tx !== null ? tx + (item.width || 0) : null;
          prevY = ty;
        }
      }
      return out;
    },
    destroy: () => { void doc.loadingTask.destroy(); },
  };
}

/** A PDF's title and author, and a picture of its first page, for the bookshelf. */
export async function readPdfInfo(file: PdfFile) {
  const doc = await loadDocument(file);
  try {
    const meta = await doc.getMetadata().catch(() => null);
    const info = (meta?.info ?? {}) as { Title?: string; Author?: string };
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: 420 / page.getViewport({ scale: 1 }).width });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    await page.render({ canvas, viewport }).promise;
    return { title: info.Title?.trim() ?? '', author: info.Author?.trim() ?? '', canvas };
  } finally {
    void doc.loadingTask.destroy();
  }
}

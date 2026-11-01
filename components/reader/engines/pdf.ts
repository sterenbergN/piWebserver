import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api';
import type { FixedSource, TocEntry } from '../source';

// PDFs through pdf.js. The legacy build runs on iPhones a few years old. The file is
// read in pieces as pages need them, so a 500 MB textbook doesn't fill a phone's memory.
// The worker, fonts and character maps are copied into public/ by scripts/run-next.mjs.

export const PDF_ASSETS = `/reader-assets/pdfjs-${pdfjs.version}/`;

pdfjs.GlobalWorkerOptions.workerSrc = `${PDF_ASSETS}pdf.worker.min.mjs`;

const PIECE_BYTES = 256 * 1024;

class BlobRange extends pdfjs.PDFDataRangeTransport {
  constructor(private blob: Blob, first: Uint8Array) {
    super(blob.size, first);
  }

  requestDataRange(begin: number, end: number) {
    void this.blob.slice(begin, end).arrayBuffer().then((buffer) => this.onDataRange(begin, new Uint8Array(buffer)));
  }
}

async function loadDocument(blob: Blob) {
  const first = new Uint8Array(await blob.slice(0, PIECE_BYTES).arrayBuffer());
  return pdfjs.getDocument({
    range: new BlobRange(blob, first),
    rangeChunkSize: PIECE_BYTES,
    disableAutoFetch: true,
    disableStream: true,
    cMapUrl: `${PDF_ASSETS}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${PDF_ASSETS}standard_fonts/`,
    wasmUrl: `${PDF_ASSETS}wasm/`,
    iccUrl: `${PDF_ASSETS}iccs/`,
  }).promise;
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

export async function openPdf(blob: Blob): Promise<FixedSource> {
  const doc = await loadDocument(blob);
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
    destroy: () => { void doc.loadingTask.destroy(); },
  };
}

/** A PDF's title and author, and a picture of its first page, for the bookshelf. */
export async function readPdfInfo(blob: Blob) {
  const doc = await loadDocument(blob);
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

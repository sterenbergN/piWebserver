'use client';

import { buildIco, ConvertError, csvToJson, ICO_SIZES, jsonToCsv, kindOf, parsePageRanges, renamed, uniqueNames, type Conversion } from '@/lib/convert/formats';

// The conversions that run on this device: nothing is uploaded. Images go through a
// canvas, PDFs through pdf-lib (making and editing) and pdf.js (drawing and reading
// pages), zips through fflate. The heavier libraries load only when they're needed.

export type ConvertOptions = {
  /** JPEG and WebP quality, 0.5–1. */
  quality: number;
  /** Longest side in pixels for images (0 keeps the size). */
  maxSide: number;
  /** How sharp PDF pages come out as pictures: 1 is screen, 2 is print. */
  scale: number;
  /** Pages, like "1-3, 5" (empty is every page). */
  pages: string;
  /** Pick pages: one PDF per page instead of one PDF. */
  split: boolean;
  rotate: 90 | 180 | 270;
  /** Combining photos into a PDF: each page the photo's size, or a paper size. */
  pageSize: 'fit' | 'a4' | 'letter';
};

export const DEFAULT_OPTIONS: ConvertOptions = { quality: 0.9, maxSide: 0, scale: 2, pages: '', split: false, rotate: 90, pageSize: 'fit' };

export type Output = { name: string; blob: Blob };

const MAX_UNZIPPED = 1024 * 1024 * 1024;
const MAX_ENTRIES = 5000;

// ── Images ─────────────────────────────────────────────────────────────────────

type Drawable = { source: CanvasImageSource; width: number; height: number; close?: () => void };

/** Any picture the browser can show, plus iPhone HEIC (natively in Safari, otherwise with a decoder). */
async function loadImage(file: File): Promise<Drawable> {
  if (kindOf(file.name, file.type) === 'heic') {
    try {
      const bitmap = await createImageBitmap(file);
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      const { heicTo } = await import('heic-to/next');
      const bitmap = await heicTo({ blob: file, type: 'bitmap' }).catch(() => {
        throw new ConvertError(`${file.name} couldn’t be read as an iPhone (HEIC) photo.`);
      });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    // An SVG without a size of its own draws at a useful size.
    const width = img.naturalWidth || 1024;
    const height = img.naturalHeight || 1024;
    return { source: img, width, height, close: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    throw new ConvertError(`${file.name} couldn’t be opened as a picture.`);
  }
}

function canvasFor(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new ConvertError('This browser can’t draw pictures here.');
  return { canvas, ctx };
}

const toBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) => new Promise<Blob>((resolve, reject) => {
  canvas.toBlob((b) => (b ? resolve(b) : reject(new ConvertError(`This browser can’t make ${type.replace('image/', '').toUpperCase()} files.`))), type, quality);
});

/** Draw a picture at its size (or shrunk to `maxSide`), on white when the format has no see-through. */
async function drawImage(file: File, maxSide: number, opaque: boolean) {
  const img = await loadImage(file);
  try {
    const scale = maxSide > 0 ? Math.min(1, maxSide / Math.max(img.width, img.height)) : 1;
    const { canvas, ctx } = canvasFor(img.width * scale, img.height * scale);
    if (opaque) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img.source, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    img.close?.();
  }
}

async function convertImage(file: File, conversion: Conversion, o: ConvertOptions): Promise<Output> {
  if (conversion.id === 'img-ico') {
    const img = await loadImage(file);
    try {
      const pngs = [];
      for (const size of ICO_SIZES) {
        const { canvas, ctx } = canvasFor(size, size);
        // Fitted inside the square, centred, the rest left clear.
        const scale = Math.min(size / img.width, size / img.height);
        const w = img.width * scale, h = img.height * scale;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img.source, (size - w) / 2, (size - h) / 2, w, h);
        pngs.push({ size, png: new Uint8Array(await (await toBlob(canvas, 'image/png')).arrayBuffer()) });
      }
      return { name: renamed(file.name, 'ico'), blob: new Blob([buildIco(pngs) as BlobPart], { type: 'image/x-icon' }) };
    } finally {
      img.close?.();
    }
  }
  const type = conversion.id === 'img-png' ? 'image/png' : conversion.id === 'img-webp' ? 'image/webp' : 'image/jpeg';
  const canvas = await drawImage(file, o.maxSide, type === 'image/jpeg');
  const blob = await toBlob(canvas, type, type === 'image/png' ? undefined : o.quality);
  // Safari quietly makes PNG when asked for WebP it can't write.
  if (blob.type !== type) throw new ConvertError(`This browser can’t make ${type.replace('image/', '').toUpperCase()} files. Try another browser, or PNG or JPEG.`);
  return { name: renamed(file.name, conversion.ext!), blob };
}

// ── PDF ────────────────────────────────────────────────────────────────────────

async function pdfLib() {
  return import('pdf-lib');
}

async function pdfjs() {
  const lib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  if (!lib.GlobalWorkerOptions.workerSrc) lib.GlobalWorkerOptions.workerSrc = `/reader-assets/pdfjs-${lib.version}/pdf.worker.min.mjs`;
  return lib;
}

async function openPdf(file: File) {
  const { PDFDocument } = await pdfLib();
  try {
    return await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: false });
  } catch (e) {
    const msg = e instanceof Error && /encrypt/i.test(e.message) ? 'is password-protected, so it can’t be changed here' : 'couldn’t be read as a PDF';
    throw new ConvertError(`${file.name} ${msg}.`);
  }
}

const pdfBlob = (bytes: Uint8Array) => new Blob([bytes as BlobPart], { type: 'application/pdf' });

/** Points per inch over pixels per inch: a photo's page is its size at 96 dpi. */
const PX_TO_PT = 0.75;
const PAPER = { a4: [595.28, 841.89], letter: [612, 792] } as const;

async function combineToPdf(files: File[], o: ConvertOptions): Promise<Output> {
  const { PDFDocument } = await pdfLib();
  const out = await PDFDocument.create();
  for (const file of files) {
    if (kindOf(file.name, file.type) === 'pdf') {
      const src = await openPdf(file);
      for (const page of await out.copyPages(src, src.getPageIndices())) out.addPage(page);
      continue;
    }
    // Photos as JPEG (small, and every PDF reader shows it); PNGs stay PNG for sharp screenshots.
    const isPng = file.type === 'image/png' || /\.png$/i.test(file.name);
    const canvas = await drawImage(file, o.maxSide || 3000, !isPng);
    const bytes = new Uint8Array(await (await toBlob(canvas, isPng ? 'image/png' : 'image/jpeg', isPng ? undefined : o.quality)).arrayBuffer());
    const image = isPng ? await out.embedPng(bytes) : await out.embedJpg(bytes);
    if (o.pageSize === 'fit') {
      const page = out.addPage([image.width * PX_TO_PT, image.height * PX_TO_PT]);
      page.drawImage(image, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
    } else {
      // Paper turned to match the photo, with a small margin.
      const [short, long] = PAPER[o.pageSize];
      const landscape = image.width > image.height;
      const page = out.addPage(landscape ? [long, short] : [short, long]);
      const margin = 24;
      const fit = Math.min((page.getWidth() - 2 * margin) / image.width, (page.getHeight() - 2 * margin) / image.height);
      const w = image.width * fit, h = image.height * fit;
      page.drawImage(image, { x: (page.getWidth() - w) / 2, y: (page.getHeight() - h) / 2, width: w, height: h });
    }
  }
  const first = files[0]?.name ?? 'combined';
  return { name: renamed(files.length === 1 ? first : 'combined', 'pdf'), blob: pdfBlob(await out.save()) };
}

async function pdfPagesToImages(file: File, conversion: Conversion, o: ConvertOptions): Promise<Output[]> {
  const lib = await pdfjs();
  let doc;
  try {
    doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  } catch {
    throw new ConvertError(`${file.name} couldn’t be read as a PDF.`);
  }
  try {
    const pages = parsePageRanges(o.pages, doc.numPages);
    const type = conversion.id === 'pdf-png' ? 'image/png' : 'image/jpeg';
    const out: Output[] = [];
    for (const index of pages) {
      const page = await doc.getPage(index + 1);
      const viewport = page.getViewport({ scale: o.scale });
      const { canvas, ctx } = canvasFor(viewport.width, viewport.height);
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      out.push({ name: renamed(file.name, type === 'image/png' ? 'png' : 'jpg', `-page${index + 1}`), blob: await toBlob(canvas, type, type === 'image/png' ? undefined : o.quality) });
      page.cleanup();
    }
    return out;
  } finally {
    void doc.loadingTask.destroy();
  }
}

async function pdfText(file: File, o: ConvertOptions): Promise<Output> {
  const lib = await pdfjs();
  const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise.catch(() => {
    throw new ConvertError(`${file.name} couldn’t be read as a PDF.`);
  });
  try {
    const chunks: string[] = [];
    for (const index of parsePageRanges(o.pages, doc.numPages)) {
      const page = await doc.getPage(index + 1);
      const content = await page.getTextContent();
      const text = content.items.map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : '') : '')).join('');
      chunks.push(`--- Page ${index + 1} ---\n${text.trim()}`);
    }
    const all = chunks.join('\n\n');
    if (!all.replace(/--- Page \d+ ---/g, '').trim()) throw new ConvertError(`${file.name} has no text in it (a scan, probably), so there’s nothing to pull out.`);
    return { name: renamed(file.name, 'txt'), blob: new Blob([all], { type: 'text/plain;charset=utf-8' }) };
  } finally {
    void doc.loadingTask.destroy();
  }
}

async function pickPages(file: File, o: ConvertOptions): Promise<Output[]> {
  const { PDFDocument } = await pdfLib();
  const src = await openPdf(file);
  const pages = parsePageRanges(o.pages, src.getPageCount());
  if (o.split) {
    const out: Output[] = [];
    for (const index of pages) {
      const doc = await PDFDocument.create();
      const [page] = await doc.copyPages(src, [index]);
      doc.addPage(page);
      out.push({ name: renamed(file.name, 'pdf', `-page${index + 1}`), blob: pdfBlob(await doc.save()) });
    }
    return out;
  }
  const doc = await PDFDocument.create();
  for (const page of await doc.copyPages(src, pages)) doc.addPage(page);
  return [{ name: renamed(file.name, 'pdf', '-pages'), blob: pdfBlob(await doc.save()) }];
}

async function rotatePages(file: File, o: ConvertOptions): Promise<Output> {
  const { degrees } = await pdfLib();
  const doc = await openPdf(file);
  for (const index of parsePageRanges(o.pages, doc.getPageCount())) {
    const page = doc.getPage(index);
    page.setRotation(degrees((page.getRotation().angle + o.rotate) % 360));
  }
  return { name: renamed(file.name, 'pdf', '-rotated'), blob: pdfBlob(await doc.save()) };
}

// ── Data and zips ───────────────────────────────────────────────────────────────

async function zipFiles(files: File[]): Promise<Output> {
  const { zipSync } = await import('fflate');
  const names = uniqueNames(files.map((f) => f.name));
  const entries: Record<string, Uint8Array> = {};
  for (let i = 0; i < files.length; i++) entries[names[i]] = new Uint8Array(await files[i].arrayBuffer());
  // Already-squeezed files (photos, video, zips) aren't worth squeezing again.
  const bytes = zipSync(Object.fromEntries(Object.entries(entries).map(([n, d]) => [n, [d, { level: /\.(jpe?g|png|webp|heic|mp[34]|m4a|mov|zip|gz|pdf)$/i.test(n) ? 0 : 6 }]])));
  return { name: files.length === 1 ? renamed(files[0].name, 'zip') : 'files.zip', blob: new Blob([bytes as BlobPart], { type: 'application/zip' }) };
}

async function unzipFile(file: File): Promise<Output[]> {
  const { unzipSync } = await import('fflate');
  let total = 0;
  let count = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(await file.arrayBuffer()), {
      filter: (f) => {
        if (f.name.endsWith('/') || f.name.startsWith('__MACOSX/') || /(^|\/)\.DS_Store$/.test(f.name)) return false;
        total += f.originalSize;
        count += 1;
        if (total > MAX_UNZIPPED || count > MAX_ENTRIES) throw new ConvertError(`${file.name} unpacks to more than 1 GB or ${MAX_ENTRIES} files, which is too much to open here.`);
        return true;
      },
    });
  } catch (e) {
    if (e instanceof ConvertError) throw e;
    throw new ConvertError(`${file.name} couldn’t be opened as a zip.`);
  }
  // Folders flatten into the name (a/b.txt becomes a - b.txt), since downloads are one level.
  const names = uniqueNames(Object.keys(files).map((n) => n.split('/').filter(Boolean).join(' - ')));
  return Object.values(files).map((data, i) => ({ name: names[i], blob: new Blob([data as BlobPart]) }));
}

async function convertData(file: File, conversion: Conversion): Promise<Output> {
  const text = await file.text();
  const json = conversion.id === 'csv-json';
  return {
    name: renamed(file.name, json ? 'json' : 'csv'),
    blob: new Blob([json ? csvToJson(text) : `﻿${jsonToCsv(text)}`], { type: json ? 'application/json' : 'text/csv;charset=utf-8' }),
  };
}

/** Run a conversion that works on this device. Combining ones take every file at once. */
export async function runInBrowser(conversion: Conversion, files: File[], options: ConvertOptions, onFile?: (done: number) => void): Promise<Output[]> {
  if (conversion.id === 'to-pdf') return [await combineToPdf(files, options)];
  if (conversion.id === 'zip') return [await zipFiles(files)];
  const out: Output[] = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    switch (conversion.id) {
      case 'img-jpeg': case 'img-png': case 'img-webp': case 'img-ico': out.push(await convertImage(file, conversion, options)); break;
      case 'pdf-jpeg': case 'pdf-png': out.push(...(await pdfPagesToImages(file, conversion, options))); break;
      case 'pdf-pages': out.push(...(await pickPages(file, options))); break;
      case 'pdf-rotate': out.push(await rotatePages(file, options)); break;
      case 'pdf-text': out.push(await pdfText(file, options)); break;
      case 'csv-json': case 'json-csv': out.push(await convertData(file, conversion)); break;
      case 'unzip': out.push(...(await unzipFile(file))); break;
      default: throw new ConvertError('That conversion runs on the Pi.');
    }
    onFile?.(i + 1);
  }
  const names = uniqueNames(out.map((o) => o.name));
  return out.map((o, i) => ({ ...o, name: names[i] }));
}

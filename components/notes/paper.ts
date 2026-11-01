'use client';

import { isDark, type PageElement, type PageRecord, type StrokeElement } from '@/lib/notes/items';
import { markColors, templateMarks, type TemplateMarks } from '@/lib/notes/templates';
import { getFile } from './db';
import { drawImageElement, drawStroke, drawText } from './ink';
import { fetchFile } from './sync';

// Drawing a whole page to any canvas, with the canvas's transform already set to points: what
// the screen uses, and also thumbnails and exports. Pictures and PDF pages have to be fetched
// from the device's database, which takes a moment, so `Assets` hands back what's ready, starts
// on what isn't, and says when it arrives.

type PdfModule = typeof import('@/components/reader/engines/pdf');
type PdfDocument = Awaited<ReturnType<PdfModule['loadDocument']>>;

export const loadPdfEngine = () => import('@/components/reader/engines/pdf');

const marksCache = new Map<string, TemplateMarks>();

export function marksFor(page: Pick<PageRecord, 'template' | 'w' | 'h'>) {
  const key = `${page.template}/${page.w}/${page.h}`;
  let marks = marksCache.get(key);
  if (!marks) {
    marks = templateMarks(page.template, page.w, page.h);
    marksCache.set(key, marks);
  }
  return marks;
}

/** The paper and what's printed on it. */
export function drawPaper(ctx: CanvasRenderingContext2D, page: Pick<PageRecord, 'template' | 'w' | 'h' | 'paper'>, heavier = 1) {
  ctx.fillStyle = page.paper;
  ctx.fillRect(0, 0, page.w, page.h);
  const marks = marksFor(page);
  const colors = markColors(page.paper);
  const heavies = [colors.minor, colors.major, colors.accent];
  for (const weight of [0, 1, 2] as const) {
    const lines = marks.lines.filter((line) => line[4] === weight);
    if (!lines.length) continue;
    ctx.strokeStyle = heavies[weight];
    ctx.lineWidth = (weight === 0 ? 0.5 : 0.8) * heavier;
    ctx.beginPath();
    for (const [x1, y1, x2, y2] of lines) {
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
    }
    ctx.stroke();
  }
  if (marks.dots.length) {
    ctx.fillStyle = colors.dot;
    ctx.beginPath();
    for (const [x, y] of marks.dots) {
      ctx.moveTo(x + 0.7 * heavier, y);
      ctx.arc(x, y, 0.7 * heavier, 0, Math.PI * 2);
    }
    ctx.fill();
  }
  if (marks.boxes.length) {
    ctx.strokeStyle = colors.major;
    ctx.lineWidth = 0.8 * heavier;
    for (const [x, y, half] of marks.boxes) ctx.strokeRect(x - half, y - half, half * 2, half * 2);
  }
  if (marks.labels.length) {
    ctx.fillStyle = colors.label;
    ctx.textBaseline = 'alphabetic';
    for (const label of marks.labels) {
      ctx.font = `${label.size}px -apple-system, system-ui, 'Segoe UI', Roboto, sans-serif`;
      ctx.fillText(label.text, label.x, label.y);
    }
  }
}

const KEEP_PICTURES = 24;
const KEEP_PDF_PAGES = 8;

type Bitmap = HTMLCanvasElement | ImageBitmap;

export class Assets {
  private pictures = new Map<string, Bitmap | null>();
  private pdfs = new Map<string, Promise<PdfDocument | null>>();
  private pdfPages = new Map<string, { canvas: HTMLCanvasElement; scale: number } | null>();
  /** One PDF page draws at a time: a phone can't do several, and the newest is what you're looking at. */
  private queue: Promise<unknown> = Promise.resolve();
  private gone = false;

  constructor(private notebook: string, private onReady: () => void) {}

  private async fileBlob(file: string) {
    return (await getFile(this.notebook, file)) ?? (await fetchFile(this.notebook, file).catch(() => null));
  }

  picture(file: string): Bitmap | null {
    if (this.pictures.has(file)) {
      const held = this.pictures.get(file) ?? null;
      if (held) {
        this.pictures.delete(file);
        this.pictures.set(file, held);
      }
      return held;
    }
    this.pictures.set(file, null);
    void this.fileBlob(file).then((blob) => (blob ? createImageBitmap(blob) : null)).then((bitmap) => {
      if (this.gone) { bitmap?.close(); return; }
      if (!bitmap) { this.pictures.delete(file); return; }
      this.pictures.set(file, bitmap);
      while (this.pictures.size > KEEP_PICTURES) {
        const oldest = this.pictures.keys().next().value as string;
        const held = this.pictures.get(oldest);
        if (held && 'close' in held) held.close();
        this.pictures.delete(oldest);
      }
      this.onReady();
    }).catch(() => { this.pictures.delete(file); });
    return null;
  }

  /** Waits for a picture, for exports and thumbnails, which have no later frame to catch it on. */
  async pictureReady(file: string) {
    const blob = await this.fileBlob(file);
    if (!blob) return null;
    return createImageBitmap(blob);
  }

  private pdfDocument(file: string) {
    let doc = this.pdfs.get(file);
    if (!doc) {
      doc = (async () => {
        const blob = await this.fileBlob(file);
        if (!blob) { this.pdfs.delete(file); return null; }
        return (await loadPdfEngine()).loadDocument(blob);
      })().catch(() => { this.pdfs.delete(file); return null; });
      this.pdfs.set(file, doc);
    }
    return doc;
  }

  /** Draw a PDF page on a canvas: all of it, sized to fit, unless `region` says which part the canvas is already sized for. */
  private async renderPdf(pdf: { file: string; page: number }, target: HTMLCanvasElement, scale: number, region?: { offsetX: number; offsetY: number }) {
    const doc = await this.pdfDocument(pdf.file);
    if (!doc || this.gone) return false;
    const page = await doc.getPage(pdf.page + 1);
    const viewport = page.getViewport({ scale, ...region });
    if (!region) {
      target.width = Math.floor(viewport.width);
      target.height = Math.floor(viewport.height);
    }
    await page.render({ canvas: target, viewport }).promise;
    return true;
  }

  /** A PDF page at about `scale` pixels to the point, or nothing yet. */
  pdfPage(pdf: { file: string; page: number }, scale: number) {
    const key = `${pdf.file}/${pdf.page}/${Math.round(scale * 100)}`;
    if (this.pdfPages.has(key)) return this.pdfPages.get(key) ?? null;
    this.pdfPages.set(key, null);
    this.queue = this.queue.then(async () => {
      if (this.gone || !this.pdfPages.has(key)) return;
      const canvas = document.createElement('canvas');
      const drew = await this.renderPdf(pdf, canvas, scale);
      if (!drew) { this.pdfPages.delete(key); return; }
      this.pdfPages.set(key, { canvas, scale });
      while (this.pdfPages.size > KEEP_PDF_PAGES) this.pdfPages.delete(this.pdfPages.keys().next().value as string);
      this.onReady();
    }).catch(() => { this.pdfPages.delete(key); });
    return null;
  }

  /** Part of a PDF page, for when you've zoomed in further than the whole page can be kept at. */
  async pdfRegion(pdf: { file: string; page: number }, canvas: HTMLCanvasElement, scale: number, offsetX: number, offsetY: number) {
    let drew = false;
    this.queue = this.queue.then(async () => { drew = await this.renderPdf(pdf, canvas, scale, { offsetX, offsetY }); }).catch(() => {});
    await this.queue;
    return drew;
  }

  /** A whole PDF page, waited for, for exports and thumbnails. */
  async pdfWhole(pdf: { file: string; page: number }, scale: number) {
    const canvas = document.createElement('canvas');
    let drew = false;
    this.queue = this.queue.then(async () => { drew = await this.renderPdf(pdf, canvas, scale); }).catch(() => {});
    await this.queue;
    return drew ? canvas : null;
  }

  /** The words on each page of a PDF, for search. */
  async pdfText(file: string) {
    const doc = await this.pdfDocument(file);
    if (!doc) return null;
    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const content = await (await doc.getPage(i)).getTextContent();
      pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' ').replace(/\s+/g, ' ').trim());
    }
    return pages;
  }

  destroy() {
    this.gone = true;
    for (const held of this.pictures.values()) {
      if (held && 'close' in held) held.close();
    }
    this.pictures.clear();
    this.pdfPages.clear();
    for (const doc of this.pdfs.values()) void doc.then((d) => d?.loadingTask.destroy());
    this.pdfs.clear();
  }
}

/** The order things sit on a page: pictures, then highlighter, then writing, then tape over the top. */
function layer(element: PageElement) {
  if (element.kind === 'image') return 0;
  if (element.kind === 'text') return 2;
  if (element.style === 'marker') return 1;
  return element.style === 'tape' ? 3 : 2;
}

export function sortForDrawing(elements: PageElement[]) {
  return [...elements].sort((a, b) => layer(a) - layer(b)
    || ((a.kind === 'image' ? a.z : undefined) ?? a.createdAt) - ((b.kind === 'image' ? b.z : undefined) ?? b.createdAt)
    || (a.id < b.id ? -1 : 1));
}

export function drawElements(ctx: CanvasRenderingContext2D, elements: PageElement[], page: Pick<PageRecord, 'paper'>, assets: Assets | null, options: { hidden?: Set<string>; revealed?: Set<string> } = {}) {
  const dark = isDark(page.paper);
  for (const element of sortForDrawing(elements)) {
    if (options.hidden?.has(element.id)) continue;
    drawElement(ctx, element, dark, assets, options.revealed);
  }
}

export function drawElement(ctx: CanvasRenderingContext2D, element: PageElement, darkPaper: boolean, assets: Assets | null, revealed?: Set<string>) {
  if (element.kind === 'stroke') drawStroke(ctx, element as StrokeElement, darkPaper, revealed?.has(element.id));
  else if (element.kind === 'text') drawText(ctx, element);
  else drawImageElement(ctx, element, assets?.picture(element.file) ?? null);
}

/** A page drawn once, start to finish, waiting for whatever it needs. For thumbnails and pictures of a page. */
export async function renderPage(canvas: HTMLCanvasElement, page: PageRecord, elements: PageElement[], assets: Assets, scale: number) {
  canvas.width = Math.max(1, Math.round(page.w * scale));
  canvas.height = Math.max(1, Math.round(page.h * scale));
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  drawPaper(ctx, page);
  if (page.pdf) {
    const sheet = await assets.pdfWhole(page.pdf, scale);
    if (sheet) ctx.drawImage(sheet, 0, 0, page.w, page.h);
  }
  const dark = isDark(page.paper);
  for (const element of sortForDrawing(elements)) {
    if (element.kind === 'image') {
      const bitmap = await assets.pictureReady(element.file);
      drawImageElement(ctx, element, bitmap);
      bitmap?.close();
    } else {
      drawElement(ctx, element, dark, assets);
    }
  }
}

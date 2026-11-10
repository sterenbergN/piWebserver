'use client';

import type { PDFFont, PDFImage, PDFPage } from 'pdf-lib';
import { isDark, type ImageElement, type PageElement, type PageRecord, type StrokeElement, type TextElement } from '@/lib/notes/items';
import { markColors } from '@/lib/notes/templates';
import { getElements, getFile } from './db';
import { layoutText, MARKER_ALPHA, outlineCommands, outlineOf, strokePoints, TEXT_LINE_HEIGHT } from './ink';
import { Assets, marksFor, renderPage, sortForDrawing } from './paper';
import { fetchFile } from './sync';

// Notebooks out into the world. Ink goes into a PDF as real shapes and typing as real text, so
// it stays sharp at any size, and a PDF you imported goes back out as the same PDF with your
// writing on top, so its text can still be selected. If a page can't be reused like that
// (encrypted, or stored turned on its side) it's drawn as a picture instead.

function rgbOf(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

function parseRgba(value: string) {
  const [r, g, b, a] = value.replace(/[^\d.,]/g, '').split(',').map(Number);
  return { r: r / 255, g: g / 255, b: b / 255, a };
}

const svgPath = (outline: number[][]) => outlineCommands(outline).map((command) => command.join(' ')).join(' ');

const FONT_NAMES = {
  sans: ['Helvetica', 'HelveticaBold', 'HelveticaOblique', 'HelveticaBoldOblique'],
  hand: ['Helvetica', 'HelveticaBold', 'HelveticaOblique', 'HelveticaBoldOblique'],
  serif: ['TimesRoman', 'TimesRomanBold', 'TimesRomanItalic', 'TimesRomanBoldItalic'],
  mono: ['Courier', 'CourierBold', 'CourierOblique', 'CourierBoldOblique'],
} as const;

export type ExportOptions = { templates: boolean };

const blobFor = async (notebook: string, file: string) => (await getFile(notebook, file)) ?? (await fetchFile(notebook, file).catch(() => null));

/** A set of pages as one PDF. */
export async function exportPdf(notebook: string, title: string, pages: PageRecord[], options: ExportOptions, onProgress: (done: number) => void) {
  const lib = await import('pdf-lib');
  const { PDFDocument, rgb, degrees, BlendMode, LineCapStyle, StandardFonts } = lib;
  const out = await PDFDocument.create();
  out.setTitle(title);
  out.setCreator('Notes');
  const sources = new Map<string, Awaited<ReturnType<typeof PDFDocument.load>> | null>();
  const fonts = new Map<string, { font: PDFFont; known: Set<number> }>();
  const pictures = new Map<string, PDFImage | null>();
  const assets = new Assets(notebook, () => {});

  const fontFor = async (element: TextElement) => {
    const name = FONT_NAMES[element.font][(element.bold ? 1 : 0) + (element.italic ? 2 : 0)];
    let held = fonts.get(name);
    if (!held) {
      const font = await out.embedFont(StandardFonts[name]);
      held = { font, known: new Set(font.getCharacterSet()) };
      fonts.set(name, held);
    }
    return held;
  };

  const pictureFor = async (file: string) => {
    if (pictures.has(file)) return pictures.get(file) ?? null;
    const blob = await blobFor(notebook, file);
    let image: PDFImage | null = null;
    if (blob) {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      image = await (bytes[0] === 0x89 ? out.embedPng(bytes) : out.embedJpg(bytes)).catch(() => null);
    }
    pictures.set(file, image);
    return image;
  };

  /** Try to bring the original page across as it is. */
  const reuse = async (page: PageRecord) => {
    if (!page.pdf) return null;
    if (!sources.has(page.pdf.file)) {
      const blob = await blobFor(notebook, page.pdf.file);
      const loaded = blob ? await PDFDocument.load(await blob.arrayBuffer(), { ignoreEncryption: false }).catch(() => null) : null;
      sources.set(page.pdf.file, loaded);
    }
    const source = sources.get(page.pdf.file);
    if (!source) return null;
    const original = source.getPage(page.pdf.page);
    if (original.getRotation().angle % 360 !== 0) return null;
    const [copied] = await out.copyPages(source, [page.pdf.page]);
    return out.addPage(copied);
  };

  const drawPrinted = (target: PDFPage, page: PageRecord, ox: number, oy: number) => {
    const marks = marksFor(page);
    const colors = markColors(page.paper);
    const toPdfY = (y: number) => oy + page.h - y;
    const heavies = [colors.minor, colors.major, colors.accent];
    for (const [x1, y1, x2, y2, weight] of marks.lines) {
      const color = parseRgba(heavies[weight]);
      target.drawLine({ start: { x: ox + x1, y: toPdfY(y1) }, end: { x: ox + x2, y: toPdfY(y2) }, thickness: weight === 0 ? 0.5 : 0.8, color: rgb(color.r, color.g, color.b), opacity: color.a });
    }
    if (marks.dots.length) {
      const dot = parseRgba(colors.dot);
      // As one shape: a page of dots would otherwise be a thousand separate drawings.
      const path = marks.dots.map(([x, y]) => `M ${x - 0.6} ${y - 0.6} h 1.2 v 1.2 h -1.2 Z`).join(' ');
      target.drawSvgPath(path, { x: ox, y: oy + page.h, color: rgb(dot.r, dot.g, dot.b), opacity: dot.a, borderWidth: 0 });
    }
    for (const [x, y, half] of marks.boxes) {
      const color = parseRgba(colors.major);
      target.drawRectangle({ x: ox + x - half, y: toPdfY(y) - half, width: half * 2, height: half * 2, borderColor: rgb(color.r, color.g, color.b), borderOpacity: color.a, borderWidth: 0.8 });
    }
    const label = parseRgba(colors.label);
    for (const mark of marks.labels) {
      const held = fonts.get('Helvetica');
      if (held) target.drawText(mark.text, { x: ox + mark.x, y: toPdfY(mark.y), size: mark.size, font: held.font, color: rgb(label.r, label.g, label.b), opacity: label.a });
    }
  };

  const drawStroke = (target: PDFPage, stroke: StrokeElement, darkPaper: boolean, ox: number, oy: number, pageH: number) => {
    const color = rgbOf(stroke.color);
    const ink = rgb(color.r, color.g, color.b);
    const place = { x: ox, y: oy + pageH };
    if (stroke.style === 'shape') {
      const pts = strokePoints(stroke);
      let path = `M ${pts[0]} ${pts[1]}`;
      for (let i = 3; i < pts.length; i += 3) path += ` L ${pts[i]} ${pts[i + 1]}`;
      target.drawSvgPath(path, { ...place, borderColor: ink, borderWidth: stroke.width, borderLineCap: LineCapStyle.Round });
      return;
    }
    const path = svgPath(outlineOf(strokePoints(stroke), stroke.style, stroke.width, true, undefined, stroke.k));
    if (stroke.style === 'marker') {
      target.drawSvgPath(path, { ...place, color: ink, borderWidth: 0, ...(darkPaper ? { opacity: MARKER_ALPHA } : { blendMode: BlendMode.Multiply }) });
    } else {
      target.drawSvgPath(path, { ...place, color: ink, borderWidth: 0 });
    }
  };

  const drawText = async (target: PDFPage, element: TextElement, ox: number, oy: number, pageH: number) => {
    const { font, known } = await fontFor(element);
    const color = rgbOf(element.color);
    const lineHeight = element.size * TEXT_LINE_HEIGHT;
    const baseline = (lineHeight - element.size) / 2 + element.size * 0.82;
    const cx = element.x + element.w / 2;
    const cy = element.y + element.h / 2;
    const cos = Math.cos(element.rot);
    const sin = Math.sin(element.rot);
    layoutText(element).forEach((line, i) => {
      // Only what the PDF's built-in fonts can spell. Anything else shows as a question mark, not an error.
      const text = [...line].map((char) => (known.has(char.codePointAt(0)!) ? char : '?')).join('');
      if (!text.trim()) return;
      const width = font.widthOfTextAtSize(text, element.size);
      const left = element.align === 'center' ? element.x + (element.w - width) / 2 : element.align === 'right' ? element.x + element.w - width : element.x;
      const y = element.y + baseline + i * lineHeight;
      const rx = cx + (left - cx) * cos - (y - cy) * sin;
      const ry = cy + (left - cx) * sin + (y - cy) * cos;
      target.drawText(text, { x: ox + rx, y: oy + pageH - ry, size: element.size, font, color: rgb(color.r, color.g, color.b), rotate: degrees((-element.rot * 180) / Math.PI) });
    });
  };

  const drawImage = async (target: PDFPage, element: ImageElement, ox: number, oy: number, pageH: number) => {
    const image = await pictureFor(element.file);
    if (!image) return;
    const cx = element.x + element.w / 2;
    const cy = pageH - (element.y + element.h / 2);
    // A PDF turns pictures about their corner, and the other way round.
    const turn = -element.rot;
    const x = cx - (element.w / 2) * Math.cos(turn) + (element.h / 2) * Math.sin(turn);
    const y = cy - (element.w / 2) * Math.sin(turn) - (element.h / 2) * Math.cos(turn);
    target.drawImage(image, { x: ox + x, y: oy + y, width: element.w, height: element.h, rotate: degrees((turn * 180) / Math.PI) });
  };

  const baseFont = await out.embedFont(StandardFonts.Helvetica);
  fonts.set('Helvetica', { font: baseFont, known: new Set(baseFont.getCharacterSet()) });

  try {
    for (const [index, page] of pages.entries()) {
      let target = await reuse(page).catch(() => null);
      let ox = 0;
      let oy = 0;
      if (target) {
        const box = target.getCropBox();
        ox = box.x;
        oy = box.y;
      } else {
        target = out.addPage([page.w, page.h]);
        const paper = rgbOf(page.paper);
        if (page.paper.toLowerCase() !== '#ffffff') target.drawRectangle({ x: 0, y: 0, width: page.w, height: page.h, color: rgb(paper.r, paper.g, paper.b) });
        if (page.pdf) {
          const sheet = await assets.pdfWhole(page.pdf, 2);
          if (sheet) {
            const data = await new Promise<Blob | null>((resolve) => sheet.toBlob(resolve, 'image/jpeg', 0.85));
            if (data) target.drawImage(await out.embedJpg(new Uint8Array(await data.arrayBuffer())), { x: 0, y: 0, width: page.w, height: page.h });
          }
        } else if (options.templates) {
          drawPrinted(target, page, 0, 0);
        }
      }
      const elements = (await getElements(page.id)).filter((element) => !element.deleted) as PageElement[];
      const dark = isDark(page.paper);
      for (const element of sortForDrawing(elements)) {
        // Links, headings and keywords are for finding your way in the app, not for print.
        if (element.kind === 'mark') continue;
        if (element.kind === 'stroke') drawStroke(target, element, dark, ox, oy, page.h);
        else if (element.kind === 'text') await drawText(target, element, ox, oy, page.h);
        else await drawImage(target, element, ox, oy, page.h);
      }
      onProgress(index + 1);
      // Give the screen a turn: a long notebook would otherwise look frozen.
      await new Promise((resolve) => setTimeout(resolve));
    }
    const bytes = await out.save();
    return new Blob([bytes as BlobPart], { type: 'application/pdf' });
  } finally {
    assets.destroy();
  }
}

/** One page as a picture. */
export async function exportPng(notebook: string, page: PageRecord, scale = 2.5) {
  const assets = new Assets(notebook, () => {});
  try {
    const canvas = document.createElement('canvas');
    const elements = (await getElements(page.id)).filter((element) => !element.deleted) as PageElement[];
    await renderPage(canvas, page, elements, assets, scale);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('That page wouldn’t turn into a picture.');
    return blob;
  } finally {
    assets.destroy();
  }
}

/** "1-3, 7" as page numbers in order, without repeats. Nothing valid means nothing. */
export function parsePageRange(text: string, total: number) {
  const out = new Set<number>();
  for (const part of text.split(/[,\s]+/).filter(Boolean)) {
    const match = /^(\d+)(?:-(\d+))?$/.exec(part);
    if (!match) continue;
    const from = Number(match[1]);
    const to = Number(match[2] ?? match[1]);
    for (let n = Math.max(1, Math.min(from, to)); n <= Math.min(total, Math.max(from, to)); n++) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

/** Hand a finished file to the iPad's share sheet, or to the downloads folder where there isn't one. */
export async function shareOrSave(blob: Blob, fileName: string) {
  const file = new File([blob], fileName, { type: blob.type });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: fileName });
      return;
    } catch (error) {
      if ((error as Error).name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export const safeFileName = (title: string) => title.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100) || 'Notes';

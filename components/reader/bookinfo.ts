'use client';

import { formatFromName, titleFromName, type BookFormat } from '@/lib/reader/items';
import { isImageName, naturalSort, ZipReader } from '@/lib/reader/zip';
import { loadEpub, loadFixed, loadFlow, loadPdf, loadText } from './offline';
import type { Engine, ReaderSettings } from './source';

// What the page turner gets for each kind of file, and what the shelf shows for a new book.

export async function openEngine(format: BookFormat, blob: Blob, stage: HTMLElement, settings: ReaderSettings, onChange: () => void): Promise<Engine> {
  if (format === 'pdf' || format === 'cbz') {
    const [{ FixedEngine, openComic }, pdf] = await Promise.all([loadFixed(), format === 'pdf' ? loadPdf() : null]);
    return new FixedEngine(stage, pdf ? await pdf.openPdf(blob) : await openComic(blob), settings, onChange);
  }
  const { FlowEngine } = await loadFlow();
  const source = format === 'epub' ? await (await loadEpub()).openEpub(blob) : await (await loadText()).openTextBook(blob, format);
  return new FlowEngine(stage, source, settings, onChange);
}

const COVER_WIDTH = 420;

function canvasToCover(source: CanvasImageSource, width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = COVER_WIDTH;
  canvas.height = Math.round(COVER_WIDTH * height / width);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.8);
}

async function imageToCover(blob: Blob) {
  const bitmap = await createImageBitmap(blob);
  const cover = canvasToCover(bitmap, bitmap.width, bitmap.height);
  bitmap.close();
  return cover;
}

/** The title, author and cover hiding in a file. Nothing in here is worth failing an upload over. */
export async function readBookInfo(file: File): Promise<{ title: string; author: string; cover: string | null }> {
  const format = formatFromName(file.name);
  const fallback = { title: titleFromName(file.name), author: '', cover: null };
  try {
    if (format === 'epub') {
      const info = await (await loadEpub()).readEpubInfo(file);
      return { title: info.title || fallback.title, author: info.author, cover: info.cover ? await imageToCover(info.cover).catch(() => null) : null };
    }
    if (format === 'pdf') {
      const info = await (await loadPdf()).readPdfInfo(file);
      return { title: info.title || fallback.title, author: info.author, cover: canvasToCover(info.canvas, info.canvas.width, info.canvas.height) };
    }
    if (format === 'cbz') {
      const zip = await ZipReader.open(file);
      const [first] = naturalSort(zip.names().filter((name) => isImageName(name) && !name.startsWith('__MACOSX')));
      return { ...fallback, cover: first ? await imageToCover(new Blob([new Uint8Array(await zip.bytes(first))])).catch(() => null) : null };
    }
  } catch { /* A damaged file shows up as an error when it's opened, with a clearer message. */ }
  return fallback;
}

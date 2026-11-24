// The file converter (Tools › File converter): which conversions exist, which files
// each one takes, and the small pure pieces they share (page ranges, CSV and JSON,
// icon files). Most run in the browser, so the file never leaves the device; audio,
// video and Office files go to the Pi (ffmpeg, LibreOffice) for signed-in accounts.

export type FileKind = 'image' | 'heic' | 'pdf' | 'audio' | 'video' | 'doc' | 'slides' | 'sheet' | 'csv' | 'json' | 'zip' | 'other';

const EXT_KIND: Record<string, FileKind> = {
  png: 'image', jpg: 'image', jpeg: 'image', jfif: 'image', webp: 'image', gif: 'image', bmp: 'image', svg: 'image', avif: 'image', ico: 'image',
  heic: 'heic', heif: 'heic',
  pdf: 'pdf',
  mp3: 'audio', m4a: 'audio', aac: 'audio', wav: 'audio', ogg: 'audio', oga: 'audio', opus: 'audio', flac: 'audio', wma: 'audio', aiff: 'audio', aif: 'audio', amr: 'audio',
  mp4: 'video', mov: 'video', m4v: 'video', mkv: 'video', webm: 'video', avi: 'video', wmv: 'video', '3gp': 'video', mpg: 'video', mpeg: 'video', ts: 'video', flv: 'video',
  docx: 'doc', doc: 'doc', odt: 'doc', rtf: 'doc', pages: 'other',
  pptx: 'slides', ppt: 'slides', odp: 'slides', pps: 'slides', ppsx: 'slides', key: 'other',
  xlsx: 'sheet', xls: 'sheet', ods: 'sheet',
  csv: 'csv', json: 'json',
  zip: 'zip',
};

export const extensionOf = (name: string) => (name.match(/\.([a-z0-9]{1,5})$/i)?.[1] ?? '').toLowerCase();

/** What sort of file this is, from its name (and its type when the name says nothing). */
export function kindOf(name: string, type = ''): FileKind {
  const byExt = EXT_KIND[extensionOf(name)];
  if (byExt) return byExt;
  if (type === 'image/heic' || type === 'image/heif') return 'heic';
  if (type.startsWith('image/')) return 'image';
  if (type === 'application/pdf') return 'pdf';
  if (type.startsWith('audio/')) return 'audio';
  if (type.startsWith('video/')) return 'video';
  return 'other';
}

export type Where = 'browser' | 'pi';
export type PiTool = 'ffmpeg' | 'office';

export type Conversion = {
  id: string;
  label: string;
  /** A short line under the label. */
  hint?: string;
  group: 'Images' | 'PDF' | 'Audio & video' | 'Office' | 'Data & files';
  takes: FileKind[];
  /** Many files in, one file out (a PDF, a zip); otherwise each file is converted on its own. */
  combine?: boolean;
  where: Where;
  tool?: PiTool;
  /** The new extension (for the Pi's conversions, which make one file each). */
  ext?: string;
};

export const CONVERSIONS: Conversion[] = [
  { id: 'img-jpeg', label: 'To JPEG', group: 'Images', takes: ['image', 'heic'], where: 'browser', ext: 'jpg' },
  { id: 'img-png', label: 'To PNG', group: 'Images', takes: ['image', 'heic'], where: 'browser', ext: 'png' },
  { id: 'img-webp', label: 'To WebP', hint: 'smaller files for the web', group: 'Images', takes: ['image', 'heic'], where: 'browser', ext: 'webp' },
  { id: 'img-ico', label: 'To icon (.ico)', hint: 'a favicon at 16–256 px', group: 'Images', takes: ['image', 'heic'], where: 'browser', ext: 'ico' },
  { id: 'to-pdf', label: 'Combine into one PDF', hint: 'photos and PDFs, in the order shown', group: 'PDF', takes: ['image', 'heic', 'pdf'], combine: true, where: 'browser', ext: 'pdf' },
  { id: 'pdf-jpeg', label: 'Pages to JPEG', group: 'PDF', takes: ['pdf'], where: 'browser' },
  { id: 'pdf-png', label: 'Pages to PNG', group: 'PDF', takes: ['pdf'], where: 'browser' },
  { id: 'pdf-pages', label: 'Pick or split pages', hint: 'keep some pages, or one PDF per page', group: 'PDF', takes: ['pdf'], where: 'browser', ext: 'pdf' },
  { id: 'pdf-rotate', label: 'Rotate pages', group: 'PDF', takes: ['pdf'], where: 'browser', ext: 'pdf' },
  { id: 'pdf-text', label: 'Text (.txt)', hint: 'the words, for PDFs that have them', group: 'PDF', takes: ['pdf'], where: 'browser', ext: 'txt' },
  { id: 'av-mp3', label: 'To MP3', hint: 'audio only, from audio or video', group: 'Audio & video', takes: ['audio', 'video'], where: 'pi', tool: 'ffmpeg', ext: 'mp3' },
  { id: 'av-m4a', label: 'To M4A (AAC)', group: 'Audio & video', takes: ['audio', 'video'], where: 'pi', tool: 'ffmpeg', ext: 'm4a' },
  { id: 'av-wav', label: 'To WAV', group: 'Audio & video', takes: ['audio', 'video'], where: 'pi', tool: 'ffmpeg', ext: 'wav' },
  { id: 'video-mp4', label: 'To MP4', hint: 'plays everywhere (H.264); slow on the Pi', group: 'Audio & video', takes: ['video'], where: 'pi', tool: 'ffmpeg', ext: 'mp4' },
  { id: 'video-gif', label: 'To GIF', hint: 'the first 15 seconds, 480 px wide', group: 'Audio & video', takes: ['video'], where: 'pi', tool: 'ffmpeg', ext: 'gif' },
  { id: 'office-pdf', label: 'To PDF', hint: 'PowerPoint, Word or Excel', group: 'Office', takes: ['doc', 'slides', 'sheet'], where: 'pi', tool: 'office', ext: 'pdf' },
  { id: 'doc-docx', label: 'To Word (.docx)', group: 'Office', takes: ['doc'], where: 'pi', tool: 'office', ext: 'docx' },
  { id: 'slides-pptx', label: 'To PowerPoint (.pptx)', group: 'Office', takes: ['slides'], where: 'pi', tool: 'office', ext: 'pptx' },
  { id: 'sheet-csv', label: 'To CSV', hint: 'the first sheet', group: 'Office', takes: ['sheet'], where: 'pi', tool: 'office', ext: 'csv' },
  { id: 'sheet-xlsx', label: 'To Excel (.xlsx)', group: 'Office', takes: ['sheet', 'csv'], where: 'pi', tool: 'office', ext: 'xlsx' },
  { id: 'csv-json', label: 'CSV to JSON', group: 'Data & files', takes: ['csv'], where: 'browser', ext: 'json' },
  { id: 'json-csv', label: 'JSON to CSV', hint: 'a list of objects', group: 'Data & files', takes: ['json'], where: 'browser', ext: 'csv' },
  { id: 'zip', label: 'Zip together', group: 'Data & files', takes: ['image', 'heic', 'pdf', 'audio', 'video', 'doc', 'slides', 'sheet', 'csv', 'json', 'zip', 'other'], combine: true, where: 'browser', ext: 'zip' },
  { id: 'unzip', label: 'Unzip', group: 'Data & files', takes: ['zip'], where: 'browser' },
];

export const conversionById = (id: unknown) => CONVERSIONS.find((c) => c.id === id) ?? null;

/** Conversions that suit every one of these files (so one choice applies to them all). */
export function conversionsFor(kinds: FileKind[]): Conversion[] {
  if (!kinds.length) return [];
  return CONVERSIONS.filter((c) => kinds.every((k) => c.takes.includes(k)));
}

/** A file name with a new extension, keeping the rest safe to save anywhere. */
export function renamed(name: string, ext: string, suffix = '') {
  const base = name.replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_').trim().slice(0, 120) || 'file';
  return `${base}${suffix}.${ext}`;
}

/** Make every name in a list different (photo.jpg, photo (2).jpg…). */
export function uniqueNames(names: string[]): string[] {
  const used = new Map<string, number>();
  return names.map((name) => {
    const key = name.toLowerCase();
    const n = (used.get(key) ?? 0) + 1;
    used.set(key, n);
    return n === 1 ? name : name.replace(/(\.[^.]+)?$/, (ext) => ` (${n})${ext}`);
  });
}

export class ConvertError extends Error {}

/**
 * Pages from "1-3, 5, 8-" (1-based, as people count them) as 0-based indexes, in
 * the order written. Empty means every page.
 */
export function parsePageRanges(text: string, pageCount: number): number[] {
  const all = Array.from({ length: pageCount }, (_, i) => i);
  if (!text.trim()) return all;
  const out: number[] = [];
  for (const part of text.split(/[,;]+/).map((p) => p.trim()).filter(Boolean)) {
    const m = part.match(/^(\d+)?\s*(-|–|to)?\s*(\d+)?$/i);
    if (!m || (!m[1] && !m[3])) throw new ConvertError(`“${part}” isn’t a page or range, like 1-3 or 5.`);
    const from = m[1] ? Number(m[1]) : 1;
    const to = m[2] ? (m[3] ? Number(m[3]) : pageCount) : from;
    if (from < 1 || to < 1 || from > pageCount || to > pageCount) throw new ConvertError(`This PDF has ${pageCount} page${pageCount === 1 ? '' : 's'}, so ${part} is past the end.`);
    const step = from <= to ? 1 : -1;
    for (let p = from; step > 0 ? p <= to : p >= to; p += step) out.push(p - 1);
  }
  return out;
}

// ── CSV and JSON ────────────────────────────────────────────────────────────────

/** Rows of a CSV file (quotes, doubled quotes and line breaks inside quotes handled). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length > 1 || r[0] !== '');
}

/** A CSV with a header row as a list of objects (numbers left as text: CSV can't say which are numbers). */
export function csvToJson(text: string): string {
  const [header, ...rows] = parseCsv(text);
  if (!header) throw new ConvertError('That CSV is empty.');
  const keys = header.map((h, i) => h.trim() || `column${i + 1}`);
  return JSON.stringify(rows.map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i] ?? '']))), null, 2);
}

const csvCell = (value: unknown) => {
  const text = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** A JSON list of objects (or one object, or a list of lists) as CSV, with every key as a column. */
export function jsonToCsv(text: string): string {
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw new ConvertError('That isn’t valid JSON.'); }
  const list = Array.isArray(data) ? data : [data];
  if (!list.length) throw new ConvertError('That JSON list is empty.');
  if (list.every(Array.isArray)) return list.map((r) => (r as unknown[]).map(csvCell).join(',')).join('\r\n');
  if (!list.every((r) => r && typeof r === 'object' && !Array.isArray(r))) throw new ConvertError('CSV needs a list of objects, like [{"name": "…"}].');
  const keys = [...new Set(list.flatMap((r) => Object.keys(r as object)))];
  return [keys.map(csvCell).join(','), ...list.map((r) => keys.map((k) => csvCell((r as Record<string, unknown>)[k])).join(','))].join('\r\n');
}

// ── Icons ───────────────────────────────────────────────────────────────────────

/** Sizes a favicon .ico carries. */
export const ICO_SIZES = [16, 32, 48, 256];

/** An .ico file holding PNGs (every browser and Windows reads PNG-in-ICO). */
export function buildIco(images: { size: number; png: Uint8Array }[]): Uint8Array {
  const header = 6 + 16 * images.length;
  const total = header + images.reduce((sum, i) => sum + i.png.length, 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint16(0, 0, true);
  view.setUint16(2, 1, true);
  view.setUint16(4, images.length, true);
  let offset = header;
  images.forEach((img, i) => {
    const at = 6 + 16 * i;
    out[at] = img.size >= 256 ? 0 : img.size;
    out[at + 1] = img.size >= 256 ? 0 : img.size;
    view.setUint16(at + 4, 1, true);
    view.setUint16(at + 6, 32, true);
    view.setUint32(at + 8, img.png.length, true);
    view.setUint32(at + 12, offset, true);
    out.set(img.png, offset);
    offset += img.png.length;
  });
  return out;
}

// The notes app's data, shared by the server and the browser: what a notebook, a page and
// the things on a page look like, and how two devices' copies merge.
//
// Everything is a record with its own id, kept in one of three levels: the account's
// library (folders and notebooks), a notebook (its pages and recordings), and a page (its
// strokes, text and images). Devices work offline and send what changed when they can, and
// the newest edit of a record wins, so writing on the phone and the iPad on the same flight
// loses nothing. A deleted record stays as a small tombstone, so the delete reaches the
// other devices too. A page is the unit that gets saved, so a 500-page notebook never has
// to be rewritten because of one stroke, which is what the Reader's one file per book does.

import { isId } from '@/lib/reader/items';

export { isId };

/** Set by the server: the order changes reached it in. */
type Synced = { id: string; createdAt: number; updatedAt: number; deleted?: boolean; seq?: number };

export type Folder = Synced & { kind: 'folder'; name: string; parent?: string };

export type Notebook = Synced & {
  kind: 'notebook';
  title: string;
  folder?: string;
  /** A cover colour, or nothing to show the first page. */
  cover?: string;
  starred?: boolean;
  /** In the trash since then. It comes back from there until it's emptied. */
  trashedAt?: number;
  /** When something in it last changed. Apart from `updatedAt`, which is about this record. */
  editedAt?: number;
  /** What new pages look like. */
  template?: TemplateId;
  paper?: string;
  size?: { w: number; h: number };
};

export type LibraryRecord = Folder | Notebook;

export const TEMPLATE_IDS = [
  'blank', 'ruled-narrow', 'ruled', 'ruled-wide', 'grid-small', 'grid', 'engineering', 'dots', 'isometric', 'cornell', 'checklist', 'music', 'daily', 'weekly',
] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

export type PageRecord = Synced & {
  kind: 'page';
  /** Where it sits in the notebook. Between its neighbours, so moves from two devices can't collide. */
  order: number;
  /** Size in points: 72 to the inch. */
  w: number;
  h: number;
  template: TemplateId;
  paper: string;
  title?: string;
  starred?: boolean;
  /** A page of a PDF underneath everything. `page` counts from 0. */
  pdf?: { file: string; page: number };
};

/** Sound recorded while writing. Ink carries the time it was written, which is what links the two. */
export type RecordingRecord = Synced & { kind: 'recording'; file: string; startedAt: number; duration: number; title: string; mime: string };

export type BookRecord = PageRecord | RecordingRecord;

export const PEN_STYLES = ['ball', 'fountain', 'brush'] as const;
export type StrokeStyle = (typeof PEN_STYLES)[number] | 'marker' | 'tape' | 'shape';

/**
 * One stroke on a page. `p` holds x, y, pressure for each point, packed by geometry.ts. The
 * first three are absolute and the rest are differences, so a page of handwriting takes about
 * half the room. Positions are in twentieths of a point, and `width` is in points.
 */
export type StrokeElement = Synced & { kind: 'stroke'; style: StrokeStyle; color: string; width: number; p: number[] };

export const TEXT_FONTS = ['sans', 'serif', 'mono', 'hand'] as const;
export type TextFont = (typeof TEXT_FONTS)[number];

export type TextElement = Synced & {
  kind: 'text';
  x: number; y: number; w: number; h: number; rot: number;
  text: string; size: number; color: string; font: TextFont; bold?: boolean; italic?: boolean; align?: 'left' | 'center' | 'right';
};

export type ImageElement = Synced & { kind: 'image'; x: number; y: number; w: number; h: number; rot: number; file: string; z?: number };

export type PageElement = StrokeElement | TextElement | ImageElement;

export type RecordFile<T> = { seq: number; items: Record<string, T> };
export const emptyFile = <T>(): RecordFile<T> => ({ seq: 0, items: {} });

export const MAX_CHANGES = 300;
export const MAX_TEXT_CHARS = 50_000;
/** Numbers in a stroke's `p`, three to a point. Longer strokes are ended and carried on as a new one. */
export const MAX_STROKE_POINTS = 8_000;
export const MAX_FILE_BYTES = 1024 * 1024 * 1024;
/** Cloudflare turns away requests over 100 MB, so big files go up in pieces. */
export const UPLOAD_CHUNK_BYTES = 32 * 1024 * 1024;
const MAX_PAGE_POINTS = 5_000;

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
export const isColor = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
const cleanName = (value: unknown, limit = 200) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, limit) : '');

export const isDark = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) < 128;
};

/** What every record has, from a device, checked. A phone with its clock set wrong shouldn't win every argument for years. */
function base(r: Record<string, unknown>, now: number): Synced | null {
  if (!isId(r.id) || !finite(r.updatedAt) || !finite(r.createdAt)) return null;
  return { id: r.id, createdAt: Math.min(r.createdAt, now), updatedAt: Math.min(r.updatedAt, now), ...(r.deleted === true ? { deleted: true } : {}) };
}

export function cleanSize(raw: unknown) {
  const s = raw as { w?: unknown; h?: unknown } | null | undefined;
  if (!s || !finite(s.w) || !finite(s.h) || s.w < 72 || s.h < 72 || s.w > MAX_PAGE_POINTS || s.h > MAX_PAGE_POINTS) return null;
  return { w: s.w, h: s.h };
}

export function cleanLibraryRecord(raw: unknown, now: number): LibraryRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const common = base(r, now);
  if (!common) return null;
  if (r.kind === 'folder') {
    if (common.deleted) return { ...common, kind: 'folder', name: '' };
    const name = cleanName(r.name, 80);
    if (!name) return null;
    return { ...common, kind: 'folder', name, ...(isId(r.parent) && r.parent !== r.id ? { parent: r.parent } : {}) };
  }
  if (r.kind !== 'notebook') return null;
  if (common.deleted) return { ...common, kind: 'notebook', title: '' };
  const size = cleanSize(r.size);
  return {
    ...common,
    kind: 'notebook',
    title: cleanName(r.title, 300) || 'Untitled',
    ...(isId(r.folder) ? { folder: r.folder } : {}),
    ...(isColor(r.cover) ? { cover: r.cover } : {}),
    ...(r.starred === true ? { starred: true } : {}),
    ...(finite(r.trashedAt) ? { trashedAt: r.trashedAt } : {}),
    ...(finite(r.editedAt) ? { editedAt: Math.min(r.editedAt, now) } : {}),
    ...(TEMPLATE_IDS.includes(r.template as TemplateId) ? { template: r.template as TemplateId } : {}),
    ...(isColor(r.paper) ? { paper: r.paper } : {}),
    ...(size ? { size } : {}),
  };
}

export function cleanBookRecord(raw: unknown, now: number): BookRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const common = base(r, now);
  if (!common) return null;
  if (r.kind === 'recording') {
    if (common.deleted) return { ...common, kind: 'recording', file: '', startedAt: 0, duration: 0, title: '', mime: '' };
    if (!isId(r.file) || !finite(r.startedAt) || !finite(r.duration) || r.duration < 0) return null;
    return { ...common, kind: 'recording', file: r.file, startedAt: r.startedAt, duration: r.duration, title: cleanName(r.title) || 'Recording', mime: cleanName(r.mime, 80) };
  }
  if (r.kind !== 'page' || !finite(r.order)) return null;
  const size = cleanSize(r);
  if (!size) return null;
  const pdf = r.pdf as { file?: unknown; page?: unknown } | undefined;
  return {
    ...common,
    kind: 'page',
    order: r.order,
    ...size,
    template: TEMPLATE_IDS.includes(r.template as TemplateId) ? r.template as TemplateId : 'blank',
    paper: isColor(r.paper) ? r.paper : '#ffffff',
    ...(cleanName(r.title) ? { title: cleanName(r.title) } : {}),
    ...(r.starred === true ? { starred: true } : {}),
    ...(pdf && isId(pdf.file) && finite(pdf.page) && pdf.page >= 0 ? { pdf: { file: pdf.file, page: Math.floor(pdf.page) } } : {}),
  };
}

const STROKE_STYLES: StrokeStyle[] = [...PEN_STYLES, 'marker', 'tape', 'shape'];

export function cleanElement(raw: unknown, now: number): PageElement | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const common = base(r, now);
  if (!common) return null;
  if (r.kind === 'stroke') {
    if (common.deleted) return { ...common, kind: 'stroke', style: 'ball', color: '#000000', width: 1, p: [] };
    if (!STROKE_STYLES.includes(r.style as StrokeStyle) || !isColor(r.color) || !finite(r.width) || r.width <= 0 || r.width > 200) return null;
    if (!Array.isArray(r.p) || r.p.length < 3 || r.p.length % 3 !== 0 || r.p.length > MAX_STROKE_POINTS * 3 || !r.p.every(finite)) return null;
    return { ...common, kind: 'stroke', style: r.style as StrokeStyle, color: r.color, width: r.width, p: r.p as number[] };
  }
  if (r.kind !== 'text' && r.kind !== 'image') return null;
  const box = { x: r.x, y: r.y, w: r.w, h: r.h, rot: r.rot ?? 0 };
  if (common.deleted) {
    return r.kind === 'text'
      ? { ...common, kind: 'text', x: 0, y: 0, w: 1, h: 1, rot: 0, text: '', size: 12, color: '#000000', font: 'sans' }
      : { ...common, kind: 'image', x: 0, y: 0, w: 1, h: 1, rot: 0, file: '' };
  }
  if (!Object.values(box).every(finite) || (box.w as number) <= 0 || (box.h as number) < 0) return null;
  const placed = box as { x: number; y: number; w: number; h: number; rot: number };
  if (r.kind === 'image') {
    if (!isId(r.file)) return null;
    return { ...common, kind: 'image', ...placed, file: r.file, ...(finite(r.z) ? { z: r.z } : {}) };
  }
  if (typeof r.text !== 'string' || !isColor(r.color) || !finite(r.size) || r.size < 4 || r.size > 300) return null;
  return {
    ...common,
    kind: 'text',
    ...placed,
    text: r.text.slice(0, MAX_TEXT_CHARS),
    size: r.size,
    color: r.color,
    font: TEXT_FONTS.includes(r.font as TextFont) ? r.font as TextFont : 'sans',
    ...(r.bold === true ? { bold: true } : {}),
    ...(r.italic === true ? { italic: true } : {}),
    ...(r.align === 'center' || r.align === 'right' ? { align: r.align } : {}),
  };
}

/** Bring a device's changes into a stored file, newest edit of each record winning. */
export function mergeChanges<T extends Synced>(file: RecordFile<T>, changes: unknown[], clean: (raw: unknown, now: number) => T | null, now: number) {
  const accepted: T[] = [];
  for (const raw of changes) {
    const record = clean(raw, now);
    if (!record) continue;
    const held = file.items[record.id];
    if (held && held.updatedAt >= record.updatedAt) continue;
    file.seq += 1;
    const stored = { ...record, seq: file.seq };
    file.items[record.id] = stored;
    accepted.push(stored);
  }
  return accepted;
}

/** What a device that's seen everything up to `cursor` hasn't seen yet. */
export const recordsSince = <T extends Synced>(file: RecordFile<T>, cursor: number) => Object.values(file.items).filter((record) => (record.seq ?? 0) > cursor);

export const FILE_KINDS = ['pdf', 'jpeg', 'png', 'audio'] as const;
export type FileKind = (typeof FILE_KINDS)[number];

/** What the first bytes of a stored file say it is, or null for anything the notes don't keep. */
export function sniffFile(head: Uint8Array): FileKind | null {
  if (head.length < 12) return null;
  const ascii = (from: number, to: number) => String.fromCharCode(...head.subarray(from, to));
  if (String.fromCharCode(...head.subarray(0, Math.min(1024, head.length))).includes('%PDF-')) return 'pdf';
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'jpeg';
  if (head[0] === 0x89 && ascii(1, 4) === 'PNG') return 'png';
  // Safari records MP4, Chrome and Firefox WebM or Ogg.
  if (ascii(4, 8) === 'ftyp' || ascii(0, 4) === 'OggS' || (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3)) return 'audio';
  return null;
}

/** The order that puts a page right after `before` and ahead of `after`. */
export function orderBetween(before: number | undefined, after: number | undefined) {
  if (before === undefined && after === undefined) return 1000;
  if (before === undefined) return (after as number) - 1000;
  if (after === undefined) return before + 1000;
  return (before + after) / 2;
}

/** How a folder sits inside its parents, for the breadcrumb. A loop from two devices' moves just stops. */
export function folderPath(folders: Folder[], id: string | undefined) {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const path: Folder[] = [];
  const seen = new Set<string>();
  let at = id ? byId.get(id) : undefined;
  while (at && !seen.has(at.id)) {
    seen.add(at.id);
    path.unshift(at);
    at = at.parent ? byId.get(at.parent) : undefined;
  }
  return path;
}

/** Whether moving `folder` into `target` would put it inside itself. */
export function wouldNest(folders: Folder[], folder: string, target: string | undefined) {
  return folderPath(folders, target).some((f) => f.id === folder);
}

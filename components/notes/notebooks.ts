'use client';

import { findInText } from '@/lib/notes/search';
import { orderBetween, type InkText, type MarkElement, type Folder, type Notebook, type PageElement, type PageRecord, type TemplateId } from '@/lib/notes/items';
import {
  forgetNotebook, getElements, getFile, getKv, getNotebookElements, getNotebookMarks, kvValues, getNotebookText, getThumb, listBook, listLibrary, livePages, pdfTextKey, putBook, putElements, putKv, putLibrary, putThumb,
  type StoredBook, type StoredElement, type StoredLibrary,
} from './db';
import { newId, tombstone } from './doc';
import { Assets, loadPdfEngine, renderPage } from './paper';
import { keepNewFile, newFileId, scheduleSync } from './sync';

// The things you do to whole notebooks and folders. All of them work with no connection: a
// change goes in this device's database, marked to go up, and the server hears about it later.

/** How long something stays in the trash before it's gone for good. */
const TRASH_DAYS = 30;

export const COVER_COLORS = ['#2f4f8f', '#7c3f58', '#2c6e5a', '#b4632a', '#5b4a9e', '#3d4450', '#a33a3a', '#1f7a8c'];

export type NewNotebook = { title: string; folder?: string; cover?: string; template: TemplateId; paper: string; w: number; h: number };

async function saveLibrary(record: StoredLibrary) {
  await putLibrary([{ ...record, dirty: true }]);
  scheduleSync(800);
}

export async function createNotebook(details: NewNotebook) {
  const now = Date.now();
  const id = newId();
  const { title, folder, cover, template, paper, w, h } = details;
  await putLibrary([{
    id, kind: 'notebook', title: title.trim() || 'Untitled', createdAt: now, updatedAt: now, editedAt: now, template, paper, size: { w, h }, dirty: true,
    ...(folder ? { folder } : {}), ...(cover ? { cover } : {}),
  }]);
  const page: StoredBook = { id: newId(), kind: 'page', notebook: id, order: 1000, w, h, template, paper, createdAt: now, updatedAt: now, dirty: true };
  await putBook([page]);
  scheduleSync(800);
  return id;
}

/** Pages in a PDF, each one a page you can write on. Answers how many went in. */
async function pdfPages(notebook: string, file: string, blob: Blob, startOrder: number, step: number, now: number) {
  const engine = await loadPdfEngine();
  const doc = await engine.loadDocument(blob);
  try {
    const pages: StoredBook[] = [];
    for (let i = 0; i < doc.numPages; i++) {
      const { width, height } = (await doc.getPage(i + 1)).getViewport({ scale: 1 });
      pages.push({
        id: newId(), kind: 'page', notebook, order: startOrder + i * step, w: Math.max(72, width), h: Math.max(72, height),
        template: 'blank', paper: '#ffffff', pdf: { file, page: i }, createdAt: now, updatedAt: now, dirty: true,
      });
    }
    await putBook(pages);
    return pages;
  } finally {
    void doc.loadingTask.destroy();
  }
}

const titleFromFile = (name: string) => name.replace(/\.[^.]+$/, '').replace(/_+/g, ' ').replace(/\s+/g, ' ').trim() || 'Untitled';

/** A PDF as a new notebook. */
export async function importPdfNotebook(file: File, folder?: string) {
  const now = Date.now();
  const id = newId();
  await putLibrary([{ id, kind: 'notebook', title: titleFromFile(file.name), createdAt: now, updatedAt: now, editedAt: now, dirty: true, ...(folder ? { folder } : {}) }]);
  const fileId = newFileId();
  try {
    const blob = file.slice(0, file.size, 'application/pdf');
    await pdfPages(id, fileId, blob, 1000, 1000, now);
    await keepNewFile(id, fileId, blob);
    void indexPdfText(id, fileId);
  } catch (error) {
    await forgetNotebook(id);
    await putLibrary([{ ...tombstone({ id, kind: 'notebook', createdAt: now }), dirty: true } as StoredLibrary]);
    throw error;
  }
  return id;
}

/** A PDF's pages, added to a notebook after a page of it. */
export async function addPdfToNotebook(notebook: string, file: File, after: { order: number; next?: number }) {
  const fileId = newFileId();
  const blob = file.slice(0, file.size, 'application/pdf');
  const now = Date.now();
  const engine = await loadPdfEngine();
  const doc = await engine.loadDocument(blob);
  const count = doc.numPages;
  void doc.loadingTask.destroy();
  const end = after.next ?? after.order + 1000 * (count + 1);
  const step = (end - after.order) / (count + 1);
  const pages = await pdfPages(notebook, fileId, blob, after.order + step, step, now);
  await keepNewFile(notebook, fileId, blob);
  void indexPdfText(notebook, fileId);
  return pages;
}

const MAX_PICTURE_SIDE = 2400;

/**
 * A picture ready to keep: no bigger than it needs to be, and turned the right way up, so a
 * 12 MP photo doesn't take 12 MP of room. Only JPEG and PNG go on, so nothing strange is ever stored.
 */
export async function preparePicture(file: Blob) {
  const bitmap = await createImageBitmap(file);
  const shrink = Math.min(1, MAX_PICTURE_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * shrink);
  canvas.height = Math.round(bitmap.height * shrink);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const keepAlpha = file.type === 'image/png' || file.type === 'image/gif' || file.type === 'image/webp';
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, keepAlpha ? 'image/png' : 'image/jpeg', 0.86));
  if (!blob) throw new Error('That picture wouldn’t open.');
  return { blob, width: canvas.width, height: canvas.height };
}

/** A picture as a new notebook, on a page the shape of the picture. */
export async function importPictureNotebook(file: File, folder?: string) {
  const { blob, width, height } = await preparePicture(file);
  const now = Date.now();
  const id = newId();
  const scale = Math.min(1, 792 / Math.max(width, height));
  const w = Math.max(72, width * scale);
  const h = Math.max(72, height * scale);
  await putLibrary([{ id, kind: 'notebook', title: titleFromFile(file.name), createdAt: now, updatedAt: now, editedAt: now, dirty: true, ...(folder ? { folder } : {}) }]);
  const page: StoredBook = { id: newId(), kind: 'page', notebook: id, order: 1000, w, h, template: 'blank', paper: '#ffffff', createdAt: now, updatedAt: now, dirty: true };
  await putBook([page]);
  const fileId = newFileId();
  await keepNewFile(id, fileId, blob);
  await putElements([{ id: newId(), kind: 'image', x: 0, y: 0, w, h, rot: 0, file: fileId, createdAt: now, updatedAt: now, notebook: id, page: page.id, dirty: true }]);
  return id;
}

export async function updateNotebook(notebook: Notebook, changes: Partial<Notebook>) {
  await saveLibrary({ ...notebook, ...changes, updatedAt: Date.now() });
}

export async function trashNotebook(notebook: Notebook) {
  await updateNotebook(notebook, { trashedAt: Date.now() });
}

export async function restoreNotebook(notebook: Notebook) {
  const { trashedAt: _trashedAt, ...rest } = notebook;
  await saveLibrary({ ...rest, updatedAt: Date.now() });
}

/** Gone for good, here and everywhere. */
export async function deleteNotebookForever(notebook: Notebook) {
  await saveLibrary(tombstone(notebook) as StoredLibrary);
  await forgetNotebook(notebook.id);
}

/** Anything in the trash long enough. */
export async function emptyOldTrash(notebooks: Notebook[]) {
  const limit = Date.now() - TRASH_DAYS * 86_400_000;
  for (const notebook of notebooks) {
    if (notebook.trashedAt && notebook.trashedAt < limit) await deleteNotebookForever(notebook);
  }
}

/** A complete copy, with everything new, so it goes its own way from here. Files are copied too, since a notebook's files go with it. */
export async function duplicateNotebook(notebook: Notebook) {
  const now = Date.now();
  const id = newId();
  const { seq: _seq, trashedAt: _trashedAt, starred: _starred, ...rest } = notebook;
  const fileMap = new Map<string, string>();
  const copyFile = async (file: string) => {
    let copy = fileMap.get(file);
    if (copy) return copy;
    copy = newFileId();
    fileMap.set(file, copy);
    const blob = await getFile(notebook.id, file);
    if (blob) await keepNewFile(id, copy, blob);
    return copy;
  };
  await putLibrary([{ ...rest, id, title: `${notebook.title} copy`, createdAt: now, updatedAt: now, editedAt: now, dirty: true }]);
  const pageMap = new Map<string, string>();
  const book: StoredBook[] = [];
  for (const record of await listBook(notebook.id)) {
    if (record.deleted) continue;
    const { seq: _recordSeq, ...fields } = record;
    if (fields.kind === 'page') {
      const newPage = newId();
      pageMap.set(fields.id, newPage);
      book.push({ ...fields, id: newPage, notebook: id, createdAt: now, updatedAt: now, dirty: true, ...(fields.pdf ? { pdf: { ...fields.pdf, file: await copyFile(fields.pdf.file) } } : {}) });
    } else {
      book.push({ ...fields, id: newId(), notebook: id, file: await copyFile(fields.file), createdAt: now, updatedAt: now, dirty: true });
    }
  }
  await putBook(book);
  const elements: StoredElement[] = [];
  for (const element of await getNotebookElements(notebook.id)) {
    const page = pageMap.get(element.page);
    if (!page || element.deleted) continue;
    const { seq: _elementSeq, ...fields } = element;
    elements.push({ ...fields, id: newId(), notebook: id, page, updatedAt: now, dirty: true, ...(fields.kind === 'image' ? { file: await copyFile(fields.file) } : {}) } as StoredElement);
  }
  if (elements.length) await putElements(elements);
  scheduleSync(800);
  return id;
}

/** A page copied onto the end of another notebook. Its files go too. */
export async function copyPageToNotebook(source: string, page: PageRecord, target: string) {
  const now = Date.now();
  const existing = livePages(await listBook(target));
  const { seq: _seq, ...fields } = page;
  const pageId = newId();
  const copyFile = async (file: string) => {
    const copy = newFileId();
    const blob = await getFile(source, file);
    if (blob) await keepNewFile(target, copy, blob);
    return copy;
  };
  await putBook([{
    ...fields, id: pageId, notebook: target, order: orderBetween(existing[existing.length - 1]?.order, undefined), createdAt: now, updatedAt: now, dirty: true,
    ...(fields.pdf ? { pdf: { ...fields.pdf, file: await copyFile(fields.pdf.file) } } : {}),
  } as StoredBook]);
  const elements: StoredElement[] = [];
  for (const element of await getElements(page.id)) {
    if (element.deleted) continue;
    const { seq: _elementSeq, ...rest } = element;
    elements.push({ ...rest, id: newId(), notebook: target, page: pageId, updatedAt: now, dirty: true, ...(rest.kind === 'image' ? { file: await copyFile(rest.file) } : {}) } as StoredElement);
  }
  if (elements.length) await putElements(elements);
  scheduleSync(800);
}

/** Pictures from another notebook have to come along when they're pasted here. */
export async function bringFilesAcross(elements: PageElement[], from: string, to: string) {
  if (from === to) return elements;
  const copies = new Map<string, string>();
  const out: PageElement[] = [];
  for (const element of elements) {
    if (element.kind !== 'image') { out.push(element); continue; }
    let copy = copies.get(element.file);
    if (!copy) {
      copy = newFileId();
      copies.set(element.file, copy);
      const blob = await getFile(from, element.file);
      if (blob) await keepNewFile(to, copy, blob);
    }
    out.push({ ...element, file: copy });
  }
  return out;
}

export async function createFolder(name: string, parent?: string) {
  const now = Date.now();
  const folder: Folder = { id: newId(), kind: 'folder', name: name.trim() || 'New folder', createdAt: now, updatedAt: now, ...(parent ? { parent } : {}) };
  await saveLibrary(folder);
  return folder;
}

export const renameFolder = (folder: Folder, name: string) => saveLibrary({ ...folder, name: name.trim() || folder.name, updatedAt: Date.now() });

export async function moveFolder(folder: Folder, parent?: string) {
  const { parent: _old, ...rest } = folder;
  await saveLibrary({ ...rest, updatedAt: Date.now(), ...(parent ? { parent } : {}) });
}

export async function moveNotebook(notebook: Notebook, folder?: string) {
  const { folder: _old, ...rest } = notebook;
  await saveLibrary({ ...rest, updatedAt: Date.now(), ...(folder ? { folder } : {}) });
}

/** The folder goes. What's in it moves up one level. */
export async function deleteFolder(folder: Folder) {
  const now = Date.now();
  const changes: StoredLibrary[] = [{ ...tombstone(folder, now), dirty: true } as StoredLibrary];
  for (const record of await listLibrary()) {
    if (record.deleted) continue;
    if (record.kind === 'notebook' && record.folder === folder.id) {
      const { folder: _old, ...rest } = record;
      changes.push({ ...rest, updatedAt: now, dirty: true, ...(folder.parent ? { folder: folder.parent } : {}) });
    }
    if (record.kind === 'folder' && record.parent === folder.id) {
      const { parent: _old, ...rest } = record;
      changes.push({ ...rest, updatedAt: now, dirty: true, ...(folder.parent ? { parent: folder.parent } : {}) });
    }
  }
  await putLibrary(changes);
  scheduleSync(800);
}

// ── Pictures of first pages ──────────────────────────────────────────────────────

const THUMB_WIDTH = 320;
let thumbQueue: Promise<unknown> = Promise.resolve();

/** The first page as a small picture. Made at most once per edit, one at a time. */
export function notebookThumb(notebook: Notebook): Promise<Blob | null> {
  const stamp = Math.max(notebook.editedAt ?? 0, notebook.updatedAt);
  const run = thumbQueue.then(async () => {
    const held = await getThumb(notebook.id);
    if (held && held.stamp >= stamp) return held.blob;
    const [page] = livePages(await listBook(notebook.id));
    if (!page) return held?.blob ?? null;
    const elements = (await getElements(page.id)).filter((element) => !element.deleted);
    const assets = new Assets(notebook.id, () => {});
    try {
      const canvas = document.createElement('canvas');
      await renderPage(canvas, page, elements, assets, THUMB_WIDTH / page.w);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8));
      if (blob) await putThumb(notebook.id, blob, stamp).catch(() => {});
      return blob;
    } finally {
      assets.destroy();
    }
  }).catch(() => null);
  thumbQueue = run;
  return run;
}

// ── Finding things ───────────────────────────────────────────────────────────────

export type SearchHit = {
  notebook: string; title: string; page: string | null; pageNumber: number;
  where: 'title' | 'page' | 'text' | 'pdf' | 'ink' | 'mark' | 'tag';
  snippet: string;
  /** Where on the page, to point it out when you get there. */
  box?: { x: number; y: number; w: number; h: number };
};

function snippetAround(text: string, at: number, length: number) {
  const start = Math.max(0, at - 40);
  const end = Math.min(text.length, at + length + 60);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${end < text.length ? '…' : ''}`;
}

async function indexPdfText(notebook: string, file: string) {
  const key = pdfTextKey(notebook, file);
  if (await getKv(key)) return;
  const assets = new Assets(notebook, () => {});
  try {
    const pages = await assets.pdfText(file);
    if (pages) await putKv(key, pages);
  } catch { /* Can't be read as text: it just won't be found by searching. */ } finally {
    assets.destroy();
  }
}

/** Search one notebook: its page titles, its typed text and the words of any PDFs in it. Handwriting can't be read. */
export async function searchNotebook(notebook: string, title: string, query: string, limit = 60) {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const hits: SearchHit[] = [];
  const pages = livePages(await listBook(notebook));
  const number = new Map(pages.map((page, i) => [page.id, i + 1]));
  for (const page of pages) {
    const at = page.title?.toLowerCase().indexOf(needle) ?? -1;
    if (at >= 0) hits.push({ notebook, title, page: page.id, pageNumber: number.get(page.id)!, where: 'page', snippet: page.title! });
  }
  for (const page of pages) {
    const tag = page.tags?.find((t) => t.toLowerCase().includes(needle.replace(/^#/, '')));
    if (tag) hits.push({ notebook, title, page: page.id, pageNumber: number.get(page.id)!, where: 'tag', snippet: `#${tag}` });
  }
  for (const element of await getNotebookText(notebook)) {
    if (element.kind !== 'text' || element.deleted || !number.has(element.page)) continue;
    const at = element.text.toLowerCase().indexOf(needle);
    if (at >= 0) hits.push({ notebook, title, page: element.page, pageNumber: number.get(element.page)!, where: 'text', snippet: snippetAround(element.text, at, needle.length), box: element });
  }
  for (const element of await getNotebookMarks(notebook)) {
    if (element.kind !== 'mark' || element.deleted || !number.has(element.page)) continue;
    if (element.label.toLowerCase().includes(needle)) hits.push({ notebook, title, page: element.page, pageNumber: number.get(element.page)!, where: 'mark', snippet: element.label, box: element });
  }
  // What the server read in the handwriting, a line at a time, so the line can be pointed to.
  for (const record of await kvValues<InkText>(`inktext:${notebook}:`)) {
    if (!number.has(record.page)) continue;
    for (const line of record.lines) {
      const found = findInText(line.text, query, true);
      if (found) {
        hits.push({ notebook, title, page: record.page, pageNumber: number.get(record.page)!, where: 'ink', snippet: snippetAround(line.text, found[0], found[1]), box: line.box });
        break;
      }
    }
  }
  const files = new Set(pages.flatMap((page) => (page.pdf ? [page.pdf.file] : [])));
  for (const file of files) {
    await indexPdfText(notebook, file);
    const text = await getKv<string[]>(pdfTextKey(notebook, file));
    if (!text) continue;
    for (const page of pages) {
      if (page.pdf?.file !== file) continue;
      const words = text[page.pdf.page] ?? '';
      const at = words.toLowerCase().indexOf(needle);
      if (at >= 0) hits.push({ notebook, title, page: page.id, pageNumber: number.get(page.id)!, where: 'pdf', snippet: snippetAround(words, at, needle.length) });
      if (hits.length >= limit) break;
    }
  }
  return hits.sort((a, b) => a.pageNumber - b.pageNumber).slice(0, limit);
}

/** Search every notebook, a notebook at a time, handing over results as they turn up. */
export async function searchEverything(query: string, onHits: (hits: SearchHit[]) => void, stillWanted: () => boolean) {
  const needle = query.trim().toLowerCase();
  const notebooks = (await listLibrary()).filter((record): record is Notebook & StoredLibrary => record.kind === 'notebook' && !record.deleted && !record.trashedAt);
  const titled = notebooks.filter((notebook) => notebook.title.toLowerCase().includes(needle));
  if (titled.length) onHits(titled.map((notebook) => ({ notebook: notebook.id, title: notebook.title, page: null, pageNumber: 1, where: 'title', snippet: '' })));
  for (const notebook of notebooks) {
    if (!stillWanted()) return;
    const hits = await searchNotebook(notebook.id, notebook.title, query, 12);
    if (hits.length && stillWanted()) onHits(hits);
  }
}

// ── Tags, links and the outline ─────────────────────────────────────────────────

export type PagePlace = { notebook: string; title: string; page: string; pageNumber: number; label?: string };

const liveNotebooks = async () => (await listLibrary()).filter((record): record is Notebook & StoredLibrary => record.kind === 'notebook' && !record.deleted && !record.trashedAt);

/** Every tag, on pages or lassoed as a keyword, with where each one is. */
export async function allTags() {
  const tags = new Map<string, { name: string; places: PagePlace[] }>();
  const add = (name: string, place: PagePlace) => {
    const key = name.toLowerCase();
    const held = tags.get(key) ?? { name, places: [] };
    if (!held.places.some((p) => p.page === place.page)) held.places.push(place);
    tags.set(key, held);
  };
  for (const notebook of await liveNotebooks()) {
    const pages = livePages(await listBook(notebook.id));
    const number = new Map(pages.map((page, i) => [page.id, i + 1]));
    for (const page of pages) {
      for (const tag of page.tags ?? []) add(tag, { notebook: notebook.id, title: notebook.title, page: page.id, pageNumber: number.get(page.id)!, label: page.title });
    }
    for (const mark of await getNotebookMarks(notebook.id)) {
      if (mark.kind === 'mark' && mark.role === 'keyword' && !mark.deleted && number.has(mark.page)) {
        add(mark.label, { notebook: notebook.id, title: notebook.title, page: mark.page, pageNumber: number.get(mark.page)! });
      }
    }
  }
  return [...tags.values()].sort((a, b) => b.places.length - a.places.length || a.name.localeCompare(b.name));
}

/** The links, in any notebook, that come to this page, or to this notebook as a whole if it's the first page. */
export async function linksTo(notebook: string, page: string, isFirst: boolean) {
  const out: (PagePlace & { label: string })[] = [];
  for (const source of await liveNotebooks()) {
    const pages = livePages(await listBook(source.id));
    const number = new Map(pages.map((p, i) => [p.id, i + 1]));
    for (const mark of await getNotebookMarks(source.id)) {
      if (mark.kind !== 'mark' || mark.role !== 'link' || mark.deleted || !mark.target || 'url' in mark.target || !number.has(mark.page)) continue;
      const target = mark.target;
      if (target.notebook !== notebook || (target.page ? target.page !== page : !isFirst)) continue;
      out.push({ notebook: source.id, title: source.title, page: mark.page, pageNumber: number.get(mark.page)!, label: mark.label });
    }
  }
  return out;
}

/** A notebook's headings and page titles, in order: its table of contents. */
export async function notebookOutline(notebook: string) {
  const pages = livePages(await listBook(notebook));
  const number = new Map(pages.map((page, i) => [page.id, i + 1]));
  const entries: { page: string; pageNumber: number; label: string; level: number; box?: MarkElement }[] = [];
  for (const page of pages) if (page.title) entries.push({ page: page.id, pageNumber: number.get(page.id)!, label: page.title, level: 0 });
  for (const mark of await getNotebookMarks(notebook)) {
    if (mark.kind === 'mark' && mark.role === 'heading' && !mark.deleted && number.has(mark.page)) {
      entries.push({ page: mark.page, pageNumber: number.get(mark.page)!, label: mark.label || 'Heading', level: mark.level ?? 1, box: mark });
    }
  }
  return entries.sort((a, b) => a.pageNumber - b.pageNumber || a.level - b.level || (a.box?.y ?? 0) - (b.box?.y ?? 0));
}

/** Pages to link to: every page of a notebook, with its title and first heading to know it by. */
export async function pagesToLinkTo(notebook: string) {
  const pages = livePages(await listBook(notebook));
  const headings = new Map<string, string>();
  for (const mark of await getNotebookMarks(notebook)) {
    if (mark.kind === 'mark' && mark.role === 'heading' && !mark.deleted && !headings.has(mark.page)) headings.set(mark.page, mark.label);
  }
  return pages.map((page, i) => ({ id: page.id, number: i + 1, label: page.title ?? headings.get(page.id) ?? '' }));
}

export { liveNotebooks };

/** Read some handwriting now, on the server. */
export async function readInk(strokes: { id: string; p: number[]; width: number }[]) {
  const res = await fetch('/api/notes/read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ strokes }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.success) throw new Error(body.message || 'That couldn’t be read.');
  return body.text as string;
}

export const isNotebook = (record: StoredLibrary): record is Notebook & StoredLibrary => record.kind === 'notebook' && !record.deleted;
export const isFolder = (record: StoredLibrary): record is Folder & StoredLibrary => record.kind === 'folder' && !record.deleted;

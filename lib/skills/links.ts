// Skills' ties to the Reader and to Notes, done on the server so every device
// sees the same thing:
// - a resource linked to a Reader book takes its status and progress from your
//   reading (started is in progress, finished is done, and the pages so far);
// - topics have Notes pages, new ones made here in a "Skills" notebook;
// - your notes (typed and handwritten notes in linked books, the text and
//   recordings on a topic's pages) can go into the question prompt.

import crypto from 'crypto';
import path from 'path';
import { readJson } from '@/lib/json-store';
import { localDayOf } from '@/lib/habits/dates';
import { orderBetween, type Notebook, type PageElement, type PageRecord, type RecordingRecord } from '@/lib/notes/items';
import { readBookItems, readInkText, readLibrary as readNotesLibrary, readPageElements, syncBook, syncLibrary, syncPage, transcriptsPath } from '@/lib/notes/store';
import type { Transcript } from '@/lib/notes/transcripts';
import { compareAnchors, readingState, type NotesFile } from '@/lib/reader/items';
import { notesFolder as readerNotesFolder, readLibrary as readReaderLibrary, readProgressFile } from '@/lib/reader/store';
import { asDailyQuestion } from './edit';
import { readSkills, updateSkills } from './store';
import type { NotesPageRef, SkillsData, Subject, Topic } from './types';

const newId = () => crypto.randomBytes(12).toString('hex');

// ── Reader ───────────────────────────────────────────────────────────────────

/**
 * Bring linked resources up to date with the Reader. Never takes a resource
 * back (finishing it here stays finished), and leaves dropped ones alone.
 * Returns whether anything changed, so the caller only writes when it must.
 */
export async function syncReaderResources(userId: string, data: SkillsData) {
  const linked = data.subjects.flatMap((s) => s.resources.filter((r) => r.readerBookId && r.status !== 'dropped'));
  if (!linked.length) return false;
  const progress = await readProgressFile(userId).catch(() => ({}) as Awaited<ReturnType<typeof readProgressFile>>);
  let changed = false;
  for (const r of linked) {
    const p = progress[r.readerBookId!];
    const state = readingState(p);
    if (!p || state === 'new') continue;
    const day = (ms?: number) => (ms ? localDayOf(new Date(ms).toISOString()) ?? undefined : undefined);
    if (p.total && p.total > 0) {
      const done = state === 'finished' ? p.total : Math.min(p.total, Math.max(0, Math.round(p.pct * p.total)));
      if (r.progress?.done !== done || r.progress?.total !== p.total || r.progress?.unit !== 'pages') {
        r.progress = { done, total: p.total, unit: 'pages' };
        changed = true;
      }
    }
    if (state === 'finished' && r.status !== 'done') {
      r.status = 'done';
      r.finishedOn = day(p.finishedAt) ?? day(p.at);
      r.startedOn ??= day(p.startedAt) ?? r.finishedOn;
      changed = true;
    } else if (state === 'reading' && r.status === 'planned') {
      r.status = 'doing';
      r.startedOn = day(p.startedAt) ?? day(p.at);
      changed = true;
    }
  }
  return changed;
}

/** The Reader's books, for linking one to a resource. */
export async function readerShelf(userId: string) {
  const [library, progress] = await Promise.all([readReaderLibrary(userId), readProgressFile(userId)]);
  return library.books.map((b) => ({ id: b.id, title: b.title, author: b.author, state: readingState(progress[b.id]), pct: progress[b.id]?.pct ?? 0 }));
}

// ── Notes ────────────────────────────────────────────────────────────────────

const NOTEBOOK_TITLE = 'Skills';
const PAGE = { w: 612, h: 792 };

/** The Skills notebook in Notes, made the first time it's needed (or again if it was thrown away). */
export async function skillsNotebook(userId: string, data: SkillsData) {
  const library = await readNotesLibrary(userId);
  const held = data.notesNotebook ? library.items[data.notesNotebook] : undefined;
  if (held?.kind === 'notebook' && !held.deleted && !held.trashedAt) return held.id;
  const now = Date.now();
  const notebook: Notebook = { id: newId(), kind: 'notebook', title: NOTEBOOK_TITLE, cover: '#3987e5', template: 'ruled', paper: '#ffffff', size: PAGE, createdAt: now, updatedAt: now, editedAt: now };
  await syncLibrary(userId, Number.MAX_SAFE_INTEGER, [notebook], now);
  data.notesNotebook = notebook.id;
  return notebook.id;
}

async function livePages(userId: string, notebook: string) {
  return (await readBookItems(userId, notebook))
    .filter((item): item is PageRecord => item.kind === 'page')
    .sort((a, b) => a.order - b.order);
}

/**
 * A new page for a topic: its name and what it covers at the top, and a link
 * back to the subject. Added to the end of the Skills notebook.
 */
export async function newTopicPage(userId: string, notebook: string, subject: Subject, topic: Topic, origin: string): Promise<NotesPageRef> {
  const now = Date.now();
  const pages = await livePages(userId, notebook);
  const title = `${subject.name}: ${topic.name}`;
  const page: PageRecord = { id: newId(), kind: 'page', order: orderBetween(pages[pages.length - 1]?.order, undefined), ...PAGE, template: 'ruled', paper: '#ffffff', title, createdAt: now, updatedAt: now };
  await syncBook(userId, notebook, Number.MAX_SAFE_INTEGER, [page], now);
  const margin = 48;
  const heading = { id: newId(), kind: 'text', x: margin, y: margin, w: PAGE.w - 2 * margin, h: 30, rot: 0, text: title, size: 22, color: '#1d1d1f', font: 'sans', bold: true, createdAt: now, updatedAt: now };
  const back = { id: newId(), kind: 'text', x: margin, y: margin + 34, w: 260, h: 16, rot: 0, text: `Open ${subject.name} in Skills ↗`, size: 11, color: '#1f6fd1', font: 'sans', createdAt: now, updatedAt: now };
  const link = { id: newId(), kind: 'mark', role: 'link', x: back.x, y: back.y, w: back.w, h: back.h, rot: 0, label: subject.name, target: { url: `${origin}/skills/${subject.id}?tab=topics` }, createdAt: now, updatedAt: now };
  const about = topic.description
    ? [{ id: newId(), kind: 'text', x: margin, y: margin + 58, w: PAGE.w - 2 * margin, h: 32, rot: 0, text: topic.description, size: 12, color: '#555555', font: 'sans', createdAt: now, updatedAt: now }]
    : [];
  await syncPage(userId, notebook, page.id, Number.MAX_SAFE_INTEGER, [heading, back, link, ...about], now);
  return { notebook, page: page.id };
}

/** A graded Skills question, shaped for a Notes question sheet, and the notebook its working goes in. */
export async function skillQuestionForNotes(userId: string, itemId: string) {
  const data = await readSkills(userId);
  for (const subject of data.subjects) {
    const item = subject.items.find((i) => i.id === itemId);
    if (!item || item.kind !== 'graded') continue;
    const topic = subject.topics.find((t) => t.id === item.topicId)?.name ?? subject.name;
    const notebook = await updateSkills(userId, (fresh) => skillsNotebook(userId, fresh));
    return { question: asDailyQuestion(item.question, topic), notebook, href: `/skills/review?item=${item.id}` };
  }
  return null;
}

export type NotesPageView = NotesPageRef & { label: string; href: string };

/** Every notebook's pages, for tying one to a topic. */
export async function notesPageChoices(userId: string) {
  const library = await readNotesLibrary(userId);
  const notebooks = Object.values(library.items).filter((r): r is Notebook => r.kind === 'notebook' && !r.deleted && !r.trashedAt);
  const out = [];
  for (const nb of notebooks.sort((a, b) => (b.editedAt ?? b.updatedAt) - (a.editedAt ?? a.updatedAt))) {
    const pages = await livePages(userId, nb.id).catch(() => []);
    out.push({ notebook: nb.id, title: nb.title, pages: pages.map((p, i) => ({ page: p.id, number: i + 1, ...(p.title ? { title: p.title } : {}) })) });
  }
  return out;
}

/** Labels and links for pages tied to topics; pages that have gone are left out. */
export async function describePages(userId: string, refs: NotesPageRef[]): Promise<NotesPageView[]> {
  if (!refs.length) return [];
  const library = await readNotesLibrary(userId);
  const byBook = new Map<string, PageRecord[]>();
  const out: NotesPageView[] = [];
  for (const ref of refs) {
    const nb = library.items[ref.notebook];
    if (nb?.kind !== 'notebook' || nb.deleted || nb.trashedAt) continue;
    if (!byBook.has(ref.notebook)) byBook.set(ref.notebook, await livePages(userId, ref.notebook).catch(() => []));
    const pages = byBook.get(ref.notebook)!;
    const i = pages.findIndex((p) => p.id === ref.page);
    if (i < 0) continue;
    out.push({ ...ref, label: pages[i].title ? `${pages[i].title} (${nb.title}, p. ${i + 1})` : `${nb.title}, page ${i + 1}`, href: `/notes?notebook=${encodeURIComponent(ref.notebook)}&page=${encodeURIComponent(ref.page)}` });
  }
  return out;
}

// ── Your notes, for the question prompt ──────────────────────────────────────

export type Material = { id: string; kind: 'book' | 'page'; label: string; text: string };

/** Most of one source, and of everything, that goes into a prompt. */
export const MATERIAL_CAP = { each: 12_000, total: 40_000 };

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}\n[…cut short]` : text);

/** Typed and handwritten notes in a Reader book, in book order, with page numbers. */
async function bookNotes(userId: string, bookId: string) {
  const file = await readJson<NotesFile>(path.join(readerNotesFolder(userId), `${bookId}.json`), { seq: 0, items: {} }).catch(() => ({ seq: 0, items: {} }) as NotesFile);
  return Object.values(file.items)
    .filter((i) => !i.deleted && (i.kind === 'note' || i.kind === 'sketch') && i.text?.trim())
    .sort((a, b) => compareAnchors(a.anchor, b.anchor))
    .map((i) => `p. ${i.anchor.page}${i.anchor.chapter ? ` (${i.anchor.chapter})` : ''}: ${i.text!.trim()}`)
    .join('\n');
}

/** A Notes page as text: typed boxes top to bottom, what was read in the handwriting, and the transcripts of recordings made on it. */
async function pageText(userId: string, ref: NotesPageRef) {
  const [elements, items] = await Promise.all([readPageElements(userId, ref.notebook, ref.page), readBookItems(userId, ref.notebook)]);
  const title = items.find((i) => i.id === ref.page && i.kind === 'page')?.title;
  // What newTopicPage wrote isn't your notes: its heading and the link back to Skills.
  const boilerplate = (text: string) => text === title || /^Open .+ in Skills ↗$/.test(text);
  const typed = elements.filter((e): e is Extract<PageElement, { kind: 'text' }> => e.kind === 'text' && !!e.text.trim() && !boilerplate(e.text.trim()))
    .sort((a, b) => a.y - b.y || a.x - b.x).map((e) => e.text.trim());
  const ink = (await readInkText(userId, ref.notebook, ref.page))?.text?.trim();
  const recordings = items.filter((r): r is RecordingRecord => r.kind === 'recording' && (r.page === ref.page || !!r.pages?.some((p) => p.page === ref.page)));
  const transcripts = recordings.length ? (await readJson<{ items: Record<string, Transcript> }>(transcriptsPath(userId, ref.notebook), { items: {} })).items : {};
  const heard = recordings.map((r) => {
    const t = transcripts[r.id];
    const said = t?.status === 'done' ? t.segments.map((s) => s.text.trim()).join(' ') : '';
    return said ? `Recording "${r.title}":\n${said}` : '';
  }).filter(Boolean);
  return [typed.join('\n'), ink ? `Handwritten:\n${ink}` : '', ...heard].filter(Boolean).join('\n\n');
}

/**
 * What you've written about these topics: notes in Reader books tied to them,
 * and their Notes pages. Each source is cut to MATERIAL_CAP.each.
 */
export async function materialFor(userId: string, subject: Subject, topicIds: string[]): Promise<Material[]> {
  const wanted = new Set(topicIds.length ? topicIds : subject.topics.map((t) => t.id));
  const out: Material[] = [];
  const books = subject.resources.filter((r) => r.readerBookId && r.topicIds.some((id) => wanted.has(id)));
  for (const r of books) {
    const text = await bookNotes(userId, r.readerBookId!).catch(() => '');
    if (text) out.push({ id: `book:${r.readerBookId}`, kind: 'book', label: `Your notes in ${r.title}`, text: clip(text, MATERIAL_CAP.each) });
  }
  const refs = subject.topics.filter((t) => wanted.has(t.id)).flatMap((t) => t.notePages ?? []);
  const seen = new Set<string>();
  const views = await describePages(userId, refs.filter((r) => !seen.has(r.page) && seen.add(r.page)));
  for (const v of views) {
    const text = await pageText(userId, v).catch(() => '');
    if (text) out.push({ id: `page:${v.page}`, kind: 'page', label: v.label, text: clip(text, MATERIAL_CAP.each) });
  }
  return out;
}

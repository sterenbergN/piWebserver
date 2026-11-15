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
import { compareAnchors, readingState, type BookMeta, type NotesFile, type Progress as ReaderProgress } from '@/lib/reader/items';
import { notesFolder as readerNotesFolder, readLibrary as readReaderLibrary, readProgressFile } from '@/lib/reader/store';
import { asDailyQuestion } from './edit';
import { inquiryConceptAlias } from './parse';
import { readSkills, updateSkills } from './store';
import { itemTitle, type KnowledgeInquiry, type NotesPageRef, type ProjectAttachment, type Resource, type SkillsData, type Subject, type Topic } from './types';

export { inquiryConceptAlias };

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
  const [progress, library] = await Promise.all([
    readProgressFile(userId).catch(() => ({}) as Awaited<ReturnType<typeof readProgressFile>>),
    readReaderLibrary(userId).catch(() => ({ books: [] as { id: string; format: string }[] })),
  ]);
  // Audio books count in minutes (their progress is in seconds); everything else in pages.
  const audio = new Set(library.books.filter((b) => b.format === 'audio').map((b) => b.id));
  let changed = false;
  for (const r of linked) {
    const p = progress[r.readerBookId!];
    const state = readingState(p);
    if (!p || state === 'new') continue;
    const day = (ms?: number) => (ms ? localDayOf(new Date(ms).toISOString()) ?? undefined : undefined);
    if (p.total && p.total > 0) {
      const minutes = audio.has(r.readerBookId!);
      const total = minutes ? Math.max(1, Math.round(p.total / 60)) : p.total;
      const unit = minutes ? 'minutes' : 'pages';
      const done = state === 'finished' ? total : Math.min(total, Math.max(0, Math.round(p.pct * total)));
      if (r.progress?.done !== done || r.progress?.total !== total || r.progress?.unit !== unit) {
        r.progress = { done, total, unit };
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
  return library.books.map((b) => ({ id: b.id, title: b.title, author: b.author, audio: b.format === 'audio', state: readingState(progress[b.id]), pct: progress[b.id]?.pct ?? 0 }));
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

// ── Knowledge Vault: Obsidian-like graph, wiki-links, tags & backlinks ───────

export type LinkableName = { name: string; kind: 'subject' | 'topic' | 'resource' | 'lookup'; detail?: string };

/** Everything a [[link]] can point at, for suggesting names as one is typed. */
export function linkableNames(data: SkillsData): LinkableName[] {
  const out: LinkableName[] = [];
  const seen = new Set<string>();
  const add = (name: string | undefined, kind: LinkableName['kind'], detail?: string) => {
    const clean = name?.trim().replace(/\s+/g, ' ');
    if (!clean || clean.length > 160) return;
    const key = `${kind}:${clean.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ name: clean, kind, ...(detail ? { detail } : {}) });
  };
  for (const s of data.subjects) {
    add(s.name, 'subject', s.area);
    for (const t of s.topics) add(t.name, 'topic', s.name);
    for (const r of s.resources) add(r.title, 'resource', s.name);
  }
  for (const q of data.inquiries ?? []) add(inquiryConceptAlias(q.question) || q.question, 'lookup', q.status === 'solved' ? 'answered' : 'to look up');
  return out;
}

export type KnowledgeNodeKind =
  | 'subject'
  | 'topic'
  | 'book'
  | 'paper'
  | 'project'
  | 'resource'
  | 'note'
  | 'reader'
  | 'question'
  | 'inquiry'
  | 'tag'
  /** A [[link]] to something that isn't written yet, as Obsidian shows it: there, and one tap from existing. */
  | 'missing';

export type KnowledgeEdgeKind =
  | 'subskill'
  | 'topic'
  | 'resource'
  | 'reader'
  | 'note-page'
  | 'wiki-link'
  | 'tag'
  | 'question'
  | 'inquiry'
  | 'project-log';

export type KnowledgeNode = {
  id: string;
  kind: KnowledgeNodeKind;
  label: string;
  subtitle?: string;
  subjectId?: string;
  topicId?: string;
  resourceId?: string;
  href?: string;
  url?: string;
  freePdfUrl?: string;
  youtubeAudioUrl?: string;
  status?: string;
  excerpt?: string;
  content?: string;
  tags: string[];
  wikiLinks: string[];
  attachments?: ProjectAttachment[];
  meta?: Record<string, string | number | boolean | undefined>;
};

export type KnowledgeEdge = {
  id: string;
  from: string;
  to: string;
  kind: KnowledgeEdgeKind;
  label?: string;
};

export type KnowledgeMaterialItem = {
  id: string;
  nodeId: string;
  sourceKind:
    | 'notes-page'
    | 'reader-notes'
    | 'topic-notes'
    | 'resource-takeaways'
    | 'project-log'
    | 'book'
    | 'paper'
    | 'article'
    | 'course'
    | 'video'
    | 'reader-book'
    | 'question'
    | 'card'
    | 'step'
    | 'activity'
    | 'project'
    | 'inquiry-open'
    | 'inquiry-solved';
  title: string;
  subtitle?: string;
  subjectId?: string;
  subjectName?: string;
  topicId?: string;
  topicName?: string;
  resourceId?: string;
  day?: string;
  status?: string;
  text?: string;
  href?: string;
  url?: string;
  freePdfUrl?: string;
  youtubeAudioUrl?: string;
  attachments?: ProjectAttachment[];
  tags: string[];
  wikiLinks: string[];
};

export type KnowledgeBacklink = {
  targetId: string;
  targetLabel: string;
  targetKind: KnowledgeNodeKind;
  sourceId: string;
  sourceLabel: string;
  sourceKind: KnowledgeNodeKind;
  edgeKind: KnowledgeEdgeKind;
  label?: string;
};

export type KnowledgeBundle = {
  scopeSubjectId?: string;
  ownKnowledge: KnowledgeMaterialItem[];
  sourceMaterials: KnowledgeMaterialItem[];
  qaAndActivities: KnowledgeMaterialItem[];
  inquiries: KnowledgeInquiry[];
  backlinks: Record<string, KnowledgeBacklink[]>;
};

export type KnowledgeGraph = {
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
};

const normKey = (v: string) => v.trim().replace(/\s+/g, ' ').toLowerCase();

/** Extract `[[Target]]` or `[[Target|Alias]]` wiki-links, deduplicated case-insensitively. */
export function extractWikiLinks(text: string): string[] {
  if (!text) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  const re = /\[\[([^[\]\r\n]+?)\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const rawTarget = m[1].split('|')[0].trim().replace(/\s+/g, ' ');
    if (!rawTarget || rawTarget.length > 160) continue;
    const key = rawTarget.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(rawTarget);
  }
  return out;
}

/** Extract `#tag-name` tokens outside URLs, hex colors, and LaTeX math blocks. */
export function extractTags(text: string): string[] {
  if (!text) return [];
  // Strip display/inline LaTeX, escaped hashes, and URLs/site paths containing fragments.
  const cleaned = text
    .replace(/\$\$[\s\S]*?\$\$/g, ' ')
    .replace(/\$(?!\s|\d+(?:[.,]\d+)?(?:\s|$))[^$\n]+?(?<!\s)\$/g, ' ')
    .replace(/\\\[[\s\S]*?\\\]/g, ' ')
    .replace(/\\\([\s\S]*?\\\)/g, ' ')
    .replace(/\\#/g, ' ')
    .replace(/https?:\/\/[^\s<>"')]+/gi, ' ')
    .replace(/(^|[\s(["'])\/[a-zA-Z0-9_./?=&%-]*#[^\s<>"')]+/g, '$1 ');

  const seen = new Set<string>();
  const out: string[] = [];
  const re = /(?:^|[\s(\[{,;:])#([a-zA-Z][a-zA-Z0-9_/-]{0,63})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) {
    const tag = m[1].replace(/[/_-]+$/, '').toLowerCase();
    if (!tag || !/^[a-z]/.test(tag)) continue;
    // Skip CSS hex colors such as #ffffff, #ff00aa, #fff while preserving real words like #cad / #fea.
    if (/^(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(tag)) continue;
    if (/^([a-f])\1\1$/i.test(tag)) continue;
    if (seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

function collectMeta(texts: (string | undefined)[], extraTags: string[] = []): { tags: string[]; wikiLinks: string[] } {
  const joined = texts.filter(Boolean).join('\n');
  const tagSet = new Set<string>();
  const tags: string[] = [];
  for (const t of [...extraTags.map((x) => x.trim().toLowerCase()).filter(Boolean), ...extractTags(joined)]) {
    if (!tagSet.has(t)) {
      tagSet.add(t);
      tags.push(t);
    }
  }
  const wikiLinks = extractWikiLinks(joined);
  return { tags, wikiLinks };
}

function nodeKindForResource(kind: Resource['kind']): KnowledgeNodeKind {
  if (kind === 'book') return 'book';
  if (kind === 'paper') return 'paper';
  if (kind === 'project') return 'project';
  return 'resource';
}

function sourceKindForMaterial(kind: Resource['kind']): KnowledgeMaterialItem['sourceKind'] {
  if (kind === 'book' || kind === 'paper' || kind === 'article' || kind === 'course' || kind === 'video' || kind === 'project' || kind === 'activity') {
    return kind;
  }
  return 'book';
}

type PageVaultDetail = {
  ref: NotesPageRef;
  label: string;
  pageTitle?: string;
  notebookTitle: string;
  href: string;
  text: string;
  tags: string[];
};

async function readVaultPageDetail(userId: string, ref: NotesPageRef, view: NotesPageView, notebookTitle: string): Promise<PageVaultDetail> {
  const [text, rawBookItems] = await Promise.all([
    pageText(userId, ref).catch(() => ''),
    readBookItems(userId, ref.notebook).catch(() => null),
  ]);
  const bookItems = rawBookItems ?? [];
  let pageRec: PageRecord | undefined;
  const summaries: string[] = [];
  for (const item of bookItems) {
    if (item.kind === 'page' && item.id === ref.page) {
      pageRec = item;
    } else if (
      item.kind === 'recording' &&
      !item.deleted &&
      (item.page === ref.page || !!item.pages?.some((p) => p.page === ref.page)) &&
      !!item.summary?.trim()
    ) {
      summaries.push(`Summary "${item.title}":\n${item.summary.trim()}`);
    }
  }
  const fullText = [text, ...summaries].filter(Boolean).join('\n\n');
  const pageTags = (pageRec?.tags ?? []).map((t) => t.replace(/^#/, '').trim().toLowerCase()).filter(Boolean);
  return {
    ref,
    label: view.label,
    pageTitle: pageRec?.title,
    notebookTitle,
    href: view.href,
    text: fullText,
    tags: pageTags,
  };
}

/**
 * Build an Obsidian-like Knowledge Graph (nodes + typed edges including resolved
 * `[[Wiki-links]]`, `#tags`, subskill hierarchy, resources, tied Notes pages,
 * Reader books, project logs, and Q&A items) plus the unified Vault `bundle`.
 */
export async function buildKnowledgeGraph(
  userId: string,
  data: SkillsData,
  subjectId?: string,
): Promise<KnowledgeGraph & { bundle: KnowledgeBundle }> {
  if (subjectId && !data.subjects.some((s) => s.id === subjectId)) {
    return {
      nodes: [],
      edges: [],
      bundle: { scopeSubjectId: subjectId, ownKnowledge: [], sourceMaterials: [], qaAndActivities: [], inquiries: [], backlinks: {} },
    };
  }

  // Load Reader & Notes libraries once per call.
  const [readerLib, readerProg, notesLib] = await Promise.all([
    readReaderLibrary(userId).catch(() => ({ books: [] as BookMeta[], folders: [], seqs: {} })),
    readProgressFile(userId).catch(() => ({} as Record<string, ReaderProgress>)),
    readNotesLibrary(userId).catch(() => null),
  ]);
  const readerBooksById = new Map(readerLib.books.map((b) => [b.id, b]));

  // Deduplicated unique Notes pages and Reader books across the account.
  const uniqueRefs = new Map<string, NotesPageRef>();
  const uniqueBookIds = new Set<string>();
  for (const s of data.subjects) {
    for (const t of s.topics) {
      for (const ref of t.notePages ?? []) {
        uniqueRefs.set(`${ref.notebook}:${ref.page}`, ref);
      }
    }
    for (const r of s.resources) {
      if (r.readerBookId) uniqueBookIds.add(r.readerBookId);
    }
  }

  const refList = [...uniqueRefs.values()];
  const pageViews = refList.length ? await describePages(userId, refList).catch(() => [] as NotesPageView[]) : [];
  const pageViewMap = new Map(pageViews.map((v) => [`${v.notebook}:${v.page}`, v]));

  const [pageDetailEntries, bookNotesEntries] = await Promise.all([
    Promise.all(
      pageViews.map(async (v) => {
        const nb = notesLib?.items[v.notebook];
        const nbTitle = nb?.kind === 'notebook' ? nb.title : 'Notes';
        return [`${v.notebook}:${v.page}`, await readVaultPageDetail(userId, v, v, nbTitle)] as const;
      }),
    ),
    Promise.all(
      [...uniqueBookIds].map(async (bookId) => {
        const text = await bookNotes(userId, bookId).catch(() => '');
        return [bookId, text] as const;
      }),
    ),
  ]);

  const pageDetailMap = new Map<string, PageVaultDetail>(pageDetailEntries);
  const bookNotesMap = new Map<string, string>(bookNotesEntries);

  const allNodes = new Map<string, KnowledgeNode>();
  const allEdges: KnowledgeEdge[] = [];
  const edgeKeys = new Set<string>();
  const addNode = (node: KnowledgeNode) => {
    if (!allNodes.has(node.id)) {
      allNodes.set(node.id, node);
    }
  };
  const addEdge = (from: string, to: string, kind: KnowledgeEdgeKind, label?: string) => {
    if (from === to) return;
    if (!allNodes.has(from) || !allNodes.has(to)) return;
    const key = `${from}|${to}|${kind}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    allEdges.push({ id: `e:${allEdges.length + 1}`, from, to, kind, ...(label ? { label } : {}) });
  };

  // Lookup indexes for [[Wiki-link]] resolution (priority: subject > topic > resource > note > reader).
  const globalLookup = new Map<string, { priority: number; nodeId: string }>();
  const subjectLookup = new Map<string, Map<string, { priority: number; nodeId: string }>>();
  const registerAlias = (alias: string | undefined, nodeId: string, priority: number, subId?: string) => {
    if (!alias) return;
    const k = normKey(alias);
    if (!k) return;
    const prevGlobal = globalLookup.get(k);
    if (!prevGlobal || priority < prevGlobal.priority) {
      globalLookup.set(k, { priority, nodeId });
    }
    if (subId) {
      let map = subjectLookup.get(subId);
      if (!map) {
        map = new Map();
        subjectLookup.set(subId, map);
      }
      const prevLocal = map.get(k);
      if (!prevLocal || priority < prevLocal.priority) {
        map.set(k, { priority, nodeId });
      }
    }
  };

  // Pass 1: create nodes across all subjects so cross-subject [[wiki-links]] and subskill edges resolve.
  for (const subject of data.subjects) {
    const subNodeId = `sub:${subject.id}`;
    const stepTexts = (subject.steps ?? []).flatMap((st) => [st.title, st.detail]);
    const subMeta = collectMeta([subject.goal, subject.background, subject.roadmap, ...stepTexts]);
    const subExcerpt = (subject.goal || subject.roadmap || '').trim().slice(0, 240) || undefined;
    const subContent = [subject.goal, subject.background, subject.roadmap].filter(Boolean).join('\n\n') || undefined;

    addNode({
      id: subNodeId,
      kind: 'subject',
      label: subject.name,
      subtitle: `${subject.icon} ${subject.area}`,
      subjectId: subject.id,
      href: `/skills/${subject.id}`,
      status: subject.status,
      excerpt: subExcerpt,
      content: subContent,
      tags: subMeta.tags,
      wikiLinks: subMeta.wikiLinks,
      meta: { area: subject.area, target: subject.target, icon: subject.icon },
    });
    registerAlias(subject.name, subNodeId, 1, subject.id);

    for (const topic of subject.topics) {
      const topNodeId = `top:${topic.id}`;
      const topMeta = collectMeta([topic.description, topic.notes]);
      addNode({
        id: topNodeId,
        kind: 'topic',
        label: topic.name,
        subtitle: subject.name,
        subjectId: subject.id,
        topicId: topic.id,
        href: `/skills/${subject.id}?tab=topics`,
        excerpt: (topic.notes || topic.description || '').trim().slice(0, 240) || undefined,
        content: [topic.description, topic.notes].filter(Boolean).join('\n\n') || undefined,
        tags: topMeta.tags,
        wikiLinks: topMeta.wikiLinks,
        meta: { stage: topic.stage, core: topic.core },
      });
      registerAlias(topic.name, topNodeId, 2, subject.id);
      registerAlias(`${subject.name}: ${topic.name}`, topNodeId, 2, subject.id);
      registerAlias(`${subject.name} / ${topic.name}`, topNodeId, 2, subject.id);

      for (const ref of topic.notePages ?? []) {
        const refKey = `${ref.notebook}:${ref.page}`;
        const view = pageViewMap.get(refKey);
        if (!view) continue;
        const detail = pageDetailMap.get(refKey);
        const noteNodeId = `note:${ref.notebook}:${ref.page}`;
        const pageMeta = collectMeta([detail?.pageTitle, detail?.text], detail?.tags ?? []);
        if (!allNodes.has(noteNodeId)) {
          addNode({
            id: noteNodeId,
            kind: 'note',
            label: detail?.pageTitle || view.label,
            subtitle: `${detail?.notebookTitle ?? 'Notes'} · ${topic.name}`,
            subjectId: subject.id,
            topicId: topic.id,
            href: view.href,
            excerpt: detail?.text.slice(0, 240) || undefined,
            content: detail?.text || undefined,
            tags: pageMeta.tags,
            wikiLinks: pageMeta.wikiLinks,
          });
        }
        registerAlias(view.label, noteNodeId, 4, subject.id);
        registerAlias(detail?.pageTitle, noteNodeId, 4, subject.id);
      }
    }

    for (const res of subject.resources) {
      const resNodeId = `res:${res.id}`;
      const resMeta = collectMeta([res.detail, res.takeaways]);
      addNode({
        id: resNodeId,
        kind: nodeKindForResource(res.kind),
        label: res.title,
        subtitle: res.author ? `${res.author} · ${subject.name}` : subject.name,
        subjectId: subject.id,
        resourceId: res.id,
        href: `/skills/${subject.id}?tab=${res.kind === 'project' ? 'projects' : 'resources'}#r-${res.id}`,
        url: res.url,
        freePdfUrl: res.freePdfUrl,
        youtubeAudioUrl: res.youtubeAudioUrl,
        status: res.status,
        excerpt: (res.takeaways || res.detail || '').trim().slice(0, 240) || undefined,
        content: [res.detail, res.takeaways].filter(Boolean).join('\n\n') || undefined,
        tags: resMeta.tags,
        wikiLinks: resMeta.wikiLinks,
        meta: { resourceKind: res.kind },
      });
      registerAlias(res.title, resNodeId, 3, subject.id);

      if (res.readerBookId) {
        const readerNodeId = `reader:${res.readerBookId}`;
        const book = readerBooksById.get(res.readerBookId);
        const rNotes = bookNotesMap.get(res.readerBookId) ?? '';
        const rMeta = collectMeta([book?.title, rNotes]);
        if (!allNodes.has(readerNodeId)) {
          const prog = readerProg[res.readerBookId];
          const state = readingState(prog);
          addNode({
            id: readerNodeId,
            kind: 'reader',
            label: book?.title ?? res.title,
            subtitle: book?.author ? `${book.author} · Reader (${state})` : `Reader (${state})`,
            subjectId: subject.id,
            resourceId: res.id,
            href: `/reader?book=${encodeURIComponent(res.readerBookId)}`,
            status: state,
            excerpt: rNotes.slice(0, 240) || undefined,
            content: rNotes || undefined,
            tags: rMeta.tags,
            wikiLinks: rMeta.wikiLinks,
          });
        }
        registerAlias(book?.title, readerNodeId, 5, subject.id);
      }

      for (const log of res.logs ?? []) {
        const logNodeId = `log:${log.id}`;
        const logMeta = collectMeta([log.title, log.note]);
        addNode({
          id: logNodeId,
          kind: 'note',
          label: log.title,
          subtitle: `${res.title} · ${log.day}`,
          subjectId: subject.id,
          resourceId: res.id,
          href: `/skills/${subject.id}?tab=projects`,
          excerpt: (log.note || '').trim().slice(0, 240) || undefined,
          content: log.note || undefined,
          tags: logMeta.tags,
          wikiLinks: logMeta.wikiLinks,
          attachments: log.attachments,
          meta: { isProjectLog: true, day: log.day, attachmentCount: log.attachments.length },
        });
        registerAlias(log.title, logNodeId, 4, subject.id);
      }
    }

    for (const item of subject.items) {
      if (item.retired) continue;
      const itemNodeId = `item:${item.id}`;
      const itemTexts = item.kind === 'graded'
        ? [item.question.title, item.question.prompt, item.question.solution, ...(item.question.hints ?? [])]
        : [item.front, item.back];
      const qMeta = collectMeta(itemTexts);
      const body = item.kind === 'graded'
        ? `${item.question.prompt}\n\n${item.question.solution ?? ''}`.trim()
        : `${item.front}\n\n${item.back}`.trim();
      addNode({
        id: itemNodeId,
        kind: 'question',
        label: itemTitle(item),
        subtitle: `${item.kind === 'card' ? 'Flashcard' : 'Graded question'} · ${subject.name}`,
        subjectId: subject.id,
        topicId: item.topicId,
        href: `/skills/review?item=${encodeURIComponent(item.id)}`,
        excerpt: body.slice(0, 240) || undefined,
        content: body || undefined,
        tags: qMeta.tags,
        wikiLinks: qMeta.wikiLinks,
        meta: { itemKind: item.kind },
      });
    }
  }

  const subjectById = new Map(data.subjects.map((s) => [s.id, s]));
  for (const inq of data.inquiries ?? []) {
    const nodeId = `inq:${inq.id}`;
    const sub = inq.subjectId ? subjectById.get(inq.subjectId) : undefined;
    const rawTags = (inq.tags ?? []).map((t) => t.replace(/^#/, ''));
    const meta = collectMeta([inq.question, inq.context, inq.answer, inq.takeaways], rawTags);
    const excerpt = (inq.answer || inq.takeaways || inq.context || '').trim().slice(0, 240) || undefined;
    const content = [
      inq.context ? `Context: ${inq.context}` : '',
      inq.answer,
      inq.takeaways ? `Takeaways: ${inq.takeaways}` : '',
    ].filter(Boolean).join('\n\n') || undefined;

    addNode({
      id: nodeId,
      kind: 'inquiry',
      label: inq.question,
      subtitle: `${inq.status === 'solved' ? 'Answered' : 'To look up'}${sub ? ` · ${sub.name}` : ''}`,
      subjectId: inq.subjectId,
      topicId: inq.topicId,
      href: inq.subjectId ? `/skills/${inq.subjectId}?tab=knowledge` : '/skills?view=graph',
      status: inq.status,
      excerpt,
      content,
      tags: meta.tags,
      wikiLinks: meta.wikiLinks,
      meta: {
        inquiryId: inq.id,
        inquiryStatus: inq.status,
        cardItemId: inq.cardItemId,
        sources: inq.sources?.length ? inq.sources.join(' | ') : undefined,
      },
    });
    registerAlias(inq.question, nodeId, 3, inq.subjectId);
    const alias = inquiryConceptAlias(inq.question);
    if (alias) registerAlias(alias, nodeId, 3, inq.subjectId);
  }

  // Pass 2: structural edges across all subjects.
  for (const subject of data.subjects) {
    const subNodeId = `sub:${subject.id}`;
    for (const pid of subject.parentIds ?? []) {
      addEdge(`sub:${pid}`, subNodeId, 'subskill', 'prerequisite');
    }
    for (const topic of subject.topics) {
      const topNodeId = `top:${topic.id}`;
      addEdge(subNodeId, topNodeId, 'topic');
      for (const ref of topic.notePages ?? []) {
        const noteNodeId = `note:${ref.notebook}:${ref.page}`;
        addEdge(topNodeId, noteNodeId, 'note-page');
      }
    }
    for (const res of subject.resources) {
      const resNodeId = `res:${res.id}`;
      const validTopicIds = res.topicIds.filter((tid) => subject.topics.some((t) => t.id === tid));
      if (validTopicIds.length) {
        for (const tid of validTopicIds) addEdge(`top:${tid}`, resNodeId, 'resource');
      } else {
        addEdge(subNodeId, resNodeId, 'resource');
      }
      if (res.readerBookId) {
        addEdge(resNodeId, `reader:${res.readerBookId}`, 'reader');
      }
      for (const log of res.logs ?? []) {
        addEdge(resNodeId, `log:${log.id}`, 'project-log', log.day);
      }
    }
    for (const item of subject.items) {
      if (item.retired) continue;
      const fromId = subject.topics.some((t) => t.id === item.topicId) ? `top:${item.topicId}` : subNodeId;
      addEdge(fromId, `item:${item.id}`, 'question');
    }
  }

  for (const inq of data.inquiries ?? []) {
    const nodeId = `inq:${inq.id}`;
    const sub = inq.subjectId ? subjectById.get(inq.subjectId) : undefined;
    if (sub && inq.topicId && sub.topics.some((t) => t.id === inq.topicId)) {
      addEdge(`top:${inq.topicId}`, nodeId, 'inquiry');
    } else if (inq.subjectId) {
      addEdge(`sub:${inq.subjectId}`, nodeId, 'inquiry');
    }
  }

  // Pass 3: tag nodes/edges & [[wiki-link]] edges from every node.
  const baseNodes = [...allNodes.values()];
  for (const node of baseNodes) {
    for (const tag of node.tags) {
      const tagNodeId = `tag:${tag}`;
      addNode({
        id: tagNodeId,
        kind: 'tag',
        label: `#${tag}`,
        tags: [tag],
        wikiLinks: [],
      });
      addEdge(node.id, tagNodeId, 'tag');
    }
    for (const targetName of node.wikiLinks) {
      const key = normKey(targetName);
      const localMatch = node.subjectId ? subjectLookup.get(node.subjectId)?.get(key) : undefined;
      const globalMatch = globalLookup.get(key);
      const targetId = localMatch?.nodeId ?? globalMatch?.nodeId;
      if (targetId && targetId !== node.id) {
        addEdge(node.id, targetId, 'wiki-link', targetName);
      } else if (!targetId) {
        const ghostId = `missing:${key}`;
        addNode({ id: ghostId, kind: 'missing', label: targetName, tags: [], wikiLinks: [] });
        addEdge(node.id, ghostId, 'wiki-link', targetName);
      }
    }
  }

  // Filter graph when focused on a single subjectId while preserving cross-subject neighbors/backlinks.
  let outNodes: KnowledgeNode[];
  let outEdges: KnowledgeEdge[];
  if (subjectId) {
    const coreIds = new Set<string>();
    for (const node of allNodes.values()) {
      if (node.subjectId === subjectId) coreIds.add(node.id);
    }
    // Also mark directly tied reader books & notes pages whose edges originate from this subject's core nodes.
    for (const edge of allEdges) {
      if (coreIds.has(edge.from) && (edge.kind === 'reader' || edge.kind === 'note-page')) {
        coreIds.add(edge.to);
      }
    }
    const includedIds = new Set<string>(coreIds);
    outEdges = allEdges.filter((e) => {
      if (coreIds.has(e.from) || coreIds.has(e.to)) {
        includedIds.add(e.from);
        includedIds.add(e.to);
        return true;
      }
      return false;
    });
    outNodes = [...includedIds].map((id) => allNodes.get(id)!).filter(Boolean);
  } else {
    outNodes = [...allNodes.values()];
    outEdges = allEdges;
  }

  // Build unified KnowledgeBundle for the requested scope (focused subject or entire vault).
  const bundleSubjects = subjectId ? data.subjects.filter((s) => s.id === subjectId) : data.subjects;
  const ownKnowledge: KnowledgeMaterialItem[] = [];
  const sourceMaterials: KnowledgeMaterialItem[] = [];
  const qaAndActivities: KnowledgeMaterialItem[] = [];
  const seenNotePages = new Set<string>();
  const seenReaderNotes = new Set<string>();
  const seenReaderSources = new Set<string>();

  for (const subject of bundleSubjects) {
    const topicById = new Map(subject.topics.map((t) => [t.id, t]));

    for (const topic of subject.topics) {
      if (topic.notes?.trim()) {
        const meta = collectMeta([topic.notes]);
        ownKnowledge.push({
          id: `ok-topic:${topic.id}`,
          nodeId: `top:${topic.id}`,
          sourceKind: 'topic-notes',
          title: `${topic.name} notes`,
          subtitle: subject.name,
          subjectId: subject.id,
          subjectName: subject.name,
          topicId: topic.id,
          topicName: topic.name,
          text: topic.notes.trim(),
          href: `/skills/${subject.id}?tab=topics`,
          tags: meta.tags,
          wikiLinks: meta.wikiLinks,
        });
      }

      for (const ref of topic.notePages ?? []) {
        const refKey = `${ref.notebook}:${ref.page}`;
        if (seenNotePages.has(refKey)) continue;
        const detail = pageDetailMap.get(refKey);
        if (!detail) continue;
        seenNotePages.add(refKey);
        const meta = collectMeta([detail.pageTitle, detail.text], detail.tags);
        ownKnowledge.push({
          id: `ok-page:${refKey}`,
          nodeId: `note:${refKey}`,
          sourceKind: 'notes-page',
          title: detail.label,
          subtitle: `${subject.name} · ${topic.name}`,
          subjectId: subject.id,
          subjectName: subject.name,
          topicId: topic.id,
          topicName: topic.name,
          text: detail.text || '(Handwritten / blank notes page)',
          href: detail.href,
          tags: meta.tags,
          wikiLinks: meta.wikiLinks,
        });
      }
    }

    for (const res of subject.resources) {
      const firstTopic = res.topicIds.map((tid) => topicById.get(tid)).find(Boolean);

      if (res.takeaways?.trim()) {
        const meta = collectMeta([res.takeaways]);
        ownKnowledge.push({
          id: `ok-takeaway:${res.id}`,
          nodeId: `res:${res.id}`,
          sourceKind: 'resource-takeaways',
          title: `Takeaways: ${res.title}`,
          subtitle: res.author ? `${res.author} · ${subject.name}` : subject.name,
          subjectId: subject.id,
          subjectName: subject.name,
          topicId: firstTopic?.id,
          topicName: firstTopic?.name,
          resourceId: res.id,
          text: res.takeaways.trim(),
          href: `/skills/${subject.id}?tab=resources#r-${res.id}`,
          tags: meta.tags,
          wikiLinks: meta.wikiLinks,
        });
      }

      if (res.readerBookId) {
        const rText = bookNotesMap.get(res.readerBookId) ?? '';
        const rBook = readerBooksById.get(res.readerBookId);
        if (rText && !seenReaderNotes.has(res.readerBookId)) {
          seenReaderNotes.add(res.readerBookId);
          const meta = collectMeta([rText]);
          ownKnowledge.push({
            id: `ok-reader:${res.readerBookId}`,
            nodeId: `reader:${res.readerBookId}`,
            sourceKind: 'reader-notes',
            title: `Reader notes: ${rBook?.title ?? res.title}`,
            subtitle: rBook?.author ? `${rBook.author} · ${subject.name}` : subject.name,
            subjectId: subject.id,
            subjectName: subject.name,
            topicId: firstTopic?.id,
            topicName: firstTopic?.name,
            resourceId: res.id,
            text: rText,
            href: `/reader?book=${encodeURIComponent(res.readerBookId)}`,
            tags: meta.tags,
            wikiLinks: meta.wikiLinks,
          });
        }
        if (!seenReaderSources.has(res.readerBookId)) {
          seenReaderSources.add(res.readerBookId);
          const prog = readerProg[res.readerBookId];
          const state = readingState(prog);
          sourceMaterials.push({
            id: `src-reader:${res.readerBookId}`,
            nodeId: `reader:${res.readerBookId}`,
            sourceKind: 'reader-book',
            title: rBook?.title ?? res.title,
            subtitle: rBook?.author ? `${rBook.author} · Reader` : 'Reader book',
            subjectId: subject.id,
            subjectName: subject.name,
            resourceId: res.id,
            status: state,
            href: `/reader?book=${encodeURIComponent(res.readerBookId)}`,
            tags: [],
            wikiLinks: [],
          });
        }
      }

      for (const log of res.logs ?? []) {
        const meta = collectMeta([log.title, log.note]);
        ownKnowledge.push({
          id: `ok-log:${log.id}`,
          nodeId: `log:${log.id}`,
          sourceKind: 'project-log',
          title: log.title,
          subtitle: `${res.title} · ${subject.name}`,
          subjectId: subject.id,
          subjectName: subject.name,
          topicId: firstTopic?.id,
          topicName: firstTopic?.name,
          resourceId: res.id,
          day: log.day,
          text: log.note,
          attachments: log.attachments,
          href: `/skills/${subject.id}?tab=projects`,
          tags: meta.tags,
          wikiLinks: meta.wikiLinks,
        });
      }

      if (res.status !== 'dropped') {
        const meta = collectMeta([res.detail]);
        if (res.kind === 'project' || res.kind === 'activity') {
          qaAndActivities.push({
            id: `qa-res:${res.id}`,
            nodeId: `res:${res.id}`,
            sourceKind: res.kind,
            title: res.title,
            subtitle: `${res.kind === 'project' ? 'Project' : 'Activity'} · ${subject.name}`,
            subjectId: subject.id,
            subjectName: subject.name,
            topicId: firstTopic?.id,
            topicName: firstTopic?.name,
            resourceId: res.id,
            status: res.status,
            text: res.detail,
            url: res.url,
            href: `/skills/${subject.id}?tab=${res.kind === 'project' ? 'projects' : 'resources'}#r-${res.id}`,
            tags: meta.tags,
            wikiLinks: meta.wikiLinks,
          });
        } else {
          sourceMaterials.push({
            id: `src-res:${res.id}`,
            nodeId: `res:${res.id}`,
            sourceKind: sourceKindForMaterial(res.kind),
            title: res.title,
            subtitle: res.author ? `${res.author} · ${subject.name}` : subject.name,
            subjectId: subject.id,
            subjectName: subject.name,
            topicId: firstTopic?.id,
            topicName: firstTopic?.name,
            resourceId: res.id,
            status: res.status,
            text: res.detail,
            url: res.url,
            freePdfUrl: res.freePdfUrl,
            youtubeAudioUrl: res.youtubeAudioUrl,
            href: res.readerBookId
              ? `/reader?book=${encodeURIComponent(res.readerBookId)}`
              : `/skills/${subject.id}?tab=resources#r-${res.id}`,
            tags: meta.tags,
            wikiLinks: meta.wikiLinks,
          });
        }
      }
    }

    for (const step of subject.steps ?? []) {
      const topic = step.topicId ? topicById.get(step.topicId) : undefined;
      const meta = collectMeta([step.title, step.detail]);
      qaAndActivities.push({
        id: `qa-step:${step.id}`,
        nodeId: step.topicId ? `top:${step.topicId}` : `sub:${subject.id}`,
        sourceKind: 'step',
        title: step.title,
        subtitle: [step.kind, step.amount, step.minutes ? `${step.minutes} min` : undefined].filter(Boolean).join(' · '),
        subjectId: subject.id,
        subjectName: subject.name,
        topicId: step.topicId,
        topicName: topic?.name,
        resourceId: step.resourceId,
        status: step.done ? 'done' : 'planned',
        text: step.detail,
        href: `/skills/${subject.id}?tab=steps`,
        tags: meta.tags,
        wikiLinks: meta.wikiLinks,
      });
    }

    for (const item of subject.items) {
      if (item.retired) continue;
      const topic = topicById.get(item.topicId);
      const itemTexts = item.kind === 'graded'
        ? [item.question.title, item.question.prompt, item.question.solution]
        : [item.front, item.back];
      const meta = collectMeta(itemTexts);
      qaAndActivities.push({
        id: `qa-item:${item.id}`,
        nodeId: `item:${item.id}`,
        sourceKind: item.kind === 'card' ? 'card' : 'question',
        title: itemTitle(item),
        subtitle: `${item.kind === 'card' ? 'Flashcard' : 'Graded question'}${topic ? ` · ${topic.name}` : ''}`,
        subjectId: subject.id,
        subjectName: subject.name,
        topicId: item.topicId,
        topicName: topic?.name,
        text: item.kind === 'card' ? item.back : item.question.prompt,
        href: `/skills/review?item=${encodeURIComponent(item.id)}`,
        tags: meta.tags,
        wikiLinks: meta.wikiLinks,
      });
    }
  }

  const outNodeIds = new Set(outNodes.map((n) => n.id));
  const scopedInquiries = (data.inquiries ?? []).filter(
    (inq) => !subjectId || inq.subjectId === subjectId || outNodeIds.has(`inq:${inq.id}`),
  );
  for (const inq of scopedInquiries) {
    const nodeId = `inq:${inq.id}`;
    const node = allNodes.get(nodeId);
    const sub = inq.subjectId ? subjectById.get(inq.subjectId) : undefined;
    const topic = sub && inq.topicId ? sub.topics.find((t) => t.id === inq.topicId) : undefined;
    const solved = inq.status === 'solved';
    const baseItem: KnowledgeMaterialItem = {
      id: `${solved ? 'ok' : 'qa'}-inq:${inq.id}`,
      nodeId,
      sourceKind: solved ? 'inquiry-solved' : 'inquiry-open',
      title: inq.question,
      subtitle: sub ? (topic ? `${sub.name} · ${topic.name}` : sub.name) : solved ? 'Solved lookup' : 'Open question',
      subjectId: inq.subjectId,
      subjectName: sub?.name,
      topicId: topic?.id ?? inq.topicId,
      topicName: topic?.name,
      day: (solved ? (inq.solvedAt ?? inq.updatedAt) : inq.createdAt).slice(0, 10),
      status: solved ? 'solved' : 'open',
      text: solved
        ? [inq.answer, inq.takeaways ? `Takeaways: ${inq.takeaways}` : ''].filter(Boolean).join('\n\n') || inq.context
        : inq.context,
      href: node?.href ?? (inq.subjectId ? `/skills/${inq.subjectId}?tab=knowledge` : '/skills?view=graph'),
      tags: node?.tags ?? [],
      wikiLinks: node?.wikiLinks ?? [],
    };
    if (solved) ownKnowledge.push(baseItem);
    else qaAndActivities.push(baseItem);
  }

  const nodeMap = new Map(outNodes.map((n) => [n.id, n]));
  const backlinks: Record<string, KnowledgeBacklink[]> = {};
  for (const edge of outEdges) {
    const source = nodeMap.get(edge.from);
    const target = nodeMap.get(edge.to);
    if (!source || !target) continue;
    const list = backlinks[target.id] ?? [];
    list.push({
      targetId: target.id,
      targetLabel: target.label,
      targetKind: target.kind,
      sourceId: source.id,
      sourceLabel: source.label,
      sourceKind: source.kind,
      edgeKind: edge.kind,
      ...(edge.label ? { label: edge.label } : {}),
    });
    backlinks[target.id] = list;
  }

  return {
    nodes: outNodes,
    edges: outEdges,
    bundle: {
      ...(subjectId ? { scopeSubjectId: subjectId } : {}),
      ownKnowledge,
      sourceMaterials,
      qaAndActivities,
      inquiries: scopedInquiries,
      backlinks,
    },
  };
}


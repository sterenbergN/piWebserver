'use client';

import { orderBetween, type BookRecord, type Notebook, type PageElement, type PageRecord, type RecordingRecord, type TemplateId } from '@/lib/notes/items';
import { getElements, getLibraryRecord, listBook, livePages, liveRecordings, putBook, putElements, putLibrary, type StoredBook, type StoredElement } from './db';
import { scheduleSync } from './sync';

// An open notebook, held in memory. Every change goes into the device's database straight
// away and up to the server when it can, and it's written down as a step that undo can take
// back: what was there before and what's there after. Undoing puts the "before" back with a new
// time on it, so it reaches the other devices like any other edit.

export const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(9)), (b) => b.toString(36).padStart(2, '0')).join('');

export type Step =
  | { type: 'element'; page: string; before: PageElement | null; after: PageElement | null }
  | { type: 'book'; before: BookRecord | null; after: BookRecord | null };

const UNDO_LIMIT = 300;

export function tombstone<T extends { id: string; kind: string; createdAt: number }>(record: T, now = Date.now()) {
  return { id: record.id, kind: record.kind, createdAt: record.createdAt, updatedAt: now, deleted: true } as unknown as T;
}

export class NotebookDoc {
  pages: PageRecord[] = [];
  recordings: RecordingRecord[] = [];
  /** Goes up by one for a page each time anything on it changes. */
  private versions = new Map<string, number>();
  private elements = new Map<string, Map<string, PageElement>>();
  private loading = new Map<string, Promise<void>>();
  private undoStack: Step[][] = [];
  private redoStack: Step[][] = [];
  private listeners = new Set<(page: string | null) => void>();
  /** Writes in order, so a page reloaded from the database always sees the ones made before it. */
  private writes: Promise<unknown> = Promise.resolve();
  private touched = false;

  constructor(readonly notebook: string) {}

  async load() {
    this.adoptBook(await listBook(this.notebook));
  }

  private adoptBook(records: StoredBook[]) {
    this.pages = livePages(records);
    this.recordings = liveRecordings(records);
  }

  /** What other devices sent has been saved: show it. */
  async reload(pages: string[]) {
    await this.writes;
    await this.load();
    for (const page of pages) {
      if (this.elements.has(page)) {
        this.elements.delete(page);
        await this.ensure(page);
      }
    }
    this.notify(null);
  }

  subscribe(listener: (page: string | null) => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private notify(page: string | null) {
    for (const listener of this.listeners) listener(page);
  }

  version(page: string) {
    return this.versions.get(page) ?? 0;
  }

  private bump(page: string) {
    this.versions.set(page, this.version(page) + 1);
  }

  isLoaded(page: string) {
    return this.elements.has(page);
  }

  ensure(page: string) {
    if (this.elements.has(page)) return Promise.resolve();
    let loading = this.loading.get(page);
    if (!loading) {
      loading = getElements(page).then((stored) => {
        const map = new Map<string, PageElement>();
        for (const { notebook: _notebook, page: _page, dirty: _dirty, ...element } of stored) {
          if (!element.deleted) map.set(element.id, element as PageElement);
        }
        this.elements.set(page, map);
        this.bump(page);
        this.loading.delete(page);
      });
      this.loading.set(page, loading);
    }
    return loading;
  }

  elementsOf(page: string): PageElement[] {
    return [...(this.elements.get(page)?.values() ?? [])];
  }

  element(page: string, id: string) {
    return this.elements.get(page)?.get(id);
  }

  /** Let go of pages far from what's on screen. */
  release(keep: Set<string>) {
    if (this.elements.size < 40) return;
    for (const page of this.elements.keys()) {
      if (!keep.has(page)) this.elements.delete(page);
    }
  }

  // ── Changing things ──────────────────────────────────────────────────────────

  private store(steps: Step[]) {
    const elements: StoredElement[] = [];
    const book: StoredBook[] = [];
    const pagesChanged = new Set<string>();
    let bookChanged = false;
    for (const step of steps) {
      if (step.type === 'element') {
        const after = step.after;
        if (!after) continue;
        const map = this.elements.get(step.page) ?? new Map<string, PageElement>();
        this.elements.set(step.page, map);
        if (after.deleted) map.delete(after.id);
        else map.set(after.id, after);
        this.bump(step.page);
        pagesChanged.add(step.page);
        elements.push({ ...after, notebook: this.notebook, page: step.page, dirty: true } as StoredElement);
      } else if (step.after) {
        book.push({ ...step.after, notebook: this.notebook, dirty: true } as StoredBook);
        const list = step.after.kind === 'page' ? this.pages as BookRecord[] : this.recordings as BookRecord[];
        const at = list.findIndex((record) => record.id === step.after!.id);
        if (step.after.deleted) {
          if (at >= 0) list.splice(at, 1);
        } else if (at >= 0) {
          list[at] = step.after;
        } else {
          list.push(step.after);
        }
        bookChanged = true;
      }
    }
    if (bookChanged) {
      this.pages.sort((a, b) => a.order - b.order);
      this.recordings.sort((a, b) => a.startedAt - b.startedAt);
    }
    this.writes = this.writes.then(async () => {
      if (book.length) await putBook(book);
      if (elements.length) await putElements(elements);
    }).catch(() => {});
    this.touched = true;
    scheduleSync();
    if (bookChanged) this.notify(null);
    else for (const page of pagesChanged) this.notify(page);
  }

  /** Make a change. It's written down for undo unless `undoable` is false, or the caller is adding it up itself. */
  apply(steps: Step[], undoable = true) {
    if (!steps.length) return;
    this.store(steps);
    if (undoable) this.pushUndo(steps);
  }

  pushUndo(steps: Step[]) {
    if (!steps.length) return;
    this.undoStack.push(steps);
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    this.redoStack = [];
    this.notify(null);
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  /** Take back the last change. Answers which pages it touched, so the screen can go there. */
  undo() {
    const steps = this.undoStack.pop();
    if (!steps) return null;
    this.redoStack.push(steps);
    return this.replay([...steps].reverse(), 'before');
  }

  redo() {
    const steps = this.redoStack.pop();
    if (!steps) return null;
    this.undoStack.push(steps);
    return this.replay(steps, 'after');
  }

  private replay(steps: Step[], side: 'before' | 'after') {
    const now = Date.now();
    const out: Step[] = [];
    const pages = new Set<string>();
    for (const step of steps) {
      const wanted = step[side];
      const other = side === 'before' ? step.after : step.before;
      const target = wanted ? { ...wanted, updatedAt: now } : other ? tombstone(other, now) : null;
      if (step.type === 'element') {
        pages.add(step.page);
        out.push({ type: 'element', page: step.page, before: null, after: target as PageElement | null });
      } else {
        out.push({ type: 'book', before: null, after: target as BookRecord | null });
      }
    }
    this.store(out);
    this.notify(null);
    return [...pages];
  }

  /** Remember this notebook was edited, for sorting the library. Waits until you're done, not once a stroke. */
  async touchLibrary() {
    if (!this.touched) return;
    this.touched = false;
    const record = await getLibraryRecord(this.notebook);
    if (record?.kind !== 'notebook') return;
    const now = Date.now();
    await putLibrary([{ ...(record as Notebook), editedAt: now, updatedAt: now, dirty: true }]);
    scheduleSync(500);
  }

  // ── Pages ────────────────────────────────────────────────────────────────────

  newPage(fields: { order: number; w: number; h: number; template: TemplateId; paper: string; pdf?: PageRecord['pdf']; title?: string }): PageRecord {
    const now = Date.now();
    return { id: newId(), kind: 'page', createdAt: now, updatedAt: now, ...fields };
  }

  /** Add a page after another (or at the end), like it unless told otherwise. */
  addPage(after: string | null, like: Partial<Pick<PageRecord, 'w' | 'h' | 'template' | 'paper'>> = {}) {
    const index = after ? this.pages.findIndex((page) => page.id === after) : this.pages.length - 1;
    const model = this.pages[index] ?? this.pages[this.pages.length - 1];
    const page = this.newPage({
      order: orderBetween(this.pages[index]?.order, this.pages[index + 1]?.order),
      w: like.w ?? model?.w ?? 612,
      h: like.h ?? model?.h ?? 792,
      template: like.template ?? (model && !model.pdf ? model.template : 'ruled'),
      paper: like.paper ?? (model && !model.pdf ? model.paper : '#ffffff'),
    });
    this.apply([{ type: 'book', before: null, after: page }]);
    return page;
  }

  updatePage(page: PageRecord, changes: Partial<PageRecord>, undoable = true) {
    this.apply([{ type: 'book', before: page, after: { ...page, ...changes, updatedAt: Date.now() } }], undoable);
  }

  updatePages(pages: PageRecord[], changes: Partial<PageRecord>) {
    const now = Date.now();
    this.apply(pages.map((page) => ({ type: 'book' as const, before: page, after: { ...page, ...changes, updatedAt: now } })));
  }

  deletePage(page: PageRecord) {
    if (this.pages.length < 2) return false;
    this.apply([{ type: 'book', before: page, after: tombstone(page) }]);
    return true;
  }

  movePage(page: PageRecord, toIndex: number) {
    const others = this.pages.filter((p) => p.id !== page.id);
    const order = orderBetween(others[toIndex - 1]?.order, others[toIndex]?.order);
    this.updatePage(page, { order });
  }

  async duplicatePage(page: PageRecord) {
    await this.ensure(page.id);
    const index = this.pages.findIndex((p) => p.id === page.id);
    const { id: _id, seq: _seq, title, starred: _starred, ...rest } = page;
    const now = Date.now();
    const copy: PageRecord = { ...rest, id: newId(), createdAt: now, updatedAt: now, order: orderBetween(page.order, this.pages[index + 1]?.order), ...(title ? { title: `${title} (copy)` } : {}) };
    const steps: Step[] = [{ type: 'book', before: null, after: copy }];
    for (const element of this.elementsOf(page.id)) {
      const { seq: _elementSeq, ...fields } = element;
      steps.push({ type: 'element', page: copy.id, before: null, after: { ...fields, id: newId(), updatedAt: now } as PageElement });
    }
    this.apply(steps);
    return copy;
  }

  saveRecording(recording: RecordingRecord) {
    this.apply([{ type: 'book', before: null, after: recording }], false);
  }

  renameRecording(recording: RecordingRecord, title: string) {
    this.apply([{ type: 'book', before: recording, after: { ...recording, title, updatedAt: Date.now() } }], false);
  }

  deleteRecording(recording: RecordingRecord) {
    this.apply([{ type: 'book', before: recording, after: tombstone(recording) }], false);
  }

  /** Everything put away safely. */
  settled() {
    return this.writes;
  }
}

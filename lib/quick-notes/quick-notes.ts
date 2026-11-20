// Quick notes: one-line jots from anywhere on the site ("walk the dog later",
// "fix the gallery bug", "TIL x"), kept on the account. Not the Notes app's
// notebooks: a note is just text, when it was written and where, and whether
// it's been checked off. Checked-off notes stay until they're cleared.

export const MAX_NOTE_LENGTH = 2000;
/** Plenty for jots; a full list drops its oldest checked-off notes to make room. */
export const MAX_NOTES = 500;

export type QuickNote = {
  id: string;
  text: string;
  /** ISO time it was written. */
  createdAt: string;
  /** ISO time it was checked off; absent while it's open. */
  doneAt?: string;
  /** The page it was written on. */
  from?: { path: string; title?: string };
};

export type QuickNotesData = { notes: QuickNote[] };

export type QuickNoteAction =
  | { type: 'add'; text: string; id?: string; from?: { path?: unknown; title?: unknown } }
  | { type: 'done'; ids: string[]; done: boolean }
  | { type: 'edit'; id: string; text: string }
  | { type: 'remove'; ids: string[] }
  | { type: 'clear-done' }
  /** Put cleared notes back (undo). */
  | { type: 'restore'; notes: unknown[] };

export class QuickNoteInputError extends Error {}

const ID = /^[\w-]{1,40}$/;

export const emptyQuickNotes = (): QuickNotesData => ({ notes: [] });

/** Trimmed, at most MAX_NOTE_LENGTH, with runs of blank lines folded. */
export function cleanNoteText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_NOTE_LENGTH).trim();
}

const isoOrNull = (value: unknown) => (typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : null);

function cleanFrom(value: unknown): QuickNote['from'] {
  if (!value || typeof value !== 'object') return undefined;
  const { path, title } = value as { path?: unknown; title?: unknown };
  // Only a path on this site, never a full address somewhere else.
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || path.length > 300) return undefined;
  const cleanTitle = typeof title === 'string' ? title.trim().slice(0, 80) : '';
  return cleanTitle ? { path, title: cleanTitle } : { path };
}

function cleanNote(value: unknown): QuickNote | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const text = cleanNoteText(raw.text);
  const createdAt = isoOrNull(raw.createdAt);
  if (typeof raw.id !== 'string' || !ID.test(raw.id) || !text || !createdAt) return null;
  const note: QuickNote = { id: raw.id, text, createdAt };
  const doneAt = isoOrNull(raw.doneAt);
  if (doneAt) note.doneAt = doneAt;
  const from = cleanFrom(raw.from);
  if (from) note.from = from;
  return note;
}

/** Newest first. */
const byNewest = (a: QuickNote, b: QuickNote) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);

/** Whatever was stored, as valid notes, once each, newest first. */
export function normalizeQuickNotes(value: unknown): QuickNotesData {
  const list = value && typeof value === 'object' && Array.isArray((value as QuickNotesData).notes) ? (value as QuickNotesData).notes : [];
  const seen = new Set<string>();
  const notes: QuickNote[] = [];
  for (const item of list) {
    const note = cleanNote(item);
    if (!note || seen.has(note.id)) continue;
    seen.add(note.id);
    notes.push(note);
  }
  return { notes: notes.sort(byNewest) };
}

/** Open notes, newest first. */
export const openNotes = (data: QuickNotesData) => data.notes.filter((n) => !n.doneAt).sort(byNewest);
/** Checked-off notes, most recently checked off first. */
export const doneNotes = (data: QuickNotesData) =>
  data.notes.filter((n) => n.doneAt).sort((a, b) => b.doneAt!.localeCompare(a.doneAt!) || byNewest(a, b));

/** Make room for one more: drop the oldest checked-off note, or refuse when every note is still open. */
function makeRoom(data: QuickNotesData) {
  while (data.notes.length >= MAX_NOTES) {
    const done = data.notes.filter((n) => n.doneAt).sort((a, b) => a.doneAt!.localeCompare(b.doneAt!));
    if (!done.length) throw new QuickNoteInputError(`That’s ${MAX_NOTES} open notes. Check some off or clear a few first.`);
    data.notes = data.notes.filter((n) => n.id !== done[0].id);
  }
}

const idList = (ids: unknown) => new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []);

/**
 * Apply one change to `data` in place. `now` is when it happened; `newId` makes
 * an id when the client didn't send a usable one. Returns the added note for 'add'.
 */
export function applyQuickNoteAction(data: QuickNotesData, action: QuickNoteAction, now: Date, newId: () => string): QuickNote | undefined {
  const at = now.toISOString();
  switch (action?.type) {
    case 'add': {
      const text = cleanNoteText(action.text);
      if (!text) throw new QuickNoteInputError('Write something first.');
      makeRoom(data);
      const taken = new Set(data.notes.map((n) => n.id));
      let id = typeof action.id === 'string' && ID.test(action.id) && !taken.has(action.id) ? action.id : newId();
      while (taken.has(id)) id = newId();
      const note: QuickNote = { id, text, createdAt: at };
      const from = cleanFrom(action.from);
      if (from) note.from = from;
      data.notes.unshift(note);
      return note;
    }
    case 'done': {
      const ids = idList(action.ids);
      for (const note of data.notes) {
        if (!ids.has(note.id)) continue;
        if (action.done) note.doneAt ??= at;
        else delete note.doneAt;
      }
      return undefined;
    }
    case 'edit': {
      const note = data.notes.find((n) => n.id === action.id);
      if (!note) throw new QuickNoteInputError('That note isn’t there any more.');
      const text = cleanNoteText(action.text);
      if (!text) throw new QuickNoteInputError('A note can’t be empty. Clear it instead.');
      note.text = text;
      return undefined;
    }
    case 'remove': {
      const ids = idList(action.ids);
      data.notes = data.notes.filter((n) => !ids.has(n.id));
      return undefined;
    }
    case 'clear-done':
      data.notes = data.notes.filter((n) => !n.doneAt);
      return undefined;
    case 'restore': {
      const back = normalizeQuickNotes({ notes: Array.isArray(action.notes) ? action.notes : [] }).notes;
      const taken = new Set(data.notes.map((n) => n.id));
      for (const note of back) {
        if (taken.has(note.id)) continue;
        makeRoom(data);
        data.notes.push(note);
        taken.add(note.id);
      }
      data.notes.sort(byNewest);
      return undefined;
    }
    default:
      throw new QuickNoteInputError('Unknown change.');
  }
}

/** "just now", "5 min ago", "3 h ago", "yesterday", "Tue", "Nov 3", "Nov 3, 2025". */
export function noteAge(iso: string, now = new Date()): string {
  const then = new Date(iso);
  const mins = Math.floor((now.getTime() - then.getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(then)) / 86_400_000);
  if (days <= 0) return `${Math.floor(mins / 60)} h ago`;
  if (days === 1) return 'yesterday';
  if (days < 7) return then.toLocaleDateString('en-US', { weekday: 'short' });
  return then.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(then.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
}

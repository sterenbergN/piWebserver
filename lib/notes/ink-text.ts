import { unpackPoints } from './geometry';
import { findLines, lineKey, type InkStroke } from './handwriting';
import { readerStatus, readLines } from './recognizer';
import { pagesToRead, readInkText, readPageInk, saveInkText } from './store';

// Reading handwriting in the background, so it can be searched. A page is read about a minute
// after it was last written on, so a page being filled isn't read over and over. Only lines
// whose strokes have changed are read again: the rest keep the text they had. One page at a
// time, and if the model isn't there (no connection to fetch it, say), it waits and tries later.

const QUIET_MS = 60_000;
const RETRY_MS = 10 * 60_000;

type Waiting = { userId: string; notebook: string; page: string; due: number };

const waiting = new Map<string, Waiting>();
const caughtUp = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;
let working = false;

/** Something was written on a page: read it once the writing stops. */
export function pageChanged(userId: string, notebook: string, page: string, delay = QUIET_MS) {
  waiting.set(`${userId}/${notebook}/${page}`, { userId, notebook, page, due: Date.now() + delay });
  schedule();
}

/** Once per account each time the server starts: anything written while it wasn't reading. */
export function catchUp(userId: string) {
  if (caughtUp.has(userId)) return;
  caughtUp.add(userId);
  void pagesToRead(userId).then((pages) => {
    for (const { notebook, page } of pages) pageChanged(userId, notebook, page, 5_000);
  }).catch(() => caughtUp.delete(userId));
}

function schedule() {
  if (timer || working || !waiting.size) return;
  const next = Math.min(...[...waiting.values()].map((entry) => entry.due));
  timer = setTimeout(() => {
    timer = null;
    void work();
  }, Math.max(0, next - Date.now()));
  timer.unref?.();
}

async function work() {
  working = true;
  try {
    for (;;) {
      const due = [...waiting.entries()].filter(([, entry]) => entry.due <= Date.now()).sort((a, b) => a[1].due - b[1].due)[0];
      if (!due) break;
      const [key, entry] = due;
      waiting.delete(key);
      try {
        await readPage(entry.userId, entry.notebook, entry.page);
      } catch {
        // Most likely the model couldn't be fetched. Try again later, without losing the page.
        if (!waiting.has(key)) waiting.set(key, { ...entry, due: Date.now() + RETRY_MS });
        if (readerStatus().state === 'unavailable') break;
      }
    }
  } finally {
    working = false;
    schedule();
  }
}

export async function readPage(userId: string, notebook: string, page: string) {
  const ink = await readPageInk(userId, notebook, page);
  const held = await readInkText(userId, notebook, page);
  if (held && held.pageSeq >= ink.seq) return;
  const strokes: InkStroke[] = ink.strokes.map((stroke) => ({ id: stroke.id, pts: unpackPoints(stroke.p), width: stroke.width }));
  const stamps = new Map(ink.strokes.map((stroke) => [stroke.id, stroke.updatedAt]));
  const lines = findLines(strokes);
  const keys = lines.map((line) => lineKey(line, stamps));
  const known = new Map((held?.keys ?? []).map((key, i) => [key, held!.lines[i]?.text ?? '']));
  const fresh = lines.filter((_, i) => !known.has(keys[i]));
  const texts = fresh.length ? await readLines(strokes, fresh) : [];
  const read = new Map(fresh.map((line, i) => [line, texts[i]]));
  const out = lines.map((line, i) => ({ text: known.get(keys[i]) ?? read.get(line) ?? '', box: roundBox(line.box) }));
  await saveInkText(userId, notebook, {
    id: page, kind: 'inktext', page, pageSeq: ink.seq, keys,
    lines: out,
    text: out.map((line) => line.text).filter(Boolean).join('\n'),
  }, Date.now());
}

const roundBox = (box: { x: number; y: number; w: number; h: number }) => ({ x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.w), h: Math.round(box.h) });

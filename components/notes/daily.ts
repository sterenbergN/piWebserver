'use client';

import { orderBetween, type Notebook, type PageElement, type QuestionLink } from '@/lib/notes/items';
import { localToday } from '@/lib/habits/dates';
import { mathToPlain } from '@/lib/notes/plain-math';
import { listBook, listLibrary, livePages, putBook, putElements, putLibrary, type StoredBook, type StoredElement, type StoredLibrary } from './db';
import { newId } from './doc';
import { layoutText, TEXT_LINE_HEIGHT } from './ink';
import { scheduleSync, syncNow } from './sync';

// Doing the engineering question of the day in Notes. A question opens a page of its own in one
// notebook kept for them, with the problem written at the top, and the page is tied to the
// question so each can find the other: the question links to its working, and the page links
// back to the question.

export type DailyChoice = QuestionLink & { core: boolean };
type PublicQuestion = { id: string; title: string; prompt: string };
type DailyAnswer = { success: boolean; date: string; day: { core: PublicQuestion; bonus: PublicQuestion[] } | null; archive: { date: string; title: string }[] };

const NOTEBOOK_TITLE = 'Engineering questions';

async function fetchDay(date?: string) {
  const res = await fetch(`/api/daily?today=${localToday()}${date ? `&date=${date}` : ''}`, { cache: 'no-store' });
  const body = await res.json().catch(() => null) as DailyAnswer | null;
  if (!res.ok || !body?.success) throw new Error('The daily questions couldn’t be reached.');
  return body;
}

/** A day's questions, to tie a page to. */
export async function dailyChoices(date?: string) {
  const body = await fetchDay(date);
  const day = body.day;
  const choices: DailyChoice[] = day ? [
    { id: day.core.id, date: body.date, title: day.core.title, core: true },
    ...day.bonus.map((q) => ({ id: q.id, date: body.date, title: q.title, core: false })),
  ] : [];
  return { date: body.date, choices, archive: body.archive };
}

/** Where the daily question lives on the site, to go back to it from its page. */
export const questionHref = (link: QuestionLink) => `/daily?date=${link.date}`;

/** The pages, anywhere, already tied to a question. */
async function tiedPages(question: string) {
  const out: { notebook: string; page: string }[] = [];
  for (const record of await listLibrary()) {
    if (record.kind !== 'notebook' || record.deleted || record.trashedAt) continue;
    for (const page of livePages(await listBook(record.id))) {
      if (page.questions?.some((link) => link.id === question)) out.push({ notebook: record.id, page: page.id });
    }
  }
  return out;
}

async function dailyNotebook() {
  const held = (await listLibrary()).find((record): record is Notebook & StoredLibrary => record.kind === 'notebook' && !record.deleted && !record.trashedAt && !!record.daily);
  if (held) return held.id;
  const now = Date.now();
  const id = newId();
  await putLibrary([{ id, kind: 'notebook', title: NOTEBOOK_TITLE, daily: true, cover: '#1f7a8c', template: 'engineering', paper: '#ffffff', size: { w: 612, h: 792 }, createdAt: now, updatedAt: now, editedAt: now, dirty: true }]);
  return id;
}

/**
 * The page to work a question on: the one already tied to it, or a new one with the problem at
 * the top. Works offline too, from what the link said about the question.
 */
export async function pageForQuestion(question: string, date: string, fallbackTitle: string) {
  await syncNow().catch(() => {});
  const [already] = await tiedPages(question);
  if (already) return already;

  let title = fallbackTitle || 'Daily question';
  let prompt = '';
  try {
    const { day } = await fetchDay(date);
    const found = day && [day.core, ...day.bonus].find((q) => q.id === question);
    if (found) {
      title = found.title;
      prompt = mathToPlain(found.prompt);
    }
  } catch { /* Offline: the page still gets made, with the title it was given. */ }

  const notebook = await dailyNotebook();
  const pages = livePages(await listBook(notebook));
  const now = Date.now();
  // A brand-new notebook's first, empty page is used rather than left blank at the front.
  const blankFirst = pages.length === 1 && !pages[0].questions?.length && !pages[0].title ? pages[0] : null;
  const page: StoredBook = {
    ...(blankFirst ?? { id: newId(), kind: 'page', notebook, order: orderBetween(pages[pages.length - 1]?.order, undefined), w: 612, h: 792, template: 'engineering', paper: '#ffffff', createdAt: now }),
    kind: 'page', notebook, title, questions: [{ id: question, date, title }], updatedAt: now, dirty: true,
  } as StoredBook;
  await putBook([page]);

  const heading = { text: `${title}  ·  ${new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`, size: 13, bold: true };
  const body = { text: prompt, size: 10.5, bold: false };
  const elements: StoredElement[] = [];
  let y = 40;
  for (const part of [heading, body]) {
    if (!part.text) continue;
    const element = { id: newId(), kind: 'text', x: 40, y, w: 532, h: 0, rot: 0, text: part.text, size: part.size, color: '#1d1f27', font: 'sans', ...(part.bold ? { bold: true } : {}), createdAt: now, updatedAt: now } as PageElement & { kind: 'text' };
    element.h = layoutText(element).length * element.size * TEXT_LINE_HEIGHT;
    elements.push({ ...element, notebook, page: page.id, dirty: true } as StoredElement);
    y += element.h + 10;
  }
  if (elements.length) await putElements(elements);
  scheduleSync(500);
  return { notebook, page: page.id };
}

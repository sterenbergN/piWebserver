'use client';

import { orderBetween, type MarkElement, type Notebook, type PageElement, type PageRecord, type QuestionLink, type TextElement } from '@/lib/notes/items';
import { localToday } from '@/lib/habits/dates';
import { layoutQuestionSheet, OPEN_QUESTION, svgSize, type SheetFormula, type SheetQuestion } from '@/lib/notes/question-sheet';
import { listBook, listLibrary, livePages, putBook, putElements, putLibrary, type StoredBook, type StoredElement, type StoredLibrary } from './db';
import { newId } from './doc';
import { layoutText, textBox, TEXT_LINE_HEIGHT } from './ink';
import { keepNewFile, scheduleSync, syncNow } from './sync';

// Doing the engineering question of the day in Notes. A question opens a page of its own in one
// notebook kept for them, with the problem written at the top, and the page is tied to the
// question so each can find the other: the question links to its working, and the page links
// back to the question.

export type DailyChoice = QuestionLink & { core: boolean };
type PublicQuestion = SheetQuestion & { id: string; figure?: string; formulas?: string[] };
type DailyAnswer = {
  success: boolean; date: string;
  day: { core: PublicQuestion; bonus: PublicQuestion[]; formulas: (SheetFormula & { id: string })[] } | null;
  archive: { date: string; title: string }[];
};

const NOTEBOOK_TITLE = 'Engineering questions';

async function fetchDay(date?: string) {
  const res = await fetch(`/api/daily?today=${localToday()}${date ? `&date=${date}` : ''}`, { cache: 'no-store' });
  const body = await res.json().catch(() => null) as DailyAnswer | null;
  if (!res.ok || !body?.success) throw new Error('The daily questions couldn’t be reached.');
  return body;
}

async function fetchPractice(question: string) {
  const res = await fetch(`/api/daily/practice?today=${localToday()}&id=${encodeURIComponent(question)}`, { cache: 'no-store' });
  const body = await res.json().catch(() => null) as { success: boolean; question?: PublicQuestion; formulas?: SheetFormula[] } | null;
  return res.ok && body?.success && body.question ? { question: body.question, formulas: body.formulas ?? [] } : null;
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
/** Back to the question itself: on its day, or in Practice when it isn't one of the day's. */
export const questionHref = (link: QuestionLink) => link.href ?? `/daily?date=${link.date}&question=${encodeURIComponent(link.id)}`;

/** The same, as a full address, for a link on the page. */
const questionUrl = (link: QuestionLink) => new URL(questionHref(link), window.location.origin).href;

/** The question a link on a page goes to, if it goes to one on this site. */
function questionOf(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.origin !== window.location.origin) return null;
    // A daily question, or a Skills one (its working links back to it in Skills).
    if (parsed.pathname === '/daily') return parsed.searchParams.get('question');
    return parsed.pathname === '/skills/review' ? parsed.searchParams.get('item') : null;
  } catch {
    return null;
  }
}

export const linksToQuestion = (element: PageElement, question: string) =>
  element.kind === 'mark' && element.role === 'link' && !element.deleted && !!element.target && 'url' in element.target && questionOf(element.target.url) === question;

/** A link over the question's title on its page, the same kind as one you'd make yourself. */
function titleLink(heading: TextElement, link: QuestionLink): MarkElement {
  const box = textBox(heading);
  const now = Date.now();
  return { id: newId(), kind: 'mark', role: 'link', ...box, label: link.title, target: { url: questionUrl(link) }, createdAt: now, updatedAt: now };
}

/**
 * Links for a page's questions that its title doesn't have yet: pages made before titles were
 * links had theirs at the foot of the screen. A question whose title has gone gets none.
 */
export function missingTitleLinks(page: PageRecord, elements: PageElement[]) {
  const out: MarkElement[] = [];
  const text = (element: PageElement): element is TextElement => element.kind === 'text' && !element.deleted;
  for (const link of page.questions ?? []) {
    if (elements.some((element) => linksToQuestion(element, link.id))) continue;
    const heading = elements.find((element) => text(element) && element.text.startsWith(link.title)) as TextElement | undefined;
    if (heading) out.push(titleLink(heading, link));
    // Pages made on the server also have a visible "open this question" line to link.
    const open = elements.find((element) => text(element) && element.text === OPEN_QUESTION) as TextElement | undefined;
    if (open) out.push(titleLink(open, link));
  }
  return out;
}

/** A question's SVG figure as a PNG (Notes keeps only PNG and JPEG pictures), at twice its size to stay sharp. */
async function figurePicture(svg: string) {
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const natural = svgSize(svg);
  const w = img.naturalWidth || natural.w;
  const h = img.naturalHeight || natural.h;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * 2);
  canvas.height = Math.round(h * 2);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('The figure wouldn’t draw.');
  return { blob, w, h };
}

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
  let asked: PublicQuestion | null = null;
  let formulas: SheetFormula[] = [];
  try {
    const { day } = await fetchDay(date);
    const found = day && [day.core, ...day.bonus].find((q) => q.id === question);
    if (found) {
      asked = found;
      const used = new Set(found.formulas ?? []);
      formulas = day.formulas.filter((f) => used.has(f.id));
    } else {
      // Not one of the day's: a practice question, which Practice can open by itself.
      const practice = await fetchPractice(question);
      if (practice) ({ question: asked, formulas } = practice);
    }
    if (asked) title = asked.title;
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

  const dateLabel = new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const sheet: SheetQuestion = asked ?? { title, prompt: '', parts: [] };
  let picture: { file: string; w: number; h: number } | null = null;
  if (asked?.figure) {
    try {
      const { blob, w, h } = await figurePicture(asked.figure);
      picture = { file: newId(), w, h };
      await keepNewFile(notebook, picture.file, blob);
    } catch { picture = null; /* The page is still worth having without it. */ }
  }
  const measure = ({ text, w, size, bold }: { text: string; w: number; size: number; bold?: boolean }) =>
    layoutText({ text, w, size, font: 'sans', bold }).length * size * TEXT_LINE_HEIGHT;
  const link = { id: question, date, title };
  const elements: StoredElement[] = [];
  for (const box of layoutQuestionSheet(sheet, formulas, dateLabel, measure, picture ?? undefined)) {
    if (box.kind === 'figure') {
      elements.push({ id: newId(), kind: 'image', x: box.x, y: box.y, w: box.w, h: box.h, rot: 0, file: picture!.file, createdAt: now, updatedAt: now, notebook, page: page.id, dirty: true } as StoredElement);
      continue;
    }
    const element = { id: newId(), kind: 'text', x: box.x, y: box.y, w: box.w, h: box.h, rot: 0, text: box.text, size: box.size, color: box.color, font: 'sans', ...(box.bold ? { bold: true } : {}), createdAt: now, updatedAt: now } as TextElement;
    elements.push({ ...element, notebook, page: page.id, dirty: true } as StoredElement);
    // The title and the "open this question" line are the ways back to the question.
    if (box.role === 'heading' || box.role === 'open') elements.push({ ...titleLink(element, link), notebook, page: page.id, dirty: true } as StoredElement);
  }
  if (elements.length) await putElements(elements);
  scheduleSync(500);
  return { notebook, page: page.id };
}

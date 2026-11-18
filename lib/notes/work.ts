import crypto from 'crypto';
import sharp from 'sharp';
import { publicQuestion } from '@/lib/daily/grade';
import { findQuestion } from '@/lib/daily/store';
import type { Formula, Question } from '@/lib/daily/types';
import { skillQuestionForNotes } from '@/lib/skills/links';
import { orderBetween, type LibraryRecord, type Notebook, type PageRecord } from './items';
import { mathPicture, mathPng } from './math-picture';
import { layoutQuestionSheet, SHEET_PAGE, type MathSize, type Measure } from './question-sheet';
import { appendUpload, finishUpload, pagesTiedTo, readLibrary, syncBook, syncLibrary, syncPage, type TiedPage } from './store';

// A daily question's page in Notes, made from the question itself, so it can be started on one
// device (the question open on a computer) and written on another (the iPad). Notes makes the
// same page when a question is opened in it there (both lay it out with question-sheet.ts);
// this is that, done here, with what the server can't measure left for the device: the links
// back to the question are added the first time the page is opened. Skills questions get the
// same page, in the Skills notebook, linking back to the question in Skills.

const NOTEBOOK_TITLE = 'Engineering questions';
const PAGE = SHEET_PAGE;
const LINE_HEIGHT = 1.3;

const newId = () => crypto.randomBytes(12).toString('hex');

/** Near enough how tall a text box will be: the device lays it out properly when it draws it. */
const roughHeight: Measure = ({ text, w, size, bold }) => {
  const perLine = Math.max(1, Math.floor(w / (size * (bold ? 0.56 : 0.5))));
  const lines = text.split('\n').reduce((n, paragraph) => n + Math.max(1, Math.ceil(paragraph.length / perLine)), 0);
  return lines * size * LINE_HEIGHT;
};

const shortDate = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** A picture kept in the notebook, by its new file id. */
async function storePicture(userId: string, notebook: string, png: Buffer) {
  const file = newId();
  await appendUpload(userId, notebook, file, 0, new Blob([new Uint8Array(png)]).stream());
  await finishUpload(userId, notebook, file);
  return file;
}

/** The question's figure as a PNG in the notebook (Notes keeps only PNG and JPEG pictures). */
async function storeFigure(userId: string, notebook: string, svg: string) {
  try {
    // Twice the drawn size, so it stays sharp when zoomed in on.
    const png = await sharp(Buffer.from(svg), { density: 192 }).flatten({ background: '#ffffff' }).png().toBuffer({ resolveWithObject: true });
    return { file: await storePicture(userId, notebook, png.data), w: png.info.width / 2, h: png.info.height / 2 };
  } catch {
    return null; // The page is still worth having without it.
  }
}

const mathSize: MathSize = (latex, size) => mathPicture(latex, { size });

/** The page for this question: the one already tied to it, or a new one in the questions notebook. */
export async function pageForQuestion(userId: string, question: string, askedOn: string): Promise<TiedPage | null> {
  const [already] = await pagesTiedTo(userId, [question]);
  if (already) return already;
  const found = await findQuestion(question);
  if (found) return makeSheet(userId, await dailyNotebook(userId), found.question, found.formulas, found.date ?? askedOn);
  const skill = await skillQuestionForNotes(userId, question);
  return skill ? makeSheet(userId, skill.notebook, skill.question, [], askedOn, skill.href) : null;
}

/** The engineering questions notebook, made the first time it's needed. */
async function dailyNotebook(userId: string) {
  const now = Date.now();
  const library = await readLibrary(userId);
  const held = Object.values(library.items).find((record): record is Notebook => record.kind === 'notebook' && !record.deleted && !record.trashedAt && !!record.daily);
  const notebook: LibraryRecord = held
    ? { ...held, editedAt: now, updatedAt: now }
    : { id: newId(), kind: 'notebook', title: NOTEBOOK_TITLE, daily: true, cover: '#1f7a8c', template: 'engineering', paper: '#ffffff', size: PAGE, createdAt: now, updatedAt: now, editedAt: now };
  await syncLibrary(userId, Number.MAX_SAFE_INTEGER, [notebook], now);
  return notebook.id;
}

/** A new page in `notebookId` with the question laid out at the top, tied to it. */
async function makeSheet(userId: string, notebookId: string, q: Question, formulas: Formula[], date: string, href?: string): Promise<TiedPage | null> {
  const question = q.id;
  const title = q.title;
  const now = Date.now();
  const notebook = { id: notebookId };

  const asked = publicQuestion(q);
  const figure = asked.figure ? await storeFigure(userId, notebook.id, asked.figure) : null;
  const { boxes, h } = layoutQuestionSheet(asked, formulas, shortDate(date), roughHeight, { figure: figure ?? undefined, math: mathSize });

  const pages = (await syncBook(userId, notebook.id, 0, [], now)).items
    .filter((item): item is PageRecord => item.kind === 'page' && !item.deleted)
    .sort((a, b) => a.order - b.order);
  const page: PageRecord = {
    id: newId(), kind: 'page', order: orderBetween(pages[pages.length - 1]?.order, undefined), ...PAGE, h, template: 'engineering', paper: '#ffffff',
    title, questions: [{ id: question, date, title, ...(href ? { href } : {}) }], createdAt: now, updatedAt: now,
  };
  await syncBook(userId, notebook.id, Number.MAX_SAFE_INTEGER, [page], now);

  const elements: Record<string, unknown>[] = [];
  for (const box of boxes) {
    const at = { id: newId(), x: box.x, y: box.y, w: box.w, h: box.h, rot: 0, createdAt: now, updatedAt: now };
    if (box.kind === 'figure') elements.push({ ...at, kind: 'image', file: figure!.file });
    else if (box.kind === 'math') {
      const png = await mathPng(box.latex, box.size).catch(() => null);
      if (png) elements.push({ ...at, kind: 'image', file: await storePicture(userId, notebook.id, png) });
    } else elements.push({ ...at, kind: 'text', text: box.text, size: box.size, color: box.color, font: 'sans', ...(box.bold ? { bold: true } : {}) });
  }
  await syncPage(userId, notebook.id, page.id, Number.MAX_SAFE_INTEGER, elements, now);

  const [made] = await pagesTiedTo(userId, [question]);
  return made ?? null;
}

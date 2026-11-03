import crypto from 'crypto';
import { findQuestion } from '@/lib/daily/store';
import { orderBetween, type LibraryRecord, type Notebook, type PageRecord } from './items';
import { mathToPlain } from './plain-math';
import { pagesTiedTo, readLibrary, syncBook, syncLibrary, syncPage, type TiedPage } from './store';

// A daily question's page in Notes, made from the question itself, so it can be started on one
// device (the question open on a computer) and written on another (the iPad). Notes makes the
// same page when a question is opened in it there; this is that, done here, with what the server
// can't measure left for the device: the link on the title is added the first time it's opened.

const NOTEBOOK_TITLE = 'Engineering questions';
const PAGE = { w: 612, h: 792 };
const MARGIN = 40;
const TEXT_W = PAGE.w - MARGIN * 2;
const LINE_HEIGHT = 1.3;

const newId = () => crypto.randomBytes(12).toString('hex');

/** Near enough how tall a text box will be: the device lays it out properly when it draws it. */
function roughHeight(text: string, size: number, charWidth: number) {
  const perLine = Math.max(1, Math.floor(TEXT_W / (size * charWidth)));
  const lines = text.split('\n').reduce((n, paragraph) => n + Math.max(1, Math.ceil(paragraph.length / perLine)), 0);
  return lines * size * LINE_HEIGHT;
}

const shortDate = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** The page for this question: the one already tied to it, or a new one in the questions notebook. */
export async function pageForQuestion(userId: string, question: string, askedOn: string): Promise<TiedPage | null> {
  const [already] = await pagesTiedTo(userId, [question]);
  if (already) return already;
  const found = await findQuestion(question);
  if (!found) return null;
  const date = found.date ?? askedOn;
  const title = found.question.title;
  const now = Date.now();

  const library = await readLibrary(userId);
  const held = Object.values(library.items).find((record): record is Notebook => record.kind === 'notebook' && !record.deleted && !record.trashedAt && !!record.daily);
  const notebook: LibraryRecord = held
    ? { ...held, editedAt: now, updatedAt: now }
    : { id: newId(), kind: 'notebook', title: NOTEBOOK_TITLE, daily: true, cover: '#1f7a8c', template: 'engineering', paper: '#ffffff', size: PAGE, createdAt: now, updatedAt: now, editedAt: now };
  await syncLibrary(userId, Number.MAX_SAFE_INTEGER, [notebook], now);

  const pages = (await syncBook(userId, notebook.id, 0, [], now)).items
    .filter((item): item is PageRecord => item.kind === 'page' && !item.deleted)
    .sort((a, b) => a.order - b.order);
  const page: PageRecord = {
    id: newId(), kind: 'page', order: orderBetween(pages[pages.length - 1]?.order, undefined), ...PAGE, template: 'engineering', paper: '#ffffff',
    title, questions: [{ id: question, date, title }], createdAt: now, updatedAt: now,
  };
  await syncBook(userId, notebook.id, Number.MAX_SAFE_INTEGER, [page], now);

  const heading = `${title}  ·  ${shortDate(date)}`;
  const prompt = mathToPlain(found.question.prompt);
  const headingH = roughHeight(heading, 13, 0.56);
  const text = (y: number, body: string, size: number, h: number, bold: boolean) => ({
    id: newId(), kind: 'text', x: MARGIN, y, w: TEXT_W, h, rot: 0, text: body, size, color: '#1d1f27', font: 'sans', ...(bold ? { bold: true } : {}), createdAt: now, updatedAt: now,
  });
  const elements = [text(MARGIN, heading, 13, headingH, true)];
  if (prompt) elements.push(text(MARGIN + headingH + 10, prompt, 10.5, roughHeight(prompt, 10.5, 0.5), false));
  await syncPage(userId, notebook.id, page.id, Number.MAX_SAFE_INTEGER, elements, now);

  const [made] = await pagesTiedTo(userId, [question]);
  return made ?? null;
}

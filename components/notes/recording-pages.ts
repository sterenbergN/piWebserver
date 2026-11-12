'use client';

import type { RecordingPage, RecordingRecord } from '@/lib/notes/items';
import { pagesWrittenDuring, type TimedInk } from '@/lib/notes/recording-pages';
import { getNotebookStrokes, getNotebookText } from './db';

// The pages written on during a recording, worked out from the ink this device holds (see
// lib/notes/recording-pages.ts).

async function notebookInk(notebook: string): Promise<TimedInk[]> {
  const [strokes, text] = await Promise.all([getNotebookStrokes(notebook), getNotebookText(notebook)]);
  return [...strokes, ...text];
}

/** For one recording, from what this device holds. */
export async function findRecordingPages(notebook: string, recording: Pick<RecordingRecord, 'startedAt' | 'duration'>) {
  return pagesWrittenDuring(await notebookInk(notebook), recording);
}

/** For recordings made before pages were kept on them: worked out here, reading the notebook's ink once. */
export async function findPagesForOlder(notebook: string, recordings: RecordingRecord[]) {
  const older = recordings.filter((record) => !record.pages);
  if (!older.length) return {};
  const ink = await notebookInk(notebook);
  return Object.fromEntries(older.map((record) => [record.id, pagesWrittenDuring(ink, record)]));
}

/** The pages to show for a recording, best first: kept on it, worked out here, or where it began. */
export function recordingPages(record: RecordingRecord, found?: RecordingPage[]): RecordingPage[] {
  if (record.pages?.length) return record.pages;
  if (found?.length) return found;
  return record.page ? [{ page: record.page, at: 0 }] : [];
}

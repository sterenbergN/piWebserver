import { MAX_RECORDING_PAGES, type RecordingPage, type RecordingRecord } from './items';

// Which pages were written on while a recording was going, and how far into it the writing on
// each one began: those are the pages where tapping the ink plays the recording. Worked out
// from when each stroke and piece of text was made (erasing part of a stroke keeps its time).

/** Up to this long after a recording ends still counts: the last words get written down late. */
const AFTER_MS = 5000;

export type TimedInk = { page: string; createdAt: number; deleted?: boolean };

export function pagesWrittenDuring(elements: TimedInk[], recording: Pick<RecordingRecord, 'startedAt' | 'duration'>): RecordingPage[] {
  const from = recording.startedAt;
  const to = recording.startedAt + recording.duration + AFTER_MS;
  const first = new Map<string, number>();
  for (const element of elements) {
    if (element.deleted || element.createdAt < from || element.createdAt > to) continue;
    const at = element.createdAt - from;
    const held = first.get(element.page);
    if (held === undefined || at < held) first.set(element.page, at);
  }
  return [...first].map(([page, at]) => ({ page, at })).sort((a, b) => a.at - b.at).slice(0, MAX_RECORDING_PAGES);
}


'use client';

import { deleteKv, getKv, putKv } from './db';
import { fmtDuration } from './Recorder';

// Recordings turned into text on the Pi (see lib/notes/transcripts.ts), and the prompt that
// turns that text into a summary in whichever AI app is to hand. A finished transcript is kept
// on the device too, so it can be read with no connection.

export type TranscriptStatus = 'waiting' | 'working' | 'done' | 'failed';
export type TranscriptSegment = { start: number; end: number; text: string };
export type TranscriptInfo = {
  id: string; status: TranscriptStatus; heardTo: number; duration: number; segments: TranscriptSegment[];
  problem?: string; left: number | null; words: number;
};

const cacheKey = (notebook: string, recording: string) => `transcript:${notebook}:${recording}`;

async function call(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.success) throw new Error(body.message || (res.status === 401 ? 'Sign in to turn recordings into text.' : 'The Pi couldn’t be reached.'));
  return body;
}

/** How each of a notebook's recordings is getting on, without their text. */
export async function listTranscripts(notebook: string): Promise<Record<string, TranscriptInfo>> {
  const body = await call(`/api/notes/transcribe?notebook=${encodeURIComponent(notebook)}`);
  return Object.fromEntries((body.items as TranscriptInfo[]).map((item) => [item.id, item]));
}

/** One recording's text: from the Pi, or what this device kept last time if the Pi can't be reached. */
export async function getTranscript(notebook: string, recording: string): Promise<{ transcript: TranscriptInfo | null; offline?: boolean }> {
  try {
    const body = await call(`/api/notes/transcribe?notebook=${encodeURIComponent(notebook)}&recording=${encodeURIComponent(recording)}`);
    const transcript = body.transcript as TranscriptInfo | null;
    if (transcript?.status === 'done') void putKv(cacheKey(notebook, recording), transcript).catch(() => {});
    return { transcript };
  } catch (error) {
    const kept = await getKv<TranscriptInfo>(cacheKey(notebook, recording)).catch(() => undefined);
    if (kept) return { transcript: kept, offline: true };
    throw error;
  }
}

export async function startTranscript(notebook: string, recording: string, again = false) {
  const body = await call('/api/notes/transcribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notebook, recording, again }) });
  if (again) await deleteKv(cacheKey(notebook, recording)).catch(() => {});
  return body.transcript as TranscriptInfo;
}

export async function removeTranscript(notebook: string, recording: string) {
  await deleteKv(cacheKey(notebook, recording)).catch(() => {});
  await call(`/api/notes/transcribe?notebook=${encodeURIComponent(notebook)}&recording=${encodeURIComponent(recording)}`, { method: 'DELETE' });
}

export const transcriptText = (segments: TranscriptSegment[], times = true) =>
  segments.map((s) => (times ? `[${fmtDuration(s.start)}] ${s.text}` : s.text)).join(times ? '\n' : ' ');

/** The prompt to paste into an AI, with the whole transcript in it. */
export function summaryPrompt(title: string, notebookTitle: string, startedAt: number, segments: TranscriptSegment[]) {
  const when = new Date(startedAt).toLocaleString(undefined, { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return [
    `Below is a transcript of a recording from my notes ("${title}", in my notebook "${notebookTitle}", recorded ${when}). It's probably a lecture, class or meeting.`,
    'It was made by a small speech-recognition model, so some words, especially technical, medical or unusual ones, will be misheard. Work out what was really meant from the context, and fix those words in what you write.',
    '',
    'Please write, in plain text (no tables, no markdown headings; simple "-" bullets are fine):',
    '1. Summary: what it was about, in 3 to 5 sentences.',
    '2. Key points: the main ideas, as bullets, in the order they came up.',
    '3. Terms and facts to remember: definitions, numbers, names, formulas.',
    '4. To do: anything said about assignments, exams, deadlines or what to study. Leave this out if there was nothing.',
    '',
    'The times in [brackets] are minutes:seconds into the recording. Mention one next to a point when it would help to go back and listen.',
    '',
    'Transcript:',
    transcriptText(segments),
  ].join('\n');
}

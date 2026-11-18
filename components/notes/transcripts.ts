'use client';

import { buildStrictSummaryPrompt } from '@/lib/notes/recording-summary';
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

/**
 * How each of a notebook's recordings is getting on, without their text, and which ones the
 * Pi has no sound for yet (`missing`: it's still on the device that recorded it).
 */
export async function listTranscripts(notebook: string): Promise<{ texts: Record<string, TranscriptInfo>; missing: string[] }> {
  const body = await call(`/api/notes/transcribe?notebook=${encodeURIComponent(notebook)}`);
  return {
    texts: Object.fromEntries((body.items as TranscriptInfo[]).map((item) => [item.id, item])),
    missing: Array.isArray(body.missing) ? body.missing as string[] : [],
  };
}

/** One recording's text: from the Pi, or what this device kept last time if the Pi can't be reached. */
export async function getTranscript(notebook: string, recording: string): Promise<{ transcript: TranscriptInfo | null; offline?: boolean; onPi?: boolean }> {
  try {
    const body = await call(`/api/notes/transcribe?notebook=${encodeURIComponent(notebook)}&recording=${encodeURIComponent(recording)}`);
    const transcript = body.transcript as TranscriptInfo | null;
    if (transcript?.status === 'done') void putKv(cacheKey(notebook, recording), transcript).catch(() => {});
    return { transcript, onPi: body.onPi !== false };
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
  return buildStrictSummaryPrompt(title, notebookTitle, startedAt, segments);
}

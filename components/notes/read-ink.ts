'use client';

import { packPoints } from '@/lib/notes/geometry';

// Asking the server to read some handwriting right now. Small enough for the Reader to use too,
// without bringing the rest of the notes app along.

export type InkToRead = { id: string; p: number[]; width: number };

export async function readInk(strokes: InkToRead[]) {
  const res = await fetch('/api/notes/read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ strokes }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.success) throw new Error(body.message || 'That couldn’t be read.');
  return body.text as string;
}

/** Strokes kept in some other unit (the Reader's handwritten notes are in card widths), scaled up to about points, for reading. */
export function inkFromScaled(strokes: { pts: number[]; width: number }[], scale: number): InkToRead[] {
  return strokes.map((stroke, i) => ({
    id: `s${i}`,
    p: packPoints(stroke.pts.map((value, j) => (j % 3 === 2 ? value : value * scale))),
    width: stroke.width * scale,
  }));
}

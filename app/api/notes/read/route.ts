import { NextResponse } from 'next/server';
import { ApiError, handleApiError, readJsonObject, requireWorkoutUserId } from '@/lib/workout/api';
import { unpackPoints } from '@/lib/notes/geometry';
import { isId } from '@/lib/notes/items';
import { readerStatus, readStrokes } from '@/lib/notes/recognizer';

// Reading some handwriting right now, for the lasso: turning it into typed text, or filling in
// what a link or keyword says. GET says whether reading is available at all.

const PRIVATE = { 'Cache-Control': 'no-store, private' };
const MAX_STROKES = 600;

export async function GET() {
  try {
    await requireWorkoutUserId();
    return NextResponse.json({ success: true, ...readerStatus() }, { headers: PRIVATE });
  } catch (error) {
    return handleApiError(error, 'Notes reader status failed');
  }
}

export async function POST(request: Request) {
  try {
    await requireWorkoutUserId();
    const body = await readJsonObject(request);
    if (!Array.isArray(body.strokes) || !body.strokes.length || body.strokes.length > MAX_STROKES) throw new ApiError(400, 'Which writing?');
    const strokes = body.strokes.map((raw: unknown, i: number) => {
      const stroke = raw as { id?: unknown; p?: unknown; width?: unknown };
      if (!Array.isArray(stroke.p) || stroke.p.length < 3 || stroke.p.length % 3 || stroke.p.length > 24_000 || !stroke.p.every((n) => typeof n === 'number' && Number.isFinite(n))) {
        throw new ApiError(400, 'That isn’t writing.');
      }
      return { id: isId(stroke.id) ? stroke.id : `s${i}`, pts: unpackPoints(stroke.p as number[]), width: typeof stroke.width === 'number' ? stroke.width : 1 };
    });
    const lines = await readStrokes(strokes, true);
    return NextResponse.json({ success: true, text: lines.map((line) => line.text).join('\n'), lines: lines.map(({ text, box }) => ({ text, box })) }, { headers: PRIVATE });
  } catch (error) {
    if (!(error instanceof ApiError) && readerStatus().state === 'unavailable') {
      return NextResponse.json({ success: false, message: readerStatus().problem || 'Handwriting can’t be read right now.' }, { status: 503 });
    }
    return handleApiError(error, 'Notes reading failed');
  }
}

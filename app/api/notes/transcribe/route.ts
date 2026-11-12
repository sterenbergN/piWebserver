import { NextResponse } from 'next/server';
import { ApiError, handleApiError, readJsonObject, requireWorkoutUserId } from '@/lib/workout/api';
import { isId } from '@/lib/notes/items';
import { forDevice, forget, requestTranscript, resumeTranscripts } from '@/lib/notes/transcripts';

// Recordings turned into text on the Pi. POST starts one (or starts it over), GET says how it's
// going: for one recording with its text, or for the whole notebook without. DELETE stops it
// and forgets it.

const PRIVATE = { 'Cache-Control': 'no-store, private' };

function target(params: URLSearchParams | Record<string, unknown>) {
  const get = (name: string) => (params instanceof URLSearchParams ? params.get(name) : params[name]);
  const notebook = get('notebook');
  const recording = get('recording');
  if (!isId(notebook)) throw new ApiError(400, 'Which notebook?');
  if (recording !== null && recording !== undefined && !isId(recording)) throw new ApiError(400, 'Which recording?');
  return { notebook, recording: (recording as string | null | undefined) ?? null };
}

export async function GET(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const { notebook, recording } = target(new URL(request.url).searchParams);
    const file = await resumeTranscripts(userId, notebook);
    if (recording) {
      const item = file.items[recording];
      return NextResponse.json({ success: true, transcript: item ? forDevice(item, true) : null }, { headers: PRIVATE });
    }
    return NextResponse.json({ success: true, items: Object.values(file.items).map((item) => forDevice(item, false)) }, { headers: PRIVATE });
  } catch (error) {
    return handleApiError(error, 'Notes transcript failed');
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const body = await readJsonObject(request);
    const { notebook, recording } = target(body);
    if (!recording) throw new ApiError(400, 'Which recording?');
    const out = await requestTranscript(userId, notebook, recording, body.again === true);
    if ('gone' in out) throw new ApiError(404, 'That recording isn’t on the Pi.');
    if ('notHere' in out) throw new ApiError(409, 'This recording is still on its way to the Pi. Try again once Notes has synced.');
    return NextResponse.json({ success: true, transcript: forDevice(out.transcript, true) }, { headers: PRIVATE });
  } catch (error) {
    return handleApiError(error, 'Notes transcribing failed');
  }
}

export async function DELETE(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const { notebook, recording } = target(new URL(request.url).searchParams);
    if (!recording) throw new ApiError(400, 'Which recording?');
    await forget(userId, notebook, recording);
    return NextResponse.json({ success: true }, { headers: PRIVATE });
  } catch (error) {
    return handleApiError(error, 'Notes transcript removal failed');
  }
}

import { NextResponse } from 'next/server';
import { ApiError, handleApiError, readJsonObject, requireWorkoutUserId } from '@/lib/workout/api';
import { addYouTube, listJobs, removeJob, retryJob, YouTubeRefused } from '@/lib/reader/youtube';

// Audio books from YouTube for the signed-in account: the list of downloads,
// adding a link, trying a failed one again, and taking one off the list. The
// downloading happens on the Pi in the background (lib/reader/youtube.ts).

const PRIVATE = { 'Cache-Control': 'no-store, private' };

export async function GET() {
  try {
    const userId = await requireWorkoutUserId();
    return NextResponse.json({ success: true, jobs: await listJobs(userId) }, { headers: PRIVATE });
  } catch (error) {
    return handleApiError(error, 'Load YouTube downloads failed');
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const body = await readJsonObject(request);
    if (body.action === 'add') await addYouTube(userId, body.url, body.folder);
    else if (body.action === 'retry') await retryJob(userId, body.id);
    else if (body.action === 'remove') await removeJob(userId, body.id);
    else throw new ApiError(400, 'Unknown action');
    return NextResponse.json({ success: true, jobs: await listJobs(userId) }, { headers: PRIVATE });
  } catch (error) {
    if (error instanceof YouTubeRefused) return handleApiError(new ApiError(400, error.message));
    return handleApiError(error, 'YouTube download failed');
  }
}

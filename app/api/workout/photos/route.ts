import { NextResponse } from 'next/server';
import { ApiError, handleApiError, requireWorkoutUserId } from '@/lib/workout/api';
import { MAX_PHOTO_BYTES, savePhoto } from '@/lib/workout/photos';

/** Upload a machine photo (multipart field "photo"); returns its id for station.photo. */
export async function POST(request: Request) {
  try {
    await requireWorkoutUserId();
    const form = await request.formData().catch(() => null);
    const file = form?.get('photo');
    if (!file || typeof file === 'string') throw new ApiError(400, 'No photo uploaded');
    if (file.size > MAX_PHOTO_BYTES) throw new ApiError(413, 'That photo is too large (12 MB max)');
    if (file.type && !file.type.startsWith('image/')) throw new ApiError(400, 'That file is not an image');
    const id = await savePhoto(Buffer.from(await file.arrayBuffer())).catch(() => {
      throw new ApiError(400, 'Could not read that image');
    });
    return NextResponse.json({ success: true, id });
  } catch (error) {
    return handleApiError(error, 'Photo upload failed');
  }
}

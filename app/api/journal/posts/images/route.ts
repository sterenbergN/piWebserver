import { NextResponse } from 'next/server';
import { ApiError, handleApiError, requireWorkoutUserId } from '@/lib/workout/api';
import { saveImage } from '@/lib/journal/private-posts';

// A picture for a private post, kept in the account's own folder (not public/uploads).

const MAX_BYTES = 25 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const form = await request.formData().catch(() => null);
    const image = form?.get('image');
    if (!(image instanceof File) || !image.type.startsWith('image/') || image.type === 'image/svg+xml' || !image.size) throw new ApiError(400, 'Not an image');
    if (image.size > MAX_BYTES) throw new ApiError(413, 'Pictures can be up to 25 MB');
    let src: string;
    try {
      src = await saveImage(userId, Buffer.from(await image.arrayBuffer()));
    } catch (error) {
      if (error instanceof Error && /unsupported|Input buffer/i.test(error.message)) throw new ApiError(400, 'That picture’s format isn’t supported');
      throw error;
    }
    return NextResponse.json({ success: true, src });
  } catch (error) {
    return handleApiError(error, 'Private post picture upload failed');
  }
}

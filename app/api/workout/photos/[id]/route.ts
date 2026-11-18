import { handleApiError, requireWorkoutUserId } from '@/lib/workout/api';
import { isPhotoId, readPhoto } from '@/lib/workout/photos';

/** A machine photo. Ids are random and unguessable; any workout login can view (gyms can be shared). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireWorkoutUserId();
    const { id } = await params;
    if (!isPhotoId(id)) return new Response('Not found', { status: 404 });
    const photo = await readPhoto(id);
    if (!photo) return new Response('Not found', { status: 404 });
    return new Response(new Uint8Array(photo), {
      headers: {
        'Content-Type': 'image/webp',
        // A photo id never changes content.
        'Cache-Control': 'private, max-age=31536000, immutable',
      },
    });
  } catch (error) {
    return handleApiError(error, 'Photo load failed');
  }
}

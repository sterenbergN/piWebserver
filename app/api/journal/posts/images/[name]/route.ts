import fs from 'fs/promises';
import { handleApiError, jsonError, requireWorkoutUserId } from '@/lib/workout/api';
import { imageFile, isImageName } from '@/lib/journal/private-posts';

// A private post's picture, only for the account it belongs to. Never cached:
// on a shared computer the next person signed in mustn't get it from the browser.
export async function GET(_request: Request, context: { params: Promise<{ name: string }> }) {
  try {
    const userId = await requireWorkoutUserId();
    const { name } = await context.params;
    if (!isImageName(name)) return jsonError(404, 'Not found');
    const data = await fs.readFile(imageFile(userId, name)).catch(() => null);
    if (!data) return jsonError(404, 'Not found');
    return new Response(new Uint8Array(data), {
      headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff' },
    });
  } catch (error) {
    return handleApiError(error, 'Private post picture failed');
  }
}

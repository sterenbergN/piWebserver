import { NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/lib/workout/api';
import { getAuthenticatedWorkoutUserId, isAdminAuthenticated } from '@/lib/security/server-auth';
import { MAX_RECIPE_PHOTO_BYTES, saveRecipePhoto } from '@/lib/recipes/photos';

/** Upload a dish photo (multipart field "image"); returns the src to put on the recipe. */
export async function POST(request: Request) {
  try {
    const [workoutUser, admin] = await Promise.all([getAuthenticatedWorkoutUserId(), isAdminAuthenticated()]);
    if (!workoutUser && !admin) throw new ApiError(401, 'Sign in to upload recipe photos.');

    const form = await request.formData().catch(() => null);
    const image = form?.get('image');
    if (!(image instanceof File) || !image.size) throw new ApiError(400, 'Choose a photo to upload.');
    if (image.type && (!image.type.startsWith('image/') || image.type === 'image/svg+xml')) {
      throw new ApiError(400, 'That file is not a photo.');
    }
    if (image.size > MAX_RECIPE_PHOTO_BYTES) throw new ApiError(413, 'Photos can be up to 15 MB.');

    const src = await saveRecipePhoto(Buffer.from(await image.arrayBuffer())).catch(() => {
      throw new ApiError(400, 'That photo’s format isn’t supported.');
    });
    return NextResponse.json({ success: true, src });
  } catch (error) {
    return handleApiError(error, 'Recipe photo upload failed');
  }
}

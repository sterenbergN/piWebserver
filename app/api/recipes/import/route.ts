import { NextResponse } from 'next/server';
import { createLimiter } from '@/lib/security/rate-limit';
import { getAuthenticatedWorkoutUserId, isAdminAuthenticated } from '@/lib/security/server-auth';
import { ApiError, handleApiError, readJsonObject } from '@/lib/workout/api';
import { recipeFromHtml } from '@/lib/recipes/import';
import { ImportFetchError, fetchPublic } from '@/lib/recipes/import-fetch';
import { MAX_RECIPE_PHOTO_BYTES, saveRecipePhoto } from '@/lib/recipes/photos';

export const dynamic = 'force-dynamic';

// Each import makes outside requests from the Pi, so it's for accounts only and kept to a sane rate.
const limiter = createLimiter({ max: 20, windowMs: 10 * 60_000 });

/** Read a recipe from a web page. Nothing is saved: the editor opens with the result to check over. */
export async function POST(request: Request) {
  try {
    const [userId, admin] = await Promise.all([getAuthenticatedWorkoutUserId(), isAdminAuthenticated()]);
    if (!userId && !admin) throw new ApiError(401, 'Sign in to import recipes.');

    const key = userId || 'admin';
    const wait = limiter.retryAfter(key);
    if (wait) throw new ApiError(429, `That’s a lot of imports. Try again in ${Math.ceil(wait / 60)} min.`);
    limiter.hit(key);

    const body = await readJsonObject(request);
    const url = typeof body.url === 'string' ? body.url.trim().slice(0, 2000) : '';
    if (!url) throw new ApiError(400, 'Paste a link to a recipe.');

    const page = await fetchPublic(url);
    if (page.contentType && !/html|xml|text\/plain/i.test(page.contentType)) {
      throw new ImportFetchError('That link isn’t a web page.');
    }
    const recipe = recipeFromHtml(page.body.toString('utf8'), page.finalUrl);
    if (!recipe) throw new ImportFetchError('Couldn’t find a recipe on that page. Copy the recipe text and paste it instead.');

    // The photo is a nice-to-have: the recipe is still worth having without it.
    let photo: string | undefined;
    if (recipe.imageUrl) {
      try {
        const image = await fetchPublic(recipe.imageUrl, { accept: 'image/*', maxBytes: MAX_RECIPE_PHOTO_BYTES });
        if (/^image\//i.test(image.contentType) && !/svg/i.test(image.contentType)) photo = await saveRecipePhoto(image.body);
      } catch {
        /* imported without a photo */
      }
    }

    const { imageUrl: _imageUrl, ...rest } = recipe;
    return NextResponse.json({ success: true, recipe: { ...rest, photo } });
  } catch (error) {
    if (error instanceof ImportFetchError) return NextResponse.json({ success: false, message: error.message }, { status: 422 });
    return handleApiError(error, 'Recipe import failed');
  }
}

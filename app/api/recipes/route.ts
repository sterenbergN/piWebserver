import { NextResponse } from 'next/server';
import path from 'path';
import { readJson, updateJson } from '@/lib/json-store';
import { getAuthenticatedWorkoutUserId, isAdminAuthenticated } from '@/lib/security/server-auth';
import { ApiError, handleApiError, readJsonObject } from '@/lib/workout/api';
import { removeRecipePhoto } from '@/lib/recipes/photos';
import {
  DEFAULT_RECIPES,
  RecipeInputError,
  normalizeRecipe,
  normalizeRecipesData,
  publicRecipe,
  type Recipe,
  type RecipesData,
} from '@/lib/recipes/recipes';

export const dynamic = 'force-dynamic';

const RECIPES_FILE = path.join(process.cwd(), '.data', 'recipes', 'recipes.json');

function defaultData(): RecipesData {
  return { version: 1, recipes: structuredClone(DEFAULT_RECIPES) };
}

/** Anyone signed in (workout account or admin) may add, edit and log cooks. */
async function getViewer() {
  const [userId, isAdmin] = await Promise.all([getAuthenticatedWorkoutUserId(), isAdminAuthenticated()]);
  return { userId: userId || null, isAdmin, canEdit: Boolean(userId) || isAdmin };
}

/** Deleting is for the admin or whoever created the recipe. */
const canDelete = (viewer: Awaited<ReturnType<typeof getViewer>>, recipe: Recipe) =>
  viewer.isAdmin || (Boolean(viewer.userId) && recipe.ownerId === viewer.userId);

/** A photo no recipe uses any more (so it can be deleted), or undefined. */
const unusedPhoto = (recipes: Recipe[], photo: string | undefined) =>
  photo && !recipes.some((r) => r.photo === photo) ? photo : undefined;

export async function GET() {
  try {
    const [raw, viewer] = await Promise.all([readJson<RecipesData>(RECIPES_FILE, defaultData()), getViewer()]);
    // Imported recipes stay private by default: they're someone else's writing and photos.
    const recipes = normalizeRecipesData(raw).recipes.filter((r) => viewer.canEdit || !r.private);
    return NextResponse.json({
      success: true,
      recipes: recipes.map(publicRecipe),
      canEdit: viewer.canEdit,
      deletableIds: recipes.filter((r) => canDelete(viewer, r)).map((r) => r.id),
    });
  } catch (error) {
    return handleApiError(error, 'Load recipes failed');
  }
}

export async function POST(request: Request) {
  try {
    const viewer = await getViewer();
    if (!viewer.canEdit) throw new ApiError(401, 'Sign in to add or edit recipes.');
    const body = await readJsonObject(request);
    const type = String(body.type || '');
    const now = new Date().toISOString();

    if (type === 'save') {
      let replacedPhoto: string | undefined;
      const saved = await updateJson<RecipesData, Recipe>(RECIPES_FILE, defaultData(), (stored) => {
        const data = normalizeRecipesData(stored);
        const input = body.recipe && typeof body.recipe === 'object' ? (body.recipe as any) : body;
        const existingIdx = typeof input?.id === 'string' ? data.recipes.findIndex((r) => r.id === input.id) : -1;
        const existing = existingIdx >= 0 ? data.recipes[existingIdx] : undefined;

        let normalized: Recipe;
        try {
          normalized = normalizeRecipe(input, existing, now);
        } catch (err) {
          if (err instanceof RecipeInputError) throw new ApiError(400, err.message);
          throw err;
        }
        if (!existing && viewer.userId) normalized.ownerId = viewer.userId;

        // Ensure unique slug among other recipes
        const baseSlug = normalized.slug;
        let slug = baseSlug;
        let n = 2;
        while (data.recipes.some((r) => r.id !== normalized.id && r.slug === slug)) {
          slug = `${baseSlug}-${n++}`;
        }
        normalized.slug = slug;

        if (existingIdx >= 0) {
          data.recipes[existingIdx] = normalized;
        } else {
          data.recipes.unshift(normalized);
        }
        replacedPhoto = unusedPhoto(data.recipes, existing?.photo);
        stored.version = 1;
        stored.recipes = data.recipes;
        return normalized;
      });
      await removeRecipePhoto(replacedPhoto);
      return NextResponse.json({ success: true, recipe: publicRecipe(saved), canDelete: canDelete(viewer, saved) });
    }

    if (type === 'delete') {
      const id = String(body.id || '').trim();
      if (!id) throw new ApiError(400, 'Missing recipe id.');
      const unused = await updateJson<RecipesData, string | undefined>(RECIPES_FILE, defaultData(), (stored) => {
        const data = normalizeRecipesData(stored);
        const recipe = data.recipes.find((r) => r.id === id);
        if (!recipe) throw new ApiError(404, 'Recipe not found.');
        if (!canDelete(viewer, recipe)) throw new ApiError(403, 'Only whoever added this recipe can delete it.');
        stored.version = 1;
        stored.recipes = data.recipes.filter((r) => r.id !== id);
        return unusedPhoto(stored.recipes, recipe.photo);
      });
      await removeRecipePhoto(unused);
      return NextResponse.json({ success: true });
    }

    // Log a cook, or take back one logged by mistake (`uncooked`, with the
    // lastCookedAt from before, which the page kept).
    if (type === 'cooked' || type === 'uncooked') {
      const id = String(body.id || '').trim();
      if (!id) throw new ApiError(400, 'Missing recipe id.');
      const updated = await updateJson<RecipesData, Recipe>(RECIPES_FILE, defaultData(), (stored) => {
        const data = normalizeRecipesData(stored);
        const recipe = data.recipes.find((r) => r.id === id);
        if (!recipe) throw new ApiError(404, 'Recipe not found.');
        if (type === 'cooked') {
          recipe.timesCooked = (recipe.timesCooked || 0) + 1;
          recipe.lastCookedAt = now;
          if (Number(body.rating) >= 1 && Number(body.rating) <= 10) {
            recipe.rating = Math.round(Number(body.rating) * 10) / 10;
          }
          if (typeof body.notes === 'string') {
            const trimmed = body.notes.trim().slice(0, 1000);
            recipe.notes = trimmed || undefined;
          }
        } else {
          recipe.timesCooked = Math.max(0, (recipe.timesCooked || 0) - 1);
          const previous = typeof body.previousLastCookedAt === 'string' ? body.previousLastCookedAt : '';
          if (previous && !Number.isNaN(Date.parse(previous))) recipe.lastCookedAt = new Date(previous).toISOString();
          else delete recipe.lastCookedAt;
        }
        recipe.updatedAt = now;
        stored.version = 1;
        stored.recipes = data.recipes;
        return recipe;
      });
      return NextResponse.json({ success: true, recipe: publicRecipe(updated) });
    }

    if (type === 'rate') {
      const id = String(body.id || '').trim();
      const rating = Number(body.rating);
      if (!id || !(rating >= 1 && rating <= 10)) throw new ApiError(400, 'Rate it from 1 to 10.');
      const updated = await updateJson<RecipesData, Recipe>(RECIPES_FILE, defaultData(), (stored) => {
        const data = normalizeRecipesData(stored);
        const recipe = data.recipes.find((r) => r.id === id);
        if (!recipe) throw new ApiError(404, 'Recipe not found.');
        recipe.rating = Math.round(rating * 10) / 10;
        recipe.updatedAt = now;
        stored.version = 1;
        stored.recipes = data.recipes;
        return recipe;
      });
      return NextResponse.json({ success: true, recipe: publicRecipe(updated) });
    }

    throw new ApiError(400, 'Unknown recipe action.');
  } catch (error) {
    return handleApiError(error, 'Update recipes failed');
  }
}

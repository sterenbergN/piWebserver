import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import { NextResponse } from 'next/server';
import path from 'path';
import { readJson, updateJson } from '@/lib/json-store';
import { getWorkoutUserIdFromToken, isAdminTokenValid } from '@/lib/security/auth';
import { getAuthenticatedWorkoutUserId, isAdminAuthenticated } from '@/lib/security/server-auth';
import { ApiError, handleApiError, readJsonObject } from '@/lib/workout/api';
import { removeRecipePhoto } from '@/lib/recipes/photos';
import {
  DEFAULT_RECIPES,
  RecipeInputError,
  detachSubRecipe,
  normalizeRating,
  normalizeRecipe,
  normalizeRecipesData,
  publicRecipe,
  type CookLogEntry,
  type Recipe,
  type RecipesData,
} from '@/lib/recipes/recipes';

export const dynamic = 'force-dynamic';

const MAX_COOK_LOG_ENTRIES = 50;

const recipesFile = () => path.join(process.cwd(), '.data', 'recipes', 'recipes.json');

function defaultData(): RecipesData {
  return { version: 1, recipes: structuredClone(DEFAULT_RECIPES) };
}

function parseCookieHeader(header: string | null): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) {
      try {
        out[key] = decodeURIComponent(val);
      } catch {
        out[key] = val;
      }
    }
  }
  return out;
}

/** Anyone signed in (workout account or admin) may add, edit and log cooks. */
async function getViewer(request?: Request) {
  try {
    const [userId, isAdmin] = await Promise.all([getAuthenticatedWorkoutUserId(), isAdminAuthenticated()]);
    return { userId: userId || null, isAdmin, canEdit: Boolean(userId) || isAdmin };
  } catch {
    // Outside a Next.js request scope (e.g. unit tests calling GET/POST directly),
    // verify the same signed cookies directly from the Request.
  }

  let workoutCookie: string | undefined;
  let adminCookie: string | undefined;
  if (request) {
    const cookiesApi = (request as { cookies?: { get?: (name: string) => { value?: string } | undefined } }).cookies;
    if (cookiesApi && typeof cookiesApi.get === 'function') {
      workoutCookie = cookiesApi.get('workout_auth')?.value;
      adminCookie = cookiesApi.get('pi_auth')?.value;
    } else {
      const parsed = parseCookieHeader(request.headers.get('cookie'));
      workoutCookie = parsed.workout_auth;
      adminCookie = parsed.pi_auth;
    }
  }

  let userId = getWorkoutUserIdFromToken(workoutCookie);
  if (userId) {
    try {
      const rawUsers = JSON.parse(await fs.readFile(path.join(process.cwd(), '.data', 'workouts', 'users.json'), 'utf-8')) as {
        deletedUserIds?: unknown;
      };
      if (Array.isArray(rawUsers?.deletedUserIds) && rawUsers.deletedUserIds.includes(userId)) {
        userId = null;
      }
    } catch {
      // Missing users.json does not invalidate signed workout tokens.
    }
  }
  const isAdmin = isAdminTokenValid(adminCookie);
  return { userId: userId || null, isAdmin, canEdit: Boolean(userId) || isAdmin };
}

type Viewer = Awaited<ReturnType<typeof getViewer>>;

/** Strict privacy: public recipes are open; private recipes belong to their creator or the admin. */
const canView = (viewer: Viewer, recipe: Recipe) =>
  viewer.isAdmin || (Boolean(viewer.userId) && recipe.ownerId === viewer.userId) || !recipe.private;

/** Editing or deleting is for the admin or whoever created the recipe. */
const canModify = (viewer: Viewer, recipe: Recipe) =>
  viewer.isAdmin || (Boolean(viewer.userId) && recipe.ownerId === viewer.userId);

/** A photo no recipe uses any more (so it can be deleted), or undefined. */
const unusedPhoto = (recipes: Recipe[], photo: string | undefined) =>
  photo && !recipes.some((r) => r.photo === photo) ? photo : undefined;

function applyPinnedNotes(recipe: Recipe, rawNotes: unknown) {
  if (typeof rawNotes !== 'string') return;
  const trimmed = rawNotes.trim().slice(0, 2000);
  if (trimmed) recipe.notes = trimmed;
  else delete recipe.notes;
}

function parsePositiveServings(raw: unknown): number | undefined {
  if (typeof raw !== 'number' && typeof raw !== 'string') return undefined;
  const n = typeof raw === 'number' ? raw : raw.trim() ? Number(raw.trim()) : NaN;
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.round(n * 100) / 100 || undefined;
}

function prependCookLogEntry(recipe: Recipe, entry: CookLogEntry) {
  recipe.cookLog = [entry, ...(Array.isArray(recipe.cookLog) ? recipe.cookLog : [])].slice(0, MAX_COOK_LOG_ENTRIES);
}

function recipeSuccessResponse(recipe: Recipe) {
  const data = publicRecipe(recipe);
  return NextResponse.json({ status: 'success', success: true, data, recipe: data });
}

export async function GET(request?: Request) {
  try {
    const [raw, viewer] = await Promise.all([readJson<RecipesData>(recipesFile(), defaultData()), getViewer(request)]);
    // Imported/AI recipes stay private by default and are visible only to their owner or admin.
    const recipes = normalizeRecipesData(raw).recipes.filter((r) => canView(viewer, r));
    const ownedIds = recipes.filter((r) => canModify(viewer, r)).map((r) => r.id);
    return NextResponse.json({
      success: true,
      recipes: recipes.map(publicRecipe),
      canEdit: viewer.canEdit,
      editableIds: ownedIds,
      deletableIds: ownedIds,
    });
  } catch (error) {
    return handleApiError(error, 'Load recipes failed');
  }
}

export async function POST(request: Request) {
  try {
    const viewer = await getViewer(request);
    if (!viewer.canEdit) throw new ApiError(401, 'Sign in to add or edit recipes.');
    const body = await readJsonObject(request);
    const type = String(body.type || '');
    const now = new Date().toISOString();
    const storeFile = recipesFile();

    if (type === 'save') {
      let replacedPhoto: string | undefined;
      const saved = await updateJson<RecipesData, Recipe>(storeFile, defaultData(), (stored) => {
        const data = normalizeRecipesData(stored);
        const input = body.recipe && typeof body.recipe === 'object' ? (body.recipe as any) : body;
        const existingIdx = typeof input?.id === 'string' ? data.recipes.findIndex((r) => r.id === input.id) : -1;
        const existing = existingIdx >= 0 ? data.recipes[existingIdx] : undefined;
        if (existing && !canModify(viewer, existing)) {
          throw new ApiError(403, 'Only whoever added this recipe can edit it.');
        }

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
      const allowed = canModify(viewer, saved);
      return NextResponse.json({ success: true, recipe: publicRecipe(saved), canDelete: allowed, canModify: allowed });
    }

    if (type === 'delete') {
      const id = String(body.id || '').trim();
      if (!id) throw new ApiError(400, 'Missing recipe id.');
      const unused = await updateJson<RecipesData, string | undefined>(storeFile, defaultData(), (stored) => {
        const data = normalizeRecipesData(stored);
        const recipe = data.recipes.find((r) => r.id === id);
        if (!recipe) throw new ApiError(404, 'Recipe not found.');
        if (!canModify(viewer, recipe)) throw new ApiError(403, 'Only whoever added this recipe can delete it.');
        stored.version = 1;
        // Recipes that use it as a part keep a copy of its steps, so deleting it breaks nothing.
        stored.recipes = data.recipes.filter((r) => r.id !== id).map((r) => detachSubRecipe(r, recipe));
        return unusedPhoto(stored.recipes, recipe.photo);
      });
      await removeRecipePhoto(unused);
      return NextResponse.json({ success: true });
    }

    // Log a cook (with optional rating, pinned notes, and CookLogEntry), or undo the most recent cook.
    if (type === 'cooked' || type === 'uncooked') {
      const id = String(body.id || '').trim();
      if (!id) throw new ApiError(400, 'Missing recipe id.');
      const isUndo = type === 'uncooked' || body.undo === true;
      const updated = await updateJson<RecipesData, Recipe>(storeFile, defaultData(), (stored) => {
        const data = normalizeRecipesData(stored);
        const recipe = data.recipes.find((r) => r.id === id);
        if (!recipe) throw new ApiError(404, 'Recipe not found.');
        if (!canView(viewer, recipe)) throw new ApiError(403, 'You cannot access this recipe.');

        if (isUndo) {
          recipe.timesCooked = Math.max(0, (recipe.timesCooked || 0) - 1);
          if (Array.isArray(recipe.cookLog) && recipe.cookLog.length > 0) {
            recipe.cookLog.shift();
          }
          if (recipe.timesCooked === 0) {
            delete recipe.lastCookedAt;
          } else if (recipe.cookLog?.[0]?.cookedAt) {
            recipe.lastCookedAt = recipe.cookLog[0].cookedAt;
          } else {
            const previous = typeof body.previousLastCookedAt === 'string' ? body.previousLastCookedAt : '';
            if (previous && !Number.isNaN(Date.parse(previous))) recipe.lastCookedAt = new Date(previous).toISOString();
            else delete recipe.lastCookedAt;
          }
        } else {
          recipe.timesCooked = (recipe.timesCooked || 0) + 1;
          recipe.lastCookedAt = now;

          const entryRating = normalizeRating(body.rating);
          if (body.rating === 0 || body.rating === null) {
            delete recipe.rating;
          } else if (entryRating !== undefined) {
            recipe.rating = entryRating;
          }

          applyPinnedNotes(recipe, body.notes);

          const cookNote = typeof body.cookNote === 'string' ? body.cookNote.trim().slice(0, 1000) : '';
          const servings = parsePositiveServings(body.servings);
          prependCookLogEntry(recipe, {
            id: randomUUID(),
            cookedAt: now,
            ...(servings !== undefined ? { servings } : {}),
            ...(entryRating !== undefined ? { rating: entryRating } : {}),
            ...(cookNote ? { note: cookNote } : {}),
          });
        }

        recipe.updatedAt = now;
        stored.version = 1;
        stored.recipes = data.recipes;
        return recipe;
      });
      return recipeSuccessResponse(updated);
    }

    if (type === 'rate') {
      const id = String(body.id || '').trim();
      if (!id) throw new ApiError(400, 'Missing recipe id.');

      const hasRatingField = 'rating' in body && body.rating !== undefined;
      const clearingRating = body.rating === 0 || body.rating === null;
      const parsedRating = hasRatingField && !clearingRating ? normalizeRating(body.rating) : undefined;
      if (hasRatingField && !clearingRating && parsedRating === undefined) {
        throw new ApiError(400, 'Rate it from 1 to 10.');
      }

      const hasNotesField = typeof body.notes === 'string';
      const hasCookNoteField = typeof body.cookNote === 'string';
      const cookEntryId = typeof body.cookEntryId === 'string' ? body.cookEntryId.trim() : '';
      if (!hasRatingField && !hasNotesField && !hasCookNoteField && body.addLogEntry !== true) {
        throw new ApiError(400, 'Rate it from 1 to 10.');
      }

      const updated = await updateJson<RecipesData, Recipe>(storeFile, defaultData(), (stored) => {
        const data = normalizeRecipesData(stored);
        const recipe = data.recipes.find((r) => r.id === id);
        if (!recipe) throw new ApiError(404, 'Recipe not found.');
        if (!canView(viewer, recipe)) throw new ApiError(403, 'You cannot access this recipe.');

        if (clearingRating) {
          delete recipe.rating;
        } else if (parsedRating !== undefined) {
          recipe.rating = parsedRating;
        }

        applyPinnedNotes(recipe, body.notes);

        const cookNote = hasCookNoteField ? body.cookNote.trim().slice(0, 1000) : '';
        const servings = parsePositiveServings(body.servings);
        const existingEntry = cookEntryId && Array.isArray(recipe.cookLog) ? recipe.cookLog.find((e) => e.id === cookEntryId) : undefined;
        if (existingEntry) {
          if (hasCookNoteField) {
            if (cookNote) existingEntry.note = cookNote;
            else delete existingEntry.note;
          }
          if (clearingRating) delete existingEntry.rating;
          else if (parsedRating !== undefined) existingEntry.rating = parsedRating;
          if (servings !== undefined) existingEntry.servings = servings;
        } else if (cookNote || body.addLogEntry === true) {
          prependCookLogEntry(recipe, {
            id: randomUUID(),
            cookedAt: now,
            ...(servings !== undefined ? { servings } : {}),
            ...(parsedRating !== undefined ? { rating: parsedRating } : {}),
            ...(cookNote ? { note: cookNote } : {}),
          });
        }

        recipe.updatedAt = now;
        stored.version = 1;
        stored.recipes = data.recipes;
        return recipe;
      });
      return recipeSuccessResponse(updated);
    }

    if (type === 'notes') {
      const id = String(body.id || '').trim();
      if (!id) throw new ApiError(400, 'Missing recipe id.');

      const hasCookNoteField = typeof body.cookNote === 'string';
      const cookNote = hasCookNoteField ? body.cookNote.trim().slice(0, 1000) : '';
      const cookEntryId = typeof body.cookEntryId === 'string' ? body.cookEntryId.trim() : '';
      const entryRating = normalizeRating(body.rating);
      const servings = parsePositiveServings(body.servings);

      const updated = await updateJson<RecipesData, Recipe>(storeFile, defaultData(), (stored) => {
        const data = normalizeRecipesData(stored);
        const recipe = data.recipes.find((r) => r.id === id);
        if (!recipe) throw new ApiError(404, 'Recipe not found.');
        if (!canView(viewer, recipe)) throw new ApiError(403, 'You cannot access this recipe.');

        applyPinnedNotes(recipe, body.notes);

        const existingEntry = cookEntryId && Array.isArray(recipe.cookLog) ? recipe.cookLog.find((e) => e.id === cookEntryId) : undefined;
        if (existingEntry) {
          if (hasCookNoteField) {
            if (cookNote) existingEntry.note = cookNote;
            else delete existingEntry.note;
          }
          if (body.rating === 0 || body.rating === null) delete existingEntry.rating;
          else if (entryRating !== undefined) existingEntry.rating = entryRating;
          if (servings !== undefined) existingEntry.servings = servings;
        } else if (cookNote || body.addLogEntry === true) {
          prependCookLogEntry(recipe, {
            id: randomUUID(),
            cookedAt: now,
            ...(servings !== undefined ? { servings } : {}),
            ...(entryRating !== undefined ? { rating: entryRating } : {}),
            ...(cookNote ? { note: cookNote } : {}),
          });
        }

        if (typeof body.deleteLogEntryId === 'string' && Array.isArray(recipe.cookLog)) {
          recipe.cookLog = recipe.cookLog.filter((e) => e.id !== body.deleteLogEntryId);
        }

        recipe.updatedAt = now;
        stored.version = 1;
        stored.recipes = data.recipes;
        return recipe;
      });
      return recipeSuccessResponse(updated);
    }

    throw new ApiError(400, 'Unknown recipe action.');
  } catch (error) {
    return handleApiError(error, 'Update recipes failed');
  }
}

import { NextResponse } from 'next/server';
import { readJson, updateJson } from '@/lib/json-store';
import { describeHousehold, householdFor } from '@/lib/chores/households';
import { getAuthenticatedWorkoutUserId, isAdminAuthenticated } from '@/lib/security/server-auth';
import { ApiError, handleApiError, readJsonObject } from '@/lib/workout/api';
import { foldKitchen, householdKitchenFile, personalKitchenFile } from '@/lib/recipes/kitchen-store';
import { applyKitchenAction, emptyKitchen, mergeKitchens, newKitchenId, normalizeKitchen, type KitchenAction, type KitchenState } from '@/lib/recipes/kitchen';

export const dynamic = 'force-dynamic';

// What a household has at home, its meal plans and its shopping list, so the
// plan made on one laptop is there on everyone's phone at the store. Signed-out
// visitors keep theirs on the device only.

const MAX_ACTIONS = 200;

async function openKitchen() {
  const [userId, admin] = await Promise.all([getAuthenticatedWorkoutUserId(), isAdminAuthenticated()]);
  if (userId) {
    const household = await householdFor(userId);
    const file = householdKitchenFile(household.id);
    // A kitchen from before they were shared moves in the first time it's opened.
    await foldKitchen(personalKitchenFile(userId), file);
    return { file, userId, household };
  }
  if (admin) return { file: personalKitchenFile('admin'), userId: null, household: null };
  throw new ApiError(401, 'Sign in to sync your kitchen.');
}

export async function GET() {
  try {
    const { file, userId, household } = await openKitchen();
    const stored = await readJson<KitchenState | null>(file, null);
    return NextResponse.json({
      success: true,
      kitchen: stored ? normalizeKitchen(stored) : null,
      household: household && userId ? await describeHousehold(household, userId) : null,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return handleApiError(error, 'Load kitchen failed');
  }
}

/**
 * Apply changes (`{ actions }`) on top of what's stored, whoever saved it last,
 * and answer with the result. `{ add }` is the short way to put one thing on the list.
 */
export async function POST(request: Request) {
  try {
    const { file, userId } = await openKitchen();
    const body = await readJsonObject(request);
    const text = typeof body.add === 'string' ? body.add.trim() : '';
    const actions: KitchenAction[] = text ? [{ type: 'list-item', id: newKitchenId(), text }] : Array.isArray(body.actions) ? body.actions : [];
    if (!actions.length) throw new ApiError(400, 'Nothing to change.');
    if (actions.length > MAX_ACTIONS) throw new ApiError(400, 'Too many changes at once.');

    const created = (await readJson<KitchenState | null>(file, null)) === null;
    const kitchen = await updateJson<KitchenState, KitchenState>(file, emptyKitchen(), (stored) => {
      let next = normalizeKitchen(stored);
      for (const action of actions) {
        // Whoever is signed in added it, whatever the browser says.
        next = normalizeKitchen(applyKitchenAction(next, action?.type === 'list-item' ? { ...action, by: userId ?? undefined } : action));
      }
      Object.assign(stored, next);
      return next;
    });
    return NextResponse.json({ success: true, created, kitchen });
  } catch (error) {
    return handleApiError(error, 'Save kitchen failed');
  }
}

/** Bring what a device had before signing in into the kitchen, leaving what's there alone. */
export async function PUT(request: Request) {
  try {
    const { file } = await openKitchen();
    const body = await readJsonObject(request);
    const incoming = normalizeKitchen(body.kitchen);
    await updateJson<KitchenState, void>(file, emptyKitchen(), (stored) => {
      Object.assign(stored, mergeKitchens(normalizeKitchen(stored), incoming));
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error, 'Save kitchen failed');
  }
}

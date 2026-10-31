import crypto from 'crypto';
import { NextResponse } from 'next/server';
import path from 'path';
import { readJson, updateJson, writeJsonAtomic } from '@/lib/json-store';
import { getAuthenticatedWorkoutUserId, isAdminAuthenticated } from '@/lib/security/server-auth';
import { ApiError, handleApiError, readJsonObject } from '@/lib/workout/api';
import { addListItem, emptyKitchen, normalizeKitchen, type KitchenState } from '@/lib/recipes/kitchen';

export const dynamic = 'force-dynamic';

// What each account has at home, its meal plans and its shopping list, so the
// plan made on a laptop is there on the phone at the store. Signed-out visitors
// keep theirs on the device only.

async function kitchenFile() {
  const [userId, admin] = await Promise.all([getAuthenticatedWorkoutUserId(), isAdminAuthenticated()]);
  const owner = userId || (admin ? 'admin' : null);
  if (!owner) throw new ApiError(401, 'Sign in to sync your kitchen.');
  const name = crypto.createHash('sha256').update(owner).digest('hex').slice(0, 32);
  return path.join(process.cwd(), '.data', 'recipes', 'kitchen', `${name}.json`);
}

export async function GET() {
  try {
    const stored = await readJson<KitchenState | null>(await kitchenFile(), null);
    return NextResponse.json({ success: true, kitchen: stored ? normalizeKitchen(stored) : null });
  } catch (error) {
    return handleApiError(error, 'Load kitchen failed');
  }
}

/** Add one thing to the list (`{ add }`) on top of what's stored, whichever device last saved it. */
export async function POST(request: Request) {
  try {
    const file = await kitchenFile();
    const body = await readJsonObject(request);
    const text = typeof body.add === 'string' ? body.add.trim() : '';
    if (!text) throw new ApiError(400, 'Nothing to add.');
    const created = (await readJson<KitchenState | null>(file, null)) === null;
    await updateJson<KitchenState, void>(file, emptyKitchen(), (stored) => {
      Object.assign(stored, addListItem(normalizeKitchen(stored), text));
    });
    return NextResponse.json({ success: true, created });
  } catch (error) {
    return handleApiError(error, 'Add to list failed');
  }
}

export async function PUT(request: Request) {
  try {
    const file = await kitchenFile();
    const body = await readJsonObject(request);
    await writeJsonAtomic(file, normalizeKitchen(body.kitchen));
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error, 'Save kitchen failed');
  }
}

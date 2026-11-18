import fs from 'fs/promises';
import path from 'path';
import { cookies } from 'next/headers';
import { getWorkoutUserIdFromToken, isAdminTokenValid } from '@/lib/security/auth';

const USERS_FILE = () => path.join(process.cwd(), '.data', 'workouts', 'users.json');

async function isWorkoutUserDeleted(userId: string): Promise<boolean> {
  try {
    const raw = JSON.parse(await fs.readFile(USERS_FILE(), 'utf-8')) as { deletedUserIds?: unknown };
    return Array.isArray(raw?.deletedUserIds) && raw.deletedUserIds.includes(userId);
  } catch {
    // Missing or unreadable users.json must not invalidate valid/synthetic tokens.
    return false;
  }
}

export async function isAdminAuthenticated() {
  const cookieStore = await cookies();
  return isAdminTokenValid(cookieStore.get('pi_auth')?.value);
}

export async function getAuthenticatedWorkoutUserId() {
  const cookieStore = await cookies();
  const userId = getWorkoutUserIdFromToken(cookieStore.get('workout_auth')?.value);
  if (!userId) return null;
  if (await isWorkoutUserDeleted(userId)) return null;
  return userId;
}

import { NextResponse } from 'next/server';
import { handleApiError, readJsonObject, requireWorkoutUserId } from '@/lib/workout/api';
import { isAdminAuthenticated } from '@/lib/security/server-auth';
import { normalizeGolfUser } from '@/lib/golf/course';
import { readGolfUser, readLegacyRounds, updateGolfUser } from '@/lib/golf/store';
import { findWorkoutUser } from '@/lib/workout/users';

/**
 * Your bag and settings, your name for new rounds, and (for the site admin) how
 * many rounds the old Tools scorecard saved that haven't been brought over yet.
 */
export async function GET() {
  try {
    const userId = await requireWorkoutUserId();
    const [user, account, isAdmin] = await Promise.all([readGolfUser(userId), findWorkoutUser(userId), isAdminAuthenticated()]);
    const legacy = isAdmin ? await readLegacyRounds() : null;
    return NextResponse.json(
      { success: true, userId, name: String(account?.name || account?.username || 'Me').slice(0, 40), user, legacy: legacy ? { count: legacy.length, names: legacyNames(legacy) } : null },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return handleApiError(error, 'Golf settings');
  }
}

/** The player names in old rounds, most rounds first, so you can say which one is you. */
function legacyNames(games: unknown[]) {
  const counts = new Map<string, number>();
  for (const g of games as { players?: { name?: unknown }[] }[]) {
    for (const p of g?.players || []) if (typeof p?.name === 'string' && p.name.trim()) counts.set(p.name.trim(), (counts.get(p.name.trim()) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name).slice(0, 20);
}

export async function PUT(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const body = await readJsonObject(request);
    const next = normalizeGolfUser(body.user);
    const user = await updateGolfUser(userId, (stored) => {
      Object.assign(stored, next);
      return stored;
    });
    return NextResponse.json({ success: true, user });
  } catch (error) {
    return handleApiError(error, 'Save golf settings');
  }
}

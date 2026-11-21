import { getAuthenticatedWorkoutUserId, isAdminAuthenticated } from '@/lib/security/server-auth';
import { loadUsersData } from '@/lib/workout/users';
import { ApiError } from '@/lib/workout/api';
import { canFileTickets } from './store';

export type Reporter = { userId: string; username: string };

/** Who is filing: the signed-in account if tickets are on for it, else the admin (who can always test). */
export async function requireReporter(): Promise<Reporter> {
  const userId = await getAuthenticatedWorkoutUserId();
  if (userId && (await canFileTickets(userId))) {
    const data = await loadUsersData().catch(() => ({ users: [] as Record<string, any>[] }));
    return { userId, username: String(data.users.find((u) => u.id === userId)?.username ?? userId).slice(0, 60) };
  }
  if (await isAdminAuthenticated()) {
    // An admin who is also signed in as an account files as that account, so their own list shows it.
    if (userId) return { userId, username: 'admin' };
    return { userId: 'admin', username: 'admin' };
  }
  throw new ApiError(userId ? 403 : 401, userId ? 'Tickets are not turned on for this account' : 'Unauthorized');
}

import { getAuthenticatedWorkoutUserId, isAdminAuthenticated } from '@/lib/security/server-auth';
import { createAiJobs } from './jobs';
import { providerFor } from './providers';
import { getAiSettings } from './settings';

// The one job runner for the whole server, and who's asking.

const globalJobs = globalThis as unknown as { __aiJobs?: ReturnType<typeof createAiJobs> };
// Kept on globalThis so a dev-server reload doesn't lose jobs that are still running.
export const aiJobs = globalJobs.__aiJobs ??= createAiJobs({ loadSettings: getAiSettings, providerFor });

/** Who's signed in, as a rate-limit key: an account, or the admin. Null when nobody is. */
export async function aiCaller(): Promise<string | null> {
  const [userId, isAdmin] = await Promise.all([getAuthenticatedWorkoutUserId(), isAdminAuthenticated()]);
  if (userId) return `user:${userId}`;
  return isAdmin ? 'admin' : null;
}

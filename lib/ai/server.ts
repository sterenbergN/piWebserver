import { getAuthenticatedWorkoutUserId, isAdminAuthenticated } from '@/lib/security/server-auth';
import { createAiJobs } from './jobs';
import { providerFor } from './providers';
import { getAiSettings, type AiCaller } from './settings';

// The one job runner for the whole server, and who's asking.

const globalJobs = globalThis as unknown as { __aiJobs?: ReturnType<typeof createAiJobs> };
// Kept on globalThis so a dev-server reload doesn't lose jobs that are still running.
export const aiJobs = globalJobs.__aiJobs ??= createAiJobs({ loadSettings: getAiSettings, providerFor });

/**
 * Who's signed in: `key` names them for rate limits and job ownership (an account,
 * or the admin), `who` is what the allowed-accounts rule looks at. Null when nobody is.
 */
export async function aiCaller(): Promise<{ key: string; who: AiCaller } | null> {
  const [userId, isAdmin] = await Promise.all([getAuthenticatedWorkoutUserId(), isAdminAuthenticated()]);
  if (!userId && !isAdmin) return null;
  return { key: userId ? `user:${userId}` : 'admin', who: { userId, isAdmin } };
}

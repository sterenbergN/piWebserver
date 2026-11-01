import { findWorkoutUser } from '@/lib/workout/users';
import { getAuthenticatedWorkoutUserId } from './server-auth';

/** The account this browser is signed in to, as the navbar shows it (null when signed out). Throws if accounts can't be read. */
export async function signedInUser() {
  const userId = await getAuthenticatedWorkoutUserId();
  const user = userId ? await findWorkoutUser(userId) : null;
  return user && typeof user.username === 'string' ? { username: user.username, studyHome: user.studyHome === true } : null;
}

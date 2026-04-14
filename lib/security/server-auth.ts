import { cookies } from 'next/headers';
import { getWorkoutUserIdFromToken, isAdminTokenValid } from '@/lib/security/auth';

export async function isAdminAuthenticated() {
  const cookieStore = await cookies();
  return isAdminTokenValid(cookieStore.get('pi_auth')?.value);
}

export async function getAuthenticatedWorkoutUserId() {
  const cookieStore = await cookies();
  return getWorkoutUserIdFromToken(cookieStore.get('workout_auth')?.value);
}

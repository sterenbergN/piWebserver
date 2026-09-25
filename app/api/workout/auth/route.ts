import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createWorkoutAuthToken } from '@/lib/security/auth';
import { getAuthenticatedWorkoutUserId } from '@/lib/security/server-auth';
import { verifyPassword } from '@/lib/workout/passwords';
import { findWorkoutUser, loadUsersData, normalizeWorkoutUser, toSafeUser, updateUsersData } from '@/lib/workout/users';
import { ApiError, handleApiError, readJsonObject, requireWorkoutUserId } from '@/lib/workout/api';

export async function POST(request: Request) {
  try {
    const { username, password } = await readJsonObject(request);
    if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || !password) {
      throw new ApiError(400, 'Username and password required');
    }

    const usersData = await loadUsersData();
    const normalizedUsername = username.trim().toLowerCase();
    const user = usersData.users.find(
      (u) => typeof u.username === 'string' && u.username.toLowerCase() === normalizedUsername
    );

    if (user && verifyPassword(password, user.password)) {
      const cookieStore = await cookies();
      cookieStore.set('workout_auth', createWorkoutAuthToken(user.id), {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/',
        maxAge: 60 * 60 * 24 * 30 // 30 days
      });

      return NextResponse.json({ success: true, user: { id: user.id, username: user.username } });
    }

    return NextResponse.json({ success: false, message: "Invalid credentials" }, { status: 401 });
  } catch (error) {
    return handleApiError(error, 'Workout login failed');
  }
}

export async function DELETE() {
  const cookieStore = await cookies();
  cookieStore.delete('workout_auth');
  return NextResponse.json({ success: true });
}

export async function GET() {
  try {
    const userId = await getAuthenticatedWorkoutUserId();
    if (!userId) {
      return NextResponse.json({ success: false, authenticated: false });
    }

    const user = await findWorkoutUser(userId);
    if (!user) {
      return NextResponse.json({ success: false, authenticated: false });
    }

    return NextResponse.json({ success: true, authenticated: true, user: toSafeUser(user) });
  } catch (error) {
    return handleApiError(error, 'Workout auth check failed');
  }
}

function toOptionalNumber(value: unknown, fallback: unknown) {
  if (value === undefined) return fallback;
  if (value === '' || value === null) return '';
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export async function PATCH(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const updates = await readJsonObject(request);

    const updatedUser = await updateUsersData((usersData) => {
      const userIndex = usersData.users.findIndex((u) => u.id === userId);
      if (userIndex === -1) throw new ApiError(404, 'User not found');

      // Only profile fields are user-editable; username/password/id stay admin-only.
      const user = usersData.users[userIndex];
      const merged = normalizeWorkoutUser({
        ...user,
        birthdate: updates.birthdate !== undefined ? updates.birthdate : user.birthdate,
        weight: toOptionalNumber(updates.weight, user.weight),
        height: toOptionalNumber(updates.height, user.height),
        gender: typeof updates.gender === 'string' ? updates.gender : user.gender,
        intensityFactor: updates.intensityFactor !== undefined && Number.isFinite(Number(updates.intensityFactor))
          ? Number(updates.intensityFactor)
          : user.intensityFactor,
      });
      usersData.users[userIndex] = merged;
      return merged;
    });

    return NextResponse.json({ success: true, user: toSafeUser(updatedUser) });
  } catch (error) {
    return handleApiError(error, 'Workout profile update failed');
  }
}

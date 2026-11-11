import { NextResponse } from 'next/server';
import { getAuthenticatedWorkoutUserId, isAdminAuthenticated } from '@/lib/security/server-auth';
import { getWorkoutUserIdFromToken, isAdminTokenValid } from '@/lib/security/auth';
import { loadUsersData } from '@/lib/workout/users';
import {
  loadUserMovieData,
  saveUserMovieData,
  normalizeUserMovieState,
  mergeUserMovieStates,
  type UserMovieState,
} from '@/lib/tools/movies-store';

export const dynamic = 'force-dynamic';

async function getCallerUserId(request?: Request): Promise<string | null> {
  try {
    const [workoutUserId, isAdmin] = await Promise.all([
      getAuthenticatedWorkoutUserId(),
      isAdminAuthenticated(),
    ]);
    if (workoutUserId) return workoutUserId;
    if (isAdmin) return 'admin';
  } catch {
    // If called outside Next request scope (e.g. in unit tests), fallback to parsing request cookies
  }

  if (request) {
    if ('cookies' in request && typeof (request as any).cookies?.get === 'function') {
      const workoutVal = (request as any).cookies.get('workout_auth')?.value;
      const adminVal = (request as any).cookies.get('pi_auth')?.value;
      const uid = getWorkoutUserIdFromToken(workoutVal);
      if (uid) return uid;
      if (isAdminTokenValid(adminVal)) return 'admin';
    }

    const cookieHeader = request.headers.get('cookie');
    if (cookieHeader) {
      const parsed = Object.fromEntries(
        cookieHeader.split(';').map((c) => {
          const [k, ...v] = c.trim().split('=');
          return [k, v.join('=')];
        })
      );
      const uid = getWorkoutUserIdFromToken(parsed['workout_auth']);
      if (uid) return uid;
      if (isAdminTokenValid(parsed['pi_auth'])) return 'admin';
    }
  }

  return null;
}

export async function GET(request: Request) {
  try {
    const callerUserId = await getCallerUserId(request);
    if (!callerUserId) {
      return NextResponse.json(
        { success: true, authenticated: false },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const { searchParams } = new URL(request.url);
    const targetUserId = searchParams.get('userId');

    const usersData = await loadUsersData().catch(() => ({ users: [] }));
    const users = (usersData.users || []).map((u) => ({
      id: u.id,
      username: u.username || u.name || u.id,
    }));
    if (callerUserId === 'admin' && !users.some((u) => u.id === 'admin')) {
      users.unshift({ id: 'admin', username: 'Admin' });
    }

    if (targetUserId && targetUserId !== callerUserId) {
      const targetState = await loadUserMovieData(targetUserId);
      return NextResponse.json(
        {
          success: true,
          authenticated: true,
          callerUserId,
          targetUserId,
          publicState: {
            userId: targetState.userId,
            username: targetState.username,
            watched: targetState.watched,
            reviews: targetState.reviews,
            rankings: targetState.rankings,
          },
          state: {
            userId: targetState.userId,
            username: targetState.username,
            watched: targetState.watched,
            reviews: targetState.reviews,
            rankings: targetState.rankings,
          },
          users,
        },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const callerState = await loadUserMovieData(callerUserId);
    const matchedUser = users.find((u) => u.id === callerUserId);
    if (!callerState.username && matchedUser?.username) {
      callerState.username = matchedUser.username;
    }

    return NextResponse.json(
      {
        success: true,
        authenticated: true,
        callerUserId,
        state: callerState,
        users,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('Movies user GET error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to load movie data' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const callerUserId = await getCallerUserId(request);
    if (!callerUserId) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { success: false, error: 'Invalid request body' },
        { status: 400 }
      );
    }

    const existingState = await loadUserMovieData(callerUserId);

    let updatedState: UserMovieState;

    if (body.guestState && typeof body.guestState === 'object') {
      const guestNormalized = normalizeUserMovieState(body.guestState, callerUserId);
      updatedState = mergeUserMovieStates(existingState, guestNormalized);
    } else if (body.merge === true) {
      const incomingRaw = body.state || body;
      const incomingNormalized = normalizeUserMovieState(incomingRaw, callerUserId);
      updatedState = mergeUserMovieStates(existingState, incomingNormalized);
    } else {
      const rawState = body.state !== undefined ? body.state : body;
      const normalized = normalizeUserMovieState(rawState, callerUserId, existingState.username);
      updatedState = normalized;
    }

    const saved = await saveUserMovieData(callerUserId, updatedState);

    return NextResponse.json({
      success: true,
      state: saved,
    });
  } catch (error) {
    console.error('Movies user POST error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to save movie data' },
      { status: 500 }
    );
  }
}

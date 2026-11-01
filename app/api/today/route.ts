import { NextResponse } from 'next/server';
import { readTodayHidden } from '@/lib/today-prefs';
import { ApiError, handleApiError, readJsonObject, requireWorkoutUserId } from '@/lib/workout/api';
import { findWorkoutUser, updateUsersData } from '@/lib/workout/users';

// Which cards this account has taken off its Today page.

const PRIVATE = { 'Cache-Control': 'no-store, private' };

export async function GET() {
  try {
    const userId = await requireWorkoutUserId();
    const user = await findWorkoutUser(userId);
    return NextResponse.json({ success: true, hidden: readTodayHidden(user?.todayHidden) }, { headers: PRIVATE });
  } catch (error) {
    return handleApiError(error, 'Load Today settings failed');
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const body = await readJsonObject(request);
    const hidden = readTodayHidden(body.hidden);
    await updateUsersData((data) => {
      const user = data.users.find((u) => u.id === userId);
      if (!user) throw new ApiError(404, 'Account not found');
      if (hidden.length) user.todayHidden = hidden;
      else delete user.todayHidden;
    });
    return NextResponse.json({ success: true, hidden }, { headers: PRIVATE });
  } catch (error) {
    return handleApiError(error, 'Save Today settings failed');
  }
}

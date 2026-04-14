import { NextResponse } from 'next/server';
import { getWorkoutData, saveWorkoutData } from '@/lib/workout/data';
import { getAuthenticatedWorkoutUserId } from '@/lib/security/server-auth';
import { buildSeededCalculatorDefaults, normalizeCalculatorDefaults } from '@/lib/workout/calculators';
import { normalizeUsersData } from '@/lib/workout/users';

export async function GET() {
  const userId = await getAuthenticatedWorkoutUserId();
  if (!userId) {
    return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
  }

  const rawUsersData = await getWorkoutData('users.json', { users: [] as any[] });
  const { data: usersData, changed } = normalizeUsersData(rawUsersData);
  if (changed) {
    await saveWorkoutData('users.json', usersData);
  }

  const user = usersData.users.find((entry: any) => entry.id === userId);
  if (!user) {
    return NextResponse.json({ success: false, message: 'User not found' }, { status: 404 });
  }

  return NextResponse.json({
    success: true,
    calculatorDefaults: buildSeededCalculatorDefaults(user),
  });
}

export async function PATCH(request: Request) {
  const userId = await getAuthenticatedWorkoutUserId();
  if (!userId) {
    return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
  }

  try {
    const payload = await request.json();
    const rawUsersData = await getWorkoutData('users.json', { users: [] as any[] });
    const { data: usersData } = normalizeUsersData(rawUsersData);
    const userIndex = usersData.users.findIndex((entry: any) => entry.id === userId);

    if (userIndex === -1) {
      return NextResponse.json({ success: false, message: 'User not found' }, { status: 404 });
    }

    const existingUser = usersData.users[userIndex];
    const mergedDefaults = normalizeCalculatorDefaults({
      ...existingUser.calculatorDefaults,
      ...payload?.calculatorDefaults,
      calorie: {
        ...existingUser.calculatorDefaults?.calorie,
        ...payload?.calculatorDefaults?.calorie,
      },
      bodyFat: {
        ...existingUser.calculatorDefaults?.bodyFat,
        ...payload?.calculatorDefaults?.bodyFat,
      },
    });

    usersData.users[userIndex] = {
      ...existingUser,
      calculatorDefaults: mergedDefaults,
    };

    await saveWorkoutData('users.json', usersData);

    return NextResponse.json({
      success: true,
      calculatorDefaults: buildSeededCalculatorDefaults(usersData.users[userIndex]),
    });
  } catch {
    return NextResponse.json({ success: false, message: 'Server error' }, { status: 500 });
  }
}

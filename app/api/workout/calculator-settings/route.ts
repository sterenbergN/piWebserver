import { NextResponse } from 'next/server';
import { buildSeededCalculatorDefaults, normalizeCalculatorDefaults } from '@/lib/workout/calculators';
import { findWorkoutUser, updateUsersData } from '@/lib/workout/users';
import { ApiError, handleApiError, readJsonObject, requireWorkoutUserId } from '@/lib/workout/api';

export async function GET() {
  try {
    const userId = await requireWorkoutUserId();
    const user = await findWorkoutUser(userId);
    if (!user) throw new ApiError(404, 'User not found');

    return NextResponse.json({
      success: true,
      calculatorDefaults: buildSeededCalculatorDefaults(user),
    });
  } catch (error) {
    return handleApiError(error, 'Load calculator settings failed');
  }
}

export async function PATCH(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const payload = await readJsonObject(request);

    const updatedUser = await updateUsersData((usersData) => {
      const userIndex = usersData.users.findIndex((entry) => entry.id === userId);
      if (userIndex === -1) throw new ApiError(404, 'User not found');

      const existingUser = usersData.users[userIndex];
      const mergedDefaults = normalizeCalculatorDefaults({
        ...existingUser.calculatorDefaults,
        ...payload.calculatorDefaults,
        calorie: {
          ...existingUser.calculatorDefaults?.calorie,
          ...payload.calculatorDefaults?.calorie,
        },
        bodyFat: {
          ...existingUser.calculatorDefaults?.bodyFat,
          ...payload.calculatorDefaults?.bodyFat,
        },
      });

      usersData.users[userIndex] = { ...existingUser, calculatorDefaults: mergedDefaults };
      return usersData.users[userIndex];
    });

    return NextResponse.json({
      success: true,
      calculatorDefaults: buildSeededCalculatorDefaults(updatedUser),
    });
  } catch (error) {
    return handleApiError(error, 'Save calculator settings failed');
  }
}

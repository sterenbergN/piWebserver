type WorkoutUser = Record<string, any>;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function normalizeIntensityFactor(user: WorkoutUser): number {
  if (typeof user.intensityFactor === 'number' && Number.isFinite(user.intensityFactor)) {
    return clamp(user.intensityFactor, 0.5, 1.5);
  }

  if (typeof user.progressionFactor === 'number' && Number.isFinite(user.progressionFactor)) {
    return clamp(user.progressionFactor / 0.05, 0.5, 1.5);
  }

  return 1.0;
}

export function normalizeWorkoutUser<T extends WorkoutUser>(user: T): T {
  const intensityFactor = normalizeIntensityFactor(user);
  const normalizedUser = {
    ...user,
    intensityFactor,
  } as T & { intensityFactor: number; progressionFactor?: number };

  if ('progressionFactor' in normalizedUser) {
    delete normalizedUser.progressionFactor;
  }

  return normalizedUser as T;
}

export function normalizeUsersData<T extends { users: WorkoutUser[] }>(data: T): {
  changed: boolean;
  data: T;
} {
  let changed = false;
  const normalizedUsers = data.users.map((user) => {
    const normalizedUser = normalizeWorkoutUser(user);
    const userChanged = JSON.stringify(user) !== JSON.stringify(normalizedUser);
    if (userChanged) changed = true;
    return normalizedUser;
  });

  return {
    changed,
    data: {
      ...data,
      users: normalizedUsers,
    },
  };
}

import { hashPassword, isHashedPassword } from '@/lib/workout/passwords';
import { normalizeBirthdate } from '@/lib/workout/birthdate';
import { normalizeCalculatorDefaults } from '@/lib/workout/calculators';
import { getWorkoutData, updateWorkoutData } from '@/lib/workout/data';

type WorkoutUser = Record<string, any>;
export type UsersData = { users: WorkoutUser[] };

export const USERS_FILE = 'users.json';

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
    birthdate: normalizeBirthdate(user.birthdate),
    calculatorDefaults: normalizeCalculatorDefaults(user.calculatorDefaults),
    intensityFactor,
  } as T & { intensityFactor: number; progressionFactor?: number; password?: string };

  if ('progressionFactor' in normalizedUser) {
    delete normalizedUser.progressionFactor;
  }

  if (typeof normalizedUser.password === 'string' && normalizedUser.password && !isHashedPassword(normalizedUser.password)) {
    normalizedUser.password = hashPassword(normalizedUser.password);
  }

  return normalizedUser as T;
}

export function normalizeUsersData<T extends { users: WorkoutUser[] }>(data: T): {
  changed: boolean;
  data: T;
} {
  let changed = false;
  const normalizedUsers = (Array.isArray(data.users) ? data.users : []).map((user) => {
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

/**
 * Load all users, normalized. Legacy records (plain-text passwords, old
 * progressionFactor, etc.) are migrated and persisted the first time they're seen.
 */
export async function loadUsersData(): Promise<UsersData> {
  const raw = await getWorkoutData<UsersData>(USERS_FILE, { users: [] });
  const { data, changed } = normalizeUsersData(raw);
  if (!changed) return data;

  return updateWorkoutData<UsersData, UsersData>(USERS_FILE, { users: [] }, (current) => {
    const normalized = normalizeUsersData(current).data;
    current.users = normalized.users;
    return normalized;
  });
}

/** Atomically modify the (normalized) users file. */
export async function updateUsersData<R>(mutator: (data: UsersData) => R | Promise<R>): Promise<R> {
  return updateWorkoutData<UsersData, R>(USERS_FILE, { users: [] }, (current) => {
    current.users = normalizeUsersData(current).data.users;
    return mutator(current);
  });
}

export async function findWorkoutUser(userId: string) {
  const data = await loadUsersData();
  return data.users.find((user) => user.id === userId) || null;
}

export function toSafeUser<T extends WorkoutUser>(user: T): Omit<T, 'password'> {
  const { password, ...safeUser } = user;
  return safeUser;
}

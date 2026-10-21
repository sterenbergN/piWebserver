import crypto from 'crypto';
import { getWorkoutData, updateWorkoutData } from '@/lib/workout/data';
import { loadUserHistory } from '@/lib/workout/history';
import { emptyUserHealth, HEALTH_FILE, refreshWorkoutHealth, type HealthStore, type UserHealth } from '@/lib/workout/health';

// Server side of the Apple Health sync: the per-user import key (only its
// hash is stored) and reading/writing health.json.

const hashKey = (key: string) => crypto.createHash('sha256').update(key).digest('hex');

function storeOf(data: HealthStore) {
  if (!data.users || typeof data.users !== 'object') data.users = {};
  return data.users;
}

export async function loadUserHealth(userId: string): Promise<UserHealth> {
  const data = await getWorkoutData<HealthStore>(HEALTH_FILE, { users: {} });
  return { ...emptyUserHealth(), ...(data.users?.[userId] || {}) };
}

/** Read-modify-write one user's health data under the file lock. */
export async function updateUserHealth<R>(userId: string, change: (health: UserHealth) => R): Promise<R> {
  return updateWorkoutData<HealthStore, R>(HEALTH_FILE, { users: {} }, (data) => {
    const users = storeOf(data);
    const health = { ...emptyUserHealth(), ...(users[userId] || {}) };
    const result = change(health);
    users[userId] = health;
    return result;
  });
}

/** A new import key (replacing any old one). The key itself is only returned here, once. */
export async function createImportKey(userId: string) {
  const key = `nsh_${crypto.randomBytes(24).toString('base64url')}`;
  await updateUserHealth(userId, (health) => {
    health.keyHash = hashKey(key);
    health.keyHint = key.slice(-4);
    health.keyCreatedAt = new Date().toISOString();
  });
  return key;
}

/** Whose key this is, or null. */
export async function userForImportKey(key: string): Promise<string | null> {
  if (!/^nsh_[\w-]{20,}$/.test(key)) return null;
  const data = await getWorkoutData<HealthStore>(HEALTH_FILE, { users: {} });
  const wanted = Buffer.from(hashKey(key), 'hex');
  for (const [userId, health] of Object.entries(data.users || {})) {
    if (!health?.keyHash) continue;
    const stored = Buffer.from(health.keyHash, 'hex');
    if (stored.length === wanted.length && crypto.timingSafeEqual(stored, wanted)) return userId;
  }
  return null;
}

/** Match recent logged workouts to the heart rate / energy on hand, saving only if anything changed. */
export async function refreshUserWorkoutHealth(userId: string): Promise<UserHealth> {
  const current = await loadUserHealth(userId);
  if (current.hr.length === 0 && current.energy.length === 0 && current.watchWorkouts.length === 0) return current;
  const history = await loadUserHistory(userId);
  if (!refreshWorkoutHealth({ ...current, workouts: { ...current.workouts } }, history)) return current;
  return updateUserHealth(userId, (health) => {
    refreshWorkoutHealth(health, history);
    return health;
  });
}

export async function deleteUserHealth(userId: string) {
  await updateWorkoutData<HealthStore>(HEALTH_FILE, { users: {} }, (data) => {
    delete storeOf(data)[userId];
  });
}

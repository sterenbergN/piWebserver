import { generateId, getWorkoutData, updateWorkoutData } from '@/lib/workout/data';
import { updateUsersData } from '@/lib/workout/users';

// The bodyweight log: one entry per day, typed in on the home page or sent
// from Apple Health (e.g. a smart scale). The profile weight follows the
// newest entry.

export type BodyweightEntry = { id: string; userId: string; weight: number; date: string };
type BodyweightStore = { entries: BodyweightEntry[] };

const FILE = 'bodyweight.json';

function userEntries(store: BodyweightStore, userId: string) {
  return (store.entries || [])
    .filter((entry) => entry.userId === userId)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Keep the profile weight equal to the most recent log entry. */
async function syncProfileWeight(userId: string, entries: BodyweightEntry[]) {
  const latest = entries[entries.length - 1];
  if (!latest) return;
  await updateUsersData((data) => {
    const user = data.users.find((u) => u.id === userId);
    if (user) user.weight = latest.weight;
  });
}

export async function loadBodyweight(userId: string) {
  const store = await getWorkoutData<BodyweightStore>(FILE, { entries: [] });
  return userEntries(store, userId);
}

/** Log weights (lbs) by date; a day that already has one is replaced. */
export async function logBodyweights(userId: string, logs: { date: string; weight: number }[]) {
  if (logs.length === 0) return loadBodyweight(userId);
  const entries = await updateWorkoutData<BodyweightStore, BodyweightEntry[]>(FILE, { entries: [] }, (store) => {
    if (!Array.isArray(store.entries)) store.entries = [];
    for (const { date, weight } of logs) {
      const rounded = Math.round(weight * 10) / 10;
      const existing = store.entries.find((entry) => entry.userId === userId && entry.date === date);
      if (existing) existing.weight = rounded;
      else store.entries.push({ id: generateId(), userId, weight: rounded, date });
    }
    return userEntries(store, userId);
  });
  await syncProfileWeight(userId, entries);
  return entries;
}

/** Delete one entry (only the owner's). Returns null if it isn't theirs or doesn't exist. */
export async function deleteBodyweight(userId: string, id: string) {
  const entries = await updateWorkoutData<BodyweightStore, BodyweightEntry[] | null>(FILE, { entries: [] }, (store) => {
    const entry = (store.entries || []).find((e) => e.id === id);
    if (!entry || entry.userId !== userId) return null;
    store.entries = store.entries.filter((e) => e.id !== id);
    return userEntries(store, userId);
  });
  if (entries) await syncProfileWeight(userId, entries);
  return entries;
}

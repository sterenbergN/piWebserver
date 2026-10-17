import { exerciseKey, exerciseName } from './exercises';
import { kindKey } from './equipment-kinds';
import { newRecordId } from './stations';
import type { Gym, Lift, Station } from './types';

// Sharing a finished workout by link. The link carries a snapshot of the
// workout's gym (only the machines and lifts that were used) and what was done.
// Whoever opens it can import that gym, or add the missing pieces to the copy
// they imported last time (found by `importedFrom` / `sourceId`), and then do
// the same workout with their own weights.

/** Where share links are stored (in .data/workouts). */
export const SHARES_FILE = 'workout-shares.json';

export type SharedSet = { weight: number; reps: number; rir?: number };
export type SharedLift = { liftId: string; stationId: string; name: string; exercise?: string; sets: SharedSet[] };

export type SharedWorkout = {
  token: string;
  ownerId: string;
  ownerName: string;
  createdAt: string;
  title: string;
  typeName?: string;
  timestamp: string;
  durationSecs?: number;
  gym: { id: string; name: string; emoji?: string; stations: Station[] };
  lifts: SharedLift[];
};

type WorkoutLike = {
  name?: string;
  type?: { name?: string };
  timestamp?: string;
  durationSecs?: number;
  gymId?: string;
  logs?: Record<string, { weight: number; reps: number; rir?: number }[]>;
  liftMeta?: Record<string, { name?: string; exercise?: string; stationId?: string }>;
};

/**
 * What a share link carries: the lifts done (in order, with their sets) and a
 * copy of only the machines they were on, each with only those lifts.
 * Lifts whose machine isn't in the gym any more are skipped.
 */
export function buildShareSnapshot(workout: WorkoutLike, gym: Gym) {
  const stationById = new Map(gym.stations.map((s) => [s.id, s]));
  const findStation = (liftId: string, hint?: string) =>
    (hint && stationById.get(hint)?.lifts.some((l) => l.id === liftId) ? stationById.get(hint) : undefined)
    || gym.stations.find((s) => s.lifts.some((l) => l.id === liftId));

  const lifts: SharedLift[] = [];
  const used = new Map<string, Set<string>>();
  for (const [liftId, sets] of Object.entries(workout.logs || {})) {
    const valid = (sets || []).filter((s) => Number(s.reps) > 0);
    const station = findStation(liftId, workout.liftMeta?.[liftId]?.stationId);
    if (!station || valid.length === 0) continue;
    const lift = station.lifts.find((l) => l.id === liftId)!;
    lifts.push({
      liftId,
      stationId: station.id,
      name: lift.name,
      exercise: exerciseName(lift) !== lift.name ? exerciseName(lift) : undefined,
      sets: valid.map((s) => ({ weight: Number(s.weight) || 0, reps: Number(s.reps), ...(typeof s.rir === 'number' ? { rir: s.rir } : {}) })),
    });
    used.set(station.id, (used.get(station.id) || new Set()).add(liftId));
  }

  const stations: Station[] = gym.stations
    .filter((s) => used.has(s.id))
    // Machine photos are private to the sharer's account.
    .map((s) => ({ ...s, photo: undefined, lifts: s.lifts.filter((l) => used.get(s.id)!.has(l.id)) }));
  return { gym: { id: gym.id, name: gym.name, emoji: gym.emoji, stations }, lifts };
}

/** Your gym that was imported from this sharer's gym, if any. */
export function findImportedGym(gyms: Gym[], ownerId: string, sourceGymId: string) {
  return gyms.find((g) => g.importedFrom?.ownerId === ownerId && g.importedFrom.gymId === sourceGymId);
}

const liftMatches = (local: Lift, shared: Lift) => local.sourceId === shared.id || exerciseKey(local) === exerciseKey(shared);
const stationMatches = (local: Station, shared: Station) =>
  local.sourceId === shared.id || (local.type === shared.type && kindKey(local) === kindKey(shared));

function copyStation(shared: Station, lifts: Lift[] = shared.lifts): Station {
  return { ...shared, id: newRecordId(), sourceId: shared.id, lifts: lifts.map((l) => ({ ...l, id: newRecordId(), sourceId: l.id })) };
}

/** A new gym (for your account) from a shared snapshot. */
export function gymFromSnapshot(snapshot: SharedWorkout['gym'], owner: { id: string; name: string }) {
  return {
    name: snapshot.name,
    emoji: snapshot.emoji || '🏋️',
    stations: snapshot.stations.map((s) => copyStation(s)),
    importedFrom: { ownerId: owner.id, gymId: snapshot.id, ownerName: owner.name },
  };
}

/**
 * Add what a snapshot has that your gym doesn't: unknown machines (matched by
 * source or by machine kind) and unknown lifts on known machines. Your own
 * weights, names and notes are left alone. Returns the new station list and
 * how many machines / lifts were added.
 */
export function mergeSnapshotIntoGym(gym: Pick<Gym, 'stations'>, snapshot: SharedWorkout['gym']) {
  const stations = gym.stations.map((s) => ({ ...s, lifts: [...s.lifts] }));
  let addedStations = 0;
  let addedLifts = 0;
  for (const shared of snapshot.stations) {
    const local = stations.find((s) => stationMatches(s, shared));
    if (!local) {
      stations.push(copyStation(shared));
      addedStations++;
      continue;
    }
    if (!local.sourceId) local.sourceId = shared.id;
    for (const lift of shared.lifts) {
      if (local.lifts.some((l) => liftMatches(l, lift))) continue;
      local.lifts.push({ ...lift, id: newRecordId(), sourceId: lift.id, attachment: local.attachments?.includes(lift.attachment || '') ? lift.attachment : undefined });
      addedLifts++;
    }
  }
  return { stations, addedStations, addedLifts };
}

/** What a merge would add, without changing anything (for the preview). */
export function missingFromGym(gym: Pick<Gym, 'stations'>, snapshot: SharedWorkout['gym']) {
  const { addedStations, addedLifts } = mergeSnapshotIntoGym(gym, snapshot);
  return { stations: addedStations, lifts: addedLifts };
}

/**
 * The shared workout's lifts as they exist in your gym, in order (so it can be
 * planned and tracked with your own history). Lifts your gym doesn't have are
 * returned in `missing`.
 */
export function planFromShare(share: Pick<SharedWorkout, 'gym' | 'lifts'>, gym: Pick<Gym, 'stations'>) {
  const entries: { lift: Lift; station: Station }[] = [];
  const missing: string[] = [];
  for (const sharedLift of share.lifts) {
    const sharedStation = share.gym.stations.find((s) => s.id === sharedLift.stationId);
    const shared = sharedStation?.lifts.find((l) => l.id === sharedLift.liftId);
    if (!shared || !sharedStation) { missing.push(sharedLift.name); continue; }
    // Prefer the lift on the matching machine; else the same exercise anywhere in the gym.
    const station = gym.stations.find((s) => stationMatches(s, sharedStation));
    const onStation = station?.lifts.find((l) => liftMatches(l, shared));
    const anywhere = onStation ? null : gym.stations.flatMap((s) => s.lifts.map((l) => ({ l, s }))).find(({ l }) => liftMatches(l, shared));
    if (onStation && station) entries.push({ lift: onStation, station });
    else if (anywhere) entries.push({ lift: anywhere.l, station: anywhere.s });
    else missing.push(sharedLift.name);
  }
  return { entries, missing };
}

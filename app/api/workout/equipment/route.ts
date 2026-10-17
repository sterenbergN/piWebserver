import { NextResponse } from 'next/server';
import { getWorkoutData, updateWorkoutData } from '@/lib/workout/data';
import { kindKeyFromName, kindPairKey, renameDismissedPairs, setKindInGyms, unlinkStation } from '@/lib/workout/equipment-kinds';
import { ApiError, handleApiError, readJsonObject, requireWorkoutUserId } from '@/lib/workout/api';

// "My equipment": link the same machine across your gyms, rename a machine
// everywhere, unlink one gym's copy, or say two machines are not the same.
// Linking only sets each station's `kind`; every gym keeps its own weights.

const KINDS_FILE = 'equipment-kinds.json';
type KindsStore = { users: Record<string, { dismissed?: string[] }> };
const EMPTY_STORE: KindsStore = { users: {} };

const cleanName = (value: unknown) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, 120) : '');

/** Your remembered "Not the same" pairs. */
export async function GET() {
  try {
    const userId = await requireWorkoutUserId();
    const store = await getWorkoutData<KindsStore>(KINDS_FILE, EMPTY_STORE);
    return NextResponse.json({ success: true, dismissed: store.users?.[userId]?.dismissed || [] });
  } catch (error) {
    return handleApiError(error, 'Load equipment failed');
  }
}

/**
 *   { action: 'rename', from: 'Row Machine', to: 'Seated Row' }
 *   { action: 'link', from: ['Machine Row'], to: 'Row Machine' }
 *   { action: 'unlink', gymId, stationId }
 *   { action: 'dismiss', a: 'row machine', b: 'leg press' }   (kind keys)
 */
export async function POST(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const body = await readJsonObject(request);
    const { action } = body;
    if (!['rename', 'link', 'unlink', 'dismiss'].includes(action)) throw new ApiError(400, 'Unknown action');

    /** Change your remembered pairs; returns the new list. */
    const updateDismissed = (change: (pairs: string[]) => string[]) =>
      updateWorkoutData<KindsStore, string[]>(KINDS_FILE, EMPTY_STORE, (store) => {
        if (!store.users || typeof store.users !== 'object') store.users = {};
        const entry = store.users[userId] || {};
        entry.dismissed = change(Array.isArray(entry.dismissed) ? entry.dismissed : []).slice(-500);
        store.users[userId] = entry;
        return entry.dismissed;
      });

    if (action === 'dismiss') {
      const a = kindKeyFromName(cleanName(body.a));
      const b = kindKeyFromName(cleanName(body.b));
      if (!a || !b || a === b) throw new ApiError(400, 'Pick two machines');
      const dismissed = await updateDismissed((pairs) => [...new Set([...pairs, kindPairKey(a, b)])]);
      return NextResponse.json({ success: true, gyms: null, dismissed });
    }

    let unlinked: { from: string; to: string } | null = null;
    let fromKeys = new Set<string>();
    let to = '';
    if (action === 'unlink') {
      if (typeof body.gymId !== 'string' || typeof body.stationId !== 'string') throw new ApiError(400, 'Pick the machine to unlink');
    } else {
      to = cleanName(body.to);
      const fromNames: string[] = (Array.isArray(body.from) ? body.from : [body.from]).map(cleanName).filter(Boolean).slice(0, 20);
      if (!to) throw new ApiError(400, 'Enter the new name');
      if (fromNames.length === 0) throw new ApiError(400, 'Nothing to change');
      fromKeys = new Set(fromNames.map(kindKeyFromName));
    }

    const gyms = await updateWorkoutData('gyms.json', { gyms: [] as any[] }, (data) => {
      const mine = (data.gyms || []).filter((gym: any) => gym.ownerId === userId);
      if (action === 'unlink') {
        unlinked = unlinkStation(mine, body.gymId, body.stationId);
        if (!unlinked) return false;
        mine.find((gym: any) => gym.id === body.gymId).updatedAt = new Date().toISOString();
        return mine;
      }
      const changed = setKindInGyms(mine, fromKeys, to, { renameStations: action === 'rename' });
      if (changed === 0) return false;
      mine.forEach((gym: any) => { gym.updatedAt = new Date().toISOString(); });
      return mine;
    });

    const u = unlinked as { from: string; to: string } | null;
    const dismissed = u
      // Its name probably still matches: don't suggest linking it straight back.
      ? await updateDismissed((pairs) => [...new Set([...pairs, kindPairKey(u.from, u.to)])])
      : gyms && action !== 'unlink'
        ? await updateDismissed((pairs) => renameDismissedPairs(pairs, fromKeys, kindKeyFromName(to)))
        : null;

    return NextResponse.json({ success: true, gyms: gyms || null, dismissed });
  } catch (error) {
    return handleApiError(error, 'Update equipment failed');
  }
}

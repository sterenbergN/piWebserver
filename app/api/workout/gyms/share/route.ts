import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { getWorkoutData, updateWorkoutData } from '@/lib/workout/data';
import { ApiError, handleApiError, readJsonObject, requireWorkoutUserId } from '@/lib/workout/api';

type StoredGym = { id: string; ownerId: string; name: string; emoji?: string; stations?: unknown[]; shareToken?: string };
type GymsFile = { gyms: StoredGym[] };
const FILE = 'gyms.json';
const empty = (): GymsFile => ({ gyms: [] });

// Share a gym by link: the owner creates (or revokes) a secret token, and any
// logged-in user with the link can preview the gym and import a copy.

export async function GET(request: Request) {
  try {
    await requireWorkoutUserId();
    const token = new URL(request.url).searchParams.get('token') || '';
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) throw new ApiError(404, 'Link not found');
    const data = await getWorkoutData<GymsFile>(FILE, empty());
    const gym = (data.gyms || []).find((g) => g.shareToken === token);
    if (!gym) throw new ApiError(404, 'This share link has expired or was turned off');
    return NextResponse.json({ success: true, gym: { name: gym.name, emoji: gym.emoji || '🏋️', stations: gym.stations || [] } });
  } catch (error) {
    return handleApiError(error, 'Open shared gym failed');
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const { id, regenerate } = await readJsonObject(request);
    const token = await updateWorkoutData(FILE, empty(), (data) => {
      const gym = (data.gyms || []).find((g) => g.id === id);
      if (!gym) throw new ApiError(404, 'Not found');
      if (gym.ownerId !== userId) throw new ApiError(403, 'Forbidden');
      if (!gym.shareToken || regenerate === true) gym.shareToken = crypto.randomBytes(16).toString('base64url');
      return gym.shareToken;
    });
    return NextResponse.json({ success: true, token });
  } catch (error) {
    return handleApiError(error, 'Share gym failed');
  }
}

export async function DELETE(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const id = new URL(request.url).searchParams.get('id');
    await updateWorkoutData(FILE, empty(), (data) => {
      const gym = (data.gyms || []).find((g) => g.id === id);
      if (!gym) throw new ApiError(404, 'Not found');
      if (gym.ownerId !== userId) throw new ApiError(403, 'Forbidden');
      delete gym.shareToken;
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error, 'Stop sharing failed');
  }
}

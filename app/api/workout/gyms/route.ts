import { NextResponse } from 'next/server';
import { getWorkoutData, saveWorkoutData } from '@/lib/workout/data';
import { getAuthenticatedWorkoutUserId } from '@/lib/security/server-auth';

function generateId() {
  return Math.random().toString(36).substring(2, 10);
}

const EMOJI_MAP: Record<string, string> = {
  'ðŸ‹ï¸': '🏋️',
  'ðŸ’ª': '💪',
  'ðŸ ': '🏠',
  'ðŸ¢': '🏢',
  'ðŸŸï¸': '🏟️',
  'ðŸƒ': '🏃',
  'ðŸ”¥': '🔥',
  'âš¡': '⚡',
  'ðŸŽ¯': '🎯',
  'ðŸ†': '🏆',
  'ðŸ¦¾': '🦾',
  'ðŸ§—': '🧗',
  'ðŸ“': '📍',
};

function normalizeEmoji(value: unknown) {
  if (typeof value !== 'string' || value.length === 0) return '🏋️';
  return EMOJI_MAP[value] ?? value;
}

function normalizeGym(gym: any) {
  return {
    ...gym,
    emoji: normalizeEmoji(gym?.emoji),
    isPublic: gym?.isPublic === true,
  };
}

export async function GET(request: Request) {
  const data = await getWorkoutData('gyms.json', { gyms: [] });
  const userId = await getAuthenticatedWorkoutUserId();
  if (!userId) {
    return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const scope = searchParams.get('scope');
  const normalizedGyms = (data.gyms || []).map(normalizeGym);
  const gyms =
    scope === 'all'
      ? normalizedGyms.filter((gym: any) => gym.ownerId === userId || gym.isPublic)
      : normalizedGyms.filter((gym: any) => gym.ownerId === userId);

  return NextResponse.json({ success: true, gyms });
}

export async function POST(request: Request) {
  const userId = await getAuthenticatedWorkoutUserId();
  if (!userId) {
    return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
  }

  try {
    const gymInfo = await request.json();
    const data = await getWorkoutData('gyms.json', { gyms: [] as any[] });

    const newGym = normalizeGym({
      id: generateId(),
      ownerId: userId,
      name: gymInfo.name,
      emoji: gymInfo.emoji || '🏋️',
      isPublic: gymInfo.isPublic === true,
      stations: gymInfo.stations || [],
      createdAt: new Date().toISOString(),
    });

    data.gyms.push(newGym);
    await saveWorkoutData('gyms.json', data);

    return NextResponse.json({ success: true, gym: newGym });
  } catch {
    return NextResponse.json({ success: false, message: 'Server error' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const userId = await getAuthenticatedWorkoutUserId();
  if (!userId) {
    return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
  }

  try {
    const updatedGym = await request.json();
    if (!updatedGym.id) {
      return NextResponse.json({ success: false, message: 'ID missing' }, { status: 400 });
    }

    const data = await getWorkoutData('gyms.json', { gyms: [] as any[] });
    const index = data.gyms.findIndex((gym) => gym.id === updatedGym.id);

    if (index === -1) {
      return NextResponse.json({ success: false, message: 'Not found' }, { status: 404 });
    }

    if (data.gyms[index].ownerId !== userId) {
      return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });
    }

    data.gyms[index] = normalizeGym({ ...data.gyms[index], ...updatedGym });
    await saveWorkoutData('gyms.json', data);

    return NextResponse.json({ success: true, gym: data.gyms[index] });
  } catch {
    return NextResponse.json({ success: false, message: 'Server error' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const userId = await getAuthenticatedWorkoutUserId();
  if (!userId) {
    return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ success: false, message: 'ID missing' }, { status: 400 });
    }

    const data = await getWorkoutData('gyms.json', { gyms: [] as any[] });
    const gym = data.gyms.find((entry) => entry.id === id);

    if (!gym) {
      return NextResponse.json({ success: false, message: 'Not found' }, { status: 404 });
    }
    if (gym.ownerId !== userId) {
      return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });
    }

    data.gyms = data.gyms.filter((entry) => entry.id !== id);
    await saveWorkoutData('gyms.json', data);

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: false, message: 'Server error' }, { status: 500 });
  }
}


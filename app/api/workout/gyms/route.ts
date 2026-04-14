import { NextResponse } from 'next/server';
import { getWorkoutData, saveWorkoutData } from '@/lib/workout/data';
import { getAuthenticatedWorkoutUserId } from '@/lib/security/server-auth';

function generateId() {
  return Math.random().toString(36).substring(2, 10);
}

export async function GET() {
  const data = await getWorkoutData('gyms.json', { gyms: [] });
  const userId = await getAuthenticatedWorkoutUserId();
  if (!userId) {
    return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({ success: true, gyms: data.gyms.filter((gym: any) => gym.ownerId === userId) });
}

export async function POST(request: Request) {
  const userId = await getAuthenticatedWorkoutUserId();
  if (!userId) return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });

  try {
    const gymInfo = await request.json();
    const data = await getWorkoutData('gyms.json', { gyms: [] as any[] });
    
    const newGym = {
      id: generateId(),
      ownerId: userId,
      name: gymInfo.name,
      emoji: gymInfo.emoji || '🏋️',
      stations: gymInfo.stations || [],
      createdAt: new Date().toISOString()
    };

    data.gyms.push(newGym);
    await saveWorkoutData('gyms.json', data);

    return NextResponse.json({ success: true, gym: newGym });
  } catch (error) {
    return NextResponse.json({ success: false, message: "Server error" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const userId = await getAuthenticatedWorkoutUserId();
  if (!userId) return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });

  try {
    const updatedGym = await request.json();
    if (!updatedGym.id) return NextResponse.json({ success: false, message: "ID missing" }, { status: 400 });

    const data = await getWorkoutData('gyms.json', { gyms: [] as any[] });
    const index = data.gyms.findIndex(g => g.id === updatedGym.id);
    
    if (index === -1) return NextResponse.json({ success: false, message: "Not found" }, { status: 404 });

    // Only owner can edit (or if it's imported, maybe we clone it)
    if (data.gyms[index].ownerId !== userId) {
        return NextResponse.json({ success: false, message: "Forbidden" }, { status: 403 });
    }

    data.gyms[index] = { ...data.gyms[index], ...updatedGym };
    await saveWorkoutData('gyms.json', data);

    return NextResponse.json({ success: true, gym: data.gyms[index] });
  } catch (error) {
    return NextResponse.json({ success: false, message: "Server error" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const userId = await getAuthenticatedWorkoutUserId();
  if (!userId) return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ success: false, message: "ID missing" }, { status: 400 });

    const data = await getWorkoutData('gyms.json', { gyms: [] as any[] });
    const gym = data.gyms.find(g => g.id === id);
    
    if (!gym) return NextResponse.json({ success: false, message: "Not found" }, { status: 404 });
    if (gym.ownerId !== userId) return NextResponse.json({ success: false, message: "Forbidden" }, { status: 403 });

    data.gyms = data.gyms.filter(g => g.id !== id);
    await saveWorkoutData('gyms.json', data);

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, message: "Server error" }, { status: 500 });
  }
}

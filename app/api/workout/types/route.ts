import { NextResponse } from 'next/server';
import { getWorkoutData, saveWorkoutData } from '@/lib/workout/data';
import { getAuthenticatedWorkoutUserId } from '@/lib/security/server-auth';

function generateId() {
  return Math.random().toString(36).substring(2, 10);
}

export async function GET(request: Request) {
  const data = await getWorkoutData('workout_types.json', { types: [] });
  const userId = await getAuthenticatedWorkoutUserId();
  if (!userId) {
    return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({
    success: true,
    types: data.types.filter((type: any) => type.ownerId === userId),
  });
}

export async function POST(request: Request) {
  const userId = await getAuthenticatedWorkoutUserId();
  if (!userId) return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });

  try {
    const typeInfo = await request.json();
    const data = await getWorkoutData('workout_types.json', { types: [] as any[] });
    
    const newType = {
      id: generateId(),
      ownerId: userId,
      name: typeInfo.name,
      muscles: typeInfo.muscles || [],
      intensity: typeInfo.intensity || 75, // percentage
      minReps: typeInfo.minReps || 8,
      maxReps: typeInfo.maxReps || 12,
      sets: typeInfo.sets || 4,
      createdAt: new Date().toISOString()
    };

    data.types.push(newType);
    await saveWorkoutData('workout_types.json', data);

    return NextResponse.json({ success: true, type: newType });
  } catch (error) {
    return NextResponse.json({ success: false, message: "Server error" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const userId = await getAuthenticatedWorkoutUserId();
  if (!userId) return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });

  try {
    const updatedType = await request.json();
    if (!updatedType.id) return NextResponse.json({ success: false, message: "ID missing" }, { status: 400 });

    const data = await getWorkoutData('workout_types.json', { types: [] as any[] });
    const index = data.types.findIndex(t => t.id === updatedType.id);
    
    if (index === -1) return NextResponse.json({ success: false, message: "Not found" }, { status: 404 });

    if (data.types[index].ownerId !== userId) {
        return NextResponse.json({ success: false, message: "Forbidden" }, { status: 403 });
    }

    data.types[index] = { ...data.types[index], ...updatedType };
    await saveWorkoutData('workout_types.json', data);

    return NextResponse.json({ success: true, type: data.types[index] });
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

    const data = await getWorkoutData('workout_types.json', { types: [] as any[] });
    const type = data.types.find(t => t.id === id);
    
    if (!type) return NextResponse.json({ success: false, message: "Not found" }, { status: 404 });
    if (type.ownerId !== userId) return NextResponse.json({ success: false, message: "Forbidden" }, { status: 403 });

    data.types = data.types.filter(t => t.id !== id);
    await saveWorkoutData('workout_types.json', data);

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, message: "Server error" }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getWorkoutData, saveWorkoutData } from '@/lib/workout/data';

export async function GET() {
  const cookieStore = await cookies();
  const userId = cookieStore.get('workout_auth')?.value;
  if (!userId) return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });

  const data = await getWorkoutData('history.json', { history: [] as any[] });
  const userHistory = data.history.filter(h => h.userId === userId);

  return NextResponse.json({ success: true, history: userHistory });
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const userId = cookieStore.get('workout_auth')?.value;
  if (!userId) {
     // Handle demo users smoothly by returning success without saving
     const payload = await request.json();
     if (payload.isDemo) {
        return NextResponse.json({ success: true });
     }
     return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
  }

  try {
    const payload = await request.json();
    const data = await getWorkoutData('history.json', { history: [] as any[] });

    data.history.push({
      ...payload,
      id: Math.random().toString(36).substring(2, 10),
      userId
    });

    await saveWorkoutData('history.json', data);

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, message: "Server error" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const cookieStore = await cookies();
  const userId = cookieStore.get('workout_auth')?.value;
  if (!userId) return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    
    const data = await getWorkoutData('history.json', { history: [] as any[] });
    const log = data.history.find(h => h.id === id);
    if (!log || log.userId !== userId) return NextResponse.json({ success: false, message: "Forbidden" }, { status: 403 });

    data.history = data.history.filter(h => h.id !== id);
    await saveWorkoutData('history.json', data);

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, message: "Server error" }, { status: 500 });
  }
}

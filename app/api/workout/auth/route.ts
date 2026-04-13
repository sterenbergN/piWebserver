import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getWorkoutData } from '@/lib/workout/data';
import { normalizeUsersData, normalizeWorkoutUser } from '@/lib/workout/users';

export async function POST(request: Request) {
  try {
    const { username, password } = await request.json();

    const { saveWorkoutData } = await import('@/lib/workout/data');
    const rawUsersData = await getWorkoutData('users.json', { users: [] } as any);
    const { data: usersData, changed } = normalizeUsersData(rawUsersData);
    if (changed) {
      await saveWorkoutData('users.json', usersData);
    }
    const user = usersData.users.find((u: any) => u.username.toLowerCase() === username.toLowerCase() && u.password === password);

    if (user) {
      const cookieStore = await cookies();
      cookieStore.set('workout_auth', user.id, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 60 * 60 * 24 * 30 // 30 days
      });

      return NextResponse.json({ success: true, user: { id: user.id, username: user.username } });
    }

    return NextResponse.json({ success: false, message: "Invalid credentials" }, { status: 401 });
  } catch (err) {
    return NextResponse.json({ success: false, message: "Validation error" }, { status: 500 });
  }
}

export async function DELETE() {
  const cookieStore = await cookies();
  cookieStore.delete('workout_auth');
  return NextResponse.json({ success: true });
}

export async function GET() {
  const cookieStore = await cookies();
  const userId = cookieStore.get('workout_auth')?.value;
  
  if (!userId) {
    return NextResponse.json({ success: false, authenticated: false });
  }

  const { saveWorkoutData } = await import('@/lib/workout/data');
  const rawUsersData = await getWorkoutData('users.json', { users: [] } as any);
  const { data: usersData, changed } = normalizeUsersData(rawUsersData);
  if (changed) {
    await saveWorkoutData('users.json', usersData);
  }
  const user = usersData.users.find((u: any) => u.id === userId);

  if (user) {
    // Return safe data without password
    const { password, ...safeUser } = user;
    return NextResponse.json({ success: true, authenticated: true, user: safeUser });
  }

  return NextResponse.json({ success: false, authenticated: false });
}

export async function PATCH(request: Request) {
  try {
    const cookieStore = await cookies();
    const userId = cookieStore.get('workout_auth')?.value;
    
    if (!userId) {
      return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
    }

    const updates = await request.json();
    const { saveWorkoutData } = await import('@/lib/workout/data');
    const rawUsersData = await getWorkoutData('users.json', { users: [] } as any);
    const { data: usersData } = normalizeUsersData(rawUsersData);
    
    const userIndex = usersData.users.findIndex((u: any) => u.id === userId);
    
    if (userIndex > -1) {
      // Merge all safe updates
      const user = usersData.users[userIndex];
      const updatedUser = normalizeWorkoutUser({
         ...user,
         weight: updates.weight !== undefined ? Number(updates.weight) : user.weight,
         height: updates.height !== undefined ? Number(updates.height) : user.height,
         gender: updates.gender !== undefined ? updates.gender : user.gender,
         intensityFactor: updates.intensityFactor !== undefined ? Number(updates.intensityFactor) : user.intensityFactor
      });
      
      usersData.users[userIndex] = updatedUser;
      await saveWorkoutData('users.json', usersData);
      
      const { password, ...safeUser } = updatedUser;
      return NextResponse.json({ success: true, user: safeUser });
    }
    
    return NextResponse.json({ success: false, message: "User not found" }, { status: 404 });
  } catch (err) {
    return NextResponse.json({ success: false, message: "Server error" }, { status: 500 });
  }
}

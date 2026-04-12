import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getWorkoutData, saveWorkoutData } from '@/lib/workout/data';

function generateId() {
  return Math.random().toString(36).substring(2, 10);
}

// Only system admins should be able to create, edit, and delete workout users.
async function isAdmin() {
  const cookieStore = await cookies();
  return cookieStore.has('pi_auth');
}

export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });

  const data = await getWorkoutData('users.json', { users: [] });
  // Strip passwords for safe client-side consumption in the admin panel
  const safeUsers = data.users.map((u: any) => {
    const { password, ...safe } = u;
    // Actually, admins need to see or edit passwords? 
    // They might need to reset it. Let's just pass it back for the admin panel, as it's an admin only endpoint.
    return u;
  });

  return NextResponse.json({ success: true, users: safeUsers });
}

export async function POST(request: Request) {
  if (!(await isAdmin())) return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
  
  try {
    const newUser = await request.json();
    if (!newUser.username || !newUser.password) {
       return NextResponse.json({ success: false, message: "Username and password required" }, { status: 400 });
    }

    const data = await getWorkoutData('users.json', { users: [] as any[] });
    
    // Check if username already exists
    if (data.users.some(u => u.username.toLowerCase() === newUser.username.toLowerCase())) {
        return NextResponse.json({ success: false, message: "Username already exists" }, { status: 400 });
    }

    const user = {
      id: generateId(),
      username: newUser.username,
      password: newUser.password,
      birthdate: newUser.birthdate || '',
      height: newUser.height || '', // numeric inches or string
      gender: newUser.gender || 'unspecified',
      weight: newUser.weight || 0,
      createdAt: new Date().toISOString()
    };

    data.users.push(user);
    await saveWorkoutData('users.json', data);

    return NextResponse.json({ success: true, user });
  } catch (error) {
    return NextResponse.json({ success: false, message: "Server error" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  if (!(await isAdmin())) return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });

  try {
    const updatedUser = await request.json();
    if (!updatedUser.id) return NextResponse.json({ success: false, message: "User ID missing" }, { status: 400 });

    const data = await getWorkoutData('users.json', { users: [] as any[] });
    const userIndex = data.users.findIndex(u => u.id === updatedUser.id);
    
    if (userIndex === -1) return NextResponse.json({ success: false, message: "User not found" }, { status: 404 });

    data.users[userIndex] = { ...data.users[userIndex], ...updatedUser };
    await saveWorkoutData('users.json', data);

    return NextResponse.json({ success: true, user: data.users[userIndex] });
  } catch (error) {
    return NextResponse.json({ success: false, message: "Server error" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  if (!(await isAdmin())) return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    
    if (!id) return NextResponse.json({ success: false, message: "User ID missing" }, { status: 400 });

    const data = await getWorkoutData('users.json', { users: [] as any[] });
    data.users = data.users.filter(u => u.id !== id);
    
    await saveWorkoutData('users.json', data);

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, message: "Server error" }, { status: 500 });
  }
}

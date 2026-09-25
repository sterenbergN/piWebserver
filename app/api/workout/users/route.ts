import { NextResponse } from 'next/server';
import { generateId } from '@/lib/workout/data';
import { isAdminAuthenticated } from '@/lib/security/server-auth';
import { hashPassword } from '@/lib/workout/passwords';
import { loadUsersData, normalizeWorkoutUser, toSafeUser, updateUsersData } from '@/lib/workout/users';
import { ApiError, handleApiError, readJsonObject } from '@/lib/workout/api';

// Only system admins should be able to create, edit, and delete workout users.
async function requireAdmin() {
  if (!(await isAdminAuthenticated())) throw new ApiError(401, 'Unauthorized');
}

export async function GET() {
  try {
    await requireAdmin();
    const data = await loadUsersData();
    return NextResponse.json({ success: true, users: data.users.map(toSafeUser) });
  } catch (error) {
    return handleApiError(error, 'List workout users failed');
  }
}

export async function POST(request: Request) {
  try {
    await requireAdmin();
    const newUser = await readJsonObject(request);
    const username = typeof newUser.username === 'string' ? newUser.username.trim() : '';
    if (!username || typeof newUser.password !== 'string' || !newUser.password) {
      throw new ApiError(400, 'Username and password required');
    }

    const user = await updateUsersData((data) => {
      if (data.users.some((u) => String(u.username || '').toLowerCase() === username.toLowerCase())) {
        throw new ApiError(400, 'Username already exists');
      }

      const created = normalizeWorkoutUser({
        id: generateId(),
        username,
        password: hashPassword(newUser.password),
        birthdate: newUser.birthdate || '',
        height: newUser.height || '', // numeric inches or string
        gender: newUser.gender || 'unspecified',
        weight: Number(newUser.weight) || 0,
        createdAt: new Date().toISOString()
      });
      data.users.push(created);
      return created;
    });

    return NextResponse.json({ success: true, user: toSafeUser(user) });
  } catch (error) {
    return handleApiError(error, 'Create workout user failed');
  }
}

export async function PUT(request: Request) {
  try {
    await requireAdmin();
    const updatedUser = await readJsonObject(request);
    if (!updatedUser.id) throw new ApiError(400, 'User ID missing');

    const user = await updateUsersData((data) => {
      const userIndex = data.users.findIndex((u) => u.id === updatedUser.id);
      if (userIndex === -1) throw new ApiError(404, 'User not found');

      const existingUser = data.users[userIndex];
      if (typeof updatedUser.username === 'string') {
        const username = updatedUser.username.trim();
        if (!username) throw new ApiError(400, 'Username cannot be empty');
        const taken = data.users.some(
          (u) => u.id !== existingUser.id && String(u.username || '').toLowerCase() === username.toLowerCase()
        );
        if (taken) throw new ApiError(400, 'Username already exists');
        updatedUser.username = username;
      }

      const mergedUser = normalizeWorkoutUser({
        ...existingUser,
        ...updatedUser,
        id: existingUser.id,
        createdAt: existingUser.createdAt,
        password: updatedUser.password ? hashPassword(updatedUser.password) : existingUser.password,
      });
      data.users[userIndex] = mergedUser;
      return mergedUser;
    });

    return NextResponse.json({ success: true, user: toSafeUser(user) });
  } catch (error) {
    return handleApiError(error, 'Update workout user failed');
  }
}

export async function DELETE(request: Request) {
  try {
    await requireAdmin();
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) throw new ApiError(400, 'User ID missing');

    await updateUsersData((data) => {
      data.users = data.users.filter((u) => u.id !== id);
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error, 'Delete workout user failed');
  }
}

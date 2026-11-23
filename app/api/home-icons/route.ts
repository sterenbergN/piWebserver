import { NextResponse } from 'next/server';
import { getAuthenticatedWorkoutUserId } from '@/lib/security/server-auth';
import { ApiError, handleApiError, readJsonObject, requireWorkoutUserId } from '@/lib/workout/api';
import { findWorkoutUser, updateUsersData } from '@/lib/workout/users';
import { cleanChoice, cleanHomeIcons, iconApp } from '@/lib/home-icons';

// The home-screen icons an account has picked: { workout: { symbol, color } }.
// GET lists them; PUT { slug, symbol, color } picks one, PUT { slug, reset: true }
// goes back to the section's own icon.

const PRIVATE = { 'Cache-Control': 'no-store, private' };

export async function GET() {
  try {
    const userId = await getAuthenticatedWorkoutUserId();
    if (!userId) return NextResponse.json({ success: true, signedIn: false, icons: {} }, { headers: PRIVATE });
    const user = await findWorkoutUser(userId);
    return NextResponse.json({ success: true, signedIn: true, icons: cleanHomeIcons(user?.homeIcons) }, { headers: PRIVATE });
  } catch (error) {
    return handleApiError(error, 'Load home-screen icons failed');
  }
}

export async function PUT(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const body = await readJsonObject(request);
    const slug = typeof body.slug === 'string' ? body.slug : '';
    if (!iconApp(slug)) throw new ApiError(400, 'That part of the site has no home-screen app.');
    const choice = body.reset === true ? null : cleanChoice(slug, body);
    if (body.reset !== true && !choice && !(iconApp(slug)!.symbol === body.symbol && iconApp(slug)!.color === body.color)) {
      throw new ApiError(400, 'Pick one of the symbols and colours shown.');
    }
    const icons = await updateUsersData((data) => {
      const user = data.users.find((u) => u.id === userId);
      if (!user) throw new ApiError(404, 'Account not found');
      const next = cleanHomeIcons(user.homeIcons);
      if (choice) next[slug] = choice;
      else delete next[slug];
      if (Object.keys(next).length) user.homeIcons = next;
      else delete user.homeIcons;
      return next;
    });
    return NextResponse.json({ success: true, icons }, { headers: PRIVATE });
  } catch (error) {
    return handleApiError(error, 'Save home-screen icon failed');
  }
}

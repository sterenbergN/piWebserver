import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createAdminAuthToken } from '@/lib/security/auth';

export async function POST(request: Request) {
  try {
    const { password } = await request.json();

    const SECRET_PASSWORD = process.env.PI_DASHBOARD_PASSWORD;

    if (SECRET_PASSWORD && password === SECRET_PASSWORD) {
      const cookieStore = await cookies();
      cookieStore.set('pi_auth', createAdminAuthToken(), {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/',
        maxAge: 60 * 60 * 24 * 7 // 1 week
      });

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ success: false, message: "Invalid credentials" }, { status: 401 });
  } catch (err) {
    return NextResponse.json({ success: false, message: "Validation error" }, { status: 500 });
  }
}

export async function DELETE() {
  const cookieStore = await cookies();
  cookieStore.delete('pi_auth');
  return NextResponse.json({ success: true });
}

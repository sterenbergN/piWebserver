import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createAdminAuthToken } from '@/lib/security/auth';
import { loginRetryAfter, recordLoginFailure, recordLoginSuccess, tooManyAttemptsMessage } from '@/lib/security/rate-limit';

/** Constant-time comparison (hashing first makes the lengths equal). */
function samePassword(given: string, expected: string) {
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  try {
    const wait = loginRetryAfter(request, 'admin');
    if (wait) {
      return NextResponse.json({ success: false, message: tooManyAttemptsMessage(wait) }, { status: 429, headers: { 'Retry-After': String(wait) } });
    }

    const { password } = await request.json().catch(() => ({}));
    const SECRET_PASSWORD = process.env.PI_DASHBOARD_PASSWORD;

    if (SECRET_PASSWORD && typeof password === 'string' && samePassword(password, SECRET_PASSWORD)) {
      recordLoginSuccess(request, 'admin');
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

    await recordLoginFailure(request, 'admin');
    return NextResponse.json({ success: false, message: "Invalid credentials" }, { status: 401 });
  } catch {
    return NextResponse.json({ success: false, message: "Validation error" }, { status: 500 });
  }
}

export async function DELETE() {
  const cookieStore = await cookies();
  cookieStore.delete('pi_auth');
  return NextResponse.json({ success: true });
}

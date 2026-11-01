import { NextResponse } from 'next/server';
import { isAdminAuthenticated } from '@/lib/security/server-auth';
import { signedInUser } from '@/lib/security/session';

/** Who this browser is signed in as right now, so an open page can tell if what it shows has gone stale. */
export async function GET() {
  try {
    const [user, isAdmin] = await Promise.all([signedInUser(), isAdminAuthenticated()]);
    return NextResponse.json({ success: true, user, isAdmin }, { headers: { 'Cache-Control': 'no-store, private' } });
  } catch {
    // Not knowing isn't the same as signed out: the page keeps what it has.
    return NextResponse.json({ success: false }, { status: 500, headers: { 'Cache-Control': 'no-store, private' } });
  }
}

import { NextResponse } from 'next/server';
import { isAdminAuthenticated } from '@/lib/security/server-auth';

export async function GET() {
  const isAdmin = await isAdminAuthenticated();
  return NextResponse.json({ isAdmin });
}

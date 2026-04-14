import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { isAdminTokenValid } from '@/lib/security/auth';

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const isLegacyWorkoutDataPath = path.startsWith('/uploads/workouts/');
  
  const isProtectedPath = path.startsWith('/admin');

  if (isLegacyWorkoutDataPath) {
    return new NextResponse(null, { status: 404 });
  }
  
  if (isProtectedPath) {
    const token = request.cookies.get('pi_auth')?.value;
    
    if (!isAdminTokenValid(token)) {
      return NextResponse.redirect(new URL('/login', request.url));
    }
  }
  
  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*', '/uploads/workouts/:path*'],
};

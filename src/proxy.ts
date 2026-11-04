import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { isSameOrigin, CSRF_PROTECTED_METHODS } from '@/lib/csrf';

const protectedApiRoutes = ['/api/products', '/api/workspace'];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // CSRF: state-changing API calls from a browser must be same-origin.
  // (Per-handler auth checks remain the real authorisation boundary; this is
  // the browser-level layer on top of the SameSite=Lax session cookie.)
  if (pathname.startsWith('/api/') && CSRF_PROTECTED_METHODS.includes(request.method)) {
    // Compare against the Host header the browser actually used (includes a
    // non-standard port in dev/preview); nextUrl.host can drop the port.
    const host = request.headers.get('host') ?? request.nextUrl.host;
    if (!isSameOrigin(request.headers.get('origin'), host)) {
      return NextResponse.json({ error: 'Cross-origin request blocked.' }, { status: 403 });
    }
  }

  if (protectedApiRoutes.some((route) => pathname.startsWith(route)) && request.method !== 'GET') {
    const session = request.cookies.get('platera_session');
    if (!session) {
      return NextResponse.json({ error: 'Please sign in.' }, { status: 401 });
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: '/api/:path*',
};

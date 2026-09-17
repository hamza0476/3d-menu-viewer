import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const protectedApiRoutes = ['/api/products', '/api/workspace'];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

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

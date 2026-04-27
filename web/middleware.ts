import { NextRequest, NextResponse } from 'next/server';

// Lightweight cookie-presence check. Real verification happens in route handlers
// via getSession(). This just reduces unauthenticated round-trips on protected pages.
const PUBLIC_PATHS = new Set(['/login', '/signup']);
const PUBLIC_API_PREFIXES = [
  '/api/users/login',
  '/api/users/signup',
  '/api/users/logout',
  '/api/users/me',
];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();
  if (PUBLIC_API_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next();
  if (pathname.startsWith('/_next') || pathname.startsWith('/favicon')) {
    return NextResponse.next();
  }

  const hasSession = req.cookies.has('haera_session');
  const hasInternalToken = req.headers.has('x-haera-internal-token');
  if (!hasSession && !hasInternalToken) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

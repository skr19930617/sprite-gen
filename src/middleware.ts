import { type NextRequest, NextResponse } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

const PUBLIC_PATHS = ['/', '/login', '/signup', '/auth/callback'];
const PUBLIC_API_PREFIXES = ['/api/public', '/api/stripe/webhook'];

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Strict same-origin check for state-changing requests. Stripe webhook is
 * exempt because it carries its own HMAC signature.
 */
const isCrossOriginMutation = (request: NextRequest): boolean => {
  if (SAFE_METHODS.has(request.method)) return false;
  if (request.nextUrl.pathname.startsWith('/api/stripe/webhook')) return false;
  const origin = request.headers.get('origin');
  if (!origin) {
    // No Origin header — typically server-to-server. Block by default.
    return true;
  }
  try {
    const o = new URL(origin);
    return o.host !== request.nextUrl.host;
  } catch {
    return true;
  }
};

const isPublicPath = (pathname: string): boolean => {
  if (PUBLIC_PATHS.includes(pathname)) return true;
  if (pathname.startsWith('/api/')) {
    return PUBLIC_API_PREFIXES.some((p) => pathname.startsWith(p));
  }
  // Static / Next internals — never matched by matcher anyway, but be safe.
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.startsWith('/static/')
  ) {
    return true;
  }
  return false;
};

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  if (isCrossOriginMutation(request)) {
    return NextResponse.json(
      { error: 'cross-origin request blocked' },
      { status: 403 },
    );
  }

  const { response, user } = await updateSession(request);

  if (isPublicPath(pathname)) return response;

  if (!user) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: [
    /*
     * Match all paths except:
     * - Next.js internals (_next/static, _next/image)
     * - Files with extensions (assets)
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|txt|xml)$).*)',
  ],
};

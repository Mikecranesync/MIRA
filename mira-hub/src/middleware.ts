import { withAuth, type NextRequestWithAuth } from "next-auth/middleware";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";

// withAuth's two-arg form runs the inner middleware ONLY when authorized.
// When AUTH_SECRET is unset in the runtime env, getToken throws and withAuth
// silently returns NextResponse.next() without invoking the inner function
// at all (per PR #634's issue body). That means we can't put the basePath
// root redirect inside withAuth — it has to fire before withAuth gets the
// chance to fall through.
const authMiddleware = withAuth({
  pages: {
    signIn: "/login",
  },
  secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
});

export default async function middleware(req: NextRequest, ev: NextFetchEvent) {
  // Basepath root → redirect to /feed. `redirect()` from a Server Component
  // is silently swallowed in Next.js 16.2.4 standalone + basePath (response
  // comes back chunked, 0 bytes, no Location header), so the redirect has
  // to live here. /feed itself goes through authMiddleware below, so the
  // auth gate is preserved.
  if (req.nextUrl.pathname === "/") {
    const url = req.nextUrl.clone();
    url.pathname = "/feed";
    return NextResponse.redirect(url);
  }
  return authMiddleware(req as NextRequestWithAuth, ev);
}

export const config = {
  matcher: [
    "/((?!login|signup|api/auth|api/health|_next/static|_next/image|favicon\\.ico).*)",
  ],
};

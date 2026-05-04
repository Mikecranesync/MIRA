import { withAuth, type NextRequestWithAuth } from "next-auth/middleware";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";

// Gate pages: authenticated users with non-approved status land here;
// skip the status check when already on these pages to avoid redirect loops.
const GATE_PATHS = ["/pending-approval", "/upgrade", "/magic"];

// withAuth's two-arg form: inner function runs ONLY when authorized (token exists).
// The outer middleware handles the basePath root redirect before withAuth runs.
const authMiddleware = withAuth(
  function onAuthorized(req: NextRequestWithAuth) {
    const token = req.nextauth?.token;
    if (!token) return NextResponse.next();

    const pathname = req.nextUrl.pathname;
    if (GATE_PATHS.some(p => pathname.startsWith(p))) return NextResponse.next();

    const status = String(token.status ?? "trial");

    if (status === "pending") {
      const url = req.nextUrl.clone();
      url.pathname = "/pending-approval";
      return NextResponse.redirect(url);
    }

    if (status === "expired") {
      const url = req.nextUrl.clone();
      url.pathname = "/upgrade";
      return NextResponse.redirect(url);
    }

    if (status === "trial" && token.trialExpiresAt) {
      if (new Date() > new Date(token.trialExpiresAt as string)) {
        const url = req.nextUrl.clone();
        url.pathname = "/upgrade";
        return NextResponse.redirect(url);
      }
    }

    return NextResponse.next();
  },
  {
    pages: { signIn: "/login" },
    secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
  },
);

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
    "/((?!login|signup|magic|api/auth|api/health|_next/static|_next/image|favicon\\.ico).*)",
  ],
};

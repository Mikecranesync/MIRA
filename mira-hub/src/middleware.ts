import { withAuth, type NextRequestWithAuth } from "next-auth/middleware";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import crypto from "node:crypto";

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

function buildCsp(nonce: string): string {
  return [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' https://accounts.google.com https://apis.google.com https://js.stripe.com`,
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://js.stripe.com`,
    `font-src 'self' https://fonts.gstatic.com`,
    `img-src 'self' data: https:`,
    `connect-src 'self' https://accounts.google.com https://api.hubapi.com https://api.stripe.com https://js.stripe.com`,
    `frame-src https://accounts.google.com https://js.stripe.com https://hooks.stripe.com`,
  ].join("; ");
}

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

  // Per-request nonce for script-src CSP — removes unsafe-inline/unsafe-eval.
  // Forwarded as x-nonce request header so RootLayout can attach it to <Script>.
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp(nonce);

  // Auth check runs on the original request (auth reads cookies, not x-nonce).
  const authResult = await authMiddleware(req as NextRequestWithAuth, ev);

  // Auth issued a redirect (e.g. → /login) — stamp CSP and return as-is.
  if (authResult && authResult.status >= 300 && authResult.status < 400) {
    authResult.headers.set("Content-Security-Policy", csp);
    return authResult;
  }

  // Pass through: forward nonce to server components + set CSP on response.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    "/((?!login|signup|magic|api/auth|api/health|api/scanbe/healthz|_next/static|_next/image|favicon\\.ico|sitemap\\.xml|robots\\.txt).*)",
  ],
};

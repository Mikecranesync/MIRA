import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { jwtDecrypt } from "jose";

// Next.js 16 middleware runs in the edge runtime. We must NOT import
// `node:crypto` or `next-auth/middleware` here — both pull native modules
// into the edge bundle and crash module evaluation with
// "Failed to load external module node:crypto" (#1303).
//
// Edge runtime exposes `crypto.randomUUID()` and `crypto.subtle` as globals
// (Web Crypto API). We use those for the CSP nonce and HKDF, and decrypt
// the next-auth session JWE with top-level `jose` 5 (resolves to the
// Web-Crypto build via the `worker` export condition).

const GATE_PATHS = ["/pending-approval", "/upgrade", "/magic"];
const SECURE_NAME = "__Secure-next-auth.session-token";
const REGULAR_NAME = "next-auth.session-token";
const HKDF_INFO = "NextAuth.js Generated Encryption Key";

// Command Center frames live HMI displays (Node-RED dashboards, web HMIs) in an
// iframe. CSP `frame-src` is a per-document allowlist, so those display hosts must
// be permitted here or the browser silently blocks the frame (blank viewer pane).
// Env-driven, EMPTY BY DEFAULT — prod CSP is unchanged until an operator sets it.
// Each entry must be an exact `scheme://host[:port]` origin (never a bare scheme or
// wildcard). This is the same seam Phase 2 uses: point it at the on-prem Tailscale
// reverse proxy's HTTPS origin once that lands.
//   e.g. CSP_FRAME_SRC_DISPLAY_HOSTS="http://192.168.1.12:1880,https://hmi.example.tailnet.ts.net"
// NOTE: a HTTPS Hub framing a HTTP display is blocked by the browser as mixed
// active content regardless of CSP — that's the Phase-2 (TLS-terminating proxy) gap,
// not something this allowlist can fix.
const DISPLAY_FRAME_SRC = (process.env.CSP_FRAME_SRC_DISPLAY_HOSTS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

async function deriveKey(secret: string): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const ikm = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    "HKDF",
    false,
    ["deriveBits"],
  );
  // next-auth v4.24.14 uses salt="" by default; info matches @panva/hkdf call
  // in next-auth/jwt/index.js (`"NextAuth.js Generated Encryption Key" + (salt ? ` (${salt})` : "")`).
  const derived = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(0),
      info: enc.encode(HKDF_INFO),
    },
    ikm,
    256,
  );
  return new Uint8Array(derived);
}

async function decodeSessionJwt(
  token: string,
  secret: string,
): Promise<Record<string, unknown> | null> {
  try {
    const key = await deriveKey(secret);
    const { payload } = await jwtDecrypt(token, key, { clockTolerance: 15 });
    return payload as Record<string, unknown>;
  } catch {
    return null;
  }
}

function gateRedirect(req: NextRequest, status: string, trialExpiresAt: unknown): URL | null {
  if (status === "pending") {
    const url = req.nextUrl.clone();
    url.pathname = "/pending-approval";
    url.search = "";
    return url;
  }
  if (status === "expired") {
    const url = req.nextUrl.clone();
    url.pathname = "/upgrade";
    url.search = "";
    return url;
  }
  if (status === "trial" && typeof trialExpiresAt === "string") {
    if (new Date() > new Date(trialExpiresAt)) {
      const url = req.nextUrl.clone();
      url.pathname = "/upgrade";
      url.search = "";
      return url;
    }
  }
  return null;
}

function buildCsp(nonce: string, pathname: string): string {
  // `/scan` is the monday.com marketplace iframe — it must be framable by
  // monday's marketplace shell. Every other path stays self-only.
  const frameAncestors = pathname.startsWith("/scan")
    ? `frame-ancestors 'self' https://*.monday.com`
    : `frame-ancestors 'self'`;
  return [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' https://accounts.google.com https://apis.google.com https://js.stripe.com`,
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://js.stripe.com`,
    `font-src 'self' https://fonts.gstatic.com`,
    `img-src 'self' data: https:`,
    `connect-src 'self' https://accounts.google.com https://api.hubapi.com https://api.stripe.com https://js.stripe.com`,
    // Command Center display hosts (DISPLAY_FRAME_SRC) are appended so the framed
    // HMI loads. CSP checks the post-redirect URL, so even though the iframe src is
    // the same-origin /api/command-center/display/[id] route, the display host it
    // 302s to must be listed here.
    // `'self'` is required: the Command Center iframe src is the same-origin
    // /api/command-center/display/[id] route. frame-src does NOT inherit from
    // default-src, so without 'self' the browser blocks framing our own route.
    // The display host(s) cover the URL that route 302-redirects to (CSP
    // re-checks frame-src against the post-redirect URL).
    [
      `frame-src 'self' https://accounts.google.com https://js.stripe.com https://hooks.stripe.com https://mikecranesync.github.io`,
      ...DISPLAY_FRAME_SRC,
    ].join(" "),
    frameAncestors,
  ].join("; ");
}

// Apply HSTS + XFO + CSP to every response in one place. `/scan` is the
// monday.com marketplace iframe — it must NOT have X-Frame-Options: DENY
// (which would block ALL framing); the CSP `frame-ancestors` directive
// (set by buildCsp) is the modern equivalent and already allows monday.
function applySecurityHeaders(
  resp: NextResponse,
  pathname: string,
  csp: string,
): NextResponse {
  resp.headers.set("Content-Security-Policy", csp);
  resp.headers.set(
    "Strict-Transport-Security",
    "max-age=63072000; includeSubDomains; preload",
  );
  if (!pathname.startsWith("/scan")) {
    resp.headers.set("X-Frame-Options", "DENY");
  }
  return resp;
}

// btoa is a global in the edge runtime; use it instead of Buffer for nonce encoding.
function b64Nonce(raw: string): string {
  return btoa(raw).replace(/=+$/, "");
}

export default async function middleware(req: NextRequest, _ev: NextFetchEvent) {
  const pathname = req.nextUrl.pathname;

  // Per-request nonce for script-src CSP — removes unsafe-inline/unsafe-eval.
  // Forwarded as x-nonce request header so RootLayout can attach it to <Script>.
  const nonce = b64Nonce(crypto.randomUUID());
  const csp = buildCsp(nonce, pathname);

  // Basepath root → /feed. `redirect()` from a Server Component is silently
  // swallowed in Next.js 16.2.4 standalone + basePath (response comes back
  // chunked, 0 bytes, no Location header), so the redirect has to live here.
  if (pathname === "/") {
    const url = req.nextUrl.clone();
    url.pathname = "/feed";
    url.search = "";
    return applySecurityHeaders(NextResponse.redirect(url), pathname, csp);
  }

  const cookieValue =
    req.cookies.get(SECURE_NAME)?.value ?? req.cookies.get(REGULAR_NAME)?.value;
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET ?? "";

  // No cookie or no secret configured → bounce to /login with callback.
  // EXCEPT for /api/* which must return 401 JSON (matches sessionOr401() in
  // lib/session.ts) so non-browser consumers (curl, SDK, canary) don't get
  // an HTML redirect they can't interpret. See #1764.
  if (!cookieValue || !secret) {
    if (pathname.startsWith("/api/")) {
      return applySecurityHeaders(
        NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
        pathname,
        csp,
      );
    }
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("callbackUrl", pathname);
    return applySecurityHeaders(NextResponse.redirect(url), pathname, csp);
  }

  const token = await decodeSessionJwt(cookieValue, secret);
  if (!token) {
    if (pathname.startsWith("/api/")) {
      return applySecurityHeaders(
        NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
        pathname,
        csp,
      );
    }
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("callbackUrl", pathname);
    return applySecurityHeaders(NextResponse.redirect(url), pathname, csp);
  }

  // Already on a gate page — let it render so the user can act.
  if (!GATE_PATHS.some((p) => pathname.startsWith(p))) {
    const status = String(token.status ?? "trial");
    const redirectUrl = gateRedirect(req, status, token.trialExpiresAt);
    if (redirectUrl) {
      return applySecurityHeaders(
        NextResponse.redirect(redirectUrl),
        pathname,
        csp,
      );
    }
  }

  // Pass through: forward nonce to server components + set CSP on response.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  return applySecurityHeaders(response, pathname, csp);
}

export const config = {
  matcher: [
    // `quickstart` and `api/quickstart/*` are public — the Twilio-moment landing
    // page (ADR-0014). Excluding from the matcher prevents the middleware from
    // bouncing anonymous visitors to /login.
    // api/uploads/folder (POST) and api/uploads/[id] (GET, dual-auth) are the
    // service-token ingest + status routes used by tools/mira-drop-watcher —
    // they do their own bearer-token check, so the cookie-based middleware
    // must not intercept them.
    "/((?!login|signup|magic|m/|quickstart|api/auth|api/public|api/quickstart|api/health|api/scanbe/healthz|api/uploads/folder|api/uploads/[a-f0-9]|_next/static|_next/image|favicon\\.ico|sitemap\\.xml|robots\\.txt).*)",
  ],
};

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

// btoa is a global in the edge runtime; use it instead of Buffer for nonce encoding.
function b64Nonce(raw: string): string {
  return btoa(raw).replace(/=+$/, "");
}

export default async function middleware(req: NextRequest, _ev: NextFetchEvent) {
  const pathname = req.nextUrl.pathname;

  // Basepath root → /feed. `redirect()` from a Server Component is silently
  // swallowed in Next.js 16.2.4 standalone + basePath (response comes back
  // chunked, 0 bytes, no Location header), so the redirect has to live here.
  if (pathname === "/") {
    const url = req.nextUrl.clone();
    url.pathname = "/feed";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Per-request nonce for script-src CSP — removes unsafe-inline/unsafe-eval.
  // Forwarded as x-nonce request header so RootLayout can attach it to <Script>.
  const nonce = b64Nonce(crypto.randomUUID());
  const csp = buildCsp(nonce);

  const cookieValue =
    req.cookies.get(SECURE_NAME)?.value ?? req.cookies.get(REGULAR_NAME)?.value;
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET ?? "";

  // No cookie or no secret configured → bounce to /login with callback.
  if (!cookieValue || !secret) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("callbackUrl", pathname);
    const resp = NextResponse.redirect(url);
    resp.headers.set("Content-Security-Policy", csp);
    return resp;
  }

  const token = await decodeSessionJwt(cookieValue, secret);
  if (!token) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("callbackUrl", pathname);
    const resp = NextResponse.redirect(url);
    resp.headers.set("Content-Security-Policy", csp);
    return resp;
  }

  // Already on a gate page — let it render so the user can act.
  if (!GATE_PATHS.some((p) => pathname.startsWith(p))) {
    const status = String(token.status ?? "trial");
    const redirectUrl = gateRedirect(req, status, token.trialExpiresAt);
    if (redirectUrl) {
      const resp = NextResponse.redirect(redirectUrl);
      resp.headers.set("Content-Security-Policy", csp);
      return resp;
    }
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
    "/((?!login|signup|magic|m/|api/auth|api/public|api/health|api/scanbe/healthz|_next/static|_next/image|favicon\\.ico|sitemap\\.xml|robots\\.txt).*)",
  ],
};

/**
 * Signup UTM attribution — edge-safe (no DB, no Node builtins).
 *
 * Used by Hub middleware (first-touch cookie on /signup and /login) and by
 * the register / Google-signup hooks (read body + cookie + Referer).
 * The click ids themselves are never stored — presence booleans only.
 */

export interface PilotAttribution {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  /** Presence only — the click id itself is never stored (ad-click-bound
   * identifier, PII-adjacent; see security-boundaries.md). */
  hasGclid: boolean;
  hasFbclid: boolean;
}

export const EMPTY_ATTRIBUTION: PilotAttribution = {
  utmSource: null,
  utmMedium: null,
  utmCampaign: null,
  utmContent: null,
  utmTerm: null,
  hasGclid: false,
  hasFbclid: false,
};

export const UTM_COOKIE_NAME = "flm_utm";
export const UTM_COOKIE_MAX_AGE_S = 60 * 60 * 24 * 30;

const MAX_FIELD_LEN = 128;
// Allowlist charset covering real ad-platform UTM values (letters, digits,
// space, -, _, ., %, +). Everything else — quotes, angle brackets, control
// chars, newlines — is stripped before this value is stored or emailed.
const UNSAFE_CHARS_RE = /[^a-zA-Z0-9 ._%+-]/g;

export function sanitizeField(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.trim().replace(UNSAFE_CHARS_RE, "").slice(0, MAX_FIELD_LEN);
  return cleaned.length > 0 ? cleaned : null;
}

function hasNonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.length > 0;
}

export function attributionFromParams(params: URLSearchParams): PilotAttribution {
  return {
    utmSource: sanitizeField(params.get("utm_source")),
    utmMedium: sanitizeField(params.get("utm_medium")),
    utmCampaign: sanitizeField(params.get("utm_campaign")),
    utmContent: sanitizeField(params.get("utm_content")),
    utmTerm: sanitizeField(params.get("utm_term")),
    hasGclid: hasNonEmptyString(params.get("gclid")),
    hasFbclid: hasNonEmptyString(params.get("fbclid")),
  };
}

export function attributionFromBody(body: unknown): PilotAttribution {
  if (!body || typeof body !== "object") return EMPTY_ATTRIBUTION;
  const b = body as Record<string, unknown>;
  return {
    utmSource: sanitizeField(b.utm_source),
    utmMedium: sanitizeField(b.utm_medium),
    utmCampaign: sanitizeField(b.utm_campaign),
    utmContent: sanitizeField(b.utm_content),
    utmTerm: sanitizeField(b.utm_term),
    hasGclid: hasNonEmptyString(b.gclid),
    hasFbclid: hasNonEmptyString(b.fbclid),
  };
}

export function mergeAttribution(
  primary: PilotAttribution,
  fallback: PilotAttribution,
): PilotAttribution {
  return {
    utmSource: primary.utmSource ?? fallback.utmSource,
    utmMedium: primary.utmMedium ?? fallback.utmMedium,
    utmCampaign: primary.utmCampaign ?? fallback.utmCampaign,
    utmContent: primary.utmContent ?? fallback.utmContent,
    utmTerm: primary.utmTerm ?? fallback.utmTerm,
    hasGclid: primary.hasGclid || fallback.hasGclid,
    hasFbclid: primary.hasFbclid || fallback.hasFbclid,
  };
}

export function attributionHasSignal(a: PilotAttribution): boolean {
  return Boolean(
    a.utmSource ||
      a.utmMedium ||
      a.utmCampaign ||
      a.utmContent ||
      a.utmTerm ||
      a.hasGclid ||
      a.hasFbclid,
  );
}

/** Serialize for the first-touch cookie. gclid/fbclid are presence flags, never the id. */
export function serializeUtmCookie(a: PilotAttribution): string {
  const p = new URLSearchParams();
  if (a.utmSource) p.set("utm_source", a.utmSource);
  if (a.utmMedium) p.set("utm_medium", a.utmMedium);
  if (a.utmCampaign) p.set("utm_campaign", a.utmCampaign);
  if (a.utmContent) p.set("utm_content", a.utmContent);
  if (a.utmTerm) p.set("utm_term", a.utmTerm);
  if (a.hasGclid) p.set("gclid", "1");
  if (a.hasFbclid) p.set("fbclid", "1");
  return p.toString();
}

export function parseUtmCookieValue(raw: string | undefined | null): PilotAttribution {
  if (!raw) return EMPTY_ATTRIBUTION;
  try {
    return attributionFromParams(new URLSearchParams(raw));
  } catch {
    return EMPTY_ATTRIBUTION;
  }
}

function cookieHeaderValue(header: string, name: string): string | null {
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    if (trimmed.slice(0, eq) === name) {
      try {
        return decodeURIComponent(trimmed.slice(eq + 1));
      } catch {
        return trimmed.slice(eq + 1);
      }
    }
  }
  return null;
}

export function attributionFromCookieHeader(cookieHeader: string | null): PilotAttribution {
  if (!cookieHeader) return EMPTY_ATTRIBUTION;
  return parseUtmCookieValue(cookieHeaderValue(cookieHeader, UTM_COOKIE_NAME));
}

/**
 * First-touch UTM cookie. Sets `value` only when the request search has a
 * signal AND no cookie is already present (register_once semantics).
 * Returns the value that should be stored, or null if nothing to stamp.
 */
export function firstTouchUtmCookieValue(
  search: string,
  existingCookie: string | undefined,
): string | null {
  if (existingCookie) return null;
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const incoming = attributionFromParams(params);
  if (!attributionHasSignal(incoming)) return null;
  return serializeUtmCookie(incoming);
}

export function isSignupOrLoginPath(pathname: string): boolean {
  const p = pathname.replace(/\/+$/, "") || "/";
  return p === "/signup" || p === "/login";
}

/**
 * Attribution for a new signup. Precedence (first wins per field):
 *   1. JSON body (explicit client / future ad landing)
 *   2. First-touch `flm_utm` cookie (survives Google OAuth)
 *   3. Referer query string (same-origin /signup?utm_*)
 *
 * The frozen `/signup` page is not edited — middleware stamps the cookie,
 * and this reader picks it up on `/api/auth/register` and the Google callback.
 */
export function attributionFromRequest(req: Request, body?: unknown): PilotAttribution {
  let fromReferer = EMPTY_ATTRIBUTION;
  const referer = req.headers.get("referer");
  if (referer) {
    try {
      fromReferer = attributionFromParams(new URL(referer).searchParams);
    } catch {
      // Malformed/relative Referer header — not fatal, just no signal.
    }
  }
  const fromCookie = attributionFromCookieHeader(req.headers.get("cookie"));
  return mergeAttribution(
    attributionFromBody(body),
    mergeAttribution(fromCookie, fromReferer),
  );
}

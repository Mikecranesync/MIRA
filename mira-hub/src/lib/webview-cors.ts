// Scoped CORS for the native app's WebView (#3453, ChatGPT-parity PRD STRM-1).
//
// The Capacitor shell serves the packaged bundle from a LOCAL origin
// (`https://localhost` on Android per capacitor.config.ts `androidScheme: https`;
// `capacitor://localhost` is Capacitor's iOS default). A raw WebView `fetch`
// from that origin to the Hub is cross-origin, so streaming the notebook chat
// body per token (instead of the buffered native CapacitorHttp patch) needs the
// Hub to answer the preflight and echo the origin back with credentials on.
//
// Rules (deliberately narrow — this is the only CORS the Hub grants):
//   - env-driven allowlist, EMPTY BY DEFAULT → zero change to prod headers;
//   - exact `scheme://host[:port]` origins only; `*` and wildcards are dropped;
//   - echo the matched origin (never `*`) + `Vary: Origin` + credentials=true;
//   - only the equipment-notebook routes the app's Notebook tab calls.
//
// Edge-safe: pure functions, no node: imports (middleware.ts runs on the edge).

export const MOBILE_WEBVIEW_ORIGINS_ENV = "MOBILE_WEBVIEW_ORIGINS";

/** Exact origin: scheme://host[:port], no path, no wildcard, no credentials. */
const ORIGIN_RE = /^(https|capacitor|ionic):\/\/[a-z0-9.-]+(?::\d{1,5})?$/i;

/** Path prefix (basePath-stripped) that may receive WebView CORS headers. */
export const WEBVIEW_CORS_PATH_PREFIX = "/api/equipment-notebooks/";

export function parseWebviewOrigins(raw: string | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const item of raw.split(",")) {
    const o = item.trim();
    if (!o || o.includes("*") || !ORIGIN_RE.test(o)) continue;
    const norm = o.toLowerCase();
    if (!out.includes(norm)) out.push(norm);
  }
  return out;
}

export function isWebviewCorsPath(pathname: string): boolean {
  return pathname.startsWith(WEBVIEW_CORS_PATH_PREFIX);
}

/** The matched origin, or null when the request must get no CORS grant. */
export function matchWebviewOrigin(
  origin: string | null | undefined,
  allowlist: readonly string[],
): string | null {
  if (!origin || allowlist.length === 0) return null;
  const norm = origin.trim().toLowerCase();
  return allowlist.includes(norm) ? norm : null;
}

const PREFLIGHT_METHODS = "GET, POST, PATCH, DELETE, OPTIONS";
const DEFAULT_ALLOW_HEADERS = "Content-Type";
const PREFLIGHT_MAX_AGE = "600";

/** Headers for an actual (non-preflight) response to an allowed origin. */
export function webviewCorsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    Vary: "Origin",
  };
}

/** Headers for the OPTIONS preflight to an allowed origin. Echoes the requested
 *  headers (a preflight only asks for what the caller will send). */
export function webviewPreflightHeaders(
  origin: string,
  requestedHeaders: string | null | undefined,
): Record<string, string> {
  const wanted = (requestedHeaders ?? "").trim();
  return {
    ...webviewCorsHeaders(origin),
    "Access-Control-Allow-Methods": PREFLIGHT_METHODS,
    "Access-Control-Allow-Headers": wanted || DEFAULT_ALLOW_HEADERS,
    "Access-Control-Max-Age": PREFLIGHT_MAX_AGE,
  };
}

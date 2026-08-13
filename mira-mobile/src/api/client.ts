// Shared mobile data layer — transport half (ADR-0034 Phase 3).
//
// ONE place owns: native HTTP, the persisted cookie jar (NextAuth session),
// typed errors, 401/403 discrimination, bounded retry for idempotent reads,
// and the mutation seam that carries a client-generated idempotency key.
// Screens NEVER hand-roll fetch/auth/retry logic (five-tabs rule).
//
// Fail-closed doctrine: auth/role state that cannot be established renders as
// least privilege; a 401 anywhere flips the app to the login screen via the
// onAuthExpired subscription. Cookies are never logged.

import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";

export const API_BASE = "https://app.factorylm.com";
const JAR_KEY = "flm.cookiejar.v1";

export type ApiErrorKind =
  | "auth" // 401 — session missing/expired
  | "forbidden" // 403 — authenticated but not permitted
  | "not_found" // 404
  | "client" // other 4xx (validation etc.)
  | "server" // 5xx
  | "network"; // transport failure / timeout / offline

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | null;
  readonly detail: string;
  constructor(kind: ApiErrorKind, status: number | null, detail: string) {
    super(`${kind}${status ? ` (${status})` : ""}: ${detail}`);
    this.kind = kind;
    this.status = status;
    this.detail = detail;
  }
  /** Human line for error states; never includes secrets. */
  get userMessage(): string {
    switch (this.kind) {
      case "auth":
        return "Session expired — sign in again.";
      case "forbidden":
        return "Your role doesn't allow this action.";
      case "not_found":
        return "Not found (or no access).";
      case "network":
        return "Network problem — check connectivity and retry.";
      case "server":
        return "Server error — try again shortly.";
      default:
        return this.detail || "Request failed.";
    }
  }
}

// --- cookie jar (proven in Phase 2; unchanged semantics) --------------------

let jar: Record<string, string> = {};
let jarLoaded = false;

async function loadJar(): Promise<void> {
  if (jarLoaded) return;
  const { value } = await Preferences.get({ key: JAR_KEY });
  jar = value ? (JSON.parse(value) as Record<string, string>) : {};
  jarLoaded = true;
}

async function saveJar(): Promise<void> {
  await Preferences.set({ key: JAR_KEY, value: JSON.stringify(jar) });
}

/** Split a combined Set-Cookie header on commas that start a new cookie-pair.
 *  The lookahead requires `name=` before the next `;`, which an `Expires=`
 *  weekday/date fragment ("Thu, 13 Aug 2026…") can never satisfy. */
export function splitSetCookie(combined: string): string[] {
  return combined.split(/,(?=\s*[^\s;,=]+=[^;,]*)/);
}

function storeSetCookies(headers: Record<string, string>): void {
  const raw = headers["Set-Cookie"] ?? headers["set-cookie"] ?? headers["SET-COOKIE"];
  if (!raw) return;
  for (const c of splitSetCookie(raw)) {
    const pair = c.split(";")[0];
    const i = pair.indexOf("=");
    if (i <= 0) continue;
    const name = pair.slice(0, i).trim();
    const value = pair.slice(i + 1).trim();
    if (value === "" || /Max-Age=0/i.test(c)) delete jar[name];
    else jar[name] = value;
  }
}

function cookieHeader(): string {
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

export async function clearAllLocalState(): Promise<void> {
  jar = {};
  await saveJar();
}

// --- auth-expiry subscription ----------------------------------------------

type AuthExpiredFn = () => void;
let authExpiredListeners: AuthExpiredFn[] = [];
export function onAuthExpired(fn: AuthExpiredFn): () => void {
  authExpiredListeners.push(fn);
  return () => {
    authExpiredListeners = authExpiredListeners.filter((f) => f !== fn);
  };
}

// Suppressed during the sign-in dance itself (a wrong password 401 is not an
// expired session).
let suppressAuthEvents = false;
export function withAuthEventsSuppressed<T>(fn: () => Promise<T>): Promise<T> {
  suppressAuthEvents = true;
  return fn().finally(() => {
    suppressAuthEvents = false;
  });
}

// --- request core -----------------------------------------------------------

export interface ApiResponse {
  status: number;
  data: unknown;
  text: string;
}

interface RequestOpts {
  method?: string;
  form?: Record<string, string>;
  json?: unknown;
  /** GETs retry once on transport failure; mutations retry ONLY when the
   *  caller provides an idempotency key (safe replay by contract). */
  idempotencyKey?: string;
  timeoutMs?: number;
}

async function rawRequest(path: string, opts: RequestOpts): Promise<ApiResponse> {
  await loadJar();
  const method = opts.method ?? "GET";
  const headers: Record<string, string> = {};
  const cookies = cookieHeader();
  if (cookies) headers["Cookie"] = cookies;

  let dataBody: string | undefined;
  if (opts.form) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    dataBody = new URLSearchParams(opts.form).toString();
  } else if (opts.json !== undefined) {
    headers["Content-Type"] = "application/json";
    dataBody = JSON.stringify(opts.json);
  }

  if (Capacitor.isNativePlatform()) {
    const res = await CapacitorHttp.request({
      url: API_BASE + path,
      method,
      headers,
      data: dataBody,
      disableRedirects: true,
      responseType: "text",
      readTimeout: opts.timeoutMs ?? 90_000,
      connectTimeout: 15_000,
    });
    storeSetCookies((res.headers ?? {}) as Record<string, string>);
    await saveJar();
    const text = typeof res.data === "string" ? res.data : JSON.stringify(res.data ?? "");
    let data: unknown = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
    return { status: res.status, data, text };
  }

  // Dev-browser fallback (vite proxy); browser owns cookies.
  const res = await fetch(path, {
    method,
    headers: opts.form || opts.json !== undefined ? headers : undefined,
    body: dataBody,
    credentials: "include",
    redirect: "manual",
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }
  return { status: res.status, data, text };
}

function errorFromStatus(status: number, data: unknown): ApiError {
  const detail =
    (typeof data === "object" && data !== null && "error" in data
      ? String((data as { error: unknown }).error)
      : "") || `HTTP ${status}`;
  if (status === 401) return new ApiError("auth", 401, detail);
  if (status === 403) return new ApiError("forbidden", 403, detail);
  if (status === 404) return new ApiError("not_found", 404, detail);
  if (status >= 500) return new ApiError("server", status, detail);
  return new ApiError("client", status, detail);
}

/** Multipart POST (file uploads). Uses window.fetch: on native the Capacitor
 *  fetch patch rebuilds real multipart in native code (FormData cannot cross
 *  the plugin bridge) and we attach the session Cookie explicitly from OUR
 *  jar; in the dev browser it is a plain fetch through the vite proxy with
 *  browser cookies. NOT retried — callers own replay semantics. */
export async function uploadMultipart(path: string, form: FormData): Promise<ApiResponse> {
  await loadJar();
  const native = Capacitor.isNativePlatform();
  const headers: Record<string, string> = {};
  if (native) {
    const cookies = cookieHeader();
    if (cookies) headers["Cookie"] = cookies;
  }
  let res: Response;
  try {
    res = await fetch(native ? API_BASE + path : path, {
      method: "POST",
      headers,
      body: form,
      ...(native ? {} : { credentials: "include" as const }),
    });
  } catch (e) {
    throw new ApiError("network", null, String(e));
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }
  if (res.status === 401 && !suppressAuthEvents) {
    for (const fn of authExpiredListeners) fn();
  }
  if (res.status >= 200 && res.status < 300) return { status: res.status, data, text };
  throw errorFromStatus(res.status, data);
}

/** Core request: throws typed ApiError on non-2xx; retries transport failures
 *  once for GETs and keyed mutations. 401s notify the auth-expired listeners
 *  (unless suppressed) AND still throw, so callers always see the failure. */
export async function request(path: string, opts: RequestOpts = {}): Promise<ApiResponse> {
  const method = opts.method ?? "GET";
  const retryable = method === "GET" || Boolean(opts.idempotencyKey);
  let lastNetworkErr: unknown;
  for (let attempt = 0; attempt < (retryable ? 2 : 1); attempt++) {
    let res: ApiResponse;
    try {
      res = await rawRequest(path, opts);
    } catch (e) {
      lastNetworkErr = e;
      continue; // transport failure — retry if permitted
    }
    if (res.status === 401 && !suppressAuthEvents) {
      for (const fn of authExpiredListeners) fn();
    }
    if (res.status >= 200 && res.status < 300) return res;
    throw errorFromStatus(res.status, res.data);
  }
  throw new ApiError("network", null, String(lastNetworkErr ?? "request failed"));
}

// FactoryLM Hub API client for the native shell (ADR-0034).
//
// Transport: CapacitorHttp on-device (native HTTP — no CORS, no WebView-origin
// cookies), plain fetch in dev-browser (behind the vite proxy). Cookies are
// managed EXPLICITLY in a small jar persisted via Preferences, mirroring the
// prod-proven auth dance (scratch probe 2026-08-13: csrf → credentials
// callback → session cookie → /api/me 200 → signout → 401).
//
// The Hub canonicalizes to TRAILING-SLASH paths — a slashless call costs a 308.
// SECURITY NOTE (skeleton): the session JWE lives in Preferences (app-private
// storage). Phase 4 hardens this to Keystore/Keychain-backed secure storage.

import { CapacitorHttp } from "@capacitor/core";
import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";

export const API_BASE = "https://app.factorylm.com";
const JAR_KEY = "flm.cookiejar.v1";

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
function splitSetCookie(combined: string): string[] {
  return combined.split(/,(?=\s*[^\s;,=]+=[^;,]*)/);
}

function storeSetCookies(headers: Record<string, string>): void {
  const raw =
    headers["Set-Cookie"] ?? headers["set-cookie"] ?? headers["SET-COOKIE"];
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

export interface ApiResponse {
  status: number;
  data: unknown;
  text: string;
}

async function request(
  path: string,
  opts: {
    method?: string;
    form?: Record<string, string>;
    json?: unknown;
  } = {},
): Promise<ApiResponse> {
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
      // NextAuth callbacks 302 on success in browser flows; we send json:true
      // so success is a 200, but never follow redirects into HTML.
      disableRedirects: true,
      responseType: "text",
    });
    storeSetCookies((res.headers ?? {}) as Record<string, string>);
    await saveJar();
    const text =
      typeof res.data === "string" ? res.data : JSON.stringify(res.data ?? "");
    let data: unknown = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
    return { status: res.status, data, text };
  }

  // Dev-browser fallback (vite proxy) — browser owns the cookies here.
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

// ---------------------------------------------------------------------------
// Auth (the prod-proven NextAuth dance)
// ---------------------------------------------------------------------------

export async function signIn(
  email: string,
  password: string,
): Promise<{ ok: boolean; error?: string }> {
  const csrfRes = await request("/api/auth/csrf/");
  const csrfToken = (csrfRes.data as { csrfToken?: string } | null)?.csrfToken;
  if (!csrfToken) return { ok: false, error: `csrf failed (${csrfRes.status})` };

  const cb = await request("/api/auth/callback/credentials/", {
    method: "POST",
    form: { csrfToken, email, password, json: "true" },
  });
  // Success is proven by an authenticated /api/me, not by the callback shape.
  const me = await request("/api/me/");
  if (me.status === 200) return { ok: true };
  return {
    ok: false,
    error: cb.status >= 400 ? `login failed (${cb.status})` : "invalid email or password",
  };
}

export async function signOut(): Promise<void> {
  const csrfRes = await request("/api/auth/csrf/");
  const csrfToken = (csrfRes.data as { csrfToken?: string } | null)?.csrfToken;
  if (csrfToken) {
    await request("/api/auth/signout/", {
      method: "POST",
      form: { csrfToken, json: "true" },
    });
  }
  // Fail-closed locally regardless of server response: drop ALL local state.
  jar = {};
  await saveJar();
}

// ---------------------------------------------------------------------------
// Typed surface for the skeleton screens
// ---------------------------------------------------------------------------

export interface Me {
  id: string;
  email: string;
  name: string | null;
  role: string;
  tenantId: string;
  capabilities: string[];
}

/** Fail-closed: any non-200 or malformed body yields null (unauthenticated). */
export async function getMe(): Promise<Me | null> {
  const r = await request("/api/me/");
  if (r.status !== 200 || typeof r.data !== "object" || r.data === null) return null;
  const d = r.data as Record<string, unknown>;
  return {
    id: String(d.id ?? ""),
    email: String(d.email ?? ""),
    name: (d.name as string) ?? null,
    // Deliberately NO fallback role — absence renders as least privilege.
    role: typeof d.role === "string" ? d.role : "",
    tenantId: String(d.tenantId ?? ""),
    capabilities: Array.isArray(d.capabilities)
      ? (d.capabilities as string[])
      : [],
  };
}

export interface Asset {
  id: string;
  name: string;
  equipment_type?: string | null;
  manufacturer?: string | null;
  model_number?: string | null;
  equipment_number?: string | null;
}

export async function listAssets(): Promise<Asset[]> {
  const r = await request("/api/assets/");
  if (r.status !== 200) return [];
  const d = r.data as { assets?: Asset[]; rows?: Asset[] } | Asset[] | null;
  if (Array.isArray(d)) return d;
  return d?.assets ?? d?.rows ?? [];
}

export async function getAssetByTag(tag: string): Promise<Asset | null> {
  const r = await request(`/api/assets/by-tag/${encodeURIComponent(tag)}/`);
  if (r.status !== 200) return null;
  const d = r.data as { asset?: Asset } | Asset | null;
  return (d as { asset?: Asset })?.asset ?? (d as Asset) ?? null;
}

export async function getAsset(id: string): Promise<Record<string, unknown> | null> {
  const r = await request(`/api/assets/${encodeURIComponent(id)}/`);
  return r.status === 200 ? (r.data as Record<string, unknown>) : null;
}

export interface Notebook {
  id: string;
  displayName: string;
}

export async function listNotebooks(): Promise<Notebook[]> {
  const r = await request("/api/equipment-notebooks/");
  if (r.status !== 200) return [];
  const d = r.data as { notebooks?: Notebook[] } | Notebook[] | null;
  if (Array.isArray(d)) return d;
  return d?.notebooks ?? [];
}

export interface ChatTurn {
  answer: string;
  citations: { citationId: string; sourceTitle: string; page?: number | null }[];
  status: string;
}

/** Notebook chat — SSE over POST. CapacitorHttp returns the complete body, so
 *  the skeleton parses the full frame stream at once (sources → content* →
 *  status → [DONE]). Incremental streaming is a Phase 3 concern.
 *  The route REQUIRES sourceDocIds (422 without them): send the notebook's
 *  enabled sources, exactly as the web client and tech-battery do. */
export async function askNotebook(
  notebookId: string,
  message: string,
): Promise<ChatTurn> {
  const nb = await request(
    `/api/equipment-notebooks/${encodeURIComponent(notebookId)}/`,
  );
  const sources =
    ((nb.data as { sources?: { docId: string; enabledByDefault?: boolean }[] } | null)
      ?.sources ?? []);
  const sourceDocIds = sources
    .filter((s) => s.enabledByDefault !== false)
    .map((s) => s.docId);
  const r = await request(
    `/api/equipment-notebooks/${encodeURIComponent(notebookId)}/chat/`,
    { method: "POST", json: { message, sourceDocIds } },
  );
  let answer = "";
  let citations: ChatTurn["citations"] = [];
  let status = r.status === 200 ? "" : `http ${r.status}`;
  for (const block of r.text.split("\n\n")) {
    const line = block.trim();
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (payload === "[DONE]") continue;
    try {
      const frame = JSON.parse(payload) as Record<string, unknown>;
      if (frame.kind === "content") answer += String(frame.content ?? "");
      else if (frame.kind === "sources")
        citations = (frame.citations as ChatTurn["citations"]) ?? [];
      else if (frame.kind === "status") status = String(frame.status ?? "");
    } catch {
      /* keep parsing subsequent frames */
    }
  }
  return { answer, citations, status };
}

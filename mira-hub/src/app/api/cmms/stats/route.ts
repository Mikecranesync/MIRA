import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";

export const dynamic = "force-dynamic";

// Simple in-memory token cache — one token per process lifecycle
let cachedToken: string | null = null;
let tokenExpiresAt = 0;

function atlasBase(): string {
  return (process.env.HUB_CMMS_API_URL ?? "https://cmms.factorylm.com").replace(/\/$/, "");
}

async function getToken(): Promise<{ token: string | null; reason?: string; detail?: string }> {
  const user = process.env.ATLAS_API_USER;
  const pass = process.env.ATLAS_API_PASSWORD;
  if (!user || !pass) {
    return { token: null, reason: "credentials_missing" };
  }

  if (cachedToken && Date.now() < tokenExpiresAt) {
    return { token: cachedToken };
  }

  try {
    const res = await fetch(`${atlasBase()}/auth/signin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Atlas (Spring Boot) requires `type` — matches the Python client pattern in mira-mcp/cmms/atlas.py
      body: JSON.stringify({ email: user, password: pass, type: "CLIENT" }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      let bodySnippet = "";
      try {
        bodySnippet = (await res.text()).slice(0, 200);
      } catch {
        /* ignore */
      }
      return { token: null, reason: `signin_${res.status}`, detail: bodySnippet };
    }
    const data = (await res.json()) as { token?: string; accessToken?: string };
    const token = data.token ?? data.accessToken ?? null;
    if (token) {
      cachedToken = token;
      tokenExpiresAt = Date.now() + 23 * 60 * 60 * 1000;
      return { token };
    }
    return { token: null, reason: "no_token_in_response" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { token: null, reason: `network_${message}` };
  }
}

const EMPTY_STATS = {
  workOrders: { open: 0, inprogress: 0, overdue: 0, completed: 0 },
  assets: { total: 0 },
  pms: { total: 0 },
};

async function atlasPost(path: string, payload: Record<string, unknown>, token: string): Promise<unknown> {
  const res = await fetch(`${atlasBase()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Atlas ${path} → ${res.status}`);
  return res.json();
}

function countFromResponse(data: unknown): number {
  if (Array.isArray(data)) return data.length;
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    if (typeof d.totalElements === "number") return d.totalElements;
    if (Array.isArray(d.content)) return (d.content as unknown[]).length;
  }
  return 0;
}

export async function GET() {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  const { token, reason, detail } = await getToken();
  if (!token) {
    console.warn("[api/cmms/stats] auth unavailable", { reason, detail, base: atlasBase() });
    // Graceful degrade: return 200 with empty stats and a `cmmsAvailable: false` flag so
    // the /cmms page renders without console errors. Real numbers flow through once Atlas
    // creds are valid. (CRA-37 acceptance: 200 with `{ workOrders, assets, pms }` shape.)
    return NextResponse.json({
      ...EMPTY_STATS,
      cmmsAvailable: false,
      reason: reason ?? "unknown",
      fetchedAt: new Date().toISOString(),
    });
  }

  // Atlas (Grash) advanced search needs BOTH `values: [array]` and an empty
  // `value: ""` — that's the exact shape the cmms-frontend uses. Sending
  // only one of them returns 0 rows (filter applies but matches nothing) or
  // returns the unfiltered total. enumName must be UPPERCASE per the
  // backend's EnumName enum (STATUS / PRIORITY / JS_DATE).
  // Verified live against cmms-backend 2026-05-06.
  const woFilter = (status: string) => ({
    pageSize: 1,
    pageNum: 0,
    filterFields: [
      { field: "status", operation: "in", values: [status], value: "", enumName: "STATUS" },
    ],
  });

  try {
    const [openData, inProgressData, completeData, assetsData, pmsData] = await Promise.all([
      atlasPost("/work-orders/search", woFilter("OPEN"), token),
      atlasPost("/work-orders/search", woFilter("IN_PROGRESS"), token),
      atlasPost("/work-orders/search", woFilter("COMPLETE"), token),
      atlasPost("/assets/search", { pageSize: 1, pageNum: 0 }, token),
      atlasPost("/preventive-maintenances/search", { pageSize: 1, pageNum: 0 }, token),
    ]);

    return NextResponse.json({
      workOrders: {
        open: countFromResponse(openData),
        inprogress: countFromResponse(inProgressData),
        overdue: 0,
        completed: countFromResponse(completeData),
      },
      assets: {
        total: countFromResponse(assetsData),
      },
      pms: {
        total: countFromResponse(pmsData),
      },
      cmmsAvailable: true,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    // Token may have expired — invalidate cache and let next request re-auth
    cachedToken = null;
    tokenExpiresAt = 0;
    const message = err instanceof Error ? err.message : String(err);
    console.error("[api/cmms/stats] fetch failed", { error: message, base: atlasBase() });
    // Graceful degrade rather than 502 — page already falls back on a non-200, but
    // 200 keeps the browser console clean (CRA-37).
    return NextResponse.json({
      ...EMPTY_STATS,
      cmmsAvailable: false,
      reason: `fetch_failed: ${message}`,
      fetchedAt: new Date().toISOString(),
    });
  }
}

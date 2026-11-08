import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { atlasAccountKey, runInAtlasAccountLane } from "@/lib/atlas/client";

export const dynamic = "force-dynamic";

// Simple in-memory token cache — one token per process lifecycle
let cachedToken: string | null = null;
let tokenExpiresAt = 0;

function atlasBase(): string {
  return (process.env.HUB_CMMS_API_URL ?? "https://cmms.factorylm.com").replace(/\/$/, "");
}

async function getToken(): Promise<{ token: string | null; reason?: string }> {
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
      body: JSON.stringify({ email: user, password: pass, type: "CLIENT" }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      return { token: null, reason: `signin_${res.status}` };
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

// One request at a time per Atlas account: Atlas v1.8.0 fails concurrent
// searches for the same user (#5205; see runInAtlasAccountLane).
function atlasPost(path: string, payload: Record<string, unknown>, token: string): Promise<unknown> {
  return runInAtlasAccountLane(atlasAccountKey(atlasBase(), process.env.ATLAS_API_USER ?? ""), async () => {
    const res = await fetch(`${atlasBase()}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Atlas ${path} → ${res.status}`);
    return res.json();
  });
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

  const { token, reason } = await getToken();
  if (!token) {
    console.warn("[api/cmms/stats] auth unavailable", { reason, base: atlasBase() });
    return NextResponse.json(
      { error: "cmms_unavailable", reason: reason ?? "unknown" },
      { status: 503 },
    );
  }

  try {
    // Sequential, stopping at the first failure, so a failed batch leaves
    // nothing queued behind it on the account lane.
    const openData = await atlasPost("/work-orders/search", { pageSize: 1, pageNum: 0, status: "OPEN" }, token);
    const inProgressData = await atlasPost(
      "/work-orders/search",
      { pageSize: 1, pageNum: 0, status: "IN_PROGRESS" },
      token,
    );
    const completeData = await atlasPost("/work-orders/search", { pageSize: 1, pageNum: 0, status: "COMPLETE" }, token);
    const assetsData = await atlasPost("/assets/search", { pageSize: 1, pageNum: 0 }, token);
    const pmsData = await atlasPost("/preventive-maintenances/search", { pageSize: 1, pageNum: 0 }, token);

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
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    // Token may have expired — invalidate cache and let next request re-auth
    cachedToken = null;
    tokenExpiresAt = 0;
    console.error("[api/cmms/stats]", err);
    return NextResponse.json({ error: "CMMS fetch failed" }, { status: 502 });
  }
}

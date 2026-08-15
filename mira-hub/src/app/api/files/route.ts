/**
 * GET /api/files — the tenant's canonical file list ("Files").
 *
 * Spec: Component Nameplate → Manual + Centralized Multi-Asset Files (Part 1).
 * All relationship/file SQL lives in @/lib/workspace-files — this route only
 * validates input, delegates, and maps status codes.
 *
 * Query params:
 *   q          filename search (ILIKE, substring)
 *   capability indexable | viewable | stored
 *   unfiled    "true" → only files with zero relationships
 *   limit      1..200 (service clamps; default 50)
 *   offset     >= 0
 */
import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { listFiles, type FileCapability } from "@/lib/workspace-files";

export const dynamic = "force-dynamic";

const CAPABILITIES: FileCapability[] = ["indexable", "viewable", "stored"];

function intParam(raw: string | null): number | undefined {
  if (raw === null || raw.trim() === "") return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return undefined;
  return n;
}

export async function GET(req: Request) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  const url = new URL(req.url);
  const q = url.searchParams.get("q");
  const capabilityRaw = url.searchParams.get("capability");
  if (capabilityRaw && !CAPABILITIES.includes(capabilityRaw as FileCapability)) {
    return NextResponse.json({ error: "invalid_capability" }, { status: 422 });
  }

  try {
    const files = await listFiles(ctx.tenantId, {
      q: q && q.trim() ? q.trim() : null,
      capability: (capabilityRaw as FileCapability | null) ?? null,
      unfiled: url.searchParams.get("unfiled") === "true",
      limit: intParam(url.searchParams.get("limit")),
      offset: intParam(url.searchParams.get("offset")),
    });
    return NextResponse.json({ files });
  } catch (err) {
    console.error("[api/files GET]", err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}

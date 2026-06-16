import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { enrichAsset, getEnrichmentReport } from "@/lib/agents/asset-intelligence";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  const { id } = await params;
  const report = await getEnrichmentReport(ctx.tenantId, id);
  if (!report) {
    return NextResponse.json({ error: "No enrichment report yet" }, { status: 404 });
  }
  return NextResponse.json(report);
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  const { id } = await params;
  try {
    const report = await enrichAsset(ctx.tenantId, id);
    return NextResponse.json(report);
  } catch (err) {
    console.error("[api/assets/[id]/enrich POST]", err);
    return NextResponse.json({ error: "Enrichment failed" }, { status: 500 });
  }
}

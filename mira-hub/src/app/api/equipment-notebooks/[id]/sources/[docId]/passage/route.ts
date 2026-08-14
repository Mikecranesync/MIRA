/**
 * GET /api/equipment-notebooks/[id]/sources/[docId]/passage?page=N
 *
 * The full cited passage for a citation chip (CIT-07 phase 2): the chunk
 * text(s) of one source page, so the mobile citation sheet can show the WHOLE
 * passage on demand instead of only the 240-char quote window. Read-only.
 *
 * Access: session + the source must be attached to THIS tenant's notebook
 * (same IDOR posture as the sources routes — cross-tenant ids 404 without
 * leaking existence). knowledge_entries is the HYBRID corpus, so the read
 * runs on the raw pool with the `(is_private = false OR tenant_id = $caller)`
 * law — NEVER through withTenantContext (RLS would hide shared OEM rows).
 * See .claude/rules/knowledge-entries-tenant-scoping.md.
 */

import { NextRequest, NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import pool from "@/lib/db";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; docId: string }> },
) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  const { id, docId } = await params;
  if (!UUID_RE.test(id) || !UUID_RE.test(docId)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  const pageRaw = req.nextUrl.searchParams.get("page");
  let page: number | null = null;
  if (pageRaw !== null && pageRaw !== "") {
    page = Number(pageRaw);
    if (!Number.isInteger(page) || page < 0) {
      return NextResponse.json({ error: "invalid_page" }, { status: 400 });
    }
  }

  try {
    // IDOR guard: the doc must be attached to this notebook in this tenant.
    const attached = await pool.query(
      `SELECT 1 FROM equipment_notebook_sources
        WHERE notebook_id = $1::uuid AND doc_id = $2::uuid AND tenant_id = $3::uuid
        LIMIT 1`,
      [id, docId, ctx.tenantId],
    );
    if (attached.rows.length === 0) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    const rows = await pool.query(
      `SELECT content, source_page,
              (metadata->>'chunk_index')::int AS chunk_index
         FROM knowledge_entries
        WHERE doc_id = $1::uuid
          AND (is_private = false OR tenant_id = $2::uuid)
          AND ($3::int IS NULL OR source_page = $3::int)
        ORDER BY source_page ASC NULLS LAST, chunk_index ASC NULLS LAST
        LIMIT 20`,
      [docId, ctx.tenantId, page],
    );

    return NextResponse.json({
      page,
      passages: rows.rows.map((r: Record<string, unknown>) => ({
        page: r.source_page != null ? Number(r.source_page) : null,
        text: String(r.content ?? ""),
      })),
    });
  } catch (err) {
    console.error("[api/equipment-notebooks passage]", err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}

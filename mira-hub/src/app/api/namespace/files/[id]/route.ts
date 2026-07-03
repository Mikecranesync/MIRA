import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

interface FileContentRow {
  id: string;
  filename: string;
  mime_type: string;
  content: Buffer;
}

// Raster images render inline (thumbnails + click-to-view in the filing
// cabinet). Deliberately a safelist, NOT `image/*`: SVG is scriptable and must
// stay a download.
const INLINE_MIME_SAFELIST = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

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
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  try {
    const row = await withTenantContext(ctx.tenantId, async (c) => {
      const res = await c.query<FileContentRow>(
        `SELECT id, filename, mime_type, content
         FROM namespace_direct_uploads
         WHERE id = $1 AND tenant_id = $2`,
        [id, ctx.tenantId],
      );
      return res.rows[0] ?? null;
    });

    if (!row) {
      return NextResponse.json({ error: "file not found" }, { status: 404 });
    }

    const safeFilename = encodeURIComponent(row.filename).replace(/%20/g, " ");
    const disposition = INLINE_MIME_SAFELIST.has(row.mime_type) ? "inline" : "attachment";
    return new Response(new Uint8Array(row.content), {
      status: 200,
      headers: {
        "Content-Type": row.mime_type,
        "Content-Disposition": `${disposition}; filename="${safeFilename}"`,
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    console.error("[api/namespace/files/:id GET]", err);
    return NextResponse.json({ error: "Download failed" }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  const { id } = await params;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  try {
    const outcome = await withTenantContext(ctx.tenantId, async (c) => {
      // Verified documents are retained forever — refuse before touching the
      // row. (Migration 059's BEFORE DELETE trigger is the DB-layer backstop.)
      const check = await c.query<{ verified: boolean }>(
        `SELECT verified FROM namespace_direct_uploads
         WHERE id = $1 AND tenant_id = $2`,
        [id, ctx.tenantId],
      );
      if (check.rows.length === 0) return "not_found" as const;
      if (check.rows[0].verified) return "verified" as const;

      const res = await c.query(
        `DELETE FROM namespace_direct_uploads
         WHERE id = $1 AND tenant_id = $2 AND verified = false`,
        [id, ctx.tenantId],
      );
      return (res.rowCount ?? 0) > 0 ? ("deleted" as const) : ("not_found" as const);
    });

    if (outcome === "not_found") {
      return NextResponse.json({ error: "file not found" }, { status: 404 });
    }
    if (outcome === "verified") {
      return NextResponse.json(
        { error: "verified_retention", message: "This document is verified and retained forever. Un-verify it first." },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/namespace/files/:id DELETE]", err);
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }
}

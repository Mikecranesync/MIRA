// mira-hub/src/app/api/visual/evidence/[id]/view/route.ts
//
// Visual Focus Workspace (PR V2) — serve one evidence item's original bytes.
//
// Two ways in, both tenant-bound:
//   1. Hub session cookie (same-origin <img src> — the Hub page path).
//   2. ?token= short-lived signed token (src/lib/visual/signed-url.ts) for
//      cookie-less surfaces; PRD §15 "signed URLs are short-lived and
//      tenant-bound". A bad token is a 404, never a distinguishable error.
//
// Delivery discipline mirrors api/namespace/files/[id]: inline only for the
// raster safelist, nosniff, private cache.

import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";
import { verifyEvidenceToken } from "@/lib/visual/signed-url";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const INLINE_MIME_SAFELIST = new Set(["image/png", "image/jpeg", "image/webp"]);

interface ContentRow {
  content: Buffer | null;
  content_mime: string | null;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  // Resolve the tenant: signed token first (self-contained), else session
  // cookie. Every failure downstream is a plain 404.
  const token = new URL(req.url).searchParams.get("token");
  let tenantId: string;
  if (token) {
    const verified = verifyEvidenceToken(token, id);
    if (!verified) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    tenantId = verified.tenantId;
  } else {
    const ctx = await sessionOr401();
    if (ctx instanceof NextResponse) return ctx;
    tenantId = ctx.tenantId;
  }

  try {
    const row = await withTenantContext(tenantId, async (c) => {
      const res = await c.query<ContentRow>(
        `SELECT content, content_mime
         FROM evidence_item
         WHERE evidence_id = $1 AND tenant_id = $2`,
        [id, tenantId],
      );
      return res.rows[0] ?? null;
    });

    if (!row || !row.content || !row.content_mime) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    const disposition = INLINE_MIME_SAFELIST.has(row.content_mime)
      ? "inline"
      : "attachment";
    return new Response(new Uint8Array(row.content), {
      status: 200,
      headers: {
        "Content-Type": row.content_mime,
        "Content-Disposition": disposition,
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    console.error("[api/visual/evidence/:id/view GET]", err);
    return NextResponse.json({ error: "download_failed" }, { status: 500 });
  }
}

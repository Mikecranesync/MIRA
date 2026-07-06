import { NextResponse } from "next/server";
import { sessionOrDemo } from "@/lib/demo-auth";
import { withTenantContext } from "@/lib/tenant-context";
import { normalizeManufacturer } from "@/lib/manufacturerNormalize";

export const dynamic = "force-dynamic";

interface DemoUploadPayload {
  filename: string;
  mime_type?: string;
  size_bytes?: number;
  source_url?: string;          // signed URL or public link
  asset_id?: string;
  asset_tag?: string;
  manufacturer?: string;
  model?: string;
  excerpt?: string;             // optional inline text (≤ 2000 chars for demo)
}

/**
 * POST /api/documents/upload
 *
 * Demo upload entry point for the tablet. Accepts a JSON payload with a
 * source_url (Google Drive / Dropbox / signed S3) or an inline excerpt, and
 * registers it in `knowledge_entries` as a single chunk so it surfaces
 * immediately in /api/documents and /api/assets/[id]/documents.
 *
 * This is NOT the full ingest pipeline — production uploads still go through
 * /api/uploads which kicks off OCR + chunk + embed + verify. For the May 21
 * demo we just need the tablet to drop a PDF link and see it show up in the
 * library card; deep ingest can happen later.
 *
 * Returns 201 with `{document_id, source_url, status:'registered'}`.
 */
export async function POST(req: Request) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOrDemo(req);
  if (ctx instanceof NextResponse) return ctx;

  let body: DemoUploadPayload;
  try {
    body = (await req.json()) as DemoUploadPayload;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!body.filename) {
    return NextResponse.json({ error: "filename_required" }, { status: 400 });
  }
  if (!body.source_url && !body.excerpt) {
    return NextResponse.json(
      { error: "source_url_or_excerpt_required" },
      { status: 400 },
    );
  }

  const excerpt = (body.excerpt ?? "").slice(0, 2000);
  const sourceUrl = body.source_url ?? `demo://upload/${encodeURIComponent(body.filename)}`;
  // Collapse OCR/extraction manufacturer variants to the canonical catalog name
  // before insert (issue #1596). Empty → null preserves the existing behavior.
  const manufacturer = normalizeManufacturer(body.manufacturer).canonical || null;

  try {
    const id = await withTenantContext<string>(ctx.tenantId, async (c) => {
      // is_private = true: this is a per-tenant upload, not shared OEM corpus.
      // The canonical read filter `(is_private = false OR tenant_id = $caller)`
      // relies on this so /api/documents never leaks it to another tenant.
      // See `.claude/rules/knowledge-entries-tenant-scoping.md` (#1833).
      // knowledge_entries.id is a UUID PRIMARY KEY with NO server default — every
      // other writer (node-knowledge-ingest.ts, seed-synthetic-users.ts) supplies
      // it explicitly. Omitting it here made every upload 500 with a NOT NULL
      // violation on id ("Insert failed"). Generate it in-SQL to match those writers.
      const result = await c.query(
        `INSERT INTO knowledge_entries
           (id, tenant_id, source_url, manufacturer, model_number, equipment_type, content, is_private)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, true)
         RETURNING id`,
        [
          ctx.tenantId,
          sourceUrl,
          manufacturer,
          body.model ?? null,
          null,
          excerpt || `[Demo placeholder — ${body.filename}]`,
        ],
      );
      return (result.rows[0]?.id as string) ?? "";
    });

    return NextResponse.json(
      {
        document_id: id,
        source_url: sourceUrl,
        status: "registered",
        note: "Demo registration only. Production ingest goes through /api/uploads.",
      },
      { status: 201 },
    );
  } catch (err) {
    console.error("[api/documents/upload POST]", err);
    return NextResponse.json({ error: "Insert failed" }, { status: 500 });
  }
}

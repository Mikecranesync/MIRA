/**
 * GET /api/assets/[id]/documents — the asset's documents, in two clearly
 * separated groups:
 *
 *   attached  — files EXPLICITLY linked to this asset (workspace_file_links,
 *               migration 075). Ground truth: a human filed them here.
 *               Indexed (citable) files come first.
 *   suggested — the legacy manufacturer/model inference over the shared
 *               knowledge corpus. Nobody attached these; they merely match the
 *               asset's make/model. Unchanged query, new key.
 *
 * A suggested row that is already an attached document is dropped, so the two
 * lists never double-count the same document. Asset chat scope is NOT widened
 * by this route — it is a read surface only.
 *
 * BREAKING (response shape): this used to return a bare array of the suggested
 * rows. It now returns { attached, suggested }.
 */
import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";
import { listFilesForTarget } from "@/lib/workspace-files";

export const dynamic = "force-dynamic";

interface AttachedDoc {
  fileId: string;
  linkId: string;
  filename: string;
  mimeType: string | null;
  sizeBytes: number;
  capability: string;
  indexed: boolean;
  verified: boolean;
  docId: string | null;
  role: string | null;
  displayLabel: string | null;
  isPrimary: boolean;
  attachedAt: string;
}

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

  try {
    // Fetch the asset first so we know its manufacturer/model.
    const asset = await withTenantContext(ctx.tenantId, (c) =>
      c.query(
        `SELECT manufacturer, model_number, equipment_type
         FROM cmms_equipment
         WHERE id = $1 AND tenant_id = $2
         LIMIT 1`,
        [id, ctx.tenantId],
      ).then((r) => r.rows[0] ?? null),
    );

    if (!asset) {
      return NextResponse.json({ error: "Asset not found" }, { status: 404 });
    }

    // Explicit attachments. A failure here must not take down the tab.
    let attached: AttachedDoc[] = [];
    try {
      const linked = await listFilesForTarget(ctx.tenantId, "cmms_asset", id);
      attached = linked
        .map((f) => ({
          fileId: f.id,
          linkId: f.link.id,
          filename: f.filename,
          mimeType: f.mimeType,
          sizeBytes: f.sizeBytes,
          capability: f.capability,
          indexed: f.indexed,
          verified: f.verified,
          docId: f.uploadId,
          role: f.link.role,
          displayLabel: f.link.displayLabel,
          isPrimary: f.link.isPrimary,
          attachedAt: f.link.createdAt,
        }))
        // Indexed (citable) attachments lead; the rest keep attach order.
        .sort((a, b) => Number(b.indexed) - Number(a.indexed));
    } catch (err) {
      console.warn("[api/assets/[id]/documents] attached list skipped", err);
    }

    const mfr = (asset.manufacturer as string | null) ?? "";
    const model = (asset.model_number as string | null) ?? "";
    if (!mfr) return NextResponse.json({ attached, suggested: [] });

    // Match knowledge_entries by manufacturer (always) + model_number when present.
    // Group by source_url so a single PDF surfaces as one row with its chunk count.
    const rows = await withTenantContext(ctx.tenantId, (c) =>
      c.query(
        `SELECT
           source_url,
           MIN(equipment_type) AS equipment_type,
           MIN(model_number)   AS model_number,
           COUNT(*)::int       AS chunk_count,
           MAX(created_at)     AS last_indexed,
           BOOL_OR(verified)   AS verified
         FROM knowledge_entries
         WHERE tenant_id = $1
           AND LOWER(manufacturer) = LOWER($2)
           AND ($3 = '' OR model_number ILIKE '%' || $3 || '%')
         GROUP BY source_url
         ORDER BY MAX(created_at) DESC NULLS LAST
         LIMIT 50`,
        [ctx.tenantId, mfr, model],
      ).then((r) => r.rows),
    );

    // Never list the same document twice: a v2 chunk's source_url carries its
    // doc id (node-doc/<docId>/<filename>), and the filename is the fallback.
    const attachedDocIds = new Set(attached.map((a) => a.docId).filter(Boolean) as string[]);
    const attachedNames = new Set(attached.map((a) => a.filename));

    const suggested = rows
      .map((r: Record<string, unknown>) => {
        const sourceUrl = (r.source_url as string) || "";
        return {
          sourceUrl: r.source_url,
          title: sourceUrl.split("/").pop()?.split("?")[0] ?? sourceUrl,
          modelNumber: r.model_number ?? null,
          equipmentType: r.equipment_type ?? null,
          chunkCount: r.chunk_count ?? 0,
          lastIndexed: r.last_indexed ?? null,
          verified: r.verified ?? false,
        };
      })
      .filter((doc) => {
        const url = (doc.sourceUrl as string) || "";
        if ([...attachedDocIds].some((docId) => url.includes(docId))) return false;
        return !attachedNames.has(doc.title as string);
      });

    return NextResponse.json({ attached, suggested });
  } catch (err) {
    console.error("[api/assets/[id]/documents GET]", err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}

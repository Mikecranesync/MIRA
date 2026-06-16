import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

/**
 * GET /api/library/documents?manufacturer=X&model=Y
 *
 * Returns the document list (one row per source_url) for the given
 * manufacturer + model. The Library page uses this on a deep link or
 * to lazy-load model details.
 *
 * Both `manufacturer` and `model` may be the literal string "Unknown
 * manufacturer" / "Unspecified model" — these correspond to NULL/empty
 * values in `knowledge_entries`. Handled below.
 */

const SENTINEL_MFR = "Unknown manufacturer";
const SENTINEL_MODEL = "Unspecified model";

export async function GET(req: Request) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  const url = new URL(req.url);
  const mfr = (url.searchParams.get("manufacturer") ?? "").trim();
  const model = (url.searchParams.get("model") ?? "").trim();

  if (!mfr) {
    return NextResponse.json(
      { error: "manufacturer query param is required" },
      { status: 400 },
    );
  }

  // Translate sentinel values into NULL/empty filters.
  const mfrPredicate =
    mfr === SENTINEL_MFR
      ? "(manufacturer IS NULL OR TRIM(manufacturer) = '')"
      : "TRIM(manufacturer) = $2";
  const modelPredicate = model
    ? model === SENTINEL_MODEL
      ? "AND (model_number IS NULL OR TRIM(model_number) = '')"
      : "AND TRIM(model_number) = $3"
    : "";

  const params: unknown[] = [ctx.tenantId];
  if (mfr !== SENTINEL_MFR) params.push(mfr);
  if (model && model !== SENTINEL_MODEL) params.push(model);

  try {
    const rows = await withTenantContext(ctx.tenantId, (c) =>
      c
        .query(
          `SELECT
              source_url,
              source_type,
              data_type,
              metadata->>'title'  AS title,
              MIN(equipment_entity_id::text) AS equipment_entity_id,
              MIN(created_at)     AS first_seen,
              MAX(created_at)     AS last_seen,
              COUNT(*)::text      AS chunk_count
            FROM knowledge_entries
            WHERE tenant_id = $1
              AND ${mfrPredicate}
              ${modelPredicate}
            GROUP BY source_url, source_type, data_type, metadata->>'title'
            ORDER BY chunk_count DESC NULLS LAST`,
          params,
        )
        .then((r) => r.rows),
    );

    const docs = rows.map((r: Record<string, unknown>, i: number) => ({
      // Stable id derived from the source_url (or a row-index fallback)
      // so the Library page can deep-link without a real document table.
      id: encodeDocumentId(String(r.source_url ?? `row-${i}`)),
      sourceUrl: (r.source_url as string | null) ?? null,
      title: (r.title as string | null) ?? deriveTitleFromUrl(r.source_url as string | null),
      sourceType: (r.source_type as string | null) ?? "unknown",
      docType: (r.data_type as string | null) ?? null,
      equipmentEntityId: (r.equipment_entity_id as string | null) ?? null,
      firstSeen: r.first_seen,
      lastSeen: r.last_seen,
      chunkCount: Number(r.chunk_count),
    }));

    return NextResponse.json({
      manufacturer: mfr,
      model: model || null,
      totalDocs: docs.length,
      totalChunks: docs.reduce((s, d) => s + d.chunkCount, 0),
      documents: docs,
    });
  } catch (err) {
    console.error("[api/library/documents]", err);
    return NextResponse.json({ error: "Document query failed" }, { status: 500 });
  }
}

function deriveTitleFromUrl(url: string | null): string {
  if (!url) return "Untitled document";
  const base = url.split("?")[0].split("#")[0].replace(/\/+$/, "");
  const last = base.split("/").pop() ?? base;
  return decodeURIComponent(last.replace(/\.(pdf|html?|md|txt)$/i, "")) || base;
}

function encodeDocumentId(sourceUrl: string): string {
  // URL-safe base64 of the source_url so the id can ride in a query param
  // without collision and round-trip back to the chunks endpoint.
  const b64 = Buffer.from(sourceUrl, "utf-8").toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

/**
 * GET /api/library/chunks?document_id=<urlsafe-b64>&limit=N&offset=M
 *
 * Returns chunks for a specific source document, plus the fault codes
 * extracted from those chunks (joined through kg_relationships).
 *
 * `document_id` is the URL-safe base64 of the source_url (encoded by
 * /api/library/documents). We decode and use it as the WHERE filter.
 *
 * Response shape:
 *   {
 *     document: {
 *       sourceUrl: "https://…",
 *       title: "PowerFlex 525 User Manual",
 *       totalChunks: 624,
 *     },
 *     chunks: [
 *       {
 *         id: "uuid",
 *         preview: "first 200 chars",
 *         page: 142,
 *         section: "Chapter 7 — Faults",
 *         sourceType: "manual",
 *         createdAt: "…",
 *       },
 *       …
 *     ],
 *     faultCodes: [
 *       { code: "F004", uns_path: "enterprise.knowledge_base.allen_bradley.powerflex_525.fault_codes.f004" },
 *       …
 *     ],
 *     pagination: { limit, offset, hasMore: true|false },
 *   }
 */

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export async function GET(req: Request) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  const url = new URL(req.url);
  const documentId = url.searchParams.get("document_id");
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number(url.searchParams.get("limit") ?? DEFAULT_LIMIT) || DEFAULT_LIMIT),
  );
  const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0) || 0);

  if (!documentId) {
    return NextResponse.json(
      { error: "document_id query param is required" },
      { status: 400 },
    );
  }

  let sourceUrl: string;
  try {
    sourceUrl = decodeDocumentId(documentId);
  } catch {
    return NextResponse.json({ error: "Invalid document_id" }, { status: 400 });
  }

  try {
    const data = await withTenantContext(ctx.tenantId, async (c) => {
      const { rows: meta } = await c.query(
        `SELECT
            metadata->>'title' AS title,
            COUNT(*)::text     AS total_chunks
          FROM knowledge_entries
          WHERE tenant_id = $1 AND source_url = $2
          GROUP BY metadata->>'title'
          ORDER BY total_chunks DESC NULLS LAST
          LIMIT 1`,
        [ctx.tenantId, sourceUrl],
      );
      const { rows: chunks } = await c.query(
        `SELECT
            id::text,
            LEFT(content, 220) AS preview,
            source_page,
            metadata->>'section' AS section,
            metadata->>'chunk_index' AS chunk_index,
            source_type,
            data_type,
            equipment_entity_id::text,
            created_at
          FROM knowledge_entries
          WHERE tenant_id = $1 AND source_url = $2
          ORDER BY source_page NULLS LAST, (metadata->>'chunk_index')::int NULLS LAST
          LIMIT $3 OFFSET $4`,
        [ctx.tenantId, sourceUrl, limit, offset],
      );
      // Fault codes attached to ANY chunk from this document, deduped.
      // We join through kg_relationships.source_chunk_id (every fault
      // edge cites the chunk that justified it — spec §3.2).
      const { rows: faults } = await c.query(
        `SELECT DISTINCT
            fc.id::text AS id,
            fc.name     AS name,
            fc.properties->>'code' AS code,
            fc.uns_path::text AS uns_path
          FROM kg_relationships r
          JOIN kg_entities      fc ON fc.id = r.target_entity
          JOIN knowledge_entries ke ON ke.id = r.source_chunk_id
          WHERE r.tenant_id = $1
            AND r.relation_type = 'has_fault'
            AND ke.tenant_id = $1
            AND ke.source_url = $2
          ORDER BY code NULLS LAST, name`,
        [ctx.tenantId, sourceUrl],
      );
      return { meta, chunks, faults };
    });

    const totalChunks = Number(data.meta[0]?.total_chunks ?? 0);
    const chunks = data.chunks.map((r: Record<string, unknown>) => ({
      id: String(r.id),
      preview: String(r.preview ?? ""),
      page: r.source_page == null ? null : Number(r.source_page),
      chunkIndex: r.chunk_index == null ? null : Number(r.chunk_index),
      section: (r.section as string | null) ?? null,
      sourceType: (r.source_type as string | null) ?? null,
      docType: (r.data_type as string | null) ?? null,
      equipmentEntityId: (r.equipment_entity_id as string | null) ?? null,
      createdAt: r.created_at,
    }));

    let faultCodes: Array<{ id: string; code: string; name: string; uns_path: string }> = [];
    try {
      faultCodes = data.faults.map((f: Record<string, unknown>) => ({
        id: String(f.id),
        code: String(f.code ?? ""),
        name: String(f.name ?? ""),
        uns_path: String(f.uns_path ?? ""),
      }));
    } catch {
      // KG tables may not exist on a fresh deploy before migrations 006/007.
      faultCodes = [];
    }

    return NextResponse.json({
      document: {
        sourceUrl,
        title: (data.meta[0]?.title as string | null) ?? deriveTitleFromUrl(sourceUrl),
        totalChunks,
      },
      chunks,
      faultCodes,
      pagination: {
        limit,
        offset,
        hasMore: offset + chunks.length < totalChunks,
      },
    });
  } catch (err) {
    console.error("[api/library/chunks]", err);
    return NextResponse.json({ error: "Chunk query failed" }, { status: 500 });
  }
}

function decodeDocumentId(id: string): string {
  const b64 = id.replace(/-/g, "+").replace(/_/g, "/");
  // Pad to a multiple of 4 chars.
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  return Buffer.from(padded, "base64").toString("utf-8");
}

function deriveTitleFromUrl(url: string): string {
  const base = url.split("?")[0].split("#")[0].replace(/\/+$/, "");
  const last = base.split("/").pop() ?? base;
  return decodeURIComponent(last.replace(/\.(pdf|html?|md|txt)$/i, "")) || base;
}

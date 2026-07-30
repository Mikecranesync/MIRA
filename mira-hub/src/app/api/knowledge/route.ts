import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import pool from "@/lib/db";
import { normalizeManufacturer } from "@/lib/manufacturerNormalize";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

// Returns the knowledge library rolled up by manufacturer.
// Queries knowledge_entries directly (bypasses RLS via neondb_owner). This is
// an AGGREGATE OEM SURFACE per .claude/rules/knowledge-entries-tenant-scoping.md:
// it shows only the shared OEM corpus (`is_private = false`) — per-tenant
// private uploads (`is_private = true`) must never be counted or listed here.
// Tenant_id filtering is deliberately avoided (#1761): the OEM corpus is owned
// by a single system tenant, so a ctx.tenantId filter returned 0 rows of 83K+
// ingested chunks. (History: the legacy ingest pipeline tagged rows with
// whatever MIRA_TENANT_ID was set in env, which does not match the per-user
// UUID tenantIds minted by the multi-tenant signup flow — migration 008.
// Per-tenant private docs now exist, hence the is_private filter.)
//
// LIVE — no server-side cache (force-dynamic + force-no-store + revalidate=0).
// Each request hits Neon directly so newly-ingested chunks from the Celery
// worker / kb_growth_cron appear immediately. Response also returns no-store
// headers so the browser/proxy never serves stale snapshots.
export async function GET() {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  try {
    const [{ rows: mfrRows }, { rows: globalRows }] = await Promise.all([
      pool.query(
        `SELECT
           CASE
             WHEN manufacturer IS NULL OR TRIM(manufacturer) = '' THEN 'Uncategorized'
             ELSE INITCAP(LOWER(TRIM(manufacturer)))
           END AS manufacturer,
           COUNT(*)::bigint AS chunk_count,
           COUNT(DISTINCT source_url)::bigint AS doc_count,
           MAX(created_at) AS last_indexed
         FROM knowledge_entries
         WHERE is_private = false
         GROUP BY 1
         ORDER BY manufacturer ASC`,
      ),
      pool.query(
        `SELECT
           COUNT(*)::bigint AS total_chunks,
           COUNT(DISTINCT source_url)::bigint AS total_docs,
           MAX(created_at) AS last_ingested
         FROM knowledge_entries
         WHERE is_private = false`,
      ),
    ]);

    type Mfr = { name: string; chunkCount: number; docCount: number; lastIndexed: unknown };

    // #2275: apply alias normalization and re-aggregate SQL groups that map to
    // the same canonical name (e.g. "Rockwell Automation" + "Rockwell" → one
    // row). The SQL already INITCAPs each raw variant; normalizeManufacturer
    // handles the rest.
    const canonicalMap = new Map<string, Mfr>();
    for (const r of mfrRows) {
      const rawName = r.manufacturer as string;
      const name =
        rawName === "Uncategorized"
          ? "Uncategorized"
          : normalizeManufacturer(rawName).canonical || rawName;
      const existing = canonicalMap.get(name);
      if (existing) {
        existing.chunkCount += Number(r.chunk_count);
        existing.docCount += Number(r.doc_count);
        const ri = r.last_indexed as string | null;
        if (ri && (!existing.lastIndexed || ri > (existing.lastIndexed as string))) {
          existing.lastIndexed = ri;
        }
      } else {
        canonicalMap.set(name, {
          name,
          chunkCount: Number(r.chunk_count),
          docCount: Number(r.doc_count),
          lastIndexed: r.last_indexed,
        });
      }
    }
    const manufacturers: Mfr[] = Array.from(canonicalMap.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );

    const g = globalRows[0] ?? { total_chunks: 0, total_docs: 0, last_ingested: null };

    return NextResponse.json(
      {
        manufacturers,
        stats: {
          totalChunks: Number(g.total_chunks),
          totalDocs: Number(g.total_docs),
          manufacturerCount: manufacturers.length,
          lastIngested: g.last_ingested,
          fetchedAt: new Date().toISOString(),
        },
      },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
          Pragma: "no-cache",
        },
      },
    );
  } catch (err) {
    console.error("[api/knowledge]", err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import pool from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/knowledge/search?q=<text>&limit=<n>
 *
 * Full-text search across the shared OEM corpus (`is_private = false`).
 * Per-tenant uploaded manuals (`is_private = true`) are excluded — they are
 * scoped to the owning tenant and must not appear in cross-tenant search results
 * (see knowledge-entries-tenant-scoping rule, #1833, migration 052).
 *
 * Uses Postgres BM25 (`content_tsv @@ plainto_tsquery`) with an ILIKE
 * fallback for short/noisy terms that don't tokenise well. Returns
 * distinct documents ranked by relevance so the Knowledge/Manuals UI
 * can surface real content when a manufacturer-name search returns nothing.
 */

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 30;

export interface KnowledgeSearchResult {
  sourceUrl: string;
  title: string;
  manufacturer: string;
  modelNumber: string | null;
  sourceType: string | null;
  snippet: string;
}

export async function GET(req: Request) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number(url.searchParams.get("limit") ?? DEFAULT_LIMIT) || DEFAULT_LIMIT),
  );

  if (!q) return NextResponse.json({ results: [], query: "" });

  try {
    // BM25 first — ranks by content relevance.
    const { rows: bm25 } = await pool.query<{
      source_url: string;
      title: string | null;
      manufacturer: string | null;
      model_number: string | null;
      source_type: string | null;
      snippet: string;
      rank: number;
    }>(
      `SELECT DISTINCT ON (source_url)
         source_url,
         metadata->>'title'                                       AS title,
         manufacturer,
         model_number,
         source_type,
         LEFT(content, 220)                                       AS snippet,
         ts_rank_cd(content_tsv, plainto_tsquery('english', $1)) AS rank
       FROM knowledge_entries
       WHERE content_tsv @@ plainto_tsquery('english', $1)
         AND is_private = false  -- shared OEM corpus only; never leak per-tenant uploads (#1833 / mig 052)
       ORDER BY source_url, rank DESC
       LIMIT $2`,
      [q, limit],
    );

    // If BM25 returned fewer hits than limit, augment with metadata-ILIKE matches
    // that the tokeniser missed (model numbers like "GS10", short codes).
    let combined = bm25;
    if (bm25.length < limit) {
      const seen = new Set(bm25.map((r) => r.source_url));
      const remaining = limit - bm25.length;
      const { rows: ilike } = await pool.query<{
        source_url: string;
        title: string | null;
        manufacturer: string | null;
        model_number: string | null;
        source_type: string | null;
        snippet: string;
        rank: number;
      }>(
        `SELECT DISTINCT ON (source_url)
           source_url,
           metadata->>'title'  AS title,
           manufacturer,
           model_number,
           source_type,
           LEFT(content, 220)  AS snippet,
           0.0                 AS rank
         FROM knowledge_entries
         WHERE is_private = false  -- shared OEM corpus only (#1833 / mig 052)
           AND (
             manufacturer ILIKE $1
             OR model_number ILIKE $1
             OR metadata->>'title' ILIKE $1
           )
         ORDER BY source_url
         LIMIT $2`,
        [`%${q}%`, remaining * 3],
      );
      const fresh = ilike.filter((r) => !seen.has(r.source_url)).slice(0, remaining);
      combined = [...bm25, ...fresh];
    }

    // Sort: BM25 hits (rank > 0) first, then metadata hits.
    combined.sort((a, b) => b.rank - a.rank);

    const results: KnowledgeSearchResult[] = combined.map((r) => ({
      sourceUrl: r.source_url,
      title: r.title ?? deriveTitleFromUrl(r.source_url),
      manufacturer: r.manufacturer
        ? r.manufacturer.charAt(0).toUpperCase() + r.manufacturer.slice(1)
        : "Uncategorized",
      modelNumber: r.model_number ?? null,
      sourceType: r.source_type ?? null,
      snippet: r.snippet ?? "",
    }));

    return NextResponse.json({ results, query: q });
  } catch (err) {
    console.error("[api/knowledge/search]", err);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}

function deriveTitleFromUrl(url: string): string {
  const base = url.split("?")[0].split("#")[0].replace(/\/+$/, "");
  const last = base.split("/").pop() ?? base;
  return decodeURIComponent(last.replace(/\.(pdf|html?|md|txt)$/i, "")) || base;
}

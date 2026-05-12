import type { PoolClient } from "pg";

/**
 * Manufacturer-scoped BM25 retrieval from `knowledge_entries`.
 *
 * Mirrors `mira-scan-monday/backend/vendor_rag.py` and
 * `mira-bots/shared/workers/rag_worker.py` so the Hub chat path is
 * grounded in the same 83K-chunk corpus as Telegram/scan paths.
 *
 * Retrieval uses Postgres BM25 (`content_tsv @@ plainto_tsquery`,
 * `ts_rank_cd`) — the GIN index is already populated by the crawler.
 * No embeddings, no pgvector, no extra service.
 *
 * Caller MUST run this inside `withTenantContext` so RLS scopes rows
 * to the current tenant.
 */

export interface ManualChunk {
  content: string;
  manufacturer: string;
  modelNumber: string;
  sourceUrl: string;
  sourcePage: number | null;
  title: string;
  rank: number;
}

export interface ManualSource {
  index: number;
  title: string;
  url: string | null;
  page: number | null;
}

const MAX_CONTENT_CHARS = 1200;

/**
 * Run BM25 retrieval. Tries a manufacturer-scoped query first; falls
 * back to a tenant-only query if zero hits or no manufacturer.
 */
export async function retrieveManualChunks(
  client: PoolClient,
  tenantId: string,
  query: string,
  opts: { manufacturer?: string | null; topK?: number } = {},
): Promise<ManualChunk[]> {
  const q = query.trim();
  if (!q) return [];
  const topK = opts.topK ?? 6;
  const mfr = (opts.manufacturer ?? "").trim();

  if (mfr) {
    const scoped = await runBm25Query(client, tenantId, q, topK, mfr);
    if (scoped.length > 0) return scoped;
  }
  return runBm25Query(client, tenantId, q, topK, null);
}

async function runBm25Query(
  client: PoolClient,
  tenantId: string,
  query: string,
  topK: number,
  manufacturer: string | null,
): Promise<ManualChunk[]> {
  const params: unknown[] = [tenantId, query];
  let mfrClause = "";
  if (manufacturer) {
    params.push(`%${manufacturer}%`);
    mfrClause = `AND manufacturer ILIKE $${params.length}`;
  }
  params.push(topK);
  const limitParam = `$${params.length}`;

  const { rows } = await client.query(
    `SELECT
        content,
        manufacturer,
        model_number,
        source_url,
        source_page,
        metadata->>'title' AS title,
        ts_rank_cd(content_tsv, plainto_tsquery('english', $2)) AS rank
      FROM knowledge_entries
      WHERE tenant_id = $1
        ${mfrClause}
        AND content_tsv @@ plainto_tsquery('english', $2)
      ORDER BY rank DESC
      LIMIT ${limitParam}`,
    params,
  );

  return rows.map((r: Record<string, unknown>) => ({
    content: String(r.content ?? ""),
    manufacturer: String(r.manufacturer ?? ""),
    modelNumber: String(r.model_number ?? ""),
    sourceUrl: String(r.source_url ?? ""),
    sourcePage: r.source_page == null ? null : Number(r.source_page),
    title: String(r.title ?? ""),
    rank: Number(r.rank ?? 0),
  }));
}

/**
 * Build the grounded context block for the system prompt. Chunks are
 * numbered so the model can cite with `[n]` markers.
 */
export function buildGroundedContext(chunks: ManualChunk[]): string {
  if (chunks.length === 0) return "";
  const blocks = chunks.map((c, i) => {
    const headBits = [c.manufacturer, c.modelNumber].filter(Boolean);
    const head = headBits.join(" ") || c.title || "OEM document";
    const page = c.sourcePage != null ? `, p.${c.sourcePage}` : "";
    const content = c.content.length > MAX_CONTENT_CHARS
      ? `${c.content.slice(0, MAX_CONTENT_CHARS)}…`
      : c.content;
    return `[${i + 1}] ${head}${page}\n${content}`;
  });
  return blocks.join("\n\n---\n\n");
}

/**
 * Append the retrieval block to an existing system prompt. Adds the
 * citation rule so the model uses `[n]` markers.
 */
export function appendManualContext(
  baseSystemPrompt: string,
  chunks: ManualChunk[],
): string {
  if (chunks.length === 0) {
    return `${baseSystemPrompt}

## Documentation
No OEM documentation matched this question. Tell the user plainly that you don't have manual coverage for it — do NOT guess at specifications, torque values, or safety procedures.`;
  }
  return `${baseSystemPrompt}

## Documentation (use ONLY this to answer)
Cite sources with [n] markers matching the numbered blocks below. If the documentation does not cover the question, say so plainly — never guess.

${buildGroundedContext(chunks)}`;
}

/**
 * Public source descriptors for the UI. Dedupes by (url, page).
 */
export function chunksToSources(chunks: ManualChunk[]): ManualSource[] {
  const seen = new Set<string>();
  const out: ManualSource[] = [];
  chunks.forEach((c, i) => {
    const key = `${c.sourceUrl}::${c.sourcePage ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    const titleBits = [c.manufacturer, c.modelNumber].filter(Boolean);
    const title = titleBits.join(" ") || c.title || c.sourceUrl || "OEM document";
    out.push({
      index: i + 1,
      title,
      url: c.sourceUrl || null,
      page: c.sourcePage,
    });
  });
  return out;
}

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

  // plainto_tsquery ANDs every term, so a conversational query ("what does oC
  // mean?") whose off-vocabulary words ("mean") aren't in the corpus matches
  // nothing. Try the precise AND first; fall back to an OR query (the sanitized
  // plainto lexemes rejoined with `|`) only when AND finds nothing — precision
  // when it works, recall for natural questions. Mirrors retrieveNodeChunks.
  const AND_TSQUERY = "plainto_tsquery('english', $2)";
  const OR_TSQUERY =
    "to_tsquery('english', replace(plainto_tsquery('english', $2)::text, ' & ', ' | '))";

  const run = async (tsquery: string) => {
    const res = await client.query(
      `SELECT
          content,
          manufacturer,
          model_number,
          source_url,
          source_page,
          metadata->>'title' AS title,
          ts_rank_cd(content_tsv, ${tsquery}) AS rank
        FROM knowledge_entries
        WHERE tenant_id = $1
          ${mfrClause}
          AND content_tsv @@ ${tsquery}
        ORDER BY rank DESC
        LIMIT ${limitParam}`,
      params,
    );
    return res.rows;
  };

  let rows = await run(AND_TSQUERY);
  if (rows.length === 0) {
    rows = await run(OR_TSQUERY);
  }

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
 * Subtree-scoped BM25 retrieval for the Hub "folder = brain" node chat.
 *
 * The unit of knowledge is a namespace node (kg_entities). Asking at a node
 * grounds the answer in documents attached to that node AND every node beneath
 * it in the UNS tree. The chunk → node address is read from
 * `knowledge_entries.metadata->>'node_id'` (stamped atomically at ingest in
 * lib/node-knowledge-ingest.ts) rather than the `doc_id → hub_uploads.kg_entity_id`
 * write-path chain: `hub_uploads` carries no RLS policy/grant, so under the
 * `factorylm_app` role of withTenantContext a join to it returns nothing (or
 * leaks) — the chunk-side copy is RLS-visible and equally reparent-safe
 * (node_id is the stable node id; uns_path on kg_entities recomputes on drag).
 *
 * Unlike retrieveManualChunks there is NO tenant-wide fallback: if the subtree
 * has no matching chunks we return [] ("no coverage for this node"), never the
 * whole-corpus widening that would cite unrelated docs and break the
 * "your docs on your node" grounding contract.
 *
 * Caller MUST run this inside `withTenantContext` so RLS scopes kg_entities and
 * knowledge_entries to the current tenant.
 */
export async function retrieveNodeChunks(
  client: PoolClient,
  tenantId: string,
  query: string,
  opts: { nodeId: string; unsPath: string | null; topK?: number },
): Promise<ManualChunk[]> {
  const q = query.trim();
  if (!q) return [];
  const topK = opts.topK ?? 6;

  // In-scope node ids = the node itself + every descendant (uns_path <@ nodePath,
  // which is ancestor-or-equal so it includes the node). `<@ NULL` matches nothing,
  // so a node with no uns_path falls back to just its own directly-attached docs.
  let nodeIds: string[];
  if (opts.unsPath) {
    const { rows } = await client.query(
      `SELECT id::text AS id
         FROM kg_entities
        WHERE tenant_id = $1
          AND uns_path <@ $2::ltree`,
      [tenantId, opts.unsPath],
    );
    nodeIds = rows.map((r: Record<string, unknown>) => String(r.id));
    if (!nodeIds.includes(opts.nodeId)) nodeIds.push(opts.nodeId);
  } else {
    nodeIds = [opts.nodeId];
  }
  if (nodeIds.length === 0) return [];

  // Two tsquery shapes, both derived from plainto_tsquery so the user's text is
  // sanitized (no to_tsquery injection):
  //   AND — `plainto_tsquery('english', $2)` ("gs10 & fault & oc & mean"): precise,
  //         but a single off-vocabulary word (e.g. the interrogative "mean" in
  //         "what does oC mean?") that no manual chunk contains zeroes the whole
  //         match. Natural questions hit this constantly.
  //   OR  — the same lexemes joined with `|` ("gs10 | fault | oc | mean"): recall,
  //         ranked by ts_rank_cd so the best chunk still sorts first.
  // Run AND first (precision); fall back to OR only when AND finds nothing — so a
  // precise query keeps its tight result, and a conversational one still grounds
  // instead of returning "no coverage" for a manual that IS attached.
  const AND_TSQUERY = "plainto_tsquery('english', $2)";
  const OR_TSQUERY =
    "to_tsquery('english', replace(plainto_tsquery('english', $2)::text, ' & ', ' | '))";

  const runRetrieval = async (tsquery: string) => {
    const res = await client.query(
      `SELECT
          content,
          source_url,
          source_page,
          page_start,
          section_path,
          metadata->>'filename' AS filename,
          ts_rank_cd(content_tsv, ${tsquery}) AS rank
        FROM knowledge_entries
        WHERE tenant_id = $1
          AND ingest_route = 'v2'
          AND (metadata->>'node_id') = ANY($3::text[])
          AND content_tsv @@ ${tsquery}
        ORDER BY rank DESC
        LIMIT $4`,
      [tenantId, q, nodeIds, topK],
    );
    return res.rows;
  };

  let rows = await runRetrieval(AND_TSQUERY);
  if (rows.length === 0) {
    rows = await runRetrieval(OR_TSQUERY);
  }

  return rows.map((r: Record<string, unknown>) => ({
    content: String(r.content ?? ""),
    // Node attachments have no manufacturer/model — the filename is the citable title.
    manufacturer: "",
    modelNumber: "",
    sourceUrl: String(r.source_url ?? ""),
    sourcePage:
      r.page_start != null
        ? Number(r.page_start)
        : r.source_page == null
          ? null
          : Number(r.source_page),
    title: String(r.filename ?? r.section_path ?? "Attached document"),
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

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

// #1766 — BM25 term bounding. Ports mira-bots/shared/neon_recall._recall_bm25's
// 32-term cap to the Hub retrieval path. The OR fallback below rewrites
// plainto's `&` lexemes to `|`; for a pathologically long query — the /ask
// kiosk's ~440-token MACHINE_CONTEXT prefix is the known offender — that is a
// ~438-term OR-fanout, and `to_tsquery` unioning hundreds of huge GIN posting
// lists took 31-45s (issue #1766; engine-side neon_recall already has the fix).
//
// Bounding is a NO-OP for normal-length queries: any query of <= BM25_MAX_TERMS
// raw tokens is passed through verbatim, so short technical tokens ("oC", "F4")
// and the AND→OR natural-question grounding are unchanged. Only a query that
// exceeds the cap is reduced to its <= BM25_MAX_TERMS most-selective tokens
// (deduped; pure-digit, <=2-char, and stopword tokens dropped — Postgres'
// 'english' config stems + drops its own stopwords downstream regardless).
const BM25_MAX_TERMS = 32;

// Local high-frequency stopwords. Mirrors neon_recall._COMMON_WORDS. The <=2-char
// rule already covers the short ones; the multi-char entries are the ones that
// matter once a query is long enough to bound.
const BM25_STOPWORDS = new Set<string>([
  "the", "and", "for", "with", "your", "its", "has", "was", "are", "can",
  "not", "but", "that", "this", "what", "from", "how", "why", "when", "does",
  "did", "any", "all", "also", "just", "like", "get", "got", "see", "saw",
  "too", "our", "now", "try", "fix", "out", "off", "had", "may", "will",
  "let", "run", "set", "use", "they", "them", "his", "her", "she",
]);

/**
 * Bound the text handed to `plainto_tsquery` so a runaway query can't blow up
 * the OR-fallback fanout. No-op for queries of <= BM25_MAX_TERMS raw tokens;
 * caps longer ones. Never returns empty: if every token of a long query is
 * filtered out, falls back to the deduped raw tokens (capped). Exported for
 * unit testing.
 */
export function boundBm25Query(query: string): string {
  const rawAll = query.match(/\w+/g) ?? [];
  if (rawAll.length <= BM25_MAX_TERMS) return query;

  const lowered = query.toLowerCase().match(/\w+/g) ?? [];
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const tok of lowered) {
    if (seen.has(tok)) continue;
    seen.add(tok);
    if (tok.length <= 2 || /^\d+$/.test(tok) || BM25_STOPWORDS.has(tok)) continue;
    tokens.push(tok);
    if (tokens.length >= BM25_MAX_TERMS) break;
  }
  if (tokens.length === 0) {
    return Array.from(new Set(lowered)).slice(0, BM25_MAX_TERMS).join(" ");
  }
  return tokens.join(" ");
}

// #1875 — fault-code token detector. A SINGLE letter followed by 2-4 digits:
// matches F004, F0004, E001, A002 (and parameter tokens like b005 — boosting a
// chunk that names them verbatim is still good retrieval). Deliberately does
// NOT match two-letter model prefixes (PF525, GS10) or bare model numbers
// (525) so the code pass never fires on a vendor/model token. Known limit:
// single-digit codes ("F4") are not matched — widening to \d{1,4} would start
// catching false positives, so terse codes rely on the normal BM25 path.
const FAULT_CODE_RE = /\b[A-Za-z]\d{2,4}\b/g;

/**
 * Extract fault-code tokens from a query, uppercased and de-duplicated.
 * Exported for unit testing. Empty array ⇒ the caller skips the code pass.
 */
export function extractFaultCodes(query: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of query.matchAll(FAULT_CODE_RE)) {
    const code = m[0].toUpperCase();
    if (!seen.has(code)) {
      seen.add(code);
      out.push(code);
    }
  }
  return out;
}

function dedupeChunks(chunks: ManualChunk[]): ManualChunk[] {
  const seen = new Set<string>();
  const out: ManualChunk[] = [];
  for (const c of chunks) {
    const key = `${c.sourceUrl}|${c.sourcePage}|${c.content}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

/**
 * Run BM25 retrieval. Tries a manufacturer-scoped query first; falls
 * back to a tenant-only query if zero hits or no manufacturer.
 *
 * #1875 fault-code prioritization: a verbose natural-language question
 * ("…PowerFlex 525 is showing fault F004, what does it mean?") dilutes the
 * BM25/OR ranking so the chunk that documents the code ranks below top-K and
 * the model honestly refuses ("the context blocks do not mention F004") even
 * though the chunk exists — proven live: the terse query "F004" retrieves and
 * answers it. Mirrors the engine's `recall_fault_code` *intent* (not its RRF /
 * structured-table apparatus): when the query names a fault code, run one extra
 * pass keyed on the code alone and merge those chunks AHEAD of the main result.
 * Additive only — never removes a main-pass chunk, never causes a refusal.
 */
export async function retrieveManualChunks(
  client: PoolClient,
  tenantId: string,
  query: string,
  opts: { manufacturer?: string | null; topK?: number; allowTenantFallback?: boolean } = {},
): Promise<ManualChunk[]> {
  const q = query.trim();
  if (!q) return [];
  const topK = opts.topK ?? 6;
  const mfr = (opts.manufacturer ?? "").trim();
  const allowTenantFallback = opts.allowTenantFallback ?? true;

  // Main pass (manufacturer-scoped first, optional tenant-only fallback).
  let main: ManualChunk[];
  if (mfr) {
    const scoped = await runBm25Query(client, tenantId, q, topK, mfr);
    main = scoped.length > 0 || !allowTenantFallback
      ? scoped
      : await runBm25Query(client, tenantId, q, topK, null);
  } else {
    main = await runBm25Query(client, tenantId, q, topK, null);
  }

  const codes = extractFaultCodes(q);
  if (codes.length === 0) return main;

  // Code pass: query on the code(s) alone (the terse form that reliably
  // surfaces the documenting chunk), manufacturer-scoped first then fallback.
  const codeQuery = codes.join(" ");
  let codeHits = mfr ? await runBm25Query(client, tenantId, codeQuery, topK, mfr) : [];
  if (codeHits.length === 0 && allowTenantFallback) {
    codeHits = await runBm25Query(client, tenantId, codeQuery, topK, null);
  }
  if (codeHits.length === 0) return main;

  return dedupeChunks([...codeHits, ...main]).slice(0, topK);
}

// #1875 — the exact cite-or-refuse sentence the quickstart system prompt tells
// the model to emit when context has no support. The route uses this to
// suppress phantom citation cards on a refusal (chunks render 1:1, so a refusal
// otherwise ships with 6 citations under "I don't have manuals" — the
// contradiction reported in PR #1875). Kept here so it is unit-testable.
export const QUICKSTART_REFUSAL_MARK =
  "I don't have manuals for that in the public knowledge base";

/** True when an answer is the quickstart cite-or-refuse refusal. */
export function isRefusalAnswer(answer: string | null | undefined): boolean {
  if (!answer) return false;
  return answer.toLowerCase().includes(QUICKSTART_REFUSAL_MARK.toLowerCase());
}

async function runBm25Query(
  client: PoolClient,
  tenantId: string,
  query: string,
  topK: number,
  manufacturer: string | null,
): Promise<ManualChunk[]> {
  const params: unknown[] = [tenantId, boundBm25Query(query)];
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
      [tenantId, boundBm25Query(q), nodeIds, topK],
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
 * Stable citation key for a chunk's source. Two chunks from the same document
 * page share one key (and therefore one citation number + one UI chip).
 */
function sourceKey(c: Pick<ManualChunk, "sourceUrl" | "sourcePage">): string {
  return `${c.sourceUrl}::${c.sourcePage ?? ""}`;
}

/**
 * Assign every unique source (url, page) a stable 1-based citation number in
 * first-appearance order. #1912: buildGroundedContext (the blocks the model
 * cites) and chunksToSources (the chips the UI renders) MUST share this numbering
 * — otherwise the model cites a per-chunk block number (e.g. two excerpts of the
 * same page → blocks [1] and [2]) while the deduped chip list only shows [1], and
 * the answer's `[2]` has no matching chip. Numbering by source key makes both
 * spaces identical: every inline `[n]` has a rendered `[n]` chip.
 */
function citationIndex(chunks: ManualChunk[]): Map<string, number> {
  const idx = new Map<string, number>();
  for (const c of chunks) {
    const key = sourceKey(c);
    if (!idx.has(key)) idx.set(key, idx.size + 1);
  }
  return idx;
}

/**
 * Build the grounded context block for the system prompt. Each chunk is labelled
 * with its SOURCE citation number (#1912): excerpts from the same document page
 * share one `[n]`, matching the single chip chunksToSources renders for them.
 */
export function buildGroundedContext(chunks: ManualChunk[]): string {
  if (chunks.length === 0) return "";
  const idx = citationIndex(chunks);
  const blocks = chunks.map((c) => {
    const n = idx.get(sourceKey(c))!;
    const headBits = [c.manufacturer, c.modelNumber].filter(Boolean);
    const head = headBits.join(" ") || c.title || "OEM document";
    const page = c.sourcePage != null ? `, p.${c.sourcePage}` : "";
    const content = c.content.length > MAX_CONTENT_CHARS
      ? `${c.content.slice(0, MAX_CONTENT_CHARS)}…`
      : c.content;
    return `[${n}] ${head}${page}\n${content}`;
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
 * Public source descriptors for the UI. Dedupes by (url, page) and numbers each
 * chip with the SAME citation index the model is shown (#1912) — so an inline
 * `[n]` in the answer always maps to a rendered `[n]` chip. Indices are
 * contiguous 1..M over the unique sources (previously `i + 1` used the pre-dedupe
 * position, which could emit a non-contiguous [3] for the 2nd unique chip).
 */
export function chunksToSources(chunks: ManualChunk[]): ManualSource[] {
  const idx = citationIndex(chunks);
  const seen = new Set<string>();
  const out: ManualSource[] = [];
  for (const c of chunks) {
    const key = sourceKey(c);
    if (seen.has(key)) continue;
    seen.add(key);
    const titleBits = [c.manufacturer, c.modelNumber].filter(Boolean);
    const title = titleBits.join(" ") || c.title || c.sourceUrl || "OEM document";
    out.push({
      index: idx.get(key)!,
      title,
      url: c.sourceUrl || null,
      page: c.sourcePage,
    });
  }
  return out;
}

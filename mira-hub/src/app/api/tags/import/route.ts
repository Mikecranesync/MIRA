import { NextRequest, NextResponse } from "next/server";
import type { PoolClient } from "pg";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";
import {
  parseTagCsv,
  buildTagSuggestions,
  type TagSuggestionInsert,
  MAX_IMPORT_BYTES,
} from "@/lib/tag-import";

export const dynamic = "force-dynamic";

/**
 * POST /api/tags/import
 *
 * Tag-import wizard endpoint — Phase D8 of the Ignition self-serve build.
 *
 * Accepts a multipart upload or a `text/csv` / `application/octet-stream`
 * body containing a PLC tag export CSV. Creates one `ai_suggestions` row of
 * type `tag_mapping` per valid tag row, all in `status='pending'` (the
 * ai_suggestions inbox value). The customer reviews and approves via the
 * existing Hub `/proposals` queue — this endpoint never creates tag_entities
 * or kg_* rows directly.
 *
 * Spec  : docs/specs/maintenance-namespace-builder-spec.md
 *         §"Tag classification" + §"/api/v1/ingestion/tag-import"
 * Arch  : docs/mira-ignition-secure-architecture.md §D8
 * Shape : docs/migrations/027_ai_suggestions.sql
 *
 * Request body options:
 *   - multipart/form-data  with a field named `file` containing the CSV
 *   - text/csv             body is the raw CSV text
 *   - application/octet-stream  body is the raw CSV bytes
 *
 * Optional query params:
 *   site_path  — tenant's compact UNS site root (e.g. "enterprise.orlando_plant")
 *                used for heuristic UNS inference; omit when unknown.
 *
 * Response 201:
 *   { imported: number, suggestion_ids: string[], skipped: SkippedRow[] }
 *
 * Error responses follow the existing Hub error envelope:
 *   { error: string }  with appropriate status code.
 *
 * Hard limits (enforced before any DB work):
 *   - MAX_IMPORT_BYTES (5 MB) — request body size
 *   - MAX_IMPORT_ROWS  (5000) — rows after header
 *
 * Security:
 *   - tenant_id is taken from the authenticated session cookie, never from
 *     the request body. RLS also enforces tenant isolation via SET LOCAL ROLE.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }

  // --- auth ---
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  // --- optional site_path query param ---
  const url = new URL(req.url);
  const rawSitePath = url.searchParams.get("site_path")?.trim() ?? null;
  // Validate against the compact UNS path grammar (same regex as uploads route)
  const UNS_PATH_RE = /^[a-z0-9_]+(\.[a-z0-9_]+)*$/;
  const sitePath =
    rawSitePath && UNS_PATH_RE.test(rawSitePath) ? rawSitePath : null;
  if (rawSitePath && !sitePath) {
    return NextResponse.json(
      { error: "invalid site_path format; must match ^[a-z0-9_]+(\\.[a-z0-9_]+)*$" },
      { status: 400 },
    );
  }

  // --- extract CSV text from request ---
  let csvText: string;
  try {
    csvText = await extractCsvText(req);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "bad_request";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  // --- parse CSV ---
  const { rows: validRows, skipped } = parseTagCsv(csvText);

  if (validRows.length === 0) {
    return NextResponse.json(
      { error: "no_valid_rows", skipped },
      { status: 422 },
    );
  }

  // --- build suggestion inserts ---
  const suggestions = buildTagSuggestions(validRows, ctx.tenantId, sitePath);

  // --- persist (single transaction, one multi-row INSERT) ---
  let suggestionIds: string[];
  try {
    suggestionIds = await withTenantContext(ctx.tenantId, async (client) => {
      const ids = await insertSuggestions(client, suggestions);
      return ids;
    });
  } catch (err) {
    console.error("[api/tags/import POST] DB insert failed", {
      tenantId: ctx.tenantId,
      rowCount: suggestions.length,
      error: err instanceof Error ? { message: err.message, stack: err.stack } : err,
    });
    return NextResponse.json({ error: "insert_failed" }, { status: 500 });
  }

  return NextResponse.json(
    {
      imported: suggestionIds.length,
      suggestion_ids: suggestionIds,
      skipped,
    },
    { status: 201 },
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Read the CSV body from a multipart, text/csv, or octet-stream request.
 * Throws with a descriptive message on invalid content.
 */
async function extractCsvText(req: NextRequest): Promise<string> {
  const contentType = req.headers.get("content-type") ?? "";

  // Guard: reject payloads that exceed the byte limit before buffering
  const contentLength = Number(req.headers.get("content-length") ?? "0");
  if (contentLength > MAX_IMPORT_BYTES) {
    throw new Error(
      `payload_too_large: max ${MAX_IMPORT_BYTES} bytes; got ${contentLength}`,
    );
  }

  let rawText: string;

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    if (!file || typeof file === "string") {
      throw new Error("multipart_missing_file_field");
    }
    // FormDataEntryValue is File in Node 18+ / Next.js edge
    if (file.size > MAX_IMPORT_BYTES) {
      throw new Error(
        `file_too_large: max ${MAX_IMPORT_BYTES} bytes; got ${file.size}`,
      );
    }
    rawText = await (file as File).text();
  } else if (
    contentType.includes("text/csv") ||
    contentType.includes("application/octet-stream") ||
    contentType.includes("text/plain") ||
    contentType === ""
  ) {
    // Stream to buffer with explicit size guard
    const reader = req.body?.getReader();
    if (!reader) throw new Error("empty_body");
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_IMPORT_BYTES) {
        throw new Error(
          `payload_too_large: max ${MAX_IMPORT_BYTES} bytes`,
        );
      }
      chunks.push(value);
    }
    rawText = new TextDecoder().decode(
      new Uint8Array(chunks.reduce<number[]>((a, c) => [...a, ...c], [])),
    );
  } else {
    throw new Error(
      `unsupported_content_type: ${contentType}; use multipart/form-data or text/csv`,
    );
  }

  if (!rawText.trim()) throw new Error("empty_csv");
  return rawText;
}

/**
 * Insert suggestion rows in a single parameterised multi-row INSERT.
 * Returns the generated UUIDs in the same order as the input array.
 *
 * Uses parameterized VALUES to avoid SQL injection; JSONB column is passed
 * as a JSON string cast to ::jsonb.
 */
async function insertSuggestions(
  client: PoolClient,
  suggestions: TagSuggestionInsert[],
): Promise<string[]> {
  if (suggestions.length === 0) return [];

  // Build: VALUES ($1,$2,...,$N), ($N+1,...) ...
  // Columns: tenant_id, suggestion_type, status, risk_level, proposed_by,
  //          confidence, title, body, extracted_data
  const COLS = 9;
  const valueClauses: string[] = [];
  const params: unknown[] = [];

  for (const s of suggestions) {
    const base = params.length;
    params.push(
      s.tenant_id,                        // $base+1
      s.suggestion_type,                  // $base+2
      s.status,                           // $base+3
      s.risk_level,                       // $base+4
      s.proposed_by,                      // $base+5
      s.confidence,                       // $base+6
      s.title,                            // $base+7
      s.body,                             // $base+8
      JSON.stringify(s.extracted_data),   // $base+9  → ::jsonb
    );
    const ph = Array.from(
      { length: COLS },
      (_, i) => `$${base + i + 1}`,
    );
    // Cast tenant_id to UUID, extracted_data to jsonb
    valueClauses.push(
      `(${ph[0]}::uuid, ${ph[1]}, ${ph[2]}, ${ph[3]}, ${ph[4]}, ${ph[5]}, ${ph[6]}, ${ph[7]}, ${ph[8]}::jsonb)`,
    );
  }

  const sql = `
    INSERT INTO ai_suggestions
      (tenant_id, suggestion_type, status, risk_level, proposed_by,
       confidence, title, body, extracted_data)
    VALUES ${valueClauses.join(",\n")}
    RETURNING id
  `;

  const result = await client.query(sql, params);
  return result.rows.map((r) => r.id);
}


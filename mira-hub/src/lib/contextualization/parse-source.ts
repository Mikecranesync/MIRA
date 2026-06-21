/**
 * Contextualization parse-and-store: the Node replacement for the dead Python
 * worker (`mira-hub/workers/ctx_parse_worker.py`).
 *
 * The old worker was spawned as `python ctx_parse_worker.py <sourceId>` from the
 * sources upload route. The Hub ships as a Node-alpine image with no Python, no
 * psycopg2, and no `mira_plc_parser` on it (build context is `./mira-hub`), so
 * the spawn emitted an async `'error'` and the source row stayed `pending`
 * forever on prod.
 *
 * This module keeps Python out of the Hub image and reuses the existing
 * forwarder pattern (`lib/plc-import.ts` → mira-ingest `/ingest/plc-parse`):
 *   1. POST the uploaded file to mira-ingest, which runs the stdlib-only parser
 *      and returns `{report}` (one proposed UNS path per tag).
 *   2. Map the report → `ctx_extractions` rows (port of the Python worker's
 *      tag-dictionary loop) and write them, flipping `ctx_sources` to `done`.
 *   3. On ANY non-200 (422 unsupported/binary, 413 too large, 503 parser not
 *      wired, 502/timeout unreachable) flip `ctx_sources` to `error` with a
 *      message — never leave it `pending`.
 *
 * Scope: this restores PLC-export (L5X / vendor tag CSV) parity. `/ingest/plc-parse`
 * decodes the upload as UTF-8 text, so a real PDF/binary manual returns 422 →
 * the source lands `error`. Document/manual *content* extraction is a separate
 * gap, not handled here (the old Python worker didn't handle it either).
 */

// Parser confidence bands → the NUMERIC(4,3) `ctx_extractions.confidence` column.
// Mirrors the Python worker's _CONFIDENCE_MAP exactly.
const CONFIDENCE_MAP: Record<string, number> = { high: 0.9, medium: 0.6, low: 0.3 };

// Parsing is fast + deterministic (stdlib-only); a generous-but-bounded ceiling.
// Matches lib/plc-import.ts.
const PARSE_TIMEOUT_MS = 30_000;

interface TagDictEntry {
  name?: string;
  roles?: string[];
  used_in?: string[];
  confidence?: string;
}

interface UnsCandidate {
  tag?: string;
  path?: string;
  confidence?: string;
  evidence?: string;
}

export interface ParseReport {
  detection?: { fmt?: string };
  tag_dictionary?: TagDictEntry[];
  uns_candidates?: UnsCandidate[];
}

export interface ExtractionRow {
  id: string;
  tenantId: string;
  projectId: string;
  sourceId: string;
  tagName: string;
  roles: string[];
  unsPath: string | null;
  i3xElementId: string | null;
  evidence: Record<string, unknown>;
  confidence: number;
}

export type ParseOutcome =
  | { ok: true; report: ParseReport }
  | { ok: false; error: string };

interface ExtractionIds {
  tenantId: string;
  projectId: string;
  sourceId: string;
}

/** Resolve the mira-ingest base URL, or throw a legible error (mirrors lib/plc-import.ts). */
function ingestBase(): string {
  const base = process.env.INGEST_URL;
  if (!base) throw new Error("INGEST_URL not set");
  if (base.startsWith("disabled://")) {
    throw new Error(
      "PLC parsing is disabled in this environment (no ingest service). Use production instead.",
    );
  }
  return base;
}

/**
 * Map a parser report into `ctx_extractions` rows — one per tag in the tag
 * dictionary. Direct port of `ctx_parse_worker.py` `_run` (the tag loop): the
 * UNS path/confidence/evidence come from the matching uns_candidate when present,
 * falling back to the tag's own confidence. `i3x_element_id` is the UNS path (the
 * unique signal leaf within the project), or null when the tag has no proposal.
 */
export function reportToExtractions(report: ParseReport, ids: ExtractionIds): ExtractionRow[] {
  const unsByTag = new Map<string, UnsCandidate>();
  for (const u of report.uns_candidates ?? []) {
    if (u.tag) unsByTag.set(u.tag, u);
  }

  const fmt = report.detection?.fmt ?? null;
  const rows: ExtractionRow[] = [];

  for (const tag of report.tag_dictionary ?? []) {
    const tagName = tag.name ?? "";
    if (!tagName) continue;

    const uns = unsByTag.get(tagName) ?? {};
    const unsPath = uns.path ?? null;
    const confidenceStr = uns.confidence ?? tag.confidence ?? "low";
    const confidence = CONFIDENCE_MAP[confidenceStr] ?? 0.3;

    rows.push({
      id: crypto.randomUUID(),
      tenantId: ids.tenantId,
      projectId: ids.projectId,
      sourceId: ids.sourceId,
      tagName,
      roles: tag.roles ?? [],
      unsPath,
      i3xElementId: unsPath,
      evidence: {
        source_format: fmt,
        used_in: (tag.used_in ?? []).slice(0, 6),
        confidence_source: confidenceStr,
        uns_evidence: uns.evidence ?? null,
      },
      confidence,
    });
  }

  return rows;
}

/** Best-effort human-readable error from a mira-ingest non-200 body. */
function ingestError(status: number, body: unknown): string {
  const detail = (body as { detail?: unknown; error?: unknown })?.detail;
  const err = (body as { error?: unknown })?.error;
  const msg = typeof detail === "string" ? detail : typeof err === "string" ? err : "";
  return msg ? `parse failed (${status}): ${msg}` : `parse failed (HTTP ${status})`;
}

/**
 * Forward an uploaded PLC export to mira-ingest `/ingest/plc-parse` and return the
 * report, or a legible error. No DB access — the caller writes ctx_* under tenant
 * context. `include_i3x=false`: we derive `i3x_element_id` from the report's UNS
 * path, so the heavier i3X payload isn't needed.
 */
export async function parsePlcViaIngest(fileName: string, bytes: Uint8Array): Promise<ParseOutcome> {
  let base: string;
  try {
    base = ingestBase();
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }

  const out = new FormData();
  out.append("file", new Blob([bytes]), fileName);
  out.append("filename", fileName);
  out.append("include_i3x", "false");

  let res: Response;
  try {
    res = await fetch(`${base}/ingest/plc-parse`, {
      method: "POST",
      body: out,
      signal: AbortSignal.timeout(PARSE_TIMEOUT_MS),
    });
  } catch (err) {
    const msg =
      err instanceof Error && err.name === "TimeoutError"
        ? `timeout: mira-ingest plc-parse (${PARSE_TIMEOUT_MS}ms)`
        : `mira-ingest unreachable: ${err instanceof Error ? err.message : String(err)}`;
    return { ok: false, error: msg };
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, error: ingestError(res.status, body) };
  }

  const report = (body as { report?: ParseReport }).report;
  if (!report) {
    return { ok: false, error: "parse failed: empty report from mira-ingest" };
  }
  return { ok: true, report };
}

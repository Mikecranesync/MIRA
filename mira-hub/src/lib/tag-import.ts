/**
 * Tag-import wizard — pure logic helpers.
 *
 * These functions are dependency-free (no DB, no network) so they can be
 * tested without mocks. The route handler `src/app/api/tags/import/route.ts`
 * calls `buildTagSuggestions()` and inserts the returned rows.
 *
 * Spec  : docs/specs/maintenance-namespace-builder-spec.md §"Tag classification"
 *         docs/mira-ignition-secure-architecture.md §D8
 * Shape : docs/migrations/027_ai_suggestions.sql — tag_mapping rows use
 *         `status='pending'` (the ai_suggestions inbox value, NOT 'proposed'
 *         which is the tag_entities.approval_state vocabulary).
 * Paths : mira-hub/src/lib/uns.ts — compact UNS path builders (slugify, etc.)
 *         DO NOT hand-format enterprise.* paths.
 *
 * Rules enforced here:
 *   - No tag_entities rows created — those are created during /proposals approval.
 *   - No kg_entities / kg_relationships writes.
 *   - Confidence bands: explicit valid suggested_uns → 0.8 (high band), heuristic → 0.35 (low band).
 *   - proposed_by = 'import:ignition_csv' (the import:<format> vocabulary).
 */

import { slugify, equipmentPath } from "@/lib/uns";

// ---------------------------------------------------------------------------
// CSV parsing
// ---------------------------------------------------------------------------

/** Row cap enforced before any further processing. */
export const MAX_IMPORT_ROWS = 5_000;

/** Max accepted body bytes (~5 MB). Caller enforces before calling parseTagCsv. */
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

/**
 * Raw row straight out of the CSV; all fields optional (validator decides).
 * Non-empty string values only — empty strings collapse to undefined.
 */
export interface RawTagRow {
  tag_path?: string;
  description?: string;
  data_type?: string;
  units?: string;
  suggested_uns?: string;
  source_address?: string;
}

/** A successfully parsed and validated tag row ready for suggestion building. */
export interface ValidTagRow {
  tag_path: string;          // non-empty original PLC tag path
  description: string | null;
  data_type: string;         // normalised to IEC 61131 upper-case or 'STRING' fallback
  units: string | null;
  suggested_uns: string | null; // non-null only when present AND passes grammar check
  source_address: string | null;
}

/** Skipped-row record returned to the caller for the response body. */
export interface SkippedRow {
  row: number;               // 1-indexed (header = 0)
  reason: string;
  raw_tag_path?: string;
}

/** Result of the CSV parse step. */
export interface ParseResult {
  rows: ValidTagRow[];
  skipped: SkippedRow[];
}

// IEC 61131-3 types we accept, normalised to the CHECK constraint in migration 025.
const VALID_DATA_TYPES = new Set([
  "BOOL", "INT16", "INT32", "INT64",
  "UINT16", "UINT32", "UINT64",
  "REAL", "LREAL", "STRING", "BYTES",
]);

// Common Ignition / Rockwell aliases → canonical IEC type
const DATA_TYPE_ALIASES: Record<string, string> = {
  "BOOLEAN": "BOOL",
  "SHORT":   "INT16",
  "INT":     "INT32",
  "INTEGER": "INT32",
  "LONG":    "INT64",
  "USHORT":  "UINT16",
  "UINT":    "UINT32",
  "UINTEGER":"UINT32",
  "ULONG":   "UINT64",
  "FLOAT":   "REAL",
  "DOUBLE":  "LREAL",
  "STRING8": "STRING",
  "WSTRING": "STRING",
};

// UNS path grammar (compact form, lowercase, dot-separated alphanumeric/underscore segments)
const UNS_PATH_RE = /^[a-z0-9_]+(\.[a-z0-9_]+)*$/;

/**
 * Parse a CSV text string into validated tag rows.
 *
 * Accepts header row with (at minimum) `tag_path`. Optional columns:
 * description, data_type, units, suggested_uns, source_address.
 * Extra columns are silently ignored.
 * Rows that fail validation are pushed to `skipped`.
 * If the row count exceeds MAX_IMPORT_ROWS, parsing stops and remaining
 * rows are counted as skipped with reason 'row_cap_exceeded'.
 */
export function parseTagCsv(csvText: string): ParseResult {
  const lines = csvText.split(/\r?\n/);
  const rows: ValidTagRow[] = [];
  const skipped: SkippedRow[] = [];

  if (lines.length === 0) return { rows, skipped };

  // --- header ---
  const header = parseCsvLine(lines[0]);
  if (header.length === 0) {
    skipped.push({ row: 0, reason: "empty_header" });
    return { rows, skipped };
  }
  const colIndex: Record<string, number> = {};
  for (let i = 0; i < header.length; i++) {
    colIndex[header[i].trim().toLowerCase()] = i;
  }

  if (colIndex["tag_path"] === undefined) {
    skipped.push({ row: 0, reason: "missing_required_header:tag_path" });
    return { rows, skipped };
  }

  // --- data rows ---
  for (let lineNo = 1; lineNo < lines.length; lineNo++) {
    const line = lines[lineNo].trim();
    if (!line) continue;  // skip blank lines

    if (rows.length >= MAX_IMPORT_ROWS) {
      skipped.push({ row: lineNo, reason: "row_cap_exceeded" });
      continue;
    }

    const cells = parseCsvLine(lines[lineNo]);
    const get = (col: string): string | null => {
      const idx = colIndex[col];
      if (idx === undefined) return null;
      const v = cells[idx]?.trim() ?? "";
      return v.length > 0 ? v : null;
    };

    const rawTagPath = get("tag_path");
    if (!rawTagPath) {
      skipped.push({ row: lineNo, reason: "missing_tag_path" });
      continue;
    }
    if (rawTagPath.length > 512) {
      skipped.push({ row: lineNo, reason: "tag_path_too_long", raw_tag_path: rawTagPath.slice(0, 80) });
      continue;
    }

    // Normalise data_type; default to STRING if absent/unrecognised.
    const rawDataType = (get("data_type") ?? "").toUpperCase();
    const resolvedDataType =
      VALID_DATA_TYPES.has(rawDataType)
        ? rawDataType
        : DATA_TYPE_ALIASES[rawDataType] ?? "STRING";

    // Validate suggested_uns if present; reject if it fails the grammar.
    const rawSuggestedUns = get("suggested_uns");
    let suggestedUns: string | null = null;
    if (rawSuggestedUns) {
      if (UNS_PATH_RE.test(rawSuggestedUns)) {
        suggestedUns = rawSuggestedUns;
      } else {
        // Row is still imported — just ignore the bad path (don't skip the row)
        skipped.push({
          row: lineNo,
          reason: "invalid_suggested_uns_ignored",
          raw_tag_path: rawTagPath,
        });
      }
    }

    rows.push({
      tag_path: rawTagPath,
      description: get("description"),
      data_type: resolvedDataType,
      units: get("units"),
      suggested_uns: suggestedUns,
      source_address: get("source_address"),
    });
  }

  return { rows, skipped };
}

// ---------------------------------------------------------------------------
// UNS heuristic
// ---------------------------------------------------------------------------

/**
 * Extract a candidate UNS leaf path from an Ignition-style tag path.
 *
 * Ignition exports use dot-separated or slash-separated folder paths like:
 *   "Line5/B16/PE2_Occupied"
 *   "Line5.Conveyor_B16.Motor_Current"
 *
 * Strategy: split on `/` or `.`, slugify each token, drop empty tokens,
 * prefix with the tenant's compact site root if available, otherwise use
 * the tokens as a standalone relative path. Returns null if no usable
 * tokens remain after slugification.
 *
 * The result is intentionally low-confidence — human review in /proposals
 * confirms or corrects before a tag_entities row is created.
 *
 * @param tagPath   Raw PLC tag path (e.g. "Line5/B16/PE2_Occupied")
 * @param sitePath  Tenant's compact site root from UNS tree (e.g.
 *                  "enterprise.orlando_plant") — pass null when unknown.
 */
export function inferUnsPath(
  tagPath: string,
  sitePath: string | null,
): string | null {
  // Split on / or . — the two common separators in Ignition/Rockwell exports
  const tokens = tagPath.split(/[/.]/).map((t) => slugify(t)).filter(Boolean) as string[];
  if (tokens.length === 0) return null;
  const leaf = tokens.join(".");
  return sitePath ? equipmentPath(sitePath, leaf) : leaf;
}

// ---------------------------------------------------------------------------
// Suggestion row builder
// ---------------------------------------------------------------------------

/**
 * Shape of one ai_suggestions row for suggestion_type='tag_mapping'.
 *
 * extracted_data (JSONB) carries enough for the /proposals UI to render
 * the mapping and for the approve handler to create the tag_entities row:
 *   tag_path        — original PLC path (provenance anchor)
 *   data_type       — normalised IEC type
 *   description     — free-text from the CSV, may be null
 *   units           — engineering units, may be null
 *   source_address  — raw address from CSV (modbus register, OPC node, etc.), may be null
 *   candidate_uns_path — the proposed UNS path (explicit or heuristic)
 *   uns_path_source — 'explicit' | 'heuristic' — lets UI show confidence origin
 */
export interface TagSuggestionInsert {
  tenant_id: string;          // from session — never from request body
  suggestion_type: "tag_mapping";
  status: "pending";          // ai_suggestions inbox value (not 'proposed')
  risk_level: "low";
  proposed_by: "import:ignition_csv";
  confidence: number;         // 0.8 explicit, 0.35 heuristic, 0.1 no-path
  title: string;
  body: string;
  extracted_data: {
    tag_path: string;
    data_type: string;
    description: string | null;
    units: string | null;
    source_address: string | null;
    candidate_uns_path: string | null;
    uns_path_source: "explicit" | "heuristic" | "none";
  };
}

/**
 * Build the list of ai_suggestions insert objects from validated rows.
 *
 * @param rows       Validated rows from parseTagCsv()
 * @param tenantId   From the authenticated session — MUST NOT come from the request body
 * @param sitePath   Tenant site path from the UNS tree (may be null when unknown)
 */
export function buildTagSuggestions(
  rows: ValidTagRow[],
  tenantId: string,
  sitePath: string | null,
): TagSuggestionInsert[] {
  return rows.map((row) => {
    let candidateUnsPath: string | null;
    let unsPathSource: "explicit" | "heuristic" | "none";
    let confidence: number;

    if (row.suggested_uns) {
      // Caller already validated the grammar in parseTagCsv
      candidateUnsPath = row.suggested_uns;
      unsPathSource = "explicit";
      confidence = 0.8;
    } else {
      candidateUnsPath = inferUnsPath(row.tag_path, sitePath);
      if (candidateUnsPath) {
        unsPathSource = "heuristic";
        confidence = 0.35;
      } else {
        unsPathSource = "none";
        confidence = 0.1;
      }
    }

    const displayPath = candidateUnsPath ?? "(unmapped)";
    return {
      tenant_id: tenantId,
      suggestion_type: "tag_mapping",
      status: "pending",
      risk_level: "low",
      proposed_by: "import:ignition_csv",
      confidence,
      title: `Map tag ${row.tag_path} → ${displayPath}`,
      body: `Proposed mapping from CSV import. Tag path: ${row.tag_path}. Data type: ${row.data_type}. UNS path source: ${unsPathSource}.`,
      extracted_data: {
        tag_path: row.tag_path,
        data_type: row.data_type,
        description: row.description,
        units: row.units,
        source_address: row.source_address,
        candidate_uns_path: candidateUnsPath,
        uns_path_source: unsPathSource,
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Minimal RFC 4180-compliant CSV line parser (no external dependencies)
// ---------------------------------------------------------------------------

/**
 * Parse a single CSV line into its fields, handling double-quote quoting.
 *
 * This is sufficient for the PLC tag export format (no multi-line quoted
 * fields in practice). For files where a quoted field spans multiple lines,
 * the caller should pre-join lines before calling parseTagCsv().
 */
export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let pos = 0;
  // `expectField` is true at start and after every consumed comma.
  // When pos reaches end-of-line while expectField is true we push an
  // empty trailing field (RFC 4180: "a,b," → ["a","b",""]). When we
  // reach end-of-line while NOT expecting a field (just pushed a field
  // and did not see a trailing comma) we stop without adding an extra
  // empty entry.
  let expectField = true;

  while (pos <= line.length) {
    if (pos === line.length) {
      if (expectField) {
        // trailing comma OR truly empty line: one final empty field
        fields.push("");
      }
      break;
    }

    // Reset expectField — we are about to parse a field
    expectField = false;

    if (line[pos] === '"') {
      // Quoted field
      pos++; // skip opening quote
      let value = "";
      while (pos < line.length) {
        if (line[pos] === '"') {
          if (line[pos + 1] === '"') {
            value += '"';
            pos += 2;
          } else {
            pos++; // skip closing quote
            break;
          }
        } else {
          value += line[pos++];
        }
      }
      fields.push(value);
      // skip comma after closing quote (if any)
      if (line[pos] === ",") {
        pos++;
        expectField = true;
      }
    } else {
      // Unquoted field — scan to next comma
      const start = pos;
      while (pos < line.length && line[pos] !== ",") pos++;
      fields.push(line.slice(start, pos));
      if (pos < line.length) {
        pos++; // skip comma
        expectField = true;
      }
    }
  }
  return fields;
}

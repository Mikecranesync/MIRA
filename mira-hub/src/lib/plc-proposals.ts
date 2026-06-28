import { withTenantContext } from "@/lib/tenant-context";

/**
 * Map a mira-plc-parser report into `ai_suggestions` proposals (PR-C).
 *
 * The parser is read-only and deterministic; everything it emits is a *proposal* a human approves
 * in the Hub `/proposals` queue — never an auto-verified fact (see `.claude/CLAUDE.md` § "Knowledge
 * graph proposals"). New rows are plain INSERTs at `status='pending'`; the ADR-0017 transition
 * helpers govern later status *changes*, not creation.
 *
 * Two suggestion types are produced (mig 027 `ai_suggestions`):
 *   - `tag_mapping`  — one per parsed tag: "this PLC tag maps to this UNS path / signal role"
 *   - `kg_entity`    — one per distinct asset the tag names imply: a proposed equipment UNS node
 */

// Parser confidence bands → the FLOAT(0..1) `ai_suggestions.confidence` column. Calibrated to the
// Hub UI bands (low < 0.5, medium 0.5–0.8, high > 0.8).
const BAND_TO_CONFIDENCE: Record<string, number> = { high: 0.85, medium: 0.6, low: 0.35 };

// `proposed_by` follows the mig-027 `import:<format>` convention.
export const PLC_PROPOSED_BY = "import:plc_parser";

export interface PlcSuggestion {
  suggestionType: "tag_mapping" | "kg_entity";
  title: string;
  body: string;
  confidence: number;
  riskLevel: "low" | "medium" | "high" | "safety_critical";
  extractedData: Record<string, unknown>;
}

interface UnsCandidate {
  tag: string;
  path: string;
  signal?: string;
  asset?: string;
  data_type?: string;
  standardized?: boolean;
  confidence?: string;
  evidence?: string;
  segments?: Record<string, string>;
}

interface PlcReport {
  handled?: boolean;
  controller?: string;
  vendor?: string;
  uns_candidates?: UnsCandidate[];
}

function bandToConfidence(band: string | undefined): number {
  return BAND_TO_CONFIDENCE[(band ?? "").toLowerCase()] ?? 0.5;
}

/** Container UNS path for a candidate's asset (enterprise/site/area/line/asset), or "" if no asset. */
function assetPath(c: UnsCandidate): string {
  const s = c.segments ?? {};
  if (!s.asset) return "";
  return [s.enterprise, s.site, s.area, s.line, s.asset].filter(Boolean).join("/");
}

/**
 * Pure transform: parser report → proposal rows. Deterministic, side-effect-free, so it is fully
 * unit-testable without a database. Returns [] for an unparsed/empty report.
 */
export function plcReportToSuggestions(report: PlcReport): PlcSuggestion[] {
  if (!report?.handled) return [];
  const candidates = report.uns_candidates ?? [];
  const controller = report.controller ?? "";
  const vendor = report.vendor ?? "";
  const out: PlcSuggestion[] = [];

  // One tag_mapping per parsed tag.
  for (const c of candidates) {
    const typeLabel = c.data_type ? ` (${c.data_type})` : "";
    const std = c.standardized ? ` standardized ${c.signal} signal` : "";
    out.push({
      suggestionType: "tag_mapping",
      title: `Map tag ${c.tag} → ${c.path}`,
      body:
        `PLC tag "${c.tag}"${typeLabel} proposed at UNS ${c.path}${std ? `,${std}` : ""}. ` +
        `Evidence: ${c.evidence ?? "tag name"}.`,
      confidence: bandToConfidence(c.confidence),
      riskLevel: "low",
      extractedData: {
        tag: c.tag,
        uns_path: c.path,
        signal: c.signal ?? "",
        asset: c.asset ?? "",
        data_type: c.data_type ?? "",
        standardized: Boolean(c.standardized),
        confidence_band: c.confidence ?? "",
        evidence: c.evidence ?? "",
        controller,
        vendor,
        source: "plc_parser",
      },
    });
  }

  // One kg_entity per distinct asset the tags imply (deduped by container path).
  const seen = new Set<string>();
  for (const c of candidates) {
    const path = assetPath(c);
    if (!path || seen.has(path) || !c.asset) continue;
    seen.add(path);
    const tagCount = candidates.filter((x) => assetPath(x) === path).length;
    out.push({
      suggestionType: "kg_entity",
      title: `Propose asset ${c.asset} → ${path}`,
      body:
        `Equipment "${c.asset}" inferred from ${tagCount} PLC tag(s) on controller ` +
        `"${controller || "unknown"}". Proposed UNS node ${path}.`,
      confidence: 0.6,
      riskLevel: "low",
      extractedData: {
        entity_type: "equipment",
        name: c.asset,
        uns_path: path,
        tag_count: tagCount,
        controller,
        vendor,
        source: "plc_parser",
      },
    });
  }

  return out;
}

/**
 * Persist proposals into `ai_suggestions` for `tenantId`, at `status='pending'`. One atomic
 * multi-row INSERT under the tenant's RLS context (mig 027 policy). Returns the new row ids.
 */
export async function insertPlcSuggestions(
  tenantId: string,
  rows: PlcSuggestion[],
): Promise<string[]> {
  if (rows.length === 0) return [];
  const payload = rows.map((r) => ({
    suggestion_type: r.suggestionType,
    extracted_data: r.extractedData,
    confidence: r.confidence,
    risk_level: r.riskLevel,
    title: r.title,
    body: r.body,
  }));

  return withTenantContext(tenantId, async (c) => {
    const res = await c.query<{ id: string }>(
      `INSERT INTO ai_suggestions
         (tenant_id, suggestion_type, extracted_data, confidence, status, risk_level, proposed_by, title, body)
       SELECT $1::uuid, r.suggestion_type, r.extracted_data, r.confidence, 'pending', r.risk_level, $2, r.title, r.body
       FROM jsonb_to_recordset($3::jsonb) AS r(
         suggestion_type text, extracted_data jsonb, confidence float8, risk_level text, title text, body text
       )
       RETURNING id`,
      [tenantId, PLC_PROPOSED_BY, JSON.stringify(payload)],
    );
    return res.rows.map((row) => row.id);
  });
}

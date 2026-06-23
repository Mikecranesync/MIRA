import { withTenantContext } from "@/lib/tenant-context";

/**
 * Map a Phase 1 FactoryModel (the deterministic `factory_context` spine output) into existing
 * `ai_suggestions` proposals — the SAME approval queue the PLC parser feeds. This is a verbatim
 * structural sibling of `plc-proposals.ts`; the only addition is a per-row `status` so uncertain
 * mappings land `needs_review` (mig 057) instead of `pending`.
 *
 *   Asset  -> `kg_entity`   suggestion (entity_type='equipment'); accepted -> kg_entities (createKgEntity)
 *   Signal -> `tag_mapping` suggestion;                           accepted -> tag_entities (createTagEntity)
 *
 * Everything is a PROPOSAL a human approves in `/knowledge/suggestions` — never auto-verified
 * (.claude/CLAUDE.md § "Knowledge graph proposals"). New rows are plain INSERTs; this writer NEVER
 * UPDATEs a status — ADR-0017 transition helpers govern status CHANGES, not creation.
 *
 * PR-1 scope: assets + signals only. Relationships, fault codes, and alarms are deferred (no
 * ingestion writer exists for them yet). Container levels (enterprise/site/area/line/cell) are
 * implied by the UNS path and are not separate suggestions.
 */

// Spine confidence band -> the FLOAT(0..1) `ai_suggestions.confidence` column (Hub UI bands:
// low < 0.5, medium 0.5-0.8, high > 0.8). FactoryModel is deterministic, so most nodes are "high".
const BAND_TO_CONFIDENCE: Record<string, number> = {
  high: 0.85,
  medium: 0.6,
  low: 0.35,
  review: 0.3,
};

// Spine signal archetype -> a tag_entities-declarable type string (consumed by `mapTagDataType` in
// suggestion-accept.ts on accept). An unknown archetype yields "" -> the suggestion is still created
// for review, but won't materialize a tag_entity until a human classifies it.
const ARCHETYPE_TO_DATA_TYPE: Record<string, string> = {
  live_bool: "BOOL",
  live_counter: "DINT",
  live_state: "STRING",
  live_analog: "REAL",
};

// `proposed_by` follows the mig-027 `import:<format>` convention.
export const FACTORY_MODEL_PROPOSED_BY = "import:factory_model";

export interface FactoryModelSuggestion {
  suggestionType: "tag_mapping" | "kg_entity";
  title: string;
  body: string;
  confidence: number;
  status: "pending" | "needs_review";
  riskLevel: "low" | "medium" | "high" | "safety_critical";
  extractedData: Record<string, unknown>;
}

interface SpineEvidence {
  source_file?: string;
  source_format?: string;
  locator?: string;
  detail?: string;
}

interface SpineSuggestion {
  kind?: string;
  statement?: string;
  confidence?: string;
  approval_needed?: string;
  evidence?: SpineEvidence[];
  status?: string;
}

interface FactoryNode {
  uns_path?: string;
  name?: string;
  level?: string;
  archetype?: string;
  udt_type?: string;
  mes_path?: string;
  unit?: string;
  suggestion?: SpineSuggestion;
}

interface FactoryModel {
  source?: string;
  nodes?: FactoryNode[];
  // `relationships` intentionally ignored in PR-1.
}

function bandToConfidence(band: string | undefined): number {
  return BAND_TO_CONFIDENCE[(band ?? "").toLowerCase()] ?? 0.5;
}

// Never emit an approved/accepted row — the machine does not auto-approve. Only uncertain mappings
// (spine status 'needs_review', or an unclassifiable signal) sit in review; everything else pends.
function toQueueStatus(
  spineStatus: string | undefined,
  uncertain: boolean,
): "pending" | "needs_review" {
  if (uncertain || (spineStatus ?? "").toLowerCase() === "needs_review") return "needs_review";
  return "pending";
}

function evidenceSummary(ev: SpineEvidence[] | undefined): string {
  if (!ev || ev.length === 0) return "no evidence recorded";
  return ev
    .map((e) => `${e.source_format ?? "?"}:${e.locator ?? "?"}${e.detail ? ` (${e.detail})` : ""}`)
    .join("; ");
}

/**
 * Pure transform: FactoryModel -> proposal rows. Deterministic, side-effect-free, DB-free, so it is
 * fully unit-testable. Emits a kg_entity per asset and a tag_mapping per live signal (signals with no
 * UNS path — static UDT metadata — are skipped). Returns [] for an empty/invalid model.
 */
export function factoryModelToSuggestions(model: unknown): FactoryModelSuggestion[] {
  const m = (model ?? {}) as FactoryModel;
  const nodes = Array.isArray(m.nodes) ? m.nodes : [];
  const source = typeof m.source === "string" ? m.source : "factory_model";
  const out: FactoryModelSuggestion[] = [];

  for (const node of nodes) {
    const sug = node.suggestion ?? {};
    const ev = sug.evidence;

    if (node.level === "asset") {
      const unsPath = node.uns_path ?? "";
      const name = node.name ?? "";
      if (!unsPath || !name) continue;
      const status = toQueueStatus(sug.status, false);
      out.push({
        suggestionType: "kg_entity",
        title: `Propose asset ${name} → ${unsPath}`,
        body:
          `${sug.statement ?? `Equipment "${name}" at UNS ${unsPath}.`} ` +
          `${sug.approval_needed ? `Approval: ${sug.approval_needed} ` : ""}` +
          `Evidence: ${evidenceSummary(ev)}.`,
        confidence: bandToConfidence(sug.confidence),
        status,
        riskLevel: status === "needs_review" ? "medium" : "low",
        extractedData: {
          entity_type: "equipment",
          name,
          uns_path: unsPath,
          level: node.level,
          udt_type: node.udt_type ?? "",
          confidence_band: sug.confidence ?? "",
          evidence: ev ?? [],
          source,
        },
      });
    } else if (node.level === "signal") {
      const unsPath = node.uns_path ?? "";
      const tag = node.name ?? "";
      // Static UDT metadata signals carry no UNS path in the spine draft — they are not live signals.
      if (!unsPath || !tag) continue;
      const archetype = (node.archetype ?? "").toLowerCase();
      const dataType = ARCHETYPE_TO_DATA_TYPE[archetype] ?? "";
      const uncertain = dataType === "" || archetype === "unknown";
      const status = toQueueStatus(sug.status, uncertain);
      out.push({
        suggestionType: "tag_mapping",
        title: `Map tag ${tag} → ${unsPath}`,
        body:
          `${sug.statement ?? `Signal "${tag}" at UNS ${unsPath}.`} ` +
          `Inferred role: ${archetype || "unknown"}` +
          `${dataType ? ` (type ${dataType})` : " (type unresolved — needs review)"}. ` +
          `Evidence: ${evidenceSummary(ev)}.`,
        confidence: bandToConfidence(sug.confidence),
        status,
        riskLevel: status === "needs_review" ? "medium" : "low",
        extractedData: {
          tag,
          uns_path: unsPath,
          signal: archetype,
          data_type: dataType,
          unit: node.unit ?? "",
          confidence_band: sug.confidence ?? "",
          evidence: ev ?? [],
          source,
        },
      });
    }
  }

  return out;
}

/**
 * Persist proposals into `ai_suggestions` for `tenantId`, at the per-row status ('pending' or
 * 'needs_review' — NEVER an approved/transition status). One atomic multi-row INSERT under the
 * tenant's RLS context (mig 027 policy). Mirrors `insertPlcSuggestions`; the only delta is binding
 * the per-row `status` column. Returns the new row ids.
 */
export async function insertFactoryModelSuggestions(
  tenantId: string,
  rows: FactoryModelSuggestion[],
): Promise<string[]> {
  if (rows.length === 0) return [];
  const payload = rows.map((r) => ({
    suggestion_type: r.suggestionType,
    extracted_data: r.extractedData,
    confidence: r.confidence,
    status: r.status,
    risk_level: r.riskLevel,
    title: r.title,
    body: r.body,
  }));

  return withTenantContext(tenantId, async (c) => {
    const res = await c.query<{ id: string }>(
      `INSERT INTO ai_suggestions
         (tenant_id, suggestion_type, extracted_data, confidence, status, risk_level, proposed_by, title, body)
       SELECT $1::uuid, r.suggestion_type, r.extracted_data, r.confidence, r.status, r.risk_level, $2, r.title, r.body
       FROM jsonb_to_recordset($3::jsonb) AS r(
         suggestion_type text, extracted_data jsonb, confidence float8, status text, risk_level text, title text, body text
       )
       RETURNING id`,
      [tenantId, FACTORY_MODEL_PROPOSED_BY, JSON.stringify(payload)],
    );
    return res.rows.map((row) => row.id);
  });
}

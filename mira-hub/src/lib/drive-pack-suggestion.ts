import { withTenantContext } from "@/lib/tenant-context";

/**
 * Bridge candidate (`mira-crawler/drive_pack_bridge.py`) → `ai_suggestions` row.
 *
 * The Python bridge writes a review-only *drive-pack update candidate* to
 * `~/.mira/drive-pack-candidates/<manual_id>/candidate-<sha>.json` when a
 * successful manual KB ingest belongs to a known drive family and its hash is
 * new/changed. This module is the Hub-side seam that turns such a candidate
 * into a `drive_pack_update` suggestion (mig 062) so it surfaces in the Command
 * Center `/knowledge/suggestions` queue for human review.
 *
 * Doctrine (`docs/drive-commander/runbook-do-not-silently-trust-updated-manuals.md`
 * + `.claude/rules/train-before-deploy.md`): accepting the suggestion records
 * "this changed manual is worth processing" — it does NOT extract, grade, or
 * promote a pack. The actual extraction is the human-gated `next_step` command
 * carried on the row. So the decide path is intentionally status-only for this
 * type (see `suggestion-accept.ts`).
 */

// `proposed_by` follows the mig-027 `import:<format>` convention.
export const DRIVE_PACK_PROPOSED_BY = "import:kb_growth_bridge";

export interface DrivePackSuggestion {
  suggestionType: "drive_pack_update";
  title: string;
  body: string;
  confidence: number;
  riskLevel: "low" | "medium" | "high" | "safety_critical";
  extractedData: Record<string, unknown>;
}

/** Thrown when a candidate record is missing the fields we require to build a row. */
export class InvalidCandidateError extends Error {}

interface ManualSource {
  manufacturer?: unknown;
  model?: unknown;
  vendor?: unknown;
  product_family?: unknown;
  publication?: unknown;
  revision?: unknown;
  source_url?: unknown;
  source_classification?: unknown;
}

interface CandidateRecord {
  registry_manual_id?: unknown;
  pdf_sha256?: unknown;
  previously_registered_sha256?: unknown;
  change_state?: unknown;
  manual_source?: ManualSource;
  next_step?: unknown;
  local_pdf_path?: unknown;
  review_only?: unknown;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/**
 * Pure transform: a bridge candidate record → the `ai_suggestions` row shape.
 * Deterministic, side-effect-free, fully unit-testable without a database.
 * Throws {@link InvalidCandidateError} if the record lacks the required
 * provenance (registry id, hash, change state) — the route maps that to 400.
 */
export function candidateToSuggestion(record: CandidateRecord): DrivePackSuggestion {
  const manualId = str(record.registry_manual_id);
  const sha = str(record.pdf_sha256);
  const changeState = str(record.change_state);
  if (!manualId || !sha || !changeState) {
    throw new InvalidCandidateError(
      "candidate requires registry_manual_id, pdf_sha256 and change_state",
    );
  }

  const src = record.manual_source ?? {};
  const family = str(src.product_family) || str(src.model) || manualId;
  const vendor = str(src.vendor) || str(src.manufacturer) || "the vendor";
  const publication = str(src.publication);
  const nextStep = str(record.next_step);
  const prevSha = str(record.previously_registered_sha256);

  // needs_initial_candidate = a registered family that never had an approved
  // hash yet (first extraction); changed_by_hash = an existing pack's manual
  // changed. Both are review items — the title reflects which.
  const firstTime = changeState === "needs_initial_candidate";
  const title = firstTime
    ? `Drive-pack update: ${family} manual ready for first extraction`
    : `Drive-pack update: ${family} manual changed`;

  const changeLine = firstTime
    ? `A ${vendor} ${family} manual${publication ? ` (${publication})` : ""} was ingested and is registered but has no approved drive-pack copy yet.`
    : `A ${vendor} ${family} manual${publication ? ` (${publication})` : ""} was ingested and its content differs from the approved copy` +
      (prevSha ? ` (sha ${prevSha.slice(0, 12)} → ${sha.slice(0, 12)}).` : ".");

  const body =
    `${changeLine} This is a REVIEW-ONLY candidate — it does NOT change any trusted drive-pack. ` +
    `To process it, run:\n\n    ${nextStep}\n\n` +
    `Trust requires extraction + grading + cite-integrity + human approval ` +
    `(docs/drive-commander/runbook-drive-manual-update-acceptance.md).`;

  return {
    suggestionType: "drive_pack_update",
    title,
    body,
    confidence: 0.5, // a doc-change candidate is a review item, not a graded claim
    riskLevel: "low", // review-only; nothing is acted on until a human runs next_step
    extractedData: {
      registry_manual_id: manualId,
      pdf_sha256: sha,
      previously_registered_sha256: prevSha || null,
      change_state: changeState,
      manual_source: src,
      next_step: nextStep,
      local_pdf_path: str(record.local_pdf_path) || null,
      review_only: true,
    },
  };
}

/**
 * Insert a drive-pack candidate suggestion for `tenantId` at `status='pending'`,
 * idempotent on (registry_manual_id, pdf_sha256): re-submitting the same
 * candidate returns the existing row id and does not duplicate it. Returns the
 * row id and whether it was newly created.
 */
export async function insertDrivePackSuggestion(
  tenantId: string,
  suggestion: DrivePackSuggestion,
): Promise<{ id: string; created: boolean }> {
  const manualId = String(suggestion.extractedData.registry_manual_id ?? "");
  const sha = String(suggestion.extractedData.pdf_sha256 ?? "");

  return withTenantContext(tenantId, async (c) => {
    // Dedup: a pending/deferred candidate for the same manual + hash already
    // exists → return it rather than piling duplicates into the queue.
    const existing = await c.query(
      `SELECT id FROM ai_suggestions
        WHERE tenant_id = $1::uuid
          AND suggestion_type = 'drive_pack_update'
          AND status IN ('pending', 'deferred')
          AND extracted_data->>'registry_manual_id' = $2
          AND extracted_data->>'pdf_sha256' = $3
        LIMIT 1`,
      [tenantId, manualId, sha],
    );
    const hit = (existing.rows as { id: string }[])[0];
    if (hit) return { id: hit.id, created: false };

    const res = await c.query(
      `INSERT INTO ai_suggestions
         (tenant_id, suggestion_type, extracted_data, confidence, status, risk_level, proposed_by, title, body)
       VALUES ($1::uuid, 'drive_pack_update', $2::jsonb, $3, 'pending', $4, $5, $6, $7)
       RETURNING id`,
      [
        tenantId,
        JSON.stringify(suggestion.extractedData),
        suggestion.confidence,
        suggestion.riskLevel,
        DRIVE_PACK_PROPOSED_BY,
        suggestion.title,
        suggestion.body,
      ],
    );
    return { id: (res.rows as { id: string }[])[0].id, created: true };
  });
}

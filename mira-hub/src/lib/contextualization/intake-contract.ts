/**
 * HubV3 — Shared Contextualization Intake Contract (TypeScript).
 *
 * The single normalized envelope every ingest route (offline Contextualizer,
 * Telegram thin client, Hub upload) submits to the Hub. The Hub is the system
 * of record; clients only collect evidence and create proposals. See
 * `docs/plans/2026-06-20-hubv3-contextualization-intake-prd.md` §2 and
 * `docs/adr/0023-hub-system-of-record-contextualization.md`.
 *
 * Three artifacts are kept in lockstep — change all three together:
 *   - this file (TypeScript types + validator),
 *   - `intake-contract.schema.json` (JSON Schema, co-located),
 *   - `contracts/contextualization/intake_contract.py` (Python dataclass).
 *
 * Identity model: UUIDs are identity; names / numbers / serials / model
 * numbers / controller IPs / UNS paths are MATCHING EVIDENCE, never the key.
 * `review_status` is always "proposed" on intake — nothing is auto-approved.
 *
 * Pure + dependency-free (no zod — PRD §4 bans framework abstractions, and a
 * hand-rolled validator keeps the contract portable to the Python/JSON twins).
 */

export const CONTRACT_VERSION = "contextualization-intake/v1";

export type IngestRoute = "offline" | "telegram" | "hub_upload";

/** ctx_sources.source_type domain (matches migration 055). */
export type SourceType = "l5x" | "st" | "plcopen" | "csv" | "manual" | "other";

export const INGEST_ROUTES: readonly IngestRoute[] = ["offline", "telegram", "hub_upload"];
export const SOURCE_TYPES: readonly SourceType[] = ["l5x", "st", "plcopen", "csv", "manual", "other"];

/** Identity + matching-evidence hints for the asset this submission describes. */
export interface AssetHints {
  name?: string;
  number?: string;
  manufacturer?: string;
  model?: string;
  serial?: string;
  controller?: string;
  controller_ip?: string;
  uns_path?: string;
}

export interface SourceMetadata {
  file_name: string;
  mime?: string;
  size?: number;
  captured_at?: string;
  uploader?: string;
  location?: string;
}

export interface IntakeSource {
  /** Content fingerprint — the per-source dedup key (sha256 hex). */
  source_sha256: string;
  source_type: SourceType;
  source_metadata: SourceMetadata;
  /** Optional client-minted UUID; the Hub mints its own if absent. */
  source_uuid?: string;
}

/** A proposed signal/tag. Lands as a ctx_extractions row (status "pending"). */
export interface ProposedSignal {
  tag_name: string;
  roles?: string[];
  uns_path?: string | null;
  i3x_element_id?: string | null;
  confidence?: number | null;
  evidence?: Record<string, unknown>;
  /** Which source (by sha256) this signal came from. */
  source_sha256?: string | null;
}

/**
 * The full intake envelope. Proposal arrays beyond `proposed_signals` are
 * carried verbatim for downstream phases (P3 matching, P4 publish); P2 only
 * stages sources + signals. All proposal arrays default to [].
 */
export interface IntakeContract {
  contract_version: typeof CONTRACT_VERSION;
  ingest_route: IngestRoute;
  /** Always "proposed" on intake. */
  review_status: "proposed";
  /** Whole-submission fingerprint — the project/batch dedup key (sha256 hex). */
  bundle_sha256?: string | null;
  project_hint?: string | null;
  asset_hints?: AssetHints;
  sources: IntakeSource[];
  evidence?: Record<string, unknown>[];
  entities?: Record<string, unknown>[];
  proposed_signals?: ProposedSignal[];
  proposed_uns?: Record<string, unknown>[];
  proposed_i3x?: Record<string, unknown>[];
  proposed_faults?: Record<string, unknown>[];
  proposed_parameters?: Record<string, unknown>[];
  proposed_relationships?: Record<string, unknown>[];
  provenance?: Record<string, unknown>;
  confidence?: string | number | null;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  value?: IntakeContract;
}

const SHA256_RE = /^[0-9a-f]{64}$/i;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Validate + normalize an unknown payload into an IntakeContract. Returns
 * `{ ok, errors, value? }`. `value` is only set when `ok` is true. Optional
 * proposal arrays are defaulted to []; `review_status` defaults to "proposed".
 */
export function validateIntakeContract(input: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isObject(input)) {
    return { ok: false, errors: ["intake contract must be a JSON object"] };
  }

  if (input.contract_version !== CONTRACT_VERSION) {
    errors.push(`contract_version must be "${CONTRACT_VERSION}"`);
  }

  const ingestRoute = input.ingest_route;
  if (typeof ingestRoute !== "string" || !INGEST_ROUTES.includes(ingestRoute as IngestRoute)) {
    errors.push(`ingest_route must be one of ${INGEST_ROUTES.join(", ")}`);
  }

  if (input.review_status !== undefined && input.review_status !== "proposed") {
    errors.push('review_status must be "proposed" on intake');
  }

  if (input.bundle_sha256 !== undefined && input.bundle_sha256 !== null) {
    if (typeof input.bundle_sha256 !== "string" || !SHA256_RE.test(input.bundle_sha256)) {
      errors.push("bundle_sha256 must be a 64-char hex string");
    }
  }

  const sources = input.sources;
  if (!Array.isArray(sources) || sources.length === 0) {
    errors.push("sources must be a non-empty array");
  } else {
    sources.forEach((s, i) => {
      if (!isObject(s)) {
        errors.push(`sources[${i}] must be an object`);
        return;
      }
      if (typeof s.source_sha256 !== "string" || !SHA256_RE.test(s.source_sha256)) {
        errors.push(`sources[${i}].source_sha256 must be a 64-char hex string`);
      }
      if (typeof s.source_type !== "string" || !SOURCE_TYPES.includes(s.source_type as SourceType)) {
        errors.push(`sources[${i}].source_type must be one of ${SOURCE_TYPES.join(", ")}`);
      }
      const meta = s.source_metadata;
      if (!isObject(meta) || typeof meta.file_name !== "string" || !meta.file_name.trim()) {
        errors.push(`sources[${i}].source_metadata.file_name is required`);
      }
    });
  }

  if (errors.length > 0) return { ok: false, errors };

  const value: IntakeContract = {
    contract_version: CONTRACT_VERSION,
    ingest_route: ingestRoute as IngestRoute,
    review_status: "proposed",
    bundle_sha256: (input.bundle_sha256 as string | undefined) ?? null,
    project_hint: typeof input.project_hint === "string" ? input.project_hint : null,
    asset_hints: isObject(input.asset_hints) ? (input.asset_hints as AssetHints) : undefined,
    sources: (sources as IntakeSource[]).map((s) => ({
      source_sha256: String(s.source_sha256),
      source_type: s.source_type,
      source_metadata: s.source_metadata,
      source_uuid: typeof s.source_uuid === "string" ? s.source_uuid : undefined,
    })),
    evidence: Array.isArray(input.evidence) ? (input.evidence as Record<string, unknown>[]) : [],
    entities: Array.isArray(input.entities) ? (input.entities as Record<string, unknown>[]) : [],
    proposed_signals: Array.isArray(input.proposed_signals)
      ? (input.proposed_signals as ProposedSignal[])
      : [],
    proposed_uns: Array.isArray(input.proposed_uns) ? (input.proposed_uns as Record<string, unknown>[]) : [],
    proposed_i3x: Array.isArray(input.proposed_i3x) ? (input.proposed_i3x as Record<string, unknown>[]) : [],
    proposed_faults: Array.isArray(input.proposed_faults)
      ? (input.proposed_faults as Record<string, unknown>[])
      : [],
    proposed_parameters: Array.isArray(input.proposed_parameters)
      ? (input.proposed_parameters as Record<string, unknown>[])
      : [],
    proposed_relationships: Array.isArray(input.proposed_relationships)
      ? (input.proposed_relationships as Record<string, unknown>[])
      : [],
    provenance: isObject(input.provenance) ? (input.provenance as Record<string, unknown>) : undefined,
    confidence:
      typeof input.confidence === "string" || typeof input.confidence === "number"
        ? input.confidence
        : null,
  };

  return { ok: true, errors: [], value };
}

// ── Mapping to insertable rows (consumed by the import route) ────────────────

export interface ImportSourceRow {
  fileName: string;
  sourceType: SourceType;
  sourceSha256: string;
  status: string;
}

export interface ImportExtractionRow {
  tagName: string;
  roles: string[];
  unsPathProposed: string | null;
  i3xElementId: string | null;
  evidenceJson: Record<string, unknown>;
  confidence: number | null;
  /** Nothing lands "accepted" on intake — proposed == pending in ctx_extractions. */
  status: "pending";
  sourceSha256: string | null;
}

export interface ContractImport {
  projectName: string;
  description: string | null;
  ingestRoute: IngestRoute;
  bundleSha256: string | null;
  sources: ImportSourceRow[];
  extractions: ImportExtractionRow[];
}

/**
 * Map a validated IntakeContract into the project/source/extraction rows the
 * import route inserts. Mirrors ParsedBundle (bundle-import.ts) so the route's
 * insert path is shared. proposed_signals → ctx_extractions, all "pending".
 */
export function intakeContractToImport(contract: IntakeContract): ContractImport {
  const sources: ImportSourceRow[] = contract.sources.map((s) => ({
    fileName: s.source_metadata.file_name,
    sourceType: s.source_type,
    sourceSha256: s.source_sha256,
    status: "done",
  }));

  const extractions: ImportExtractionRow[] = (contract.proposed_signals ?? [])
    .map((sig) => ({
      tagName: String(sig.tag_name ?? "").trim(),
      roles: Array.isArray(sig.roles) ? sig.roles.map(String) : [],
      unsPathProposed: typeof sig.uns_path === "string" ? sig.uns_path : null,
      i3xElementId: typeof sig.i3x_element_id === "string" ? sig.i3x_element_id : null,
      evidenceJson: isObject(sig.evidence) ? sig.evidence : {},
      confidence: typeof sig.confidence === "number" ? sig.confidence : null,
      status: "pending" as const,
      sourceSha256: typeof sig.source_sha256 === "string" ? sig.source_sha256 : null,
    }))
    .filter((e) => e.tagName);

  return {
    projectName: contract.project_hint?.trim() || "Imported project",
    description: null,
    ingestRoute: contract.ingest_route,
    bundleSha256: contract.bundle_sha256 ?? null,
    sources,
    extractions,
  };
}

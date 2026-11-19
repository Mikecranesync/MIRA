/**
 * Asset matching for HubV3 contextualization intake (PRD §2 "Import behavior", §5 Phase 3).
 *
 * Classifies an incoming asset identity (the manifest `asset_match` block / project profile of an
 * imported bundle) against the tenant's existing `cmms_equipment` rows as `strong | probable | none`,
 * and maps that to a staging decision:
 *   strong   → stage proposals under the existing asset   (`existing_asset`)
 *   probable → require human confirmation                 (`needs_confirmation`)
 *   none     → create a draft asset proposal              (`draft_asset`)
 *
 * Design goals (the adversarial bar): no FALSE-MERGE (never auto-stage under the wrong asset) and no
 * MISSED-MATCH (formatting noise must not hide a real match). Two ideas carry that weight:
 *   - Tiered evidence: only INSTANCE-unique keys (serial, asset number, proposed UNS path, or a
 *     controller IP corroborated by another field) can make a match `strong`. MODEL-level descriptors
 *     (manufacturer, model, controller type, PLC program, name) only ever reach `probable` — two
 *     identical drives must not merge.
 *   - Conflict guard: if BOTH sides carry a unique instance id and they disagree, the row is a
 *     different asset → capped at `none` (the safe direction: a draft a human can still merge).
 *   - Ambiguity guard: two equally-strong candidates downgrade to `needs_confirmation`.
 *
 * Everything lands `approval_state = "proposed"` — matching NEVER auto-verifies (ADR-0017). This module
 * is pure + DB-free so it is unit-testable without migration 056; `persistAssetMatches` is the thin
 * writer that lands rows in `ctx_extraction_asset_matches` (shape owned by migration 056, PRD §4.1).
 */

export type MatchStrength = "strong" | "probable" | "none";
export type StagingDecision = "existing_asset" | "needs_confirmation" | "draft_asset";

/** Asset-identity hints from an imported bundle (manifest `asset_match` / project profile). */
export interface AssetHints {
  assetNumber?: string | null;
  name?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  controllerType?: string | null;
  controllerIp?: string | null;
  plcProgramName?: string | null;
  proposedUnsPath?: string | null;
}

/** An existing asset to match against (normalized projection of a `cmms_equipment` row). */
export interface EquipmentRow extends AssetHints {
  id: string;
}

export interface AssetMatch {
  strength: MatchStrength;
  decision: StagingDecision;
  /** The existing asset to stage under (strong) or confirm against (probable); null for a draft. */
  matchedAssetId: string | null;
  confidence: number; // 0..1, banded by strength
  matchedFields: string[]; // evidence: which identity fields agreed
  conflictFields: string[]; // unique-id fields that disagreed (drove a downgrade)
  /** Imported matches are never auto-verified — admin approval promotes them later. */
  approvalState: "proposed";
}

// Instance-unique identity keys: an exact agreement identifies the SAME physical asset; a
// disagreement identifies a DIFFERENT one. These can make a match strong and can veto one.
const UNIQUE_KEYS = ["serialNumber", "assetNumber", "proposedUnsPath"] as const;
// Model-level descriptors: corroborating evidence only — never strong on their own.
const DESCRIPTOR_KEYS = ["manufacturer", "model", "controllerType", "plcProgramName", "name"] as const;

type Field = keyof AssetHints;

// Sentinel "I don't know" values that pollute CMMS registries. They carry NO identity, so a match on
// one must never merge two assets — treat them as absent everywhere (normalize to null).
const PLACEHOLDERS = new Set([
  "na", "nan", "none", "null", "nil", "unknown", "unk", "tbd", "tba", "pending", "default",
  "notavailable", "notapplicable", "placeholder", "xxx", "xxxx", "xxxxx",
  "0", "00", "000", "0000", "00000",
]);
// A strong (auto-merge) decision needs an instance-unique id with real entropy. 1–2 char "serials"
// are implausibly unique and a frequent data-entry artifact, so they can corroborate but never merge.
const MIN_STRONG_ID_LEN = 3;

/** Normalize for comparison: lowercase, separators/punctuation → nothing, whitespace collapsed.
 * Absorbs "Allen-Bradley" vs "allen bradley" and "enterprise/garage/cv_101" vs "enterprise.garage.cv_101".
 * Returns null for empty and for known placeholder/sentinel values (which convey no identity). */
function norm(v: string | null | undefined): string | null {
  if (v == null) return null;
  const s = v.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (!s.length || PLACEHOLDERS.has(s)) return null;
  return s;
}

function fieldsAgree(a: AssetHints, b: AssetHints, field: Field): boolean | null {
  const na = norm(a[field]);
  const nb = norm(b[field]);
  if (na == null || nb == null) return null; // not comparable (one side absent)
  return na === nb;
}

function band(strength: MatchStrength): number {
  return strength === "strong" ? 0.9 : strength === "probable" ? 0.6 : 0;
}

function decisionFor(strength: MatchStrength): StagingDecision {
  return strength === "strong"
    ? "existing_asset"
    : strength === "probable"
      ? "needs_confirmation"
      : "draft_asset";
}

interface RowVerdict {
  strength: MatchStrength;
  matchedFields: string[];
  conflictFields: string[];
}

/** Classify the hints against a single equipment row. */
function classifyRow(hints: AssetHints, row: EquipmentRow): RowVerdict {
  const matched: string[] = [];
  const conflict: string[] = [];

  for (const k of [...UNIQUE_KEYS, ...DESCRIPTOR_KEYS]) {
    const agree = fieldsAgree(hints, row, k);
    if (agree === true) matched.push(k);
    else if (agree === false && (UNIQUE_KEYS as readonly string[]).includes(k)) conflict.push(k);
  }

  // A disagreeing instance-unique id means a DIFFERENT asset — never merge. (Controller IP is not in
  // UNIQUE_KEYS: IPs get reassigned, so an IP mismatch is not proof of a different asset.)
  if (conflict.length) return { strength: "none", matchedFields: matched, conflictFields: conflict };

  const has = (k: Field) => matched.includes(k);
  // A unique-id only makes a match STRONG when its agreed value has real entropy (≥ MIN_STRONG_ID_LEN
  // after normalization) — guards against ultra-short artifacts auto-merging distinct assets.
  const strongId = (k: Field) => has(k) && (norm(hints[k])?.length ?? 0) >= MIN_STRONG_ID_LEN;
  const strongUniqueHit = strongId("serialNumber") || strongId("assetNumber") || strongId("proposedUnsPath");
  // A controller IP corroborated by a second field (PLC program / model / controller type) is strong;
  // IP alone is only probable.
  const ipAgree = fieldsAgree(hints, row, "controllerIp") === true;
  const ipCorroborated =
    ipAgree && (has("plcProgramName") || has("model") || has("controllerType"));

  if (strongUniqueHit || ipCorroborated) {
    return { strength: "strong", matchedFields: matched, conflictFields: conflict };
  }

  const modelLevel =
    (has("manufacturer") && has("model")) || has("name") || has("plcProgramName") || ipAgree;
  if (modelLevel) return { strength: "probable", matchedFields: matched, conflictFields: conflict };

  return { strength: "none", matchedFields: matched, conflictFields: conflict };
}

const RANK: Record<MatchStrength, number> = { strong: 2, probable: 1, none: 0 };

/**
 * Classify an asset identity against the existing fleet and decide how to stage it.
 * `equipmentRows` should already be scoped to the caller's tenant.
 */
export function classifyAsset(hints: AssetHints, equipmentRows: EquipmentRow[]): AssetMatch {
  let best: (RowVerdict & { id: string }) | null = null;
  let strongCount = 0;

  for (const row of equipmentRows) {
    const v = classifyRow(hints, row);
    if (v.strength === "strong") strongCount += 1;
    const better =
      !best ||
      RANK[v.strength] > RANK[best.strength] ||
      (RANK[v.strength] === RANK[best.strength] && v.matchedFields.length > best.matchedFields.length);
    if (better) best = { ...v, id: row.id };
  }

  if (!best || best.strength === "none") {
    return {
      strength: "none",
      decision: "draft_asset",
      matchedAssetId: null,
      confidence: 0,
      matchedFields: best?.matchedFields ?? [],
      conflictFields: best?.conflictFields ?? [],
      approvalState: "proposed",
    };
  }

  // Ambiguity guard: more than one equally-strong candidate → don't pick blindly, ask a human.
  let strength = best.strength;
  if (strength === "strong" && strongCount > 1) strength = "probable";

  return {
    strength,
    decision: decisionFor(strength),
    matchedAssetId: best.id,
    confidence: band(strength),
    matchedFields: best.matchedFields,
    conflictFields: best.conflictFields,
    approvalState: "proposed",
  };
}

/** A raw `cmms_equipment` row (the snake_case columns this matcher reads). */
export interface CmmsEquipmentRow {
  id: string;
  equipment_number?: string | null;
  manufacturer?: string | null;
  model_number?: string | null;
  serial_number?: string | null;
  uns_path?: string | null;
}

/** Map a `cmms_equipment` DB row to the matcher's normalized shape. Only sets the fields present
 * so an absent column never masquerades as a matchable empty string. */
export function fromEquipmentRow(row: CmmsEquipmentRow): EquipmentRow {
  const out: EquipmentRow = { id: row.id };
  if (row.equipment_number != null) out.assetNumber = row.equipment_number;
  if (row.manufacturer != null) out.manufacturer = row.manufacturer;
  if (row.model_number != null) out.model = row.model_number;
  if (row.serial_number != null) out.serialNumber = row.serial_number;
  if (row.uns_path != null) out.proposedUnsPath = row.uns_path;
  return out;
}

/** A staged extraction→asset match row, ready to insert into `ctx_extraction_asset_matches`. */
export interface ExtractionAssetMatch {
  extractionId: string;
  matchedAssetId: string | null;
  strength: MatchStrength;
  decision: StagingDecision;
  confidence: number;
  matchedFields: string[];
  approvalState: "proposed";
}

/** Apply one asset-level match to each extraction of the imported asset (one row per extraction). */
export function buildExtractionMatches(
  extractionIds: string[],
  match: AssetMatch,
): ExtractionAssetMatch[] {
  return extractionIds.map((extractionId) => ({
    extractionId,
    matchedAssetId: match.matchedAssetId,
    strength: match.strength,
    decision: match.decision,
    confidence: match.confidence,
    matchedFields: match.matchedFields,
    approvalState: match.approvalState,
  }));
}

/** Minimal `pg` client surface used by the writer (matches `withTenantContext`'s PoolClient). */
interface QueryClient {
  query: (text: string, params?: unknown[]) => Promise<unknown>;
}

/**
 * Persist staged matches into `ctx_extraction_asset_matches`.
 *
 * NOTE: the table is owned by migration 056 (PRD §4.1) and is not in 055 yet — this writer assumes
 * that shape and is exercised only once 056 lands (integration-tested then). It is intentionally
 * INSERT-only and lands every row `approval_state = 'proposed'`; promotion is a separate admin action.
 * The caller supplies a client already inside `withTenantContext(tenantId, …)` so RLS scopes the write.
 */
export async function persistAssetMatches(
  client: QueryClient,
  tenantId: string,
  rows: ExtractionAssetMatch[],
): Promise<void> {
  for (const r of rows) {
    await client.query(
      `INSERT INTO ctx_extraction_asset_matches
         (tenant_id, extraction_id, matched_equipment_id, match_strength, decision,
          confidence, matched_fields, approval_state)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7::jsonb, $8)`,
      [
        tenantId,
        r.extractionId,
        r.matchedAssetId,
        r.strength,
        r.decision,
        r.confidence,
        JSON.stringify(r.matchedFields),
        r.approvalState,
      ],
    );
  }
}

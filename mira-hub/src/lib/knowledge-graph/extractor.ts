/**
 * Live entity extraction from MIRA conversation text (#793).
 *
 * extractEntitiesFromText — pure regex, no DB.
 * extractAndStore         — runs extraction and writes to KG (fire-and-forget safe).
 */

import pool from "@/lib/db";
import type { PoolClient } from "pg";
import { extractRelationships, type EntityRef, type ExtractionStats } from "./relationship-extractor";
import { mapToCanonicalEdge, upsertInferredProposal } from "./proposals-writer";

// Regex-extracted conversation edges are co-occurrence inferences (the asset
// and the tag/fault/part appeared together), not certainties. Propose them at
// a moderate fixed confidence rather than the old auto-verified 1.0.
const REGEX_RELATIONSHIP_CONFIDENCE = 0.7;

// ── Regex patterns ─────────────────────────────────────────────────────────

// Equipment asset tags: VFD-07, POW-755-A12, PUMP-99, CNC-3
// 2-6 uppercase letters, dash, 1-4 digits, optional one-segment alphanumeric suffix
const EQUIPMENT_TAG_RE = /\b([A-Z]{2,6}-\d{1,4}(?:-[A-Z0-9]{1,4})?)\b/g;

// Part numbers — distinguished from equipment tags by length:
//   • Single long segment (≥5 chars): IR-39868252, 5V660
//   • Multi-segment (2+ segments):    DR-5V660-B200, 42B-C3-XL
// Equipment tags have 1-4 digit suffixes (handled by EQUIPMENT_TAG_RE above).
const PART_NUMBER_RE =
  /\b([A-Z]{1,4}-(?:[A-Z0-9]{5,}(?:-[A-Z0-9]{2,})*|[A-Z0-9]{2,}(?:-[A-Z0-9]{2,})+))\b/g;

// Fault codes:
//   • F-prefixed: F005, F30001
//   • ERR-codes: ERR-105, ERR105
//   • 4-5 digit standalone numeric codes: 2310, 43105
//   • Short alpha codes (whole-word only): OC, OT, SC, OH, UV, OV
const FAULT_CODE_RE =
  /\b(F\d{3,6}|ERR[-\s]?\d{2,5}|\d{4,5}|OC|OT|SC|OH|UV|OV)\b/g;

const ACTION_VERBS = new Set([
  "replaced", "replace", "adjusted", "adjust",
  "cleaned", "clean", "calibrated", "calibrate",
  "inspected", "inspect", "ordered", "order",
  "lubricated", "lubricate", "tightened", "tighten",
  "repaired", "repair", "installed", "install",
  "tested", "test", "reset", "restarted", "restart",
  "torqued", "torque", "swapped", "swap",
]);

// ── Pure extraction ─────────────────────────────────────────────────────────

export interface ExtractedEntities {
  equipment: string[];
  faultCodes: string[];
  parts: string[];
  actions: string[];
}

export function extractEntitiesFromText(text: string): ExtractedEntities {
  const upper = text.toUpperCase();

  // Equipment tags — run on uppercased text to catch mixed-case input
  const equipmentSet = new Set<string>();
  for (const m of upper.matchAll(EQUIPMENT_TAG_RE)) {
    equipmentSet.add(m[1]);
  }

  // Part numbers (longer patterns; anything also matching equipment is kept in both)
  const partsSet = new Set<string>();
  for (const m of upper.matchAll(PART_NUMBER_RE)) {
    partsSet.add(m[1]);
  }

  // Fault codes
  const faultSet = new Set<string>();
  for (const m of upper.matchAll(FAULT_CODE_RE)) {
    faultSet.add(m[1]);
  }

  // Action verbs — scan original lowercase tokens
  const actionsSet = new Set<string>();
  const tokens = text.toLowerCase().match(/\b[a-z]+\b/g) ?? [];
  for (const tok of tokens) {
    if (ACTION_VERBS.has(tok)) actionsSet.add(tok);
  }

  return {
    equipment: [...equipmentSet],
    faultCodes: [...faultSet],
    parts: [...partsSet],
    actions: [...actionsSet],
  };
}

// ── DB helpers (same dual-setting pattern as cmms-sync) ───────────────────

async function withKgContext<T>(
  tenantId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE factorylm_app");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantId]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function upsertEntity(
  client: PoolClient,
  tenantId: string,
  entityType: string,
  entityId: string,
  name: string,
  properties: Record<string, unknown> = {},
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO kg_entities (tenant_id, entity_type, entity_id, name, properties)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (tenant_id, entity_type, entity_id) DO UPDATE SET
       name       = EXCLUDED.name,
       properties = kg_entities.properties || EXCLUDED.properties,
       updated_at = now()
     RETURNING id`,
    [tenantId, entityType, entityId, name, JSON.stringify(properties)],
  );
  return rows[0]!.id;
}

/**
 * Propose a conversation-extracted edge for human review instead of writing it
 * straight to kg_relationships (Iron Rule, ADR-0017). The lowercase predicate
 * is mapped to canonical via mapToCanonicalEdge; unmapped types are skipped.
 * Returns true when a new proposal was written (false = unmapped or deduped).
 */
async function proposeConversationEdge(
  client: PoolClient,
  tenantId: string,
  src: { id: string; type: string },
  tgt: { id: string; type: string },
  rawType: string,
  conversationId: string | null,
): Promise<boolean> {
  const edge = mapToCanonicalEdge(rawType);
  if (!edge) return false;
  const source = edge.flip ? tgt : src;
  const target = edge.flip ? src : tgt;
  const proposalId = await upsertInferredProposal(client, tenantId, {
    sourceEntityId: source.id,
    sourceEntityType: source.type,
    targetEntityId: target.id,
    targetEntityType: target.type,
    relationshipType: edge.type,
    confidence: REGEX_RELATIONSHIP_CONFIDENCE,
    reasoning: `Conversation entity extraction (regex) from conversation ${conversationId ?? "?"} — original predicate "${rawType}".`,
    evidence: [
      {
        evidenceType: "technician_note",
        sourceDescription: `Diagnostic conversation ${conversationId ?? "(none)"}`,
        confidenceContribution: REGEX_RELATIONSHIP_CONFIDENCE,
      },
    ],
  });
  return proposalId !== null;
}

async function logTriple(
  client: PoolClient,
  tenantId: string,
  conversationId: string | null,
  subject: string,
  predicate: string,
  object: string,
): Promise<void> {
  await client.query(
    `INSERT INTO kg_triples_log
       (tenant_id, conversation_id, subject, predicate, object, confidence, source)
     VALUES ($1, $2, $3, $4, $5, 1.0, 'conversation_extraction')`,
    [tenantId, conversationId, subject, predicate, object],
  );
}

// ── Main extraction + store ────────────────────────────────────────────────

export interface ExtractionResult {
  equipment: number;
  faultCodes: number;
  parts: number;
  actions: number;
  /**
   * Kept for API back-compat. Conversation edges are now PROPOSED for human
   * review (Iron Rule, ADR-0017), never written directly to kg_relationships —
   * always 0. See relationshipsProposed.
   */
  relationships: number;
  /** New (#1721): edges proposed this pass (regex + LLM Pass 2 combined). */
  relationshipsProposed: number;
  triples: number;
  /** Phase 3: stats from the LLM relationship extractor pass. null if disabled. */
  llmRelationships: ExtractionStats | null;
}

export interface ExtractAndStoreOpts {
  /**
   * Run Pass 2 (LLM relationship extractor) after the regex pass. Defaults
   * to true when KG_LLM_EXTRACTOR_DISABLED is unset and any cascade key is
   * available. Caller can force off (e.g. eval / offline tests).
   */
  llmRelationships?: boolean;
}

export async function extractAndStore(
  tenantId: string,
  assetId: string,
  conversationText: string,
  conversationId: string | null,
  opts: ExtractAndStoreOpts = {},
): Promise<ExtractionResult> {
  const extracted = extractEntitiesFromText(conversationText);

  let relCount = 0;
  let tripleCount = 0;

  await withKgContext(tenantId, async (client) => {
    // Upsert the anchor asset entity
    const assetKgId = await upsertEntity(
      client, tenantId, "equipment", assetId, `Asset ${assetId}`, { asset_id: assetId },
    );

    const asset = { id: assetKgId, type: "equipment" };

    // Equipment tags mentioned in conversation
    for (const tag of extracted.equipment) {
      const tagKgId = await upsertEntity(client, tenantId, "equipment_tag", tag, tag, { source: "conversation" });
      const proposed = await proposeConversationEdge(
        client, tenantId, asset, { id: tagKgId, type: "equipment_tag" }, "mentioned_tag", conversationId,
      );
      await logTriple(client, tenantId, conversationId, `Asset ${assetId}`, "mentioned_tag", tag);
      if (proposed) relCount++;
      tripleCount++;
    }

    // Fault codes
    for (const code of extracted.faultCodes) {
      const codeKgId = await upsertEntity(client, tenantId, "fault_code", code, code, { source: "conversation" });
      const proposed = await proposeConversationEdge(
        client, tenantId, asset, { id: codeKgId, type: "fault_code" }, "exhibited_fault", conversationId,
      );
      await logTriple(client, tenantId, conversationId, `Asset ${assetId}`, "exhibited_fault", code);
      if (proposed) relCount++;
      tripleCount++;
    }

    // Parts
    for (const pn of extracted.parts) {
      const partKgId = await upsertEntity(client, tenantId, "part", pn, pn, { source: "conversation" });
      const proposed = await proposeConversationEdge(
        client, tenantId, asset, { id: partKgId, type: "part" }, "requires_part", conversationId,
      );
      await logTriple(client, tenantId, conversationId, `Asset ${assetId}`, "requires_part", pn);
      if (proposed) relCount++;
      tripleCount++;
    }

    // Actions — logged as triples only (verbs don't need entity nodes)
    for (const action of extracted.actions) {
      await logTriple(client, tenantId, conversationId, `Asset ${assetId}`, "performed_action", action);
      tripleCount++;
    }
  });

  // Pass 2: LLM relationship extractor. Fire-and-forget — failures here must
  // not break the regex-pass result. Skipped when KG_LLM_EXTRACTOR_DISABLED
  // is set or when caller passes opts.llmRelationships === false.
  const runLlm =
    opts.llmRelationships !== false && process.env.KG_LLM_EXTRACTOR_DISABLED !== "1";
  let llmStats: ExtractionStats | null = null;
  if (runLlm) {
    const refs: EntityRef[] = [
      { ref: assetId, type: "equipment" },
      ...extracted.equipment.map((e) => ({ ref: e, type: "equipment_tag" })),
      ...extracted.faultCodes.map((f) => ({ ref: f, type: "fault_code" })),
      ...extracted.parts.map((p) => ({ ref: p, type: "part" })),
    ];
    try {
      llmStats = await extractRelationships(tenantId, conversationText, refs, conversationId);
    } catch (err) {
      // never break regex-pass results because Pass 2 misbehaved
      console.warn("[kg-extractor] LLM Pass 2 failed:", err);
    }
  }

  return {
    equipment: extracted.equipment.length,
    faultCodes: extracted.faultCodes.length,
    parts: extracted.parts.length,
    actions: extracted.actions.length,
    relationships: 0,
    relationshipsProposed: relCount + (llmStats?.storedRelationships ?? 0),
    triples: tripleCount + (llmStats?.storedTriples ?? 0),
    llmRelationships: llmStats,
  };
}

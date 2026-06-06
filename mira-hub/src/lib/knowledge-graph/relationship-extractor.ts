/**
 * LLM-based relationship extraction (Phase 3 of KG multi-hop spec, #806).
 *
 * Pass 1 (existing regex extractor) gives us entities. This module is Pass 2:
 * given the conversation text + the entity list, ask the LLM cascade to
 * surface causal / resolution / dependency relationships.
 *
 * Hard guards:
 *  - Predicate must be in the EXTRACTOR_ALLOWLIST (subset of full schema —
 *    only the predicates the LLM is allowed to emit).
 *  - Endpoints must reference an entity from the supplied list. Any
 *    relationship referencing an unknown entity is dropped.
 *  - confidence < HIGH_CONFIDENCE_THRESHOLD goes to triples log only.
 *  - confidence >= HIGH_CONFIDENCE_THRESHOLD is PROPOSED for human review
 *    (relationship_proposals via upsertInferredProposal) — never written
 *    directly to kg_relationships (Iron Rule, ADR-0017). The lowercase
 *    predicate is mapped to canonical first.
 *
 * Cost: per-conversation, fire-and-forget after the diagnostic conversation
 * closes (resolved decision §12 #5). Uses the same cascade as chat.
 */

import pool from "@/lib/db";
import type { PoolClient } from "pg";
import { cascadeComplete } from "@/lib/llm/cascade";
import { mapToCanonicalEdge, upsertInferredProposal } from "./proposals-writer";
import { isRelationshipType } from "./types";

// Subset of relationship types the LLM is allowed to emit. We deliberately
// leave hierarchical types (parent_of, has_component) and located_at out —
// those come from CMMS / hand-authored hierarchy, not free-text inference.
export const EXTRACTOR_ALLOWLIST = [
  "caused_by",
  "resolved_by",
  "feeds",
  "requires_part",
  "triggered_pm",
  "had_fault",
] as const;

export type ExtractorPredicate = (typeof EXTRACTOR_ALLOWLIST)[number];

export const HIGH_CONFIDENCE_THRESHOLD = 0.6;

// ── Prompt construction ────────────────────────────────────────────────────

export interface EntityRef {
  /** Stable external identifier we expect the LLM to echo back, e.g. "VFD-07". */
  ref: string;
  /** entity_type (equipment, fault_code, part, ...). */
  type: string;
}

export interface RawRelationship {
  source: string;
  predicate: string;
  target: string;
  confidence?: number;
}

const SYSTEM_PROMPT = `You extract maintenance relationships from technician conversations.
Return ONLY a JSON object of the form {"relationships":[{"source":"...","predicate":"...","target":"...","confidence":0.0}]}.

Rules:
- predicate must be one of: ${EXTRACTOR_ALLOWLIST.join(", ")}
- source and target MUST be from the provided entity list — do not invent new ones
- confidence is a number 0.0–1.0 reflecting how clearly the conversation states the relationship
- if no relationships are present, return {"relationships":[]}
- never include explanatory text outside the JSON
- caused_by means: source's failure was caused by target ("X tripped because Y")
- resolved_by means: source's issue was fixed by target action/part ("replaced bearing — runs now")
- feeds means: source supplies / drives target ("conveyor 3 feeds packer 1")
- requires_part means: source needs target as a replacement part
- triggered_pm means: source fault should bump the PM cadence on target
- had_fault means: source equipment exhibited the target fault code in this conversation`;

export function buildExtractorPrompt(
  conversationText: string,
  entities: EntityRef[],
): { system: string; user: string } {
  const entityList = entities.map((e) => `${e.ref} (${e.type})`).join("\n");
  const user =
    `Entities present in this conversation:\n${entityList || "(none)"}\n\n` +
    `Conversation:\n${conversationText}\n\n` +
    `Return the JSON object now.`;
  return { system: SYSTEM_PROMPT, user };
}

// ── Output validation ──────────────────────────────────────────────────────

export interface ValidatedRelationship {
  source: string;
  predicate: ExtractorPredicate;
  target: string;
  confidence: number;
}

export function parseAndValidate(
  rawJson: string,
  knownRefs: Set<string>,
): ValidatedRelationship[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object" || !("relationships" in parsed)) return [];
  const list = (parsed as { relationships?: unknown }).relationships;
  if (!Array.isArray(list)) return [];

  const out: ValidatedRelationship[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const source = typeof r.source === "string" ? r.source : null;
    const predicate = typeof r.predicate === "string" ? r.predicate : null;
    const target = typeof r.target === "string" ? r.target : null;
    let confidence = typeof r.confidence === "number" ? r.confidence : 0.5;
    if (!source || !predicate || !target) continue;
    if (source === target) continue;
    // Predicate must be in extractor allowlist AND in the global relationship type allowlist
    if (!(EXTRACTOR_ALLOWLIST as readonly string[]).includes(predicate)) continue;
    if (!isRelationshipType(predicate)) continue;
    // Both endpoints must reference known entities — kill hallucinations
    if (!knownRefs.has(source) || !knownRefs.has(target)) continue;
    confidence = Math.max(0, Math.min(1, confidence));
    out.push({ source, predicate: predicate as ExtractorPredicate, target, confidence });
  }
  return out;
}

// ── Storage ────────────────────────────────────────────────────────────────

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

interface KgIdLookup {
  ref: string;
  id: string;
  entity_type: string;
}

async function lookupKgIds(
  client: PoolClient,
  tenantId: string,
  refs: string[],
): Promise<Map<string, KgIdLookup>> {
  if (refs.length === 0) return new Map();
  const { rows } = await client.query<KgIdLookup>(
    `SELECT entity_id AS ref, id, entity_type
       FROM kg_entities
       WHERE tenant_id = $1 AND entity_id = ANY($2)`,
    [tenantId, refs],
  );
  const map = new Map<string, KgIdLookup>();
  for (const r of rows) map.set(r.ref, r);
  return map;
}

export interface ExtractionStats {
  emitted: number;
  validated: number;
  storedRelationships: number;
  storedTriples: number;
  unknownEndpoints: number;
  llmProvider: string | null;
  durationMs: number;
}

/**
 * Pass 2: run the LLM relationship extractor against a conversation chunk,
 * validate, and persist. Caller has already run the regex pass and supplies
 * the resulting entity list (with refs that map to entity_id in kg_entities).
 *
 * Caller is responsible for tenancy of the entities — we trust the supplied
 * list. We refuse to invent entities; relationships that reference unknown
 * refs are silently dropped.
 *
 * Safe to call when no API keys are set — returns stats with zeros.
 */
export async function extractRelationships(
  tenantId: string,
  conversationText: string,
  entities: EntityRef[],
  conversationId: string | null,
): Promise<ExtractionStats> {
  const start = Date.now();
  const knownRefs = new Set(entities.map((e) => e.ref));

  const { system, user } = buildExtractorPrompt(conversationText, entities);
  const result = await cascadeComplete(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { jsonMode: true, temperature: 0.0, maxTokens: 600 },
  );

  if (!result) {
    return {
      emitted: 0,
      validated: 0,
      storedRelationships: 0,
      storedTriples: 0,
      unknownEndpoints: 0,
      llmProvider: null,
      durationMs: Date.now() - start,
    };
  }

  const validated = parseAndValidate(result.content, knownRefs);
  // Re-parse without the knownRefs guard to count hallucinations for telemetry
  let unknownEndpoints = 0;
  try {
    const probe = JSON.parse(result.content) as { relationships?: unknown };
    if (Array.isArray(probe.relationships)) {
      for (const item of probe.relationships) {
        if (!item || typeof item !== "object") continue;
        const r = item as Record<string, unknown>;
        const s = typeof r.source === "string" ? r.source : null;
        const t = typeof r.target === "string" ? r.target : null;
        if ((s && !knownRefs.has(s)) || (t && !knownRefs.has(t))) unknownEndpoints++;
      }
    }
  } catch {
    /* already handled by parseAndValidate */
  }

  let storedRelationships = 0;
  let storedTriples = 0;

  if (validated.length > 0) {
    await withKgContext(tenantId, async (client) => {
      const refs = [...new Set(validated.flatMap((v) => [v.source, v.target]))];
      const kgIds = await lookupKgIds(client, tenantId, refs);

      for (const v of validated) {
        const src = kgIds.get(v.source);
        const tgt = kgIds.get(v.target);

        // Always log a triple for the audit trail
        await client.query(
          `INSERT INTO kg_triples_log
             (tenant_id, conversation_id, subject, predicate, object, confidence, source)
           VALUES ($1, $2, $3, $4, $5, $6, 'llm_relationship_extraction')`,
          [tenantId, conversationId, v.source, v.predicate, v.target, v.confidence],
        );
        storedTriples++;

        // Above the threshold AND with both endpoints in the KG, PROPOSE the
        // edge for human review (Iron Rule: an LLM-inferred edge is never an
        // auto-verified kg_relationships row). The lowercase predicate is
        // mapped to canonical; unmapped types are skipped (mapToCanonicalEdge
        // returns null). Below threshold stays triple-only.
        if (v.confidence >= HIGH_CONFIDENCE_THRESHOLD && src && tgt) {
          const edge = mapToCanonicalEdge(v.predicate);
          if (edge) {
            const source = edge.flip ? tgt : src;
            const target = edge.flip ? src : tgt;
            const proposalId = await upsertInferredProposal(client, tenantId, {
              sourceEntityId: source.id,
              sourceEntityType: source.entity_type,
              targetEntityId: target.id,
              targetEntityType: target.entity_type,
              relationshipType: edge.type,
              confidence: v.confidence,
              reasoning: `LLM relationship extraction (${result.provider}) from conversation ${conversationId ?? "?"} — original predicate "${v.predicate}".`,
              evidence: [
                {
                  evidenceType: "technician_note",
                  sourceDescription: `Diagnostic conversation ${conversationId ?? "(none)"}`,
                  confidenceContribution: v.confidence,
                },
              ],
            });
            if (proposalId) storedRelationships++;
          }
        }
      }
    });
  }

  return {
    emitted: validated.length + unknownEndpoints,
    validated: validated.length,
    storedRelationships,
    storedTriples,
    unknownEndpoints,
    llmProvider: result.provider,
    durationMs: Date.now() - start,
  };
}

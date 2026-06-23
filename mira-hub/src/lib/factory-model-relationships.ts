import type { PoolClient } from "pg";
import { upsertInferredProposal } from "@/lib/knowledge-graph/proposals-writer";

/**
 * Phase 5 PR-2 — persist Phase 1 FactoryModel relationships into the EXISTING relationship-proposal
 * workflow (`relationship_proposals` + `relationship_evidence`, via the canonical
 * `upsertInferredProposal`).
 *
 * This is necessarily a POST-APPROVAL resolver: `relationship_proposals.{source,target}_entity_id`
 * are NOT-NULL UUIDs (mig 018), so a relationship can only be proposed between entities that already
 * exist — i.e. AFTER the PR-1 asset/signal suggestions are approved (which materialises
 * `kg_entities` / `tag_entities`). Approving a proposal then mirrors it into `kg_relationships`
 * through the UNCHANGED `/api/proposals/[id]/decide` path.
 *
 * Reuses, never reinvents: the canonical writer, the canonical vocab (HAS_COMPONENT / UPSTREAM_OF /
 * HAS_SIGNAL — all in the mig-018 CHECK), the ADR-0017 transition machine, the existing `/proposals`
 * queue + decide route, `withTenantContext` RLS. No new tables, no new queue.
 *
 * PR-2 scope — `contains` + `feeds`. The spine emits:
 *   - feeds (asset → asset)     -> UPSTREAM_OF
 *   - contains (parent → child) -> HAS_COMPONENT  (hierarchy; resolves only where both are entities)
 * plus a DERIVED asset → signal containment (each signal is contained by its asset):
 *   - asset → signal            -> HAS_SIGNAL     (the "Conveyor01 contains Photoeye01" case)
 */

const BAND_TO_CONFIDENCE: Record<string, number> = {
  high: 0.85,
  medium: 0.6,
  low: 0.35,
  review: 0.3,
};

// Spine relationship rel_type -> canonical `relationship_proposals.relationship_type`.
const SPINE_REL_TO_CANONICAL: Record<string, string> = {
  feeds: "UPSTREAM_OF",
  contains: "HAS_COMPONENT",
};

export interface RelationshipSpec {
  sourceUns: string;
  targetUns: string;
  relationshipType: string; // canonical (mig-018 CHECK)
  confidence: number;
  reasoning: string;
  spineType: string; // "feeds" | "contains" | "has_signal" — for reporting
}

interface SpineRelationship {
  rel_type?: string;
  source_path?: string;
  target_path?: string;
  suggestion?: { confidence?: string; statement?: string; status?: string };
}
interface FactoryNode {
  uns_path?: string;
  name?: string;
  level?: string;
  archetype?: string;
  suggestion?: { confidence?: string; statement?: string; status?: string };
}
interface FactoryModel {
  source?: string;
  nodes?: FactoryNode[];
  relationships?: SpineRelationship[];
}

function band(b: string | undefined): number {
  return BAND_TO_CONFIDENCE[(b ?? "").toLowerCase()] ?? 0.5;
}

/**
 * Pure, deterministic: FactoryModel -> canonical relationship specs. Emits the model's feeds/contains
 * edges plus asset->signal HAS_SIGNAL containment derived from the UNS hierarchy. Self-loops dropped.
 */
export function factoryModelToRelationshipSpecs(model: unknown): RelationshipSpec[] {
  const m = (model ?? {}) as FactoryModel;
  const nodes = Array.isArray(m.nodes) ? m.nodes : [];
  const rels = Array.isArray(m.relationships) ? m.relationships : [];
  const out: RelationshipSpec[] = [];

  // 1) emitted relationships (feeds, contains)
  for (const r of rels) {
    const src = r.source_path ?? "";
    const tgt = r.target_path ?? "";
    const spineType = (r.rel_type ?? "").toLowerCase();
    const canonical = SPINE_REL_TO_CANONICAL[spineType];
    if (!src || !tgt || !canonical || src === tgt) continue;
    out.push({
      sourceUns: src,
      targetUns: tgt,
      relationshipType: canonical,
      confidence: band(r.suggestion?.confidence),
      reasoning: r.suggestion?.statement ?? `${spineType}: ${src} -> ${tgt} (FactoryModel).`,
      spineType,
    });
  }

  // 2) derived asset -> signal containment (HAS_SIGNAL). Each signal node's asset is the asset whose
  // UNS path is the longest prefix of the signal's UNS path.
  const assets = nodes
    .filter((n) => n.level === "asset" && n.uns_path)
    .map((n) => n.uns_path as string);
  const assetByLen = [...assets].sort((a, b) => b.length - a.length);
  for (const n of nodes) {
    if (n.level !== "signal" || !n.uns_path) continue;
    const sig = n.uns_path;
    const asset = assetByLen.find((a) => sig === a || sig.startsWith(`${a}.`));
    if (!asset || asset === sig) continue;
    out.push({
      sourceUns: asset,
      targetUns: sig,
      relationshipType: "HAS_SIGNAL",
      confidence: band(n.suggestion?.confidence),
      reasoning: `Asset contains signal '${n.name ?? sig}' (UNS hierarchy).`,
      spineType: "has_signal",
    });
  }

  return out;
}

export interface RelationshipWriteResult {
  created: { sourceUns: string; targetUns: string; relationshipType: string; proposalId: string }[];
  skipped: { sourceUns: string; targetUns: string; relationshipType: string; reason: string }[];
  unresolved: { sourceUns: string; targetUns: string; relationshipType: string; missing: string }[];
}

/** Resolve a UNS path to an already-approved entity {id,type}: kg_entities (equipment) or tag_entities (tag). */
async function resolveEntity(
  client: PoolClient,
  tenantId: string,
  unsPath: string,
): Promise<{ id: string; type: string } | null> {
  const kg = await client.query<{ id: string }>(
    `SELECT id FROM kg_entities
      WHERE tenant_id = $1::uuid AND uns_path = $2::ltree AND approval_state = 'verified'
      LIMIT 1`,
    [tenantId, unsPath],
  );
  if (kg.rows[0]) return { id: kg.rows[0].id, type: "equipment" };
  const tag = await client.query<{ id: string }>(
    `SELECT id FROM tag_entities
      WHERE tenant_id = $1::uuid AND uns_path = $2::ltree AND approval_state = 'verified'
      LIMIT 1`,
    [tenantId, unsPath],
  );
  if (tag.rows[0]) return { id: tag.rows[0].id, type: "tag" };
  return null;
}

/**
 * Resolve each spec's endpoints to existing entities and create a relationship proposal via the
 * canonical `upsertInferredProposal` (which writes relationship_proposals at status='proposed',
 * requires_human_review=true, + 1..N relationship_evidence rows, idempotently). Endpoints that are
 * not yet approved entities are reported `unresolved` (re-run after approving them). Must run inside
 * `withTenantContext` (RLS set), as `upsertInferredProposal` requires.
 */
export async function writeRelationshipProposals(
  client: PoolClient,
  tenantId: string,
  specs: RelationshipSpec[],
): Promise<RelationshipWriteResult> {
  const result: RelationshipWriteResult = { created: [], skipped: [], unresolved: [] };
  const cache = new Map<string, { id: string; type: string } | null>();
  const resolve = async (uns: string) => {
    if (!cache.has(uns)) cache.set(uns, await resolveEntity(client, tenantId, uns));
    return cache.get(uns)!;
  };

  for (const spec of specs) {
    const key = {
      sourceUns: spec.sourceUns,
      targetUns: spec.targetUns,
      relationshipType: spec.relationshipType,
    };
    const s = await resolve(spec.sourceUns);
    const t = await resolve(spec.targetUns);
    if (!s || !t) {
      result.unresolved.push({ ...key, missing: !s && !t ? "both" : !s ? "source" : "target" });
      continue;
    }
    if (s.id === t.id) {
      result.skipped.push({ ...key, reason: "self-loop" });
      continue;
    }
    const proposalId = await upsertInferredProposal(client, tenantId, {
      sourceEntityId: s.id,
      sourceEntityType: s.type,
      targetEntityId: t.id,
      targetEntityType: t.type,
      relationshipType: spec.relationshipType,
      confidence: spec.confidence,
      reasoning: spec.reasoning,
      evidence: [
        {
          evidenceType: "manifest",
          sourceDescription: "FactoryModel import (factory_context)",
          excerpt: spec.reasoning,
          confidenceContribution: spec.confidence,
        },
      ],
    });
    if (proposalId) result.created.push({ ...key, proposalId });
    else result.skipped.push({ ...key, reason: "already exists / verified" });
  }
  return result;
}

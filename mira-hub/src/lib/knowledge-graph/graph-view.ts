// src/lib/knowledge-graph/graph-view.ts
/**
 * Pure transform from KG table rows into the {nodes, links} shape every
 * force-graph library consumes. No DB, no IO — unit-tested in isolation.
 * Degree is precomputed server-side so the client just maps nodeVal.
 */

import { canonicalizeRelationshipType } from "./canonical-relationship-type";

export interface EntityRow {
  id: string;
  entity_type: string;
  name: string | null;
  uns_path: string | null;
  /** Domain key (kg_entities.entity_id) — bridges to assets/CMMS. Optional in the payload. */
  entity_id?: string | null;
}

export interface RelRow {
  source_id: string;
  target_id: string;
  relationship_type: string;
  confidence: number | null;
  approval_state: string | null;
  proposal_id?: string | null;
  reasoning?: string | null;
  /** Short evidence snapshot on a verified edge (kg_relationships.evidence_summary). */
  evidence_summary?: string | null;
}

export interface GraphNode {
  id: string;
  type: string;
  label: string;
  degree: number;
  unsPath: string | null;
  /** Domain key (kg_entities.entity_id). Bridges to assets/CMMS; present when the row carries one. */
  entityId?: string;
  /** PageRank influence (0..1), attached only when ?analysis=true. */
  centrality?: number;
  /** Louvain community id, attached only when ?analysis=true. */
  community?: number;
}

export interface GraphLink {
  source: string;
  target: string;
  type: string;
  confidence: number;
  state: string;
  proposalId?: string;
  reasoning?: string;
  /** Short evidence snapshot shown when a verified edge is inspected. */
  evidenceSummary?: string;
}

export interface GraphPayload {
  nodes: GraphNode[];
  links: GraphLink[];
}

export function buildGraphPayload(entities: EntityRow[], rels: RelRow[]): GraphPayload {
  const nodes = new Map<string, GraphNode>();
  for (const e of entities) {
    const node: GraphNode = {
      id: e.id,
      type: e.entity_type,
      label: e.name && e.name.length > 0 ? e.name : e.id,
      degree: 0,
      unsPath: e.uns_path,
    };
    if (e.entity_id) node.entityId = e.entity_id;
    nodes.set(e.id, node);
  }

  const links: GraphLink[] = [];
  for (const r of rels) {
    const src = nodes.get(r.source_id);
    const tgt = nodes.get(r.target_id);
    if (!src || !tgt) continue; // drop dangling edges
    src.degree += 1;
    tgt.degree += 1;
    const link: GraphLink = {
      source: r.source_id,
      target: r.target_id,
      // Display-layer canonicalization only: folds lowercase writer output
      // (e.g. relationship_proposals' `has_component`) and the UPPERCASE
      // canonical form (kg_relationships' `HAS_COMPONENT`) into one label so
      // the graph doesn't show the same edge type twice. Never touches the
      // underlying row / write path.
      type: canonicalizeRelationshipType(r.relationship_type),
      confidence: r.confidence ?? 1,
      state: r.approval_state ?? "verified",
    };
    if (r.proposal_id) link.proposalId = r.proposal_id;
    if (r.reasoning) link.reasoning = r.reasoning;
    if (r.evidence_summary) link.evidenceSummary = r.evidence_summary;
    links.push(link);
  }

  return { nodes: [...nodes.values()], links };
}

/**
 * Which guidance the relationship-graph page should show, given edge counts.
 * Pure so it can be unit-tested without rendering the client component (#1984).
 *
 * - "guidance": no edges at all — nodes may exist but nothing is linked, so
 *   the page shows actionable next steps (upload manuals → confirm proposals).
 * - "review-suggestions": MIRA has proposed edges but none are verified yet —
 *   the thin banner nudges the tech to review them.
 * - "none": verified edges exist; the graph speaks for itself.
 */
export function kgMapDisplayState(
  verifiedCount: number,
  proposedCount: number,
): "guidance" | "review-suggestions" | "none" {
  if (verifiedCount > 0) return "none";
  if (proposedCount > 0) return "review-suggestions";
  return "guidance";
}

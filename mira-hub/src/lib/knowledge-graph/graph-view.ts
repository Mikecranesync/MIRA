// src/lib/knowledge-graph/graph-view.ts
/**
 * Pure transform from KG table rows into the {nodes, links} shape every
 * force-graph library consumes. No DB, no IO — unit-tested in isolation.
 * Degree is precomputed server-side so the client just maps nodeVal.
 */

export interface EntityRow {
  id: string;
  entity_type: string;
  name: string | null;
  uns_path: string | null;
}

export interface RelRow {
  source_id: string;
  target_id: string;
  relationship_type: string;
  confidence: number | null;
  approval_state: string | null;
}

export interface GraphNode {
  id: string;
  type: string;
  label: string;
  degree: number;
  unsPath: string | null;
}

export interface GraphLink {
  source: string;
  target: string;
  type: string;
  confidence: number;
  state: string;
}

export interface GraphPayload {
  nodes: GraphNode[];
  links: GraphLink[];
}

export function buildGraphPayload(entities: EntityRow[], rels: RelRow[]): GraphPayload {
  const nodes = new Map<string, GraphNode>();
  for (const e of entities) {
    nodes.set(e.id, {
      id: e.id,
      type: e.entity_type,
      label: e.name && e.name.length > 0 ? e.name : e.id,
      degree: 0,
      unsPath: e.uns_path,
    });
  }

  const links: GraphLink[] = [];
  for (const r of rels) {
    const src = nodes.get(r.source_id);
    const tgt = nodes.get(r.target_id);
    if (!src || !tgt) continue; // drop dangling edges
    src.degree += 1;
    tgt.degree += 1;
    links.push({
      source: r.source_id,
      target: r.target_id,
      type: r.relationship_type,
      confidence: r.confidence ?? 1,
      state: r.approval_state ?? "verified",
    });
  }

  return { nodes: [...nodes.values()], links };
}

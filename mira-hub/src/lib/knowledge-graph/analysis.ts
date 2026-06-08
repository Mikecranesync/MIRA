// src/lib/knowledge-graph/analysis.ts
/**
 * Pure graph analysis over a {nodes, links} payload — PageRank centrality
 * (node influence) + Louvain community detection (natural clusters). No DB,
 * no IO; unit-tested in isolation like graph-view.ts.
 *
 * Borrowed in spirit from Graphify's God-Node / community analysis
 * (tools/orchestrator/kg_query.py), but applied to the LIVE customer KG, not
 * the codebase — and TS-native (graphology, MIT) so it runs in the Next API
 * route with no Python service. See docs/specs/kg-graph-analysis-layer-spec.md.
 *
 * Degenerate-graph guard: on a graph below MIN_EDGES_FOR_ANALYSIS, Louvain
 * collapses to singletons and PageRank goes flat — meaningless. We return
 * `available: false` rather than presenting noise as insight. Most tenants are
 * sparse today; the densest (demo) tenant clears the bar.
 */
import Graph from "graphology";
import louvain from "graphology-communities-louvain";
import pagerank from "graphology-metrics/centrality/pagerank";
import type { GraphPayload } from "./graph-view";

/** Below this many (deduped, non-loop) edges, analysis is not meaningful. */
export const MIN_EDGES_FOR_ANALYSIS = 20;

export interface NodeStat {
  /** PageRank influence, normalized 0..1 by the graph max. */
  centrality: number;
  /** Louvain community id (integer). */
  community: number;
}

export interface GodNode {
  id: string;
  label: string;
  centrality: number;
}

export interface GraphAnalysis {
  available: boolean;
  edgeCount: number;
  minEdges: number;
  /** Per-node stats keyed by node id. Empty when `available` is false. */
  stats: Record<string, NodeStat>;
  /** Number of real clusters (communities with ≥2 members; singletons excluded). */
  communityCount: number;
  /** Top nodes by centrality (the knowledge hubs). Empty when unavailable. */
  godNodes: GodNode[];
}

const endId = (v: unknown): string =>
  typeof v === "string" ? v : (v as { id: string }).id;

function unavailable(edgeCount: number): GraphAnalysis {
  return {
    available: false,
    edgeCount,
    minEdges: MIN_EDGES_FOR_ANALYSIS,
    stats: {},
    communityCount: 0,
    godNodes: [],
  };
}

export function analyzeGraph(payload: GraphPayload, godNodeLimit = 10): GraphAnalysis {
  const g = new Graph({ type: "undirected" });
  const labelById = new Map<string, string>();
  for (const n of payload.nodes) {
    if (!g.hasNode(n.id)) g.addNode(n.id);
    labelById.set(n.id, n.label);
  }

  // Collapse parallel edges and self-loops — for clustering/centrality the KG
  // is treated as an undirected simple graph.
  for (const l of payload.links) {
    const s = endId(l.source);
    const t = endId(l.target);
    if (s === t) continue;
    if (!g.hasNode(s) || !g.hasNode(t)) continue; // drop dangling
    g.mergeEdge(s, t);
  }

  const edgeCount = g.size;
  if (edgeCount < MIN_EDGES_FOR_ANALYSIS) return unavailable(edgeCount);

  // Louvain: { nodeId -> communityId }
  const communities = louvain(g) as Record<string, number>;
  // PageRank: { nodeId -> score }
  const ranks = pagerank(g) as Record<string, number>;

  let maxRank = 0;
  for (const id in ranks) if (ranks[id] > maxRank) maxRank = ranks[id];
  const norm = maxRank > 0 ? maxRank : 1;

  const stats: Record<string, NodeStat> = {};
  const communitySizes = new Map<number, number>();
  g.forEachNode((id) => {
    const community = communities[id] ?? 0;
    communitySizes.set(community, (communitySizes.get(community) ?? 0) + 1);
    stats[id] = { centrality: (ranks[id] ?? 0) / norm, community };
  });
  // Real customer graphs are fragmented forests (many orphans + 2-node stars).
  // A singleton "community" isn't a cluster — counting them inflates the
  // headline number into a fragmentation artifact. Count only communities with
  // ≥2 members so the displayed cluster count is honest.
  let communityCount = 0;
  for (const size of communitySizes.values()) if (size >= 2) communityCount += 1;

  const godNodes: GodNode[] = g
    .nodes()
    .map((id) => ({ id, label: labelById.get(id) ?? id, centrality: stats[id].centrality }))
    .sort((a, b) => b.centrality - a.centrality)
    .slice(0, godNodeLimit);

  return {
    available: true,
    edgeCount,
    minEdges: MIN_EDGES_FOR_ANALYSIS,
    stats,
    communityCount,
    godNodes,
  };
}

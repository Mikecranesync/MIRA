# Knowledge-Graph Analysis Layer Spec

**Status:** PROPOSED 2026-06-07 by Claude (CHARLIE) on behalf of Mike Harper
**Targets:** `mira-hub` — additive feature on the existing `/knowledge/map` surface
**Depends on:** `/api/kg/graph` route, `mira-hub/src/lib/knowledge-graph/graph-view.ts`, `GraphCanvas.tsx`
**Stack constraints:** TypeScript-native (no Python service, no new datastore). Postgres (NeonDB) reads only. Libraries MIT-licensed (PRD §4).

---

## 0. TL;DR

This adds **graph-analysis insight** (PageRank centrality + Louvain community detection) to the live, per-tenant knowledge graph and renders it through the **existing** `react-force-graph-2d` canvas — node **size** scales by centrality, an opt-in **community** coloring groups the graph, and a small **"key assets" (God-Nodes)** panel surfaces the most-connected nodes.

It is **not** a Graphify replacement. The evaluation that produced this spec concluded Graphify is a *code-comprehension* tool (static HTML, source-code input, vis-network) and cannot replace the Command Center (a UNS tree + live-telemetry surface) or the `/knowledge/map` renderer (live, multi-tenant, mutable, evidence-backed). The one thing worth borrowing from Graphify is its **analysis algorithms** — applied to the customer KG, not the codebase. This spec borrows the *algorithms*, not the tool.

## 1. Why

`/knowledge/map` today sizes nodes only by raw **degree** and has no concept of **community structure** or **centrality**. As a tenant's graph densifies (ingest → proposals → verified edges), "which assets are the hubs of this plant's knowledge?" and "what natural clusters exist?" become answerable questions the current renderer can't show.

Graphify already demonstrates the value of this analysis on the *code* graph (`tools/orchestrator/kg_query.py` → `god_nodes()`, communities in `GRAPH_REPORT.md`). This spec brings the equivalent to the *customer* graph.

## 2. Data reality (measured 2026-06-07, dev branch `ep-lingering-salad`)

| Tenant | `kg_entities` | verified `kg_relationships` |
|---|---|---|
| `78917b56-…` (demo/seed) | **576** | **287** |
| `00000000-…00d1` | 14 | 12 |
| `e88bd0e8-…` | 13 | 0 |
| `06d0cf15-…` | 9 | 0 |

**Implication — non-negotiable:** the densest tenant clears the edge threshold; every other tenant is **degenerate** (Louvain → all singletons, PageRank → ~flat). Therefore:

1. The API computes analysis only when the graph clears a **minimum-edge threshold** (`MIN_EDGES_FOR_ANALYSIS = 20`). Below it, analysis is **unavailable**, not wrong.
2. The UI must render a graceful **"not enough connected data yet — N edges, need ~M"** state, never a degenerate blob presented as insight.
3. Tests must exercise **both** a dense fixture (real structure) and a realistic-sparse fixture (below threshold → unavailable).

### 2.1 Measured reality on the demo tenant (run the analysis, don't trust the row count)

Running the actual PageRank + Louvain pass against the 576-node / 287-edge demo tenant (2026-06-07) revealed the row count **overstates** the structure:

- **289 raw communities** → only **274 with ≥2 members** (15 singleton orphans), and the **largest cluster is 3 nodes.**
- The graph is a **fragmented forest** of `equipment → manual` pairs and `equipment → manual + part` triples. There is **no macro-structure** — almost no `equipment ↔ equipment` or shared-component edges exist yet.
- PageRank is therefore near-flat (the top God-Nodes tie at 100% because each is the hub of its own tiny star).

**Consequences baked into this spec:**

- `communityCount` counts **only communities with ≥2 members** — a raw count is a fragmentation artifact (mostly orphans), not a cluster count.
- The **God-Nodes / "Key assets"** panel is the genuinely useful output today: it correctly surfaces the most-documented assets (Phoenix-Contact QUINT, Allen-Bradley CompactLogix, Square-D QO, …). **Size-by-influence** and **color-by-cluster** are near-noise on today's data (274 micro-clusters cycling a 10-color palette) and only become insightful once cross-asset edges densify.
- Honest framing, not hidden: this layer is **ready for when the data is ready.** The lever that makes it pay off is **ingest → cross-asset proposals**, not this renderer. Shipping it now is cheap, correct, and opt-in; it does not manufacture insight the data doesn't contain.

## 3. Non-goals

- ❌ Not replacing Graphify (keep it for code comprehension / orchestrator-pulse).
- ❌ Not replacing the Command Center (UNS tree + telemetry — different surface entirely).
- ❌ No betweenness centrality (O(V·E), slow at the 5000-node cap, degenerate on sparse graphs).
- ❌ No cycle / SCC detection ("import cycles" is a code concept; an SCC on an asset graph is near-meaningless).
- ❌ No Python service, no networkx, no new dependency that isn't MIT/Apache-2.0.
- ❌ No change to the **default** map load path (analysis is opt-in and lazily fetched).

## 4. Design

### 4.1 Library

`graphology` + `graphology-communities-louvain` + `graphology-metrics` (PageRank). All MIT (verified in each package's `package.json` before merge). TS-native → runs in the existing Next.js API route, no new infra.

### 4.2 Pure analysis lib — `mira-hub/src/lib/knowledge-graph/analysis.ts`

Mirrors the `graph-view.ts` pattern: **pure, no IO, unit-tested in isolation.**

```ts
export interface NodeStat { centrality: number; community: number; }
export interface GraphAnalysis {
  available: boolean;
  edgeCount: number;
  minEdges: number;            // MIN_EDGES_FOR_ANALYSIS
  stats: Record<string, NodeStat>;  // by node id (empty when unavailable)
  communityCount: number;
  godNodes: { id: string; label: string; centrality: number }[]; // top 10
}

export function analyzeGraph(payload: GraphPayload): GraphAnalysis;
```

- Build an **undirected** graphology `Graph` from `payload` (KG relationships are semantically bidirectional for clustering).
- Below `MIN_EDGES_FOR_ANALYSIS` → return `{ available:false, edgeCount, minEdges, stats:{}, communityCount:0, godNodes:[] }`.
- Else: `pagerank` → `centrality` (normalized 0..1 by max); `louvain` → `community` (integer id); `godNodes` = top-10 by centrality.

### 4.3 API — extend `GET /api/kg/graph?analysis=true`

- Default (no flag) → unchanged payload, **no compute** (protects the common load).
- With `analysis=true` → after `buildGraphPayload`, run `analyzeGraph`, attach `centrality` + `community` to each node, and add a top-level `analysis: GraphAnalysis` summary (minus per-node `stats`, which is folded into nodes).
- Session-authed + `withTenantContext` (unchanged). Same 5000-node / 20000-edge caps.

### 4.4 Types — `graph-view.ts`

Extend `GraphNode` with optional `centrality?: number; community?: number;` — additive, backward-compatible.

### 4.5 Renderer — `GraphCanvas.tsx`

Two new **optional** props, both defaulting to current behavior:

- `sizeBy?: "degree" | "centrality"` (default `"degree"`). Centrality mode maps `node.centrality` → radius.
- `colorBy?: "type" | "community"` (default `"type"`). **`"type"` stays default so the "RED IS RESERVED FOR FAULTS" invariant holds.** `"community"` is an explicit analysis view using a categorical palette keyed by `community`.

### 4.6 Map page — `/knowledge/map`

- New **"Analysis"** control group (in the existing left panel): `Size by influence` toggle, `Color by cluster` toggle. Flipping either ON triggers a **lazy** fetch of `/api/kg/graph?includeProposals=true&analysis=true` (cached after first fetch).
- New **"Key assets"** panel: top God-Nodes (clickable → selects the node), plus `N clusters` count. Hidden when `analysis.available === false`.
- **Low-data state:** when analysis is requested but `available === false`, show "Not enough connected data for analysis yet — {edgeCount} edges, need ~{minEdges}." and leave the graph in default degree/type mode.
- Node detail panel: show `influence` (centrality) and `cluster` (community) when present.

## 5. Acceptance criteria

1. `analysis.test.ts` passes: dense fixture → `available:true`, ≥2 communities, monotone centrality; sparse fixture (< threshold) → `available:false`, empty stats. **Both** cases asserted.
2. `/api/kg/graph` with no flag returns the **byte-identical** payload shape as today (no `analysis` key, no per-node `centrality`).
3. `/api/kg/graph?analysis=true` on the demo tenant returns `analysis.available:true`, `communityCount ≥ 2`, ≥1 God-Node.
4. Default map load issues **no** analysis compute; toggling Analysis on fetches once and renders centrality sizing + community color.
5. Fault-red invariant holds in default (`type`) color mode.
6. `bun run typecheck` + `bun run lint` + `bun test` green. All three analysis deps MIT.

## 6. Out of future scope (noted, not built)

- Port community **labels** (Graphify uses an LLM; here communities are numbered — labeling could come later from dominant UNS path or entity types).
- Centrality on the **Command Center** tree (different surface; would annotate subtree importance).
- Persisting analysis (currently recomputed per request; cache if it ever gets slow above the cap).

# Live Relationship Graph for the Command Center — Design

**Date:** 2026-06-02
**Status:** Design approved, ready for plan
**Target surface:** FactoryLM Hub (`mira-hub`, Next.js) — a new `/hub/graph` module
**Graph source:** the production knowledge graph in NeonDB (`kg_entities` / `kg_relationships`)
**Companion brief:** `MIRA_PLC/specs/FactoryLM_Hub_Command_Center_Brief.typ`

---

## Why this matters (read this first)

A maintenance technician's question is rarely about one fact. It is "this drive keeps
faulting — what causes ErrorID 55, has it happened on the identical drive on Line 2, and
what fixed it last time?" Answering that means **walking relationships**: fault → cause →
remedy → part, and equipment → same-model → other equipment → its history. A node alone is a
fact; **an edge is a reasoning path.** The intelligence of the system lives in its edges, not
its nodes.

We already have the graph that the AI agents traverse. What we do **not** have is (a) a way
for a human to *see* that web live in the Command Center, and (b) enough edges in it for the
web to be worth seeing. Today the graph is 578 nodes but only 289 edges, and **269 of those
289 (93%) are a single relationship type** (`has_manual`) — equipment-to-manual star pairs.
The richer relationships are defined in the schema but sit unpopulated or unapproved.

This design does three things, in plain terms:

1. **Explains** how connections are created in the KG and what they are used for.
2. **Draws** the connections that already exist — live, in the Hub, Obsidian-style.
3. **Enriches** the web so the relationships that make it intelligent actually exist.

The model is Obsidian's graph view and the "Karpathy wiki" / evergreen-notes principle:
*link density, not the notes themselves, is the asset.* Our industrial version of Obsidian's
"unlinked mentions" is the existing **proposals queue** — candidate edges waiting for a human
to promote them.

---

## Part 1 — How connections are created and used (the explainer)

### Where connections live

| Table | Role |
|---|---|
| `kg_entities` | Nodes. `entity_type` (equipment, manual, fault_code, work_order, part, component, plant/area/line, …), `name`, `properties JSONB`, per-tenant RLS. |
| `kg_relationships` | **Edges.** `source_id`, `target_id`, `relationship_type`, `confidence (0–1)`, `approval_state` (proposed/verified/rejected/needs_review), `proposed_by` (`llm:groq`, `human:user_…`), `evidence_summary`. |
| `relationship_proposals` + `relationship_evidence` | Candidate edges before promotion, each with an evidence chain (document page, PLC rung, work order, technician note, live data…). The industrial "unlinked mention." |
| `kg_triples_log` | Low-confidence / unvetted assertions parked before promotion. |
| `kg_asset_hierarchy` (view) | Recursive CTE over `parent_of` + `has_component` → ISA-95 roll-up/drill-down with cycle protection. |

Relationship types already defined in `types.ts`: `parent_of`, `has_component`, `located_at`,
`has_work_order`, `has_pm`, `caused_by`, `resolved_by`, `requires_part`, `had_fault`,
`feeds`, `similar_to`, `electrically_connected`, `controls`, `protects`,
`references_drawing`, `instance_of`, and more (30+ in the proposal allow-list).

### The four pathways that create edges

| Pathway | What it creates | Confidence / gate | Source file |
|---|---|---|---|
| **CMMS auto-sync** | `equipment→located_at→site`, `→has_work_order`, `→has_pm` | 1.0, auto-verified | `mira-hub/src/lib/knowledge-graph/cmms-sync.ts` |
| **LLM extractor** (after a diagnostic chat) | `caused_by`, `resolved_by`, `feeds`, `requires_part`, `triggered_pm`, `had_fault` (6 allow-listed) | ≥0.6 → `kg_relationships`; else `kg_triples_log` | `…/relationship-extractor.ts` |
| **Human proposals queue** | structural: `has_component`, `wired_to`, `instance_of`, `references_drawing` (from schematics, OCR, manuals) | proposed → human **Verify** → promoted | `db/migrations/018_relationship_proposals.sql`, `…/api/proposals/[id]/decide` |
| **Manual binding** | `has_manual` (bulk fuzzy match model→manual) | 1.0 | (ingest/curation) |

**Why the web is thin:** CMMS sync only emits 3 edge types; the structural edges that would
make the graph dense are stuck in the proposals queue awaiting approval; the LLM extractor
only fires when a diagnostic conversation happens; so the only densely-created edge is
`has_manual`. The edges are *queued or unenabled, not impossible.*

### How the agents actually use the graph (what they "see")

Agents do **not** read raw tables. They call `/api/internal/kg` (8 operations), exposed as 8
MCP tools (`mira-mcp/server.py`):

- `kg_maintenance_context` — given equipment, gather hierarchy + components + recent faults +
  work orders + parts + manuals + PM schedule in one call.
- `kg_impact_analysis` — walk `feeds` forward → what downstream is blocked.
- `kg_root_cause_chain` — walk `caused_by` backward → cause chain + sibling alternates.
- `kg_traverse_chain` — follow a fixed predicate sequence (e.g. `parent_of, parent_of,
  has_component`) from plant to every component.
- `kg_flag_pm_mismatches`, `mira_browse_namespace`, `mira_get_equipment`,
  `kg_extract_schematic`.

All traversals are PostgreSQL recursive CTEs with cycle protection (`traversal.ts`). **This is
"the underlying background connections that the agents actually see and use."** The live
visual we build queries the *same* edges, so what the human sees == what the agent reasons over.

### What the edges are for: GraphRAG

Plain vector RAG retrieves similar text chunks. **GraphRAG** traverses typed edges, so it can
answer multi-hop questions that no single chunk contains, with fewer hallucinations and — the
part that matters for safety — a **traceable citation: the path itself.** "ErrorID 55 →
`caused_by` → RS-485 response-delay too fast → `resolved_by` → set P09.09=10ms" is an answer a
technician can trust because they can see the chain. This is the payoff that makes drawing and
enriching the graph worth doing.

---

## Part 2 — The visual (drawing the connections, live)

### Approach (chosen: A)

A new **`/hub/graph`** page backed by a new **`GET /api/kg/graph`** endpoint, rendered with
**`react-force-graph-2d`** (vasturiano) imported via `next/dynamic` with `ssr:false`. It
mirrors Obsidian:

- **Degree-based node sizing** (precomputed server-side), **color-by-`entity_type`**.
- **Global view** + **click-to-expand local graph** (N-hop neighborhood, like Obsidian's depth
  slider) instead of loading everything.
- **Search** to seed the focus node; **type/predicate filters**; **orphan toggle**.
- **Click → detail panel** reusing `mira_get_equipment` / entity properties.
- **Dashed "suggested" edges** drawn from the proposals queue; one-click **Verify** promotes a
  proposal to a solid edge — the industrial "unlinked mention" promotion.
- **3D toggle** reusing the proven `3d-force-graph` for demo flair (same data).

Rejected alternatives:
- **B — iframe the existing static `kg_relationship_sphere.html`:** fast but a dead snapshot;
  doesn't solve "live" or interactivity. Acceptable only as a stopgap.
- **C — Sigma.js + graphology (WebGL):** the right escape hatch above ~10k visible nodes
  (in-browser Louvain communities); overkill at ~600 nodes today.

### API shape

```
GET /api/kg/graph?focus=<entityId>&depth=<n>&types=<csv>&includeProposals=<bool>
→ { "nodes": [ { id, type, label, degree, unsPath } ],
    "links": [ { source, target, type, confidence, state } ] }
```

Backed by the existing `traversal.ts` CTEs. `state: "verified" | "proposed"` drives
solid-vs-dashed rendering. Degree precomputed in the query so the client just maps `nodeVal`.

---

## Part 3 — Enriching the web (making relationships exist)

Two kinds of new edges:

**a) Promote what's already queued.** Run the structural extractors (schematic / manual /
namespace) so `has_component`, `instance_of`, `located_at`, `feeds` land as proposals, then
clear the approval queue. These already have code paths — this is throughput, not new logic.

**b) Infer new edges (the unlinked-mention analog), as proposals:**
- `same_model_as` — group `kg_entities` of type equipment by `properties.manufacturer +
  model`; propose an edge between identical units. Answers "has this failure happened on an
  identical drive elsewhere?"
- `co_failed_with` — from work-order co-occurrence (two assets repeatedly in the same
  outage/WO window); surfaces hidden failure correlations.

Both are written with `confidence < 1`, `created_by='rule'`, `requires_human_review=true`, so
they flow through the **existing** proposal/approval machinery — no new trust path, full
auditability. In the UI they appear as dashed suggestions the user promotes.

---

## Phased plan

| Phase | Goal | Acceptance | Skills / sub-agents |
|---|---|---|---|
| **0 — Explain & make safe** | This spec + the connection-model explainer, committed | Spec on branch, pointer in MIRA_PLC | writing-plans, elements-of-style |
| **1 — Render existing edges LIVE** | `/api/kg/graph` + `/hub/graph` page | The real 289 edges render live from Neon; search + click-to-expand + detail panel work | feature-dev, test-driven-development, verification-before-completion |
| **2 — Enrich the web** | Clear proposal queue; infer `same_model_as` + `co_failed_with` as proposals; dashed suggestions promotable in UI | Non-`has_manual` edge share rises materially; suggested edges appear and promote correctly | dispatching-parallel-agents (one agent per edge type / inference) |
| **3 — Close the loop to intelligence** | Wire the graph into Ask MIRA (Local + Global GraphRAG); highlight the subgraph MIRA traversed to answer | An answer shows its traversal path on the graph | ai:claude-api |
| **4 — Live & embedded** | SSE deltas; community clustering for readability; focused mini-graph on each Asset page | Graph updates without full reload; per-asset neighborhood embeds | subagent-driven-development, requesting-code-review |

### Build sequence for Phase 1 (the first plan)

1. `GET /api/kg/graph` endpoint over `traversal.ts` (nodes+links+degree+state). TDD.
2. `npm install react-force-graph-2d`; `GraphCanvas.tsx` (dynamic, ssr:false).
3. `/hub/graph/page.tsx`: search seed → focus, force graph, color-by-type, degree sizing.
4. Detail panel (reuse `mira_get_equipment`), type filters, orphan toggle.
5. Click-to-expand neighborhood (depth+1 fetch, merge into in-memory graph).
6. Verify against live Neon snapshot; screenshot; request code review before merge.

---

## Risks / open questions

- **Tenant scoping:** every query is per-`tenant_id` (RLS). The graph page must take tenant
  from session, never a client param. (Carry into the plan.)
- **Inference precision:** `co_failed_with` from WO co-occurrence can be noisy — start with a
  high co-occurrence threshold and require human approval (it already does).
- **Performance:** ~600 nodes is trivial for `react-force-graph-2d`; revisit Sigma.js only if a
  single tenant's graph passes ~10k visible nodes.
- **Cross-repo:** the static export lives in `MIRA_PLC/specs/`; the live feature lives here in
  `mira-hub`. This spec is the bridge; a pointer is kept in `MIRA_PLC/specs/`.

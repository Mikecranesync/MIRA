# ADR-0020: Address knowledge to namespace nodes via a link table (keyed on node_id)

**Status:** ❌ SUPERSEDED by ADR-0019 (mira-ingest-v2), before implementation (2026-05-29).
**Relates to:** ADR-0013 (kg/cmms canonicalization), ADR-0019 (mira-ingest-v2)
**Spec:** `docs/specs/uns-node-centric-knowledge-spec.md`

> **Superseded — do not implement.** Two findings killed this design:
> 1. Its premise was wrong: Hub/web uploads (`mira-core/mira-ingest/main.py::ingest_document_kb`)
>    write **only Open WebUI's KB**, never `knowledge_entries` — so there were no rows to link. All
>    retrieval (Hub `lib/manual-rag.ts` + bot `neon_recall.py`) reads only `knowledge_entries`.
> 2. The foundational fix already exists as **ADR-0019 mira-ingest-v2** (Accepted 2026-05-26): it
>    writes drop chunks into `knowledge_entries` with `doc_id = hub_uploads.id` + `ingest_route`, and
>    `hub_uploads.kg_entity_id` points at the tech-confirmed `kg_entities` node (which carries
>    `uns_path` ltree). So the chunk→node address already exists: **`knowledge_entries.doc_id →
>    hub_uploads.kg_entity_id → kg_entities.uns_path`** — no separate link table. A `knowledge_node_links`
>    sibling table is exactly the dual-truth pattern ADR-0019 rejects. Node-subtree retrieval rides
>    the existing `kg_entities` GIST `uns_path <@` index over that chain. See the spec for the Hub
>    front-door + subtree-chat layer built on the ADR-0019 schema.

## Context

We want "folder = brain": attach a document to a `/namespace` node so it's indexed and citable, and
Ask-MIRA at a node grounds in that node's subtree. The open question is **how a `knowledge_entries`
chunk becomes addressable by a namespace node** (`kg_entities`, which carries a `uns_path` ltree with a
GIST index already tuned for `tenant_id = X AND uns_path <@ Y`).

Constraints:
- Namespace nodes are **mutable**: drag-to-reparent changes a node's `uns_path` (and all descendants').
  An address stored as a raw path string goes stale on reparent.
- `knowledge_entries` is the shared, tenant-scoped BM25 corpus also used by the asset-card chat via
  **manufacturer/model match** — that path must keep working untouched.
- A single document may legitimately belong to more than one node (same OEM manual referenced by two
  installs).
- UNS-031 (BLOCKING): the migration goes dev → staging → prod via `apply-migrations.yml`.

## Decision

Add a **link table** that associates a knowledge chunk with a namespace node **by `node_id`** (FK to
`kg_entities.id`), not by a stored path:

```sql
-- mira-hub/db/migrations/0NN_knowledge_node_links.sql
CREATE TABLE knowledge_node_links (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL,
  node_id            uuid NOT NULL REFERENCES kg_entities(id) ON DELETE CASCADE,
  knowledge_entry_id uuid NOT NULL REFERENCES knowledge_entries(id) ON DELETE CASCADE,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (node_id, knowledge_entry_id)
);
CREATE INDEX idx_knl_tenant_node ON knowledge_node_links (tenant_id, node_id);
CREATE INDEX idx_knl_entry       ON knowledge_node_links (knowledge_entry_id);
```

**Subtree retrieval resolves the path live** (so it survives reparents) using the existing
`kg_entities` GIST index:

```sql
-- chunks linked to any node in the selected node's subtree
SELECT ke.*
FROM knowledge_node_links knl
JOIN knowledge_entries ke ON ke.id = knl.knowledge_entry_id
WHERE knl.tenant_id = $tenant
  AND knl.node_id IN (
    SELECT id FROM kg_entities
    WHERE tenant_id = $tenant
      AND uns_path <@ (SELECT uns_path FROM kg_entities WHERE id = $node AND tenant_id = $tenant)
  );
-- BM25 ranking layered on top per lib/manual-rag.ts
```

## Alternatives considered

- **A. `uns_path ltree` column on `knowledge_entries`.** Simplest query (`WHERE uns_path <@ $node`), but
  (1) goes stale on reparent unless every chunk is rewritten when a node moves; (2) alters the shared
  corpus table; (3) one address per row makes multi-node attachment awkward. Rejected for reparent
  fragility + corpus-table coupling.
- **C. Reuse `kg_entities.source_chunk_id`** (migration 024). That's entity→one-chunk (provenance of an
  extracted entity), the inverse of node→many-docs. Doesn't fit; leave it for its current purpose.
- **B (chosen) link table by node_id.** Survives reparent (node_id stable; path resolved at query time),
  supports multi-node, leaves the corpus table and its manufacturer-match path untouched. Cost: one join.

## Consequences

- **Positive:** reparent-safe; corpus + asset-chat unaffected; multi-node docs supported; reuses the
  existing GIST subtree index (no new index on the big corpus table); clean separation of "OEM corpus
  knowledge" (manufacturer-matched) vs "this tenant's doc hung on this node."
- **Negative / watch:** retrieval adds a join + a subtree subquery (bounded by the GIST index, expected
  cheap at bench/tenant scale); link rows must be created at ingest-completion (the only write path) and
  are `ON DELETE CASCADE` from both sides so node/chunk deletion cleans up.
- **Relationship to ADR-0013:** this does **not** canonicalize `kg_entities` ↔ `cmms_equipment`. It adds a
  node↔knowledge association purely on the kg side. If/when assets are folded into kg nodes, the link
  table stays valid (it keys on `kg_entities.id`). This is a forward-compatible step, not a competing
  direction.

## Verification
- Migration dry-run clean on dev then staging (`apply-migrations.yml`); `\d knowledge_node_links` shows FKs + indexes.
- Reparent test: attach doc to a node, move the node under a new parent, confirm subtree query at the new parent now returns the doc (path resolved live).

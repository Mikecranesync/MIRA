# ADR-0014: `ai_suggestions` as the broad work queue (supersedes ADR-0013 §Decision item 1)

## Status
Accepted — 2026-05-18

**Supersedes:** ADR-0013 §"Decision" item 1 (the table-mapping row that said `ai_suggestions` → use `relationship_proposals`).
**Leaves intact:** the rest of ADR-0013 — Hub `mira-hub/db/migrations/` is still authoritative for product-surface schema; engine `docs/migrations/` still owns `kg_entities` / `kg_relationships`.

**Related:** `docs/specs/mira-ground-truth-architecture-investigation.md` §3.1 #2 and §5.3 (the investigation that surfaced the gap).
**Implements:** Phase 0 demo-blocker #2 from the investigation report.

---

## Context

ADR-0013 (accepted 2026-05-16) rejected a new `ai_suggestions` table on the grounds that `relationship_proposals` (Hub migration 018) already serves as the proposals queue, and a second table would duplicate workflow.

Two days later, the ground-truth architecture investigation (PR #1417) audited the proposal surface against the product spec and found the rejection was based on an incomplete frame:

- `relationship_proposals` is **edge-only**. Its required columns are `source_entity_id`, `source_entity_type`, `target_entity_id`, `target_entity_type`, `relationship_type` (CHECK-constrained to 26 edge types).
- The product spec (`docs/specs/maintenance-namespace-builder-spec.md` §Data Model) lists six `suggestion_type` values the Hub `/proposals` page must render: `kg_edge`, `kg_entity`, `tag_mapping`, `component_profile`, `uns_confirmation`, `namespace_move`.
- Only `kg_edge` fits `relationship_proposals`. The other five have no canonical home — they have no source/target entity pair, no `relationship_type` from the allowed set, and in some cases (e.g. `namespace_move`) aren't entities at all but operations.

The Hub `/proposals` page currently has nothing to render for the non-edge suggestion types. The May 21 demo's headline loop — technician photographs a nameplate → MIRA proposes a new component instance → Hub `/proposals` surfaces it — produces a `kg_entity` proposal, which cannot land in `relationship_proposals`.

## Decision

**Add `ai_suggestions` as the broad work queue (Hub migration 027).** It carries the five non-edge suggestion types plus `kg_edge` for parity with the Hub `/proposals` read model.

`relationship_proposals` stays as authored — it remains the **edge-specific catalog with structured evidence** (the `relationship_evidence` join table is unique to it; the controlled vocabulary CHECK constraint is unique to it). Two tables, two roles:

| Table | Role | Reader |
|---|---|---|
| `relationship_proposals` + `relationship_evidence` | Edge-specific catalog. Holds the LLM-proposed edges with 1..N evidence rows. Authoritative for confidence math, contradiction tracking, and edge promotion to `kg_relationships`. | The engine's promotion job + the Hub `/proposals?type=kg_edge` filter. |
| `ai_suggestions` | Broad work queue. One row per Hub-facing proposal regardless of shape (`kg_edge`, `kg_entity`, `tag_mapping`, `component_profile`, `uns_confirmation`, `namespace_move`). For `kg_edge`, the row points at the underlying `relationship_proposals.id`. | The Hub `/proposals` page (all types) and the MCP `kg_propose_*` tools. |

Writers must:

- For `kg_edge`: write `relationship_proposals` first, then a row in `ai_suggestions` with `suggestion_type='kg_edge'` and `payload.relationship_proposal_id` pointing at the edge row.
- For all other types: write `ai_suggestions` directly.

This preserves ADR-0013's "two-lineage, two-cadence" principle (Hub owns product-surface, engine owns kg_entities/kg_relationships) and does **not** introduce a competing proposals workflow — `ai_suggestions` is a thin work-queue header over the existing detailed tables for `kg_edge`, and the canonical home for the other five types.

## Why this is right

- **The product spec wins.** `docs/specs/maintenance-namespace-builder-spec.md` lists the six `suggestion_type` values explicitly. The Hub `/proposals` page is the contract. ADR-0013 didn't have this scoped.
- **No duplicate workflow for edges.** Edge promotion still flows through `relationship_proposals` → `kg_relationships.approval_state`. The `ai_suggestions.kg_edge` row is a header, not a second store.
- **Photo → KG closes.** The May 21 demo's `kg_entity` proposal (new `installed_component_instances` row) now has a place to land in the Hub UI.
- **One Hub read.** `/proposals` issues one query against `ai_suggestions` to render every pending decision; it joins to `relationship_proposals` only when the user opens an edge proposal's evidence detail.

## Consequences

- New Hub migration `027_ai_suggestions.sql` (this PR).
- Existing writers that produce edge proposals must add a follow-up `INSERT INTO ai_suggestions` after the `relationship_proposals` row. The `tools/load_manifest_to_kg.py` conveyor importer and the engine's promotion path are the only known producers today; both update in this same PR's photo-pipeline follow-up.
- Hub `/proposals` page reads from `ai_suggestions` (new), not `relationship_proposals` directly. The Hub UI implementation is not in this PR; this PR ships the table so the UI work isn't schema-blocked.
- The reviewer for any future "second proposals queue" PR should compare against this ADR before approving — `ai_suggestions` is the queue for non-edge proposals AND the read surface for the Hub; nothing else should reproduce that role.

## What was NOT decided here

- The Hub `/proposals` page UI shape — owned by the Hub Next.js sub-task that consumes this table.
- Whether `relationship_proposals` eventually folds into `ai_suggestions` (it shouldn't — the evidence join table and the relationship-type CHECK constraint are doing real work). Treat the two as permanent siblings.
- Tenant-id type canonicalization across Hub (UUID) and engine (TEXT) — separate work, called out as a structural risk in the investigation §3.2 #12 and not in scope here.

---

## Verification

```bash
# Confirm the new table exists after migration 027.
psql "$NEON_DATABASE_URL" -c "\\d ai_suggestions"

# Confirm relationship_proposals is unchanged.
psql "$NEON_DATABASE_URL" -c "\\d relationship_proposals"

# Confirm the Hub query for /proposals returns all types when populated.
psql "$NEON_DATABASE_URL" -c "
  SELECT suggestion_type, status, count(*)
    FROM ai_suggestions
   GROUP BY suggestion_type, status
   ORDER BY suggestion_type, status;
"
```

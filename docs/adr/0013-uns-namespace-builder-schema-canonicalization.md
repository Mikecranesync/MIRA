# ADR-0013: Namespace-builder schema canonicalization — Hub (`mira-hub/db/migrations/`) is authoritative

## Status
Accepted — 2026-05-16

**Related:** ADR-0012 (MES Architecture Walker UNS Framework), `docs/plans/2026-05-15-maintenance-namespace-builder.md` (Phase 1 schema gate)
**Implements:** Phase 1 "schema canonicalization decision" gate called out in `docs/plans/2026-05-15-maintenance-namespace-builder.md` §"Migration-numbering note" and §"Risks — plan-level".

---

## Context

MIRA has two parallel SQL-migration lineages, both Postgres-targeted:

| Lineage | Path | Numbering | Owner | What it ships |
|---|---|---|---|---|
| NeonDB / engine-side | `docs/migrations/` | 001–007 | mira-bots / mira-mcp | `kg_entities`, `kg_relationships`, `kg_bridge`, `uns_path` enforcement |
| Hub / product-side | `mira-hub/db/migrations/` | 001–020 | mira-hub | `component_templates` (016), `installed_component_instances` (017), `relationship_proposals` + `relationship_evidence` (018), `sessions_and_signals` (019), `signal_cache_and_trends` (020), `equipment_uns_path` (015), `uns_path_backfill` (014), `qr_permanent_binding` (012) |

When `docs/plans/2026-05-15-maintenance-namespace-builder.md` was drafted (PR #1323), it specified a new `docs/migrations/008_namespace_builder.sql` adding `ai_suggestions`, `approvals`, `wizard_progress`, `health_scores`, `qr_codes`, `namespace_versions`. A pre-build audit of `mira-hub/db/migrations/` revealed that the conceptual product schema for **proposals + evidence + readiness + QR** is already shipped on the Hub side at migrations 012, 016, 017, 018, 019, 020 — committed 2026-05-16 to origin/main.

Continuing to add another lineage's `008_namespace_builder.sql` would (a) duplicate `relationship_proposals` under a different name (`ai_suggestions`), (b) create two non-interchangeable approval workflows, and (c) fork the readiness signal source.

## Decision

**Hub migrations (`mira-hub/db/migrations/`) are the canonical home for namespace-builder product-surface schema.** `docs/migrations/` continues to own engine-side state (KG entities/relationships, UNS-path enforcement on those tables) but does NOT add a parallel proposals / wizard / readiness lineage.

Concrete consequences for the namespace-builder plan:

1. The plan's `008_namespace_builder.sql` is **not authored** under `docs/migrations/`. Its product-surface tables map onto existing Hub migrations:

   | Plan table | Status | Canonical home |
   |---|---|---|
   | `ai_suggestions` | Already present (named differently) | `mira-hub/db/migrations/018_relationship_proposals.sql` (table `relationship_proposals`) |
   | KG-edge evidence | Already present | `mira-hub/db/migrations/018_relationship_proposals.sql` (table `relationship_evidence`) |
   | `approvals` | TBD — add as 021 if needed | `mira-hub/db/migrations/021_...` |
   | `wizard_progress` | Not present | `mira-hub/db/migrations/021_...` (combined with the above) |
   | `health_scores` | Not present | `mira-hub/db/migrations/022_...` |
   | `qr_codes` | Subsumed by `qr_permanent_binding` | `mira-hub/db/migrations/012_qr_permanent_binding.sql` (existing) |
   | `namespace_versions` | Not present | `mira-hub/db/migrations/023_...` |

2. The plan's `kg_entities.approval_state` + `kg_relationships.approval_state` column additions are **still authored under `docs/migrations/`** (next number `008_kg_approval_state.sql`), because those tables live in the NeonDB / engine lineage. The application layer treats Hub `relationship_proposals.status` as the upstream proposal queue; `kg_relationships.approval_state` records only the verified-state copy that the engine actually reads at diagnostic time.

3. Phase 2 "Hub product surfaces" (`/proposals`, `/namespace`, readiness widget) reads from Hub tables. The plan's API routes (`/api/v1/proposals/...`, `/api/v1/namespace/...`) map to the existing Hub schema and do **not** create a second proposal queue.

## Why this is right

- **Hub already ships the schema.** Migrations 014–020 (added 2026-05-16) cover the heavy lift. Authoring a duplicate set under `docs/migrations/` would force a future deduplication migration that the plan's Phase 1 "Risks" section already flags as the largest plan-level risk.
- **Engine reads what humans verified.** Keeping `kg_relationships` (NeonDB lineage) on the verified-only side preserves the "engine never reads a `proposed` edge" invariant the namespace-builder spec relies on. The Hub-side proposals table is the LLM/human handshake; the engine-side table is the diagnostic truth set.
- **Two stewardships, two cadences.** Product-surface schema changes ride with Hub Next.js code (TypeScript types, route handlers). Engine schema changes ride with mira-bots. Keeping the lineages separate keeps PRs scoped.

## Consequences

- The namespace-builder plan's `docs/migrations/008_namespace_builder.sql` line item is retired in favor of two narrower migrations: (a) the engine-side `008_kg_approval_state.sql` (still under `docs/migrations/`); (b) a Hub-side `021_namespace_builder.sql` for `approvals` + `wizard_progress` (still missing).
- A follow-up cleanup migration is **not** needed for the existing 016–020 lineage; those tables stay as authored.
- The plan's "Acceptance" line "New migration applies + reverses cleanly on staging" applies to whichever lineage owns the new migration in the sub-task at hand — both lineages have a staging clone today.
- The plan document is updated with a Change-Log entry pointing here so future sessions don't re-litigate this question.

## What was NOT decided here

- Whether the Hub-side `relationship_proposals` table itself needs columns added (e.g. an explicit `evidence_summary TEXT`) for Phase 1's MCP `kg_propose_edge` tool — that decision moves to the sub-task that wires the tool.
- Whether the Hub `relationship_proposals.status` enum (`proposed | reviewed | verified | rejected | deprecated | contradicted`) is a strict subset/superset of the namespace-builder spec's status set — also deferred to the wiring sub-task.
- The exact column shape of the still-missing `wizard_progress` and `health_scores` tables — deferred to Phase 2 / Phase 3 sub-tasks where the Hub UI defines the read contract.

---

## Verification

```bash
# Confirm the Hub lineage covers proposals + evidence + components.
ls mira-hub/db/migrations/ | grep -E '018_relationship_proposals|016_component_templates|017_installed_component_instances'

# Confirm engine lineage does NOT have a competing proposals/suggestions migration.
ls docs/migrations/ | grep -iE 'ai_suggestions|proposals|wizard|health_scores'
# (expect: no matches)
```

---

## Update (2026-05-19): Empirical reality for `kg_entities` / `kg_relationships`

The original Decision (above) reads: *"`docs/migrations/` continues to own engine-side state (KG entities/relationships, UNS-path enforcement on those tables)…"*

That ownership claim was aspirational. The empirical reality, verified 2026-05-19 via the rewritten `db-inspect.yml` against prod NeonDB:

- **Both `kg_entities` and `kg_relationships` in prod were created by `mira-hub/db/migrations/001_knowledge_graph.sql`**, with the hub-shape columns (`source_id`, `target_id`, `relationship_type`).
- `docs/migrations/006_kg_bridge.sql` declares the same tables with **different column names** (`source_entity`, `target_entity`, `relation_type`) under `CREATE TABLE IF NOT EXISTS …`. Because hub-001 ran first in prod, engine-006 became a no-op for those tables.
- Most engine-side column additions DID land — `kg_entities.uns_path` (engine-migration 007), `kg_*.approval_state / proposed_by / evidence_summary` (engine-migration 008), `kg_*.source_chunk_id` (hub-migration 024) — all via `ALTER TABLE`. Only the original `CREATE TABLE` shape was decided by the race.

### Consequences not foreseen in the original Decision

- `mira-crawler/ingest/kg_writer.py:upsert_relationship` was authored against engine-006's column names (`source_entity` / `target_entity` / `relation_type`) and **silently 500-d on every call** from introduction until 2026-05-19. The 30 `kg_relationships` rows in prod at that date came entirely from hub-TS code and `mira-crawler/tasks/full_ingest_pipeline.py` (already hub-shape, lines 426-429 / 459-463).
- Fixed in PR #1443 (merge commit `623a43d1`): kg_writer now writes to `source_id` / `target_id` / `relationship_type`. Verified by db-inspect run [#26130051449](https://github.com/Mikecranesync/MIRA/actions/runs/26130051449): `kg_relationships` row count 30 → 299; `has_manual` edges 0 → 269, matching the 269 distinct (tenant, manufacturer, model) triples enumerated by `tools/uns_backfill.py`.

### Revised rule

The Decision still stands for **product-surface schema** (proposals / wizard / readiness / health scores / approvals — all hub-side). For `kg_entities` / `kg_relationships` specifically:

1. **Treat hub-001 as the canonical shape.** Future column additions to either table go through `mira-hub/db/migrations/` (`ALTER TABLE`), not `docs/migrations/`. Do not author another competing `CREATE TABLE` under either lineage.
2. **Python writers use hub-001 column names.** New code targeting `kg_relationships` uses `source_id` / `target_id` / `relationship_type`. The Python parameter names `source_entity` / `target_entity` / `relation_type` are preserved in `kg_writer.py` for back-compat with callers but are **not** the column names in flight.
3. **Engine-side migrations that ALTER these tables can continue to live under `docs/migrations/`** when the ALTER is engine-policy (e.g., engine-008's `approval_state`). What's forbidden is a parallel `CREATE TABLE` under either lineage.
4. **Verification path** — `db-inspect.yml` (rewritten in PR #1443 to use `psql` directly) is the read-only inspector. Run it before debugging any "the writer ran but no rows appeared" symptom; it surfaces column shape, indexes, RLS state, connecting role.

### What this Update does NOT change

- The Decision about **proposals / evidence / wizard / readiness / QR / components** (the bulk of this ADR). Hub-side migrations 012, 016, 017, 018, 019, 020 remain the canonical home; no parallel set under `docs/migrations/`.
- The "engine reads what humans verified" invariant. `kg_relationships.approval_state` continues to record the verified-state copy; `relationship_proposals.status` continues to be the upstream proposal queue.
- The two-stewardships-two-cadences rationale. Product-surface schema rides with hub Next.js code; engine policy ALTERs ride with mira-bots.

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

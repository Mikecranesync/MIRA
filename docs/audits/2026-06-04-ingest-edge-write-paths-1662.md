# Ingest edge write-path audit (issue #1662)

**Date:** 2026-06-04 · **Context:** PR #1716 (Path-A slice) · **Doctrine:** MIRA may *infer* relationships but must not *silently verify* them (`.claude/CLAUDE.md`, ADR-0017).

Every place in the codebase that can create a knowledge-graph edge, classified so #1662 can be closed without missing a hidden writer. Categories: **proposalized** (propose → human verify), **safe** (approval-gated verified write, intended), **gated opt-in** (proposalized by default; auto-verify only behind a deliberate flag), **still auto-verifies** (bypass — needs work).

## kg_relationships INSERT sites (verified-edge writers)

| Site | Classification | Notes |
|---|---|---|
| `mira-crawler/ingest/kg_writer.py:254` (`_autoverify_relationship`) | **gated opt-in** ✅ | This PR. Default = proposal path; legacy auto-verify only when `MIRA_KG_INGEST_AUTOVERIFY` is set (one-time bulk migration / debug). |
| `mira-hub/.../proposals/[id]/decide/route.ts:115` | **safe** ✅ | The Hub admin-approval path. Writes the verified edge **on approve only**. This is the intended single verified-write door. |
| `mira-connectors/mira_connectors/store.py:573` | **safe** ✅ | Called from `confirmation_gate.py:370` on **technician confirmation** (`evidence_type='human_observation'`). Approval-gated, like decide route. (Also proposes first at `store.py:415`.) |
| `mira-crawler/tasks/full_ingest_pipeline.py:426, 459` | **still auto-verifies** ⛔ | **Path B** — the cron bulk OEM loader (`kb_growth_cron` 06:00 UTC). Inline psycopg2, `confidence 1.0`. Highest-value remaining target. Reroute through `proposal_writer.propose_relationship` (same as Path A) + add the `MIRA_KG_INGEST_AUTOVERIFY` gate. |
| `mira-hub/src/lib/knowledge-graph/queries.ts:57, 280` | **still auto-verifies** ⛔ | Includes `upsertSchematicComponents()` (`confidence 1.0`) — explicitly named in #1662 as a bypass. TS side. |
| `mira-hub/src/lib/knowledge-graph/relationship-extractor.ts:270` | **still auto-verifies** ⛔ | Conversation-extracted edges (`source_conversation_id`). TS side. |
| `mira-hub/src/lib/knowledge-graph/extractor.ts:141` | **still auto-verifies** ⛔ | Conversation-extracted edges. TS side. |
| `mira-hub/src/lib/knowledge-graph/cmms-sync.ts:275` | **still auto-verifies** ⛔ | CMMS-sync edges. TS side. |
| `mira-hub/src/lib/knowledge-graph/hierarchy-backfill.ts:120` | **unknown — verify** ❓ | Structural hierarchy backfill. May be a deliberate admin/structural operation (acceptable) rather than inferred knowledge. Read before reclassifying. |

## relationship_proposals INSERT sites (proposers — the "good" path)

| Site | Classification | Notes |
|---|---|---|
| `mira-crawler/ingest/proposal_writer.py:195` | **proposalized** ✅ | This PR. `created_by='import'`, bridges `ai_suggestions(kg_edge)`. |
| `tools/load_manifest_to_kg.py:265` | **proposalized** ✅ | Manifest loader. `created_by='import'`. The reference pattern. |
| `mira-relay/flaky_detector.py:502` | **proposalized** ✅ | Flaky-input detector proposes. |
| `mira-hub/src/lib/knowledge-graph/proposals-writer.ts:55` | **proposalized** ✅ | Hub-side proposer. |
| `mira-connectors/mira_connectors/store.py:415` | **proposalized** ✅ | Connectors propose-before-confirm. |

## Checklist to close #1662

1. **Path B** — reroute `full_ingest_pipeline.py` (cron bulk OEM) through `propose_relationship` + the `MIRA_KG_INGEST_AUTOVERIFY` gate. *(Python, Bravo-finishable.)*
2. **TS write paths** — `queries.ts` (incl. `upsertSchematicComponents`), `relationship-extractor.ts`, `extractor.ts`, `cmms-sync.ts`: route through `mira-hub/lib/proposal-transition.ts` (still to be created) so they propose, not auto-verify. *(Hub build required — not Bravo-finishable.)*
3. **`hierarchy-backfill.ts`** — read & decide: deliberate structural backfill (leave) vs inferred (proposalize).
4. **ADR-0017 canary** — add `tests/canary/proposal_state_drift.sql` + the nightly workflow.
5. **Audit guard** — once all live writers are proposalized, add a CI grep that fails on any non-gated, non-approval `INSERT INTO kg_relationships`.

## What PR #1716 proved (staging smoke)

`proposals=1 evidence=1 suggestions=1 kg_relationships=0 rel_type='HAS_DOCUMENT'`, idempotent, self-cleaned — against the staging Neon branch via the real `register_equipment_and_manual` ingest path. The live Path-A ingest now proposes and never auto-verifies.

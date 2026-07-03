# Context Spine Unification Plan

Date: 2026-06-25

Goal: unify existing FactoryLM/MIRA pieces into one coherent self-serve factory contextualization spine without rebuilding, replacing, bypassing approval, adding a database, or creating live control paths.

## Product Spine Decision

MIRA Hub is the canonical spine. FactoryLM should feed MIRA as a read-only source/proof adapter, not become a parallel approval/KG/readiness product. Evidence: MIRA has contextualization staging at `mira-hub/db/migrations/055_contextualization.sql:12`, approval publishing at `mira-hub/src/app/api/contextualization/batches/[batchId]/review/route.ts:98`, KG/UNS storage at `mira-hub/db/migrations/001_knowledge_graph.sql:3` and `mira-hub/db/migrations/010_kg_uns_path.sql:3`, readiness scoring at `mira-hub/src/lib/health-score.ts:10`, and retrieval chunks at `docs/migrations/001_knowledge_entries.sql:11`; FactoryLM dashboard is not implemented at `C:\Users\hharp\Desktop\factorylm-monorepo\apps\dashboard\NOT_IMPLEMENTED.md:1` and its diagnosis path is separate at `C:\Users\hharp\Desktop\factorylm-monorepo\services\diagnosis\main.py:296`.

## No-Rebuild Principles

- Use existing stores: `kg_entities`, `kg_relationships`, `ai_suggestions`, `relationship_proposals`, `knowledge_entries`, `health_scores`, `approved_tags`, `tag_events`, and `live_signal_cache`. Evidence: `mira-hub/db/migrations/001_knowledge_graph.sql:3`, `mira-hub/db/migrations/018_relationship_proposals.sql:6`, `mira-hub/db/migrations/027_ai_suggestions.sql:3`, `docs/migrations/001_knowledge_entries.sql:11`, `mira-hub/src/lib/health-score.ts:10`, `mira-hub/db/migrations/035_approved_tags.sql:39`, and `mira-hub/db/migrations/033_tag_events.sql:177`.
- Keep all imports proposed until human approval. Evidence: JSON imports force proposed review state at `mira-hub/src/lib/contextualization/intake-contract.ts:80`; batch approval publishes only accepted extractions at `mira-hub/src/app/api/contextualization/batches/[batchId]/review/route.ts:98`.
- Do not use live write/control paths. Evidence: FactoryLM exposes a write endpoint at `C:\Users\hharp\Desktop\factorylm-monorepo\services\plc-modbus\backend\routes\plc.py:77`; MIRA relay uses read-only approved telemetry at `mira-relay/tag_ingest.py:388`.
- Prefer feature flags for risky enforcement. Evidence: approved-only retrieval is already flag-gated at `mira-hub/src/lib/manual-rag.ts:50` and `mira-bots/shared/neon_recall.py:112`.

## Phase 0: Inventory And Contracts

Objective: freeze the contracts and mark drift before touching runtime code.

Checklist:

- [ ] Document MIRA Hub as the canonical spine and FactoryLM as a read-only source/proof adapter. Evidence target: this plan plus audit doc.
- [ ] Define canonical identity as `kg_entities.id` for KG identity, `kg_entities.uns_path` as the query/address projection, and source/evidence references through `ctx_extractions.id`, `ctx_import_batches.id`, `knowledge_entries.metadata`, and proposal evidence. Evidence: `mira-hub/db/migrations/001_knowledge_graph.sql:3`, `mira-hub/db/migrations/010_kg_uns_path.sql:3`, `mira-hub/src/lib/contextualization/intake-contract.ts:15`, `mira-hub/src/lib/node-knowledge-ingest.ts:233`, and `mira-hub/db/migrations/018_relationship_proposals.sql:67`.
- [ ] Reconcile doc drift: contextualizer docs say import seeds `knowledge_entries`, while Hub route says this is out of scope. Evidence: `mira-contextualizer/ARCHITECTURE.md:209` and `mira-hub/src/app/api/contextualization/import/route.ts:29`.
- [ ] Reconcile CCW docs: architecture says auto-placement is L5X/tag-CSV only, but current CCW placement code/tests exist. Evidence: `mira-contextualizer/ARCHITECTURE.md:134`, `mira-contextualizer/mira_contextualizer/placement.py:1`, `mira-contextualizer/mira_contextualizer/ccw.py:351`, and `mira-contextualizer/tests/test_placement.py:27`.
- [ ] Decide whether to extend Hub source type enum for `ccw` and `ignition_json` or continue normalizing to `other` with evidence fields. Evidence: `mira-hub/db/migrations/055_contextualization.sql:43`, `mira-contextualizer/mira_contextualizer/server.py:350`, and `mira-hub/src/lib/contextualization/bundle-import.ts:33`.
- [ ] Confirm current approved-only retrieval behavior by running existing tests and, when allowed, live config checks. Evidence: code flags at `mira-hub/src/lib/manual-rag.ts:50` and `mira-bots/shared/neon_recall.py:112`; tests at `mira-hub/src/lib/__tests__/manual-rag.test.ts:123` and `mira-hub/src/lib/__tests__/manual-rag.test.ts:256`.

Files/modules to modify in Phase 0:

- `mira-contextualizer/ARCHITECTURE.md`
- `docs/investigations/2026-06-25-context-spine-subagent-audit.md`
- `docs/plans/2026-06-25-context-spine-unification-plan.md`
- Optional: `mira-hub/src/lib/contextualization/intake-contract.ts` comments only if contract language needs clarification.

Tests/proofs:

- Docs-only: `git diff --check`
- Contract-only: `cd mira-hub; npx vitest run src/lib/contextualization/bundle-import.test.ts src/app/api/contextualization/import/import.integration.test.ts`

## Phase 1: Make Offline Contextualizer -> Hub Import The Default Spine

Objective: make offline contextualizer output land in the same Hub review path every time.

Checklist:

- [ ] Prefer JSON `contextualization-intake/v1` for offline imports or wrap legacy bundle upload into a `ctx_import_batches` row. Evidence: JSON route support at `mira-hub/src/app/api/contextualization/import/route.ts:18`, intake schema at `mira-hub/src/lib/contextualization/intake-contract.ts:23`, and batch table at `mira-hub/db/migrations/056_contextualization_intake.sql:26`.
- [ ] Preserve offline accept/reject decisions only as reviewer hints; do not publish accepted offline decisions without Hub approval. Evidence: legacy bundle preserves status at `mira-hub/src/lib/contextualization/bundle-import.ts:71`; JSON intake maps proposed signals to pending at `mira-hub/src/lib/contextualization/intake-contract.ts:223`.
- [ ] Keep bundle zip support for backward compatibility, but route the success CTA to the same review queue or clearly label it as project-level review. Evidence: project page imports bundle and routes to project review at `mira-hub/src/app/(hub)/contextualization/page.tsx:53` and `mira-hub/src/app/(hub)/contextualization/page.tsx:107`; review page says offline zip bundles are separate at `mira-hub/src/app/(hub)/contextualization/review/page.tsx:89`.
- [ ] Add novice error handling for closed PLC binaries and OCR/Tesseract absence. Evidence: `.ACD` export guidance exists at `mira-plc-parser/mira_plc_parser/detect.py:42`, but contextualizer octet-stream route can try document handling at `mira-contextualizer/mira_contextualizer/server.py:200`; OCR dependency appears at `mira-contextualizer/mira_contextualizer/extract.py:207`.

Files/modules to modify in Phase 1:

- `mira-contextualizer/mira_contextualizer/bundle.py`
- `mira-contextualizer/mira_contextualizer/server.py`
- `mira-hub/src/lib/contextualization/intake-contract.ts`
- `mira-hub/src/lib/contextualization/bundle-import.ts`
- `mira-hub/src/app/api/contextualization/import/route.ts`
- `mira-hub/src/app/(hub)/contextualization/page.tsx`
- `mira-hub/src/app/(hub)/contextualization/review/page.tsx`

Tests/proofs:

- `cd mira-contextualizer; python -m pytest`
- `cd mira-hub; npx vitest run src/lib/contextualization/bundle-import.test.ts src/app/api/contextualization/import/import.integration.test.ts`
- Add one safe integration test only if missing: legacy bundle import creates or points to a batch-like review record and never publishes KG rows until human approval.

## Phase 2: Route Imports Into Proposals / Approval / UNS / KG

Objective: use existing proposal and approval layers consistently for signals, assets, documents, and relationships.

Checklist:

- [ ] Publish accepted extractions through the existing batch review route, not direct KG writes. Evidence: approval route publishes accepted rows at `mira-hub/src/app/api/contextualization/batches/[batchId]/review/route.ts:98` and writes verified state at `mira-hub/src/app/api/contextualization/batches/[batchId]/review/route.ts:147`.
- [ ] Map bundle `kg_relationships.json` and inferred edges into `relationship_proposals` plus `relationship_evidence`, not direct verified relationships. Evidence: bundle emits relationships at `mira-contextualizer/mira_contextualizer/bundle.py:7`; edge proposal schema is `mira-hub/db/migrations/018_relationship_proposals.sql:6` with evidence fields at `mira-hub/db/migrations/018_relationship_proposals.sql:67`.
- [ ] Route document evidence into `knowledge_entries` with node/asset metadata only after an approval or explicit train step. Evidence: node ingest writes `metadata.node_id`, `metadata.uns_path`, and private chunks at `mira-hub/src/lib/node-knowledge-ingest.ts:233`; approved-only retrieval requires `verified=true` when enabled at `mira-hub/src/lib/manual-rag.ts:50`.
- [ ] Keep proposal transitions lockstep between `ai_suggestions` and `relationship_proposals`. Evidence: design split at `mira-hub/db/migrations/027_ai_suggestions.sql:14` and transition helper at `mira-hub/src/lib/proposal-transition.ts:74`.
- [ ] Fix or explicitly quarantine stale `uns_resolver` schema assumptions before relying on DB enrichment. Evidence: resolver selects `label` at `mira-bots/shared/uns_resolver.py:724`, while KG schema uses `name` at `mira-hub/db/migrations/001_knowledge_graph.sql:3`.

Files/modules to modify in Phase 2:

- `mira-hub/src/app/api/contextualization/batches/[batchId]/review/route.ts`
- `mira-hub/src/app/api/contextualization/[id]/promote/route.ts`
- `mira-hub/src/lib/contextualization/approval.ts`
- `mira-hub/src/lib/proposal-transition.ts`
- `mira-hub/src/lib/node-knowledge-ingest.ts`
- `mira-hub/src/lib/suggestion-accept.ts`
- `mira-bots/shared/uns_resolver.py`

Tests/proofs:

- `cd mira-hub; npx vitest run src/lib/contextualization/approval.test.ts src/app/api/contextualization/batches/[batchId]/review/review.integration.test.ts src/lib/__tests__/suggestion-accept.test.ts src/lib/knowledge-graph/__tests__/extractor-propose.test.ts`
- `python -m pytest mira-bots/tests/test_proposal_transition.py tests/test_uns_confirmation_gate.py`

## Phase 3: Add Readiness Checklist

Objective: turn the existing health score into an actionable missing-context checklist for self-serve onboarding.

Checklist:

- [ ] Keep `health-score.ts` pure and extend inputs rather than adding a new scoring store. Evidence: pure calculator at `mira-hub/src/lib/health-score.ts:1`; counts shape at `mira-hub/src/lib/health-score.ts:22`; next-step hints at `mira-hub/src/lib/health-score.ts:77`.
- [ ] Count approved/citable document chunks from `knowledge_entries`, not only `kg_triples_log`. Evidence: current readiness docs count at `mira-hub/src/app/api/readiness/recalculate/route.ts:47`; node upload chunks at `mira-hub/src/lib/node-knowledge-ingest.ts:196`.
- [ ] Include proposal backlog, approved signal count, verified relationship count, namespace coverage, documents, live tag mapping, and asset-agent validation state. Evidence: proposal counts at `mira-hub/src/app/api/readiness/route.ts:58`; live cache is keyed by UNS/freshness at `mira-hub/db/migrations/036_current_tag_state_freshness.sql:45`; asset status gate exists at `mira-hub/db/migrations/046_asset_agent_status.sql:8`.
- [ ] Display missing-context checklist in existing readiness/status surfaces, not a new dashboard. Evidence: readiness API exists at `mira-hub/src/app/api/readiness/route.ts:9`; namespace page can deep-link Ask MIRA at `mira-hub/src/app/(hub)/namespace/page.tsx:158`.

Files/modules to modify in Phase 3:

- `mira-hub/src/lib/health-score.ts`
- `mira-hub/src/app/api/readiness/route.ts`
- `mira-hub/src/app/api/readiness/recalculate/route.ts`
- Existing Hub readiness/status UI surface after locating the current route component.

Tests/proofs:

- `cd mira-hub; npx vitest run src/lib/__tests__/health-score.test.ts`
- Add route-level test for approved document chunks contributing to readiness while unverified chunks produce checklist items, not readiness credit.

## Phase 4: Make MIRA Answer Only From Approved Asset Context

Objective: production MIRA answers must come from approved asset/node context or explicitly refuse with a missing-context checklist.

Checklist:

- [ ] Enable or enforce `MIRA_ENFORCE_APPROVED_RETRIEVAL` for production Ask MIRA paths after backfill readiness is known. Evidence: Hub filter at `mira-hub/src/lib/manual-rag.ts:50`; bot filter at `mira-bots/shared/neon_recall.py:112`.
- [ ] Add explicit approved/verified filters to `/api/mira/ask` KG relationship queries or reuse approval helpers. Evidence: current relationship query location at `mira-hub/src/app/api/mira/ask/route.ts:189`; prompt labels verified context at `mira-hub/src/app/api/mira/ask/route.ts:330`; approval helpers exist at `mira-hub/src/lib/i3x/approval.ts:1`, `mira-hub/src/lib/i3x/approval.ts:22`, and `mira-hub/src/lib/i3x/approval.ts:32`.
- [ ] Refuse or return readiness checklist when `approved_source_count` is zero. Evidence: NodeChat emits approved source count at `mira-hub/src/app/api/namespace/node/[id]/chat/route.ts:300`; no-guess prompt exists at `mira-hub/src/lib/manual-rag.ts:506`.
- [ ] Keep UNS/session confirmation gate before answer generation. Evidence: shared engine gate at `mira-bots/shared/engine.py:5629`; Hub `/api/mira/ask` 412 gate at `mira-hub/src/app/api/mira/ask/route.ts:129`; Ignition direct connection gate at `mira-pipeline/ignition_chat.py:500`.
- [ ] Leave HMI/asset-agent runtime enforcement behind a feature flag until validation backfill is complete. Evidence: HMI gate flag at `mira-pipeline/ignition_chat.py:46` and runtime gate at `mira-pipeline/ignition_chat.py:537`.

Files/modules to modify in Phase 4:

- `mira-hub/src/lib/manual-rag.ts`
- `mira-bots/shared/neon_recall.py`
- `mira-hub/src/app/api/mira/ask/route.ts`
- `mira-hub/src/app/api/namespace/node/[id]/chat/route.ts`
- `mira-hub/src/app/api/assets/[id]/chat/route.ts`
- `mira-pipeline/ignition_chat.py`

Tests/proofs:

- `cd mira-hub; npx vitest run src/lib/__tests__/manual-rag.test.ts src/app/api/namespace/node/[id]/chat/__tests__/route.test.ts`
- `python -m pytest tests/test_uns_confirmation_gate.py mira-pipeline/tests/test_ignition_chat_gate.py mira-pipeline/tests/test_ignition_chat_direct_connection.py`
- Add or extend a route test proving `/api/mira/ask` excludes unverified relationships and refuses when no approved context exists.

## Phase 5: Prove With SimLab + Garage Conveyor

Objective: one safe, reproducible proof loop: upload evidence -> approve context -> map live tags -> ask MIRA -> cited answer.

Checklist:

- [ ] Use SimLab as the safe source of truth before physical conveyor. Evidence: deterministic simulated source at `docs/simlab/README.md:5` and simulated readings at `docs/simlab/README.md:11`.
- [ ] Seed approved simulator tags through existing generator and relay allowlist. Evidence: generator at `tools/seeds/gen_approved_tags_simulator.py:78`; `approved_tags` table at `mira-hub/db/migrations/035_approved_tags.sql:39`; relay fail-closed at `mira-relay/tag_ingest.py:388`.
- [ ] Publish telemetry only through `/api/v1/tags/ingest`; verify `tag_events` append and `live_signal_cache` freshness. Evidence: route at `mira-relay/relay_server.py:250`, append/cache logic at `mira-relay/tag_ingest.py:19`, append-only grants at `mira-hub/db/migrations/033_tag_events.sql:177`, and cache freshness schema at `mira-hub/db/migrations/036_current_tag_state_freshness.sql:45`.
- [ ] Verify Command Center sees UNS/freshness and MIRA answer includes citations/evidence. Evidence: Command Center reads by UNS at `mira-hub/src/app/api/command-center/tree/route.ts:141`; live Ignition path currently lacks citations/evidence at `mira-pipeline/ignition_chat.py:654`, so this is the open proof gap.
- [ ] Do not use FactoryLM conveyor-lab writes or MIRA `plc/live_monitor.py` for proof. Evidence: FactoryLM conveyor-lab control path at `C:\Users\hharp\Desktop\factorylm-monorepo\apps\conveyor-lab\backend\src\services\modbus-conveyor-adapter.ts:74`; MIRA PLC live monitor writes commands at `plc/live_monitor.py:399`.

Files/modules to modify in Phase 5:

- `simlab/api.py`
- `simlab/publishers.py`
- `mira-relay/tag_ingest.py`
- `mira-hub/src/app/api/command-center/tree/route.ts`
- `mira-pipeline/ignition_chat.py`
- `tests/simlab/runner.py`
- `tests/golden/garage_conveyor_golden_path.py`
- `docs/runbooks/2026-06-23-simlab-relay-ingest-staging-validation.md`

Tests/proofs:

- `python -m pytest tests/simlab/test_relay_ingest_e2e.py tests/simlab/test_approved_tags_seed.py mira-relay/tests/test_tag_ingest.py tests/regime7_ignition/test_no_customer_write_paths.py -q`
- `python -m pytest tests/beta/beta_ready_upload_retrieval_citation.py tests/beta/test_upload_retrieval_citation.py -q`
- `python tests/simlab/runner.py --dry-run`
- Staging DB proof only when writes are allowed: follow `docs/runbooks/2026-06-23-simlab-relay-ingest-staging-validation.md:48`.

## Risks

- FactoryLM contains write/control code that conflicts with the read-only mission if wired into the product path. Evidence: `C:\Users\hharp\Desktop\factorylm-monorepo\services\plc-modbus\backend\routes\plc.py:77` and `C:\Users\hharp\Desktop\factorylm-monorepo\apps\conveyor-lab\backend\src\services\modbus-conveyor-adapter.ts:74`.
- Approved-context enforcement is available but not clearly forced everywhere. Evidence: `mira-hub/src/lib/manual-rag.ts:50`, `mira-bots/shared/neon_recall.py:112`, and `mira-hub/src/app/api/mira/ask/route.ts:189`.
- Asset approval safety-critical proposal checks are deferred/hardcoded. Evidence: `mira-hub/src/app/api/assets/[id]/agent-status/route.ts:82` and `mira-hub/src/app/api/assets/[id]/agent-status/transition/route.ts:82`.
- Source/address drift exists between migration notes and implemented retrieval path. Evidence: `mira-hub/db/migrations/045_knowledge_entries_chunk_anchors.sql:23` and `mira-hub/src/lib/manual-rag.ts:343`.
- Runtime liveness was not probed in the audit; service/deployment status is UNKNOWN.

## Smallest Possible PR Plan

PR 1: docs and contract alignment only.

- Add this audit and plan.
- Update `mira-contextualizer/ARCHITECTURE.md` to reflect CCW placement status and the true Hub import behavior.
- Add no runtime code unless a test-only contract gap is already present and safe.

PR 2: unify import review semantics.

- Make legacy bundle import create or attach to the batch review spine, or make contextualizer default to `contextualization-intake/v1`.
- Preserve zip compatibility.
- Prove no KG rows publish before human approval.

PR 3: approved-context retrieval and readiness checklist.

- Recompute readiness from approved KG plus approved/citable document chunks.
- Add explicit verified relationship filtering to `/api/mira/ask`.
- Refuse or checklist when approved context is missing.

PR 4: SimLab proof loop.

- Add one no-write proof runner for SimLab -> relay -> live cache -> approved-context MIRA answer with citations.
- Keep physical garage conveyor proof behind explicit operator/runbook steps.

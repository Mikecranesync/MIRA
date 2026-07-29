# FactoryLM / MIRA Context Spine Sub-Agent Audit

Date: 2026-06-25

Scope: read-only investigation across this MIRA worktree and `C:\Users\hharp\Desktop\factorylm-monorepo`. No runtime code, migrations, database writes, or tests were changed.

## Executive Verdict

MIRA already contains the canonical self-serve contextualization spine. The strongest path is: offline contextualizer or Hub intake -> `ctx_*` staging -> human approval -> `kg_entities` / `kg_relationships` / `knowledge_entries` -> readiness score -> approved-context MIRA answers -> optional relay-approved telemetry -> SimLab proof. Evidence: the contextualizer describes offline/no-cloud intake and export bundles at `mira-contextualizer/ARCHITECTURE.md:9`, `mira-contextualizer/ARCHITECTURE.md:19`, and `mira-contextualizer/ARCHITECTURE.md:144`; Hub staging tables are defined at `mira-hub/db/migrations/055_contextualization.sql:12`, `mira-hub/db/migrations/055_contextualization.sql:39`, and `mira-hub/db/migrations/055_contextualization.sql:72`; batch approval publishes only accepted rows at `mira-hub/src/app/api/contextualization/batches/[batchId]/review/route.ts:98`; KG/UNS storage exists at `mira-hub/db/migrations/001_knowledge_graph.sql:3` and `mira-hub/db/migrations/010_kg_uns_path.sql:3`.

FactoryLM should be treated as an edge/demo/proof input source, not a replacement product spine. Its repo contains useful PLC/live/demo pieces, but the audited paths do not use MIRA's `kg_entities`, `knowledge_entries`, `relationship_proposals`, `health_scores`, or asset approval model. Evidence: FactoryLM dashboard is explicitly not implemented at `C:\Users\hharp\Desktop\factorylm-monorepo\apps\dashboard\NOT_IMPLEMENTED.md:1`; its PLC Modbus route exposes read status at `C:\Users\hharp\Desktop\factorylm-monorepo\services\plc-modbus\backend\routes\plc.py:35`; its separate diagnosis service calls an LLM from PLC/context state at `C:\Users\hharp\Desktop\factorylm-monorepo\services\diagnosis\main.py:296`.

No new database, graph store, or chatbot surface is needed. The gaps are wiring gaps: the offline bundle path and JSON intake path have different semantics, document chunks are not consistently tied into readiness/approval, approved-only retrieval is present but not enforced everywhere, and the SimLab/live loop is not yet one command. Evidence: the Hub import route documents JSON intake vs legacy bundle behavior at `mira-hub/src/app/api/contextualization/import/route.ts:18`; that same route says document/`knowledge_entries` seeding is out of scope at `mira-hub/src/app/api/contextualization/import/route.ts:29`; approved-only retrieval is feature-flagged at `mira-hub/src/lib/manual-rag.ts:50` and `mira-bots/shared/neon_recall.py:112`; SimLab staging remains pending infrastructure in `docs/runbooks/2026-06-23-simlab-relay-ingest-staging-validation.md:335`.

## Sub-Agent 1: Offline Contextualizer

What exists:

- Accepted documents include text, HTML, images, PDF, DOCX, XLSX, and CSV through `DOC_EXTS` and extraction routing. Evidence: `mira-contextualizer/mira_contextualizer/extract.py:22` and `mira-contextualizer/mira_contextualizer/extract.py:92`.
- PLC text routing accepts L5X, CSV, ST, and XML; advisory labels include manuals. Evidence: `mira-contextualizer/mira_contextualizer/engine.py:20` and `mira-contextualizer/mira_contextualizer/engine.py:32`.
- CCW whole-project import recognizes controller and Micro820-related files, including ST/STF/IECST, CCW module/project files, `LogicalValues.csv`, Modbus server XML, `LogicView.xml`, and `DevicePref.xml`. Evidence: `mira-contextualizer/mira_contextualizer/ccw.py:358`.
- The offline store has `projects`, `sources`, `extractions`, and `exports`; extraction rows carry `tag_name`, `roles`, `uns_path_proposed`, `i3x_element_id`, `evidence_json`, `confidence`, and `status`. Evidence: `mira-contextualizer/mira_contextualizer/store.py:17` and `mira-contextualizer/mira_contextualizer/store.py:40`.
- Project identity fields include machine, asset, manufacturer/model/serial, controller, site/area/line, proposed UNS, and Hub asset id. Evidence: `mira-contextualizer/mira_contextualizer/store.py:67`.
- Document IR is `mira-contextualizer/document@1`, using `DocBlock` records with text, kind, page, section, and confidence. Evidence: `mira-contextualizer/mira_contextualizer/extract.py:28` and `mira-contextualizer/mira_contextualizer/extract.py:57`.
- PLC IR models controllers, programs, routines, rungs, tags, provenance, and additive namespace nodes. Evidence: `mira-plc-parser/mira_plc_parser/ir.py:48`, `mira-plc-parser/mira_plc_parser/ir.py:187`, and `mira-plc-parser/mira_plc_parser/ir.py:219`.
- The review model is `pending | accepted | rejected` offline and in Hub. Evidence: `mira-contextualizer/mira_contextualizer/store.py:240`, `mira-contextualizer/mira_contextualizer/server.py:180`, and `mira-hub/db/migrations/055_contextualization.sql:82`.
- Bundle schema is `mira-contextualizer/bundle@1` and includes `manifest.json`, `uns.json`, `i3x.json`, `kg_entities.json`, `kg_relationships.json`, `signals.csv`, `evidence.json`, documents, review, scorecard, report, and import instructions. Evidence: `mira-contextualizer/mira_contextualizer/bundle.py:1`, `mira-contextualizer/mira_contextualizer/bundle.py:7`, and `mira-contextualizer/mira_contextualizer/bundle.py:459`.
- Hub import accepts both JSON `contextualization-intake/v1` and legacy multipart bundle zip. Evidence: `mira-hub/src/app/api/contextualization/import/route.ts:18` and `mira-hub/src/lib/contextualization/intake-contract.ts:23`.

Gaps for novice self-serve:

- Hub source types cannot represent CCW or Ignition JSON directly; offline CCW source type becomes `other` in legacy bundle import. Evidence: `mira-contextualizer/mira_contextualizer/server.py:350`, `mira-hub/src/lib/contextualization/bundle-import.ts:33`, and `mira-hub/db/migrations/055_contextualization.sql:43`.
- Documentation says Hub import seeds `knowledge_entries`, but the current route says document/knowledge seeding is out of scope. Evidence: `mira-contextualizer/ARCHITECTURE.md:209` and `mira-hub/src/app/api/contextualization/import/route.ts:29`.
- Siemens/TIA is detected but not parsed. Evidence: `mira-plc-parser/mira_plc_parser/detect.py:110` and `mira-plc-parser/mira_plc_parser/pipeline.py:24`.
- OCR depends on Tesseract; scanned PDFs/images degrade when it is missing. Evidence: `mira-contextualizer/mira_contextualizer/extract.py:71`, `mira-contextualizer/mira_contextualizer/extract.py:207`, and `mira-contextualizer/ARCHITECTURE.md:225`.

## Sub-Agent 2: Hub / FactoryLM Workflow

What exists:

- Public entry is `mira-web`, which sells structured namespace first and routes users toward assessment, quickstart, and `/cmms`. Evidence: `mira-web/src/views/home.ts:90`, `mira-web/src/views/home.ts:244`, and `mira-web/src/views/cmms.ts:228`.
- Hub registration creates a user/tenant, and `ensureUserAndTenant` mirrors Hub tenant identity to the data-side `tenants` table. Evidence: `mira-hub/src/app/api/auth/register/route.ts:72` and `mira-hub/src/lib/users.ts:272`.
- Onboarding stores wizard progress and can create site/line `kg_entities` plus namespace versions. Evidence: `mira-hub/src/app/(hub)/onboarding/page.tsx:62`, `mira-hub/src/app/api/wizard/[step]/route.ts:18`, and `mira-hub/src/app/api/wizard/[step]/route.ts:200`.
- Namespace node upload is the stronger "folder = brain" path: uploads go through `/api/namespace/node/[id]/files`, create `hub_uploads`, write `knowledge_entries` with `metadata.node_id`, and NodeChat retrieves only that node/subtree. Evidence: `mira-hub/src/app/(hub)/namespace/page.tsx:271`, `mira-hub/src/app/api/namespace/node/[id]/files/route.ts:175`, `mira-hub/src/lib/node-knowledge-ingest.ts:267`, and `mira-hub/src/app/api/namespace/node/[id]/chat/route.ts:247`.
- Contextualizer imports land in `contextualization_projects`, `ctx_import_batches`, `ctx_sources`, and `ctx_extractions` for JSON intake; legacy bundles recreate project/source/extraction rows. Evidence: `mira-hub/src/app/api/contextualization/import/route.ts:21`, `mira-hub/src/app/api/contextualization/import/route.ts:63`, and `mira-hub/src/app/api/contextualization/import/route.ts:259`.
- Project review accepts/rejects `ctx_extractions`; promote stages accepted rows as proposed KG entities plus pending `ai_suggestions`. Evidence: `mira-hub/src/app/(hub)/contextualization/[id]/page.tsx:124`, `mira-hub/src/app/api/contextualization/[id]/promote/route.ts:22`, and `mira-hub/src/app/api/contextualization/[id]/promote/route.ts:121`.
- Batch review is the publish gate for contract imports; approving a batch publishes accepted extractions as verified signal `kg_entities` and accepts paired suggestions. Evidence: `mira-hub/src/app/(hub)/contextualization/review/[batchId]/page.tsx:112`, `mira-hub/src/app/api/contextualization/batches/[batchId]/review/route.ts:29`, and `mira-hub/src/app/api/contextualization/batches/[batchId]/review/route.ts:98`.

Disconnected pieces:

- Hub onboarding Ignition import is mock-first; live gateway import status is UNKNOWN from this route. Evidence: `mira-hub/src/app/(hub)/onboarding/page.tsx:915`, `mira-hub/src/app/(hub)/onboarding/page.tsx:950`, and `mira-hub/src/app/api/connectors/ignition/import/route.ts:7`.
- Local onboarding PDF upload lands in the tenant Inbox despite passing `unsPath`; node-specific namespace upload is the more direct citable path. Evidence: `mira-hub/src/app/(hub)/onboarding/page.tsx:724`, `mira-hub/src/lib/local-upload.ts:174`, and `mira-hub/src/lib/inbox-node.ts:1`.
- Train-and-approve exists in Hub, but the HMI runtime gate is default-off in `mira-pipeline/ignition_chat.py`. Evidence: `mira-hub/src/components/AssetValidateTab.tsx:86`, `mira-hub/src/app/api/assets/[id]/agent-status/transition/route.ts:64`, `mira-pipeline/ignition_chat.py:46`, and `mira-pipeline/ignition_chat.py:537`.
- FactoryLM does not contain the Hub workflow equivalent. Evidence: `C:\Users\hharp\Desktop\factorylm-monorepo\AGENTS.md:19`, `C:\Users\hharp\Desktop\factorylm-monorepo\apps\dashboard\NOT_IMPLEMENTED.md:1`, `C:\Users\hharp\Desktop\factorylm-monorepo\apps\portal\README.md:1`, and `C:\Users\hharp\Desktop\factorylm-monorepo\apps\cmms\README.md:55`.

## Sub-Agent 3: UNS / KG / Approval Layer

Canonical identity and address model:

- Retrieval chunks live in `knowledge_entries` with id, tenant, source fields, content, embedding, source URL/page, metadata, privacy, and verified state. Evidence: `docs/migrations/001_knowledge_entries.sql:11`.
- KG identity is `kg_entities.id` and `kg_relationships.id`; edges reference `kg_entities.id` through `source_id` and `target_id`. Evidence: `mira-hub/db/migrations/001_knowledge_graph.sql:3`.
- Current entity natural key is `(tenant_id, entity_type, name)` after `entity_id` became nullable. Evidence: `mira-hub/db/migrations/026_kg_entities_dedupe_and_constraint.sql:81`.
- Canonical address is `kg_entities.uns_path ltree`, described as a cached/queryable projection while the graph remains the source of truth. Evidence: `mira-hub/db/migrations/010_kg_uns_path.sql:3`.
- Intake contract says UUIDs are identity; names, numbers, serials, controller IPs, and UNS paths are matching evidence, not sole keys. Evidence: `mira-hub/src/lib/contextualization/intake-contract.ts:15`.
- `namespace_versions` is append-only audit for namespace changes, not the identity source. Evidence: `mira-hub/db/migrations/021_namespace_builder.sql:136`.

Approval model:

- Edge proposals are canonicalized through `relationship_proposals` and `relationship_evidence`; nothing should land in `kg_relationships` until verified. Evidence: `mira-hub/db/migrations/018_relationship_proposals.sql:6` and `mira-hub/db/migrations/018_relationship_proposals.sql:67`.
- Non-edge decisions live in `ai_suggestions`; for `kg_edge`, suggestions are headers over `relationship_proposals`. Evidence: `mira-hub/db/migrations/027_ai_suggestions.sql:3` and `mira-hub/db/migrations/027_ai_suggestions.sql:14`.
- Verified KG state is stored on KG rows with `approval_state`; relationships also carry `proposed_by` and `evidence_summary`. Evidence: `mira-hub/db/migrations/029_kg_approval_state.sql:23`.
- Hub transitions are centralized in `applyHubProposalTransition`. Evidence: `mira-hub/src/lib/proposal-transition.ts:39` and `mira-hub/src/lib/proposal-transition.ts:95`.
- Engine-side KG transitions are separately centralized for `kg_entities` and `kg_relationships`. Evidence: `mira-bots/shared/proposal_transition.py:1`, `mira-bots/shared/proposal_transition.py:29`, and `mira-bots/shared/proposal_transition.py:62`.

Conflicts and unknowns:

- Node chunk addressing is implemented through `knowledge_entries.metadata->>'node_id'`, while migration notes describe `knowledge_entries.doc_id -> hub_uploads.kg_entity_id -> kg_entities.uns_path`. Evidence: `mira-hub/db/migrations/045_knowledge_entries_chunk_anchors.sql:23` and `mira-hub/src/lib/manual-rag.ts:343`.
- Hub manual retrieval and bot retrieval both read `knowledge_entries` but use different tenant/shared filters. Evidence: `mira-hub/src/lib/manual-rag.ts:14` and `mira-bots/shared/neon_recall.py:400`.
- `knowledge_entries.tenant_id` type has doc/history drift between the base docs migration and Hub production notes. Evidence: `docs/migrations/001_knowledge_entries.sql:11` and `mira-hub/db/migrations/051_backfill_tenants_from_hub_tenants.sql:5`.
- `uns_resolver` selects `kg_entities.label`, while the current Hub KG schema uses `name`; live compatibility is UNKNOWN. Evidence: `mira-bots/shared/uns_resolver.py:724` and `mira-hub/db/migrations/001_knowledge_graph.sql:3`.
- Approval-gated retrieval exists but defaults off; until `MIRA_ENFORCE_APPROVED_RETRIEVAL=true` and corpus backfill are proven, unverified `knowledge_entries` may still be cited. Evidence: `mira-bots/shared/neon_recall.py:112` and `mira-hub/src/lib/manual-rag.ts:50`.

## Sub-Agent 4: MIRA Agent / Troubleshooting

What exists:

- Shared bot/OpenWebUI recall retrieves from tenant plus shared OEM `knowledge_entries`, with BM25/vector/fault-code streams and fallback behavior. Evidence: `mira-bots/shared/neon_recall.py:101`, `mira-bots/shared/neon_recall.py:491`, `mira-bots/shared/neon_recall.py:730`, and `mira-bots/shared/neon_recall.py:874`.
- Approved-only recall is env-gated and default-off; live deployment state is UNKNOWN. Evidence: `mira-bots/shared/neon_recall.py:112`.
- RAG worker injects retrieved chunks with source labels and stores per-call RAG evidence. Evidence: `mira-bots/shared/workers/rag_worker.py:736`, `mira-bots/shared/workers/rag_worker.py:762`, and `mira-bots/shared/workers/rag_worker.py:835`.
- Hub quickstart Ask uses cite-or-refuse prompting and suppresses phantom citations on refusals. Evidence: `mira-hub/src/app/api/quickstart/ask/route.ts:86`, `mira-hub/src/app/api/quickstart/ask/route.ts:132`, `mira-hub/src/app/api/quickstart/ask/route.ts:154`, and `mira-hub/src/app/api/quickstart/ask/route.ts:182`.
- Hub node Ask is subtree-scoped and emits retrieved sources plus approved source count. Evidence: `mira-hub/src/app/api/namespace/node/[id]/chat/route.ts:1`, `mira-hub/src/app/api/namespace/node/[id]/chat/route.ts:169`, `mira-hub/src/app/api/namespace/node/[id]/chat/route.ts:249`, and `mira-hub/src/app/api/namespace/node/[id]/chat/route.ts:300`.
- Hub `/api/mira/ask` can use confirmed troubleshooting sessions, asset rows, components, templates, KG relationships, current signal cache, and recent signal events. Evidence: `mira-hub/src/app/api/mira/ask/route.ts:92`, `mira-hub/src/app/api/mira/ask/route.ts:129`, `mira-hub/src/app/api/mira/ask/route.ts:176`, `mira-hub/src/app/api/mira/ask/route.ts:205`, and `mira-hub/src/app/api/mira/ask/route.ts:218`.

Gates and gaps:

- The shared engine blocks diagnosis until asset/UNS confirmation unless direct connection supplies context. Evidence: `mira-bots/shared/engine.py:5629`, `mira-bots/shared/engine.py:5638`, `mira-bots/shared/engine.py:5683`, and `mira-bots/shared/engine.py:5847`.
- Hub `/api/mira/ask` returns `412` when a troubleshooting session is not confirmed. Evidence: `mira-hub/src/app/api/mira/ask/route.ts:129`.
- Ignition chat uses HMAC, rejects asset-specific questions without UNS context, and forwards direct connection context to the engine. Evidence: `mira-pipeline/ignition_chat.py:457`, `mira-pipeline/ignition_chat.py:500`, and `mira-pipeline/ignition_chat.py:608`.
- Citation compliance can detect, sanitize, rewrite, and admit gaps, but the main compliance check does not block by itself. Evidence: `mira-bots/shared/citation_compliance.py:144`, `mira-bots/shared/citation_compliance.py:163`, `mira-bots/shared/citation_compliance.py:315`, `mira-bots/shared/engine.py:619`, and `mira-bots/shared/engine.py:1238`.
- Hub manual prompts are strict about using only context; shared engine grounding is weaker because `_is_grounded` returns true with no sources. Evidence: `mira-hub/src/lib/manual-rag.ts:506` and `mira-bots/shared/engine.py:5516`.
- `/api/mira/ask` labels KG context "verified relationships," but the observed relationship query does not filter `approval_state='verified'`; the approved-context guarantee for that route is UNKNOWN/likely disconnected. Evidence: `mira-hub/src/app/api/mira/ask/route.ts:189` and `mira-hub/src/app/api/mira/ask/route.ts:330`.
- Fresh Hub node uploads write `knowledge_entries`, but the audited insert path did not prove `verified=true`; behavior under approved-only retrieval is UNKNOWN without running the current gate. Evidence: `mira-hub/src/lib/node-knowledge-ingest.ts:197`, `mira-hub/src/lib/node-knowledge-ingest.ts:261`, and `mira-hub/src/lib/node-knowledge-ingest.ts:267`.

## Sub-Agent 5: Live Data / Conveyor / SimLab Proof

What exists:

- SimLab is a deterministic simulator and safe proof source for live tags, UNS, alarms, documents, and scoring; simulated readings are marked `source_system="simulator"`. Evidence: `docs/simlab/README.md:5` and `docs/simlab/README.md:11`.
- SimLab exposes snapshot, evidence packet, rubric, replay, and eval scorecard endpoints. Evidence: `simlab/api.py:196`, `simlab/api.py:303`, `simlab/api.py:264`, and `simlab/api.py:386`.
- SimLab relay publishing is opt-in, HMAC-capable, and read-only publish-out. Evidence: `simlab/api.py:86`, `simlab/api.py:89`, and `simlab/api.py:96`.
- Relay ingest exposes `/api/v1/tags/ingest`, uses HMAC, fails closed on `approved_tags`, appends `tag_events`, and upserts `live_signal_cache`. Evidence: `mira-relay/relay_server.py:250`, `mira-relay/relay_server.py:253`, `mira-relay/tag_ingest.py:13`, and `mira-relay/tag_ingest.py:19`.
- DB schema supports append-only telemetry and approved tag allowlisting. Evidence: `mira-hub/db/migrations/033_tag_events.sql:177`, `mira-hub/db/migrations/035_approved_tags.sql:39`, and `mira-hub/db/migrations/036_current_tag_state_freshness.sql:45`.
- Command Center reads `live_signal_cache` by UNS path for freshness/display state. Evidence: `mira-hub/src/app/api/command-center/tree/route.ts:141` and `mira-hub/src/app/api/command-center/tree/route.ts:150`.
- Ignition WebDev has read-only browse/read/diagnose/chat surfaces using HMAC and allowlists. Evidence: `ignition/webdev/FactoryLM/api/tags/doGet.py:8`, `ignition/webdev/FactoryLM/api/diagnose/doGet.py:3`, and `ignition/webdev/FactoryLM/api/chat/doPost.py:1`.
- Garage conveyor golden path seeds approved/unapproved chunks, approved KG entities, and tests recall under the gate. Evidence: `tests/golden/garage_conveyor_golden_path.py:4`, `tests/golden/garage_conveyor_golden_path.py:69`, and `tests/golden/garage_conveyor_golden_path.py:130`.

Proof gaps and risks:

- Full upload -> approve -> map live tags -> ask MIRA -> cited answer is not one command yet. Evidence: staging remains pending infrastructure in `docs/runbooks/2026-06-23-simlab-relay-ingest-staging-validation.md:335`.
- Ignition live chat returns empty `sources`, `citations`, and `evidence`; cited answer from live path is incomplete. Evidence: `mira-pipeline/ignition_chat.py:654`.
- Upload evidence status is conflicting between older runbook and newer beta gate; current truth is UNKNOWN without running the gate. Evidence: `docs/runbooks/upload-manual-verify-citable.md:11` and `tests/beta/beta_ready_upload_retrieval_citation.py:12`.
- Approved-tags admin/write path is explicitly UNVERIFIED in workflow docs. Evidence: `docs/workflows/tag-ingestion-flow.md:197`.
- Legacy `tools/demo_plc_poller.py` uses old `/ingest` and direct cache writes, not the modern approved-tags path. Evidence: `tools/demo_plc_poller.py:25` and `tools/demo_plc_poller.py:453`.
- Do not use FactoryLM conveyor-lab as the read-only proof path because it has start/stop/speed/direction control and Modbus writes. Evidence: `C:\Users\hharp\Desktop\factorylm-monorepo\apps\conveyor-lab\backend\src\routes\status.ts:17` and `C:\Users\hharp\Desktop\factorylm-monorepo\apps\conveyor-lab\backend\src\services\modbus-conveyor-adapter.ts:74`.
- Do not use `plc/live_monitor.py` for proof collection because it writes GS10 commands and speed. Evidence: `plc/live_monitor.py:5` and `plc/live_monitor.py:399`.

## Sub-Agent 6: Integration Lead

Inventory summary:

- Offline/assisted intake exists in MIRA contextualizer. Evidence: `mira-contextualizer/ARCHITECTURE.md:9`, `mira-contextualizer/ARCHITECTURE.md:19`, and `mira-contextualizer/ARCHITECTURE.md:144`.
- PLC/tag extraction exists in MIRA PLC parser; FactoryLM has live PLC readers. Evidence: `mira-plc-parser/mira_plc_parser/uns.py:1`, `mira-plc-parser/mira_plc_parser/uns.py:94`, and `C:\Users\hharp\Desktop\factorylm-monorepo\services\plc-modbus\backend\routes\plc.py:35`.
- Human approval exists offline and in Hub; batch approval publishes accepted rows only. Evidence: `mira-contextualizer/ARCHITECTURE.md:77`, `mira-hub/src/lib/contextualization/approval.ts:1`, `mira-hub/src/lib/contextualization/approval.ts:92`, and `mira-hub/src/app/api/contextualization/batches/[batchId]/review/route.ts:147`.
- Readiness levels and next steps exist, but document counts may not reflect approved `knowledge_entries`. Evidence: `mira-hub/src/lib/health-score.ts:10`, `mira-hub/src/lib/health-score.ts:77`, `mira-hub/src/app/api/readiness/recalculate/route.ts:47`, and `mira-hub/src/lib/node-knowledge-ingest.ts:196`.
- Asset deploy approval exists but safety-critical proposal counts are deferred/hardcoded in audited routes. Evidence: `mira-hub/db/migrations/046_asset_agent_status.sql:8`, `mira-hub/src/app/api/assets/[id]/agent-status/route.ts:78`, `mira-hub/src/app/api/assets/[id]/agent-status/route.ts:82`, and `mira-hub/src/app/api/assets/[id]/agent-status/transition/route.ts:82`.

Minimal glue:

- Make MIRA Hub the canonical spine using existing `kg_entities`, `kg_relationships`, `ai_suggestions`, `health_scores`, `knowledge_entries`, and `approved_tags`. Evidence for these existing stores appears in `mira-hub/db/migrations/001_knowledge_graph.sql:3`, `mira-hub/db/migrations/018_relationship_proposals.sql:6`, `mira-hub/db/migrations/027_ai_suggestions.sql:3`, `mira-hub/src/lib/health-score.ts:10`, `docs/migrations/001_knowledge_entries.sql:11`, and `mira-hub/db/migrations/035_approved_tags.sql:39`.
- Treat FactoryLM live/discovery data as read-only proposals into MIRA, not direct KG writes. Evidence: FactoryLM discovery candidates exist at `C:\Users\hharp\Desktop\factorylm-monorepo\services\plc-modbus\backend\services\discovery_daemon.py:117` and `C:\Users\hharp\Desktop\factorylm-monorepo\services\plc-modbus\backend\services\discovery_daemon.py:286`; MIRA connector service/gate exists at `mira-connectors/mira_connectors/service.py:1` and `mira-connectors/mira_connectors/confirmation_gate.py:6`.
- Use MIRA relay `approved_tags` for telemetry; exclude FactoryLM write endpoints. Evidence: `mira-relay/tag_ingest.py:388`, `mira-relay/tag_ingest.py:411`, and `C:\Users\hharp\Desktop\factorylm-monorepo\services\plc-modbus\backend\routes\plc.py:77`.
- Wire SimLab proof through approved tags, relay ingest, node chat or asset validation, and the staging gate. Evidence: approved tag seed generator exists at `tools/seeds/gen_approved_tags_simulator.py:78`; SimLab runner supports dry-run/eval at `tests/simlab/runner.py:17` and `tests/simlab/runner.py:124`; staging gate is not wired at `docs/gtm/go-to-market-hardening-checklist.md:178`.

## Existing Pieces Inventory

| Spine step | Existing MIRA / FactoryLM piece | Status |
|---|---|---|
| Offline / assisted intake | MIRA contextualizer local projects/sources/extractions and bundle export | Works; docs drift exists |
| Document + PLC/tag extraction | Contextualizer document IR, PLC parser IR, CCW import, MIRA PLC parser | Works; Siemens planned; OCR dependency |
| Asset discovery | Hub onboarding/namespace, connector canonical records, contextualizer machine fields | Partly connected |
| Human accept/reject approval | Offline statuses, `ctx_extractions`, `ctx_import_batches`, batch review, suggestions | Works; two paths need alignment |
| UNS / KG storage | `kg_entities.id`, `kg_relationships.id`, `kg_entities.uns_path`, `knowledge_entries` | Works; some address/filter drift |
| Readiness score + checklist | `health-score.ts`, readiness recalc, asset status gates | Works; checklist must count approved docs/chunks |
| MIRA answers from approved context | NodeChat, manual RAG, shared engine, asset agent gate | Present but not enforced everywhere |
| Optional live telemetry | Relay ingest, `approved_tags`, `tag_events`, `live_signal_cache`, Command Center | Works; admin/proof path incomplete |
| SimLab / conveyor proof loop | SimLab, relay publisher, golden path, garage conveyor tests | Strong pieces; one-command proof missing |

## What Already Works

- Offline extraction and bundle generation work as a proposed-context source. Evidence: `mira-contextualizer/mira_contextualizer/bundle.py:1`, `mira-contextualizer/mira_contextualizer/bundle.py:459`, and `mira-contextualizer/tests/test_bundle.py:79`.
- Hub batch imports and human approval publish accepted extractions as verified signal entities. Evidence: `mira-hub/src/app/api/contextualization/import/import.integration.test.ts:94` and `mira-hub/src/app/api/contextualization/batches/[batchId]/review/review.integration.test.ts:78`.
- Node upload and subtree retrieval have route/proof coverage. Evidence: `mira-hub/src/app/api/namespace/node/[id]/files/__tests__/route.test.ts:46`, `mira-hub/src/app/api/namespace/node/[id]/chat/__tests__/route.test.ts:88`, and `mira-hub/scripts/verify-node-subtree-retrieval.ts:1`.
- Approved-only SQL filters have tests for manual/node retrieval. Evidence: `mira-hub/src/lib/__tests__/manual-rag.test.ts:123` and `mira-hub/src/lib/__tests__/manual-rag.test.ts:256`.
- Live relay rejects unapproved tags and handles simulated ingestion. Evidence: `mira-relay/tests/test_tag_ingest.py:96` and `mira-relay/tests/test_tag_ingest.py:156`.
- UNS confirmation, live snapshot, and decision trace have tests. Evidence: `tests/test_uns_confirmation_gate.py:56`, `mira-bots/tests/test_live_snapshot.py:31`, `mira-bots/tests/test_engine_live_snapshot.py:51`, and `mira-bots/tests/test_decision_trace.py:1`.

## What Is Duplicated

- FactoryLM diagnosis and MIRA troubleshooting both answer industrial questions, but only MIRA shows the audited approval/retrieval/citation spine. Evidence: FactoryLM diagnosis at `C:\Users\hharp\Desktop\factorylm-monorepo\services\diagnosis\main.py:176`, `C:\Users\hharp\Desktop\factorylm-monorepo\services\diagnosis\main.py:232`, and MIRA gates at `mira-bots/shared/engine.py:5629`, `mira-hub/src/app/api/namespace/node/[id]/chat/route.ts:169`.
- FactoryLM has a separate Brain schema and HIL queue, not MIRA's KG approval layer. Evidence: `C:\Users\hharp\Desktop\factorylm-monorepo\brain\schemas\neon_schema.sql:12`, `C:\Users\hharp\Desktop\factorylm-monorepo\apps\mission-control\backend\main.py:437`, and `C:\Users\hharp\Desktop\factorylm-monorepo\apps\mission-control\backend\main.py:577`.
- Hub has two proposal surfaces by design: `relationship_proposals` for edges and `ai_suggestions` for broad workflow. Evidence: `mira-hub/db/migrations/027_ai_suggestions.sql:14` and `mira-hub/src/lib/proposal-transition.ts:74`.

## What Is Disconnected

- Legacy bundle import preserves offline statuses and goes to project review; JSON intake maps into proposed batch review. Evidence: `mira-hub/src/lib/contextualization/bundle-import.ts:71`, `mira-hub/src/lib/contextualization/intake-contract.ts:223`, and `mira-hub/src/app/(hub)/contextualization/review/page.tsx:89`.
- Bundle export contains KG entities/relationships, but Hub import focuses on project/source/extraction recreation and explicitly leaves document/knowledge seeding out of scope. Evidence: `mira-contextualizer/mira_contextualizer/bundle.py:7`, `mira-hub/src/lib/contextualization/bundle-import.ts:46`, and `mira-hub/src/app/api/contextualization/import/route.ts:29`.
- Readiness document counts use `kg_triples_log`, while node/manual upload writes `knowledge_entries`. Evidence: `mira-hub/src/app/api/readiness/recalculate/route.ts:47` and `mira-hub/src/lib/node-knowledge-ingest.ts:196`.
- `/api/mira/ask` does not visibly enforce verified relationship filtering despite labeling context as verified. Evidence: `mira-hub/src/app/api/mira/ask/route.ts:189` and `mira-hub/src/app/api/mira/ask/route.ts:330`.
- Live/SimLab proof is not yet a single reproducible command with cited answer output. Evidence: `docs/runbooks/2026-06-23-simlab-relay-ingest-staging-validation.md:335` and `mira-pipeline/ignition_chat.py:654`.

## Unknowns To Resolve Before Implementation Claims

- UNKNOWN: live deployment value of `MIRA_ENFORCE_APPROVED_RETRIEVAL`. Evidence only proves code flags at `mira-hub/src/lib/manual-rag.ts:50` and `mira-bots/shared/neon_recall.py:112`.
- UNKNOWN: whether fresh node uploads are verified under approved-only retrieval without running current beta gates. Evidence: write path at `mira-hub/src/lib/node-knowledge-ingest.ts:261` and beta gate at `tests/beta/beta_ready_upload_retrieval_citation.py:12`.
- UNKNOWN: whether `uns_resolver` DB enrichment works against current Hub schema because it selects `kg_entities.label`. Evidence: `mira-bots/shared/uns_resolver.py:724` and `mira-hub/db/migrations/001_knowledge_graph.sql:3`.
- UNKNOWN: external-AI package status in this worktree; prior memory references `mira-mcp/factorylm_external_ai`, but current audit found only public copy in `mira-web/src/views/security.ts:193`.
- UNKNOWN: runtime liveness of Hub, relay, SimLab, and FactoryLM services because this task was an investigation and did not run deployments or DB write tests.

## Suggested Verification Commands Before Any Code PR

Run these only when ready to verify behavior, not as part of this read-only audit:

```powershell
cd C:\Users\hharp\.codex\worktrees\a113\MIRA\mira-contextualizer
python -m pytest

python -m pytest C:\Users\hharp\.codex\worktrees\a113\MIRA\mira-plc-parser\tests -q

cd C:\Users\hharp\.codex\worktrees\a113\MIRA\mira-hub
npx vitest run src/lib/__tests__/health-score.test.ts src/lib/__tests__/manual-rag.test.ts src/lib/asset-agent-transition.test.ts src/lib/contextualization/approval.test.ts

python -m pytest C:\Users\hharp\.codex\worktrees\a113\MIRA\mira-relay\tests\test_tag_ingest.py -q
python C:\Users\hharp\.codex\worktrees\a113\MIRA\tests\simlab\runner.py --dry-run
cd C:\Users\hharp\Desktop\factorylm-monorepo
pytest services/plc-modbus
```

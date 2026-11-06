# Asset Memory capability inventory and gap analysis

Evidence snapshot: 2026-11-06. Default branch `090c8e15bfcbd85f0091103cf5a6f5fc6b221056`;
guide follow-up `d91536ab6fbfd0d0382123cebf1bb31d0f9256ed` builds on unmerged
#5235/#5236. This is an inventory, not a deployment or human-acceptance receipt.
Product direction: [Asset Memory North Star](../NORTH_STAR_ASSET_MEMORY.md).
Coordination: [#5238](https://github.com/Mikecranesync/MIRA/issues/5238).

## Existing implementations, owners and evidence

Paths link to this branch; main-versus-draft differences are explicit below.
Verified code means source was inspected. Reported runtime evidence is pinned
to the cited receipt and must not be promoted to current environment truth.

| Capability / data flow | Existing code and contract | Tests / evidence | State and owner |
|---|---|---|---|
| Asset identity / confirmation | [equipment-notebooks.ts](../../mira-hub/src/lib/equipment-notebooks.ts), `resolveBoundAsset`; [asset-bridge.ts](../../mira-hub/src/lib/knowledge-graph/asset-bridge.ts) | Equipment notebook domain/bound-asset tests; wrong-tenant/unverified/missing binding controls | Implemented on main. Domain asset keys, KG UUIDs and provider IDs differ. Notebook confirmation is not a global merge of identities. |
| Postgres equipment graph | [types](../../mira-hub/src/lib/knowledge-graph/types.ts), [traversal](../../mira-hub/src/lib/knowledge-graph/traversal.ts), [context-builder](../../mira-hub/src/lib/knowledge-graph/context-builder.ts) | Existing traversal/context-builder tests | Main code connects verified entities/edges to chat. No new graph needed. `maintenanceContext` is live/bounded and drops edge/review identifiers. Graph owner not reassigned by this mission. |
| Equipment context | [asset context route](../../mira-hub/src/app/api/assets/[id]/context/route.ts) reads CMMS identity, installed components, signal count and telemetry memory | Route tests under its `__tests__` | Main code; current summary, not replayable all-source record. General UNS resolver alone lacks the notebook's explicit approval check. |
| Telemetry Machine Memory | [machine-memory.ts](../../mira-hub/src/lib/machine-memory.ts), [response](../../mira-hub/src/lib/machine-memory-response.ts), [GET](../../mira-hub/src/app/api/assets/[id]/machine-memory/route.ts) | Response/route/stream tests; [observer #3489](https://github.com/Mikecranesync/MIRA/issues/3489) | Existing run/window/diff/live-cache reads, separate from maintenance-job history. Observer is owner-gated; do not create another observer or infer current feed health. |
| Living Sheet execution | [types](../../mira-hub/src/capabilities/living-sheet/types.ts), [store](../../mira-hub/src/capabilities/living-sheet/store.ts), [reducer](../../mira-hub/src/capabilities/living-sheet/reduce.ts) | Reducer/route/real-PG suites; migration114 canonical, main #5231 | Main append-only log, sequence replay, correction history, original machine snapshot and transactional finish outbox. Types header still calls114 proposed: stale comment, not schema truth. |
| Reusable template revisions | [job-sheet-store](../../mira-hub/src/capabilities/living-sheet/job-sheet-store.ts), [importer](../../mira-hub/src/capabilities/living-sheet/job-sheet-import.ts) | Template integration/import tests | Main draft/reviewed append-only snapshots. Legacy whole-template review is not the requested per-fact/step approval workflow. |
| Structured guide intake / QC | [intake-closeout-store](../../mira-hub/src/capabilities/living-sheet/intake-closeout-store.ts), [metadata](../../mira-hub/src/capabilities/living-sheet/instruction-metadata.ts), [v2](../../mira-hub/src/capabilities/living-sheet/instruction-record-v2.ts) | Draft #5236:57 local PG tests,30 cloud must-run template tests;35 branch checks at8a54f29a | Unmerged draft, Codex01a1ae98. Preserves original packet/record, step map, captured identity, exact source sequence/hash, candidate concurrency and authenticated technician QC. Later acceptance absent. |
| Human / JSON / guide output | [v1](../../mira-hub/src/capabilities/living-sheet/instruction-record.ts), [Guide](../../mira-hub/src/factorylm-ui/LivingInstructionGuide.tsx), [print](../../mira-hub/src/factorylm-ui/living-sheet-print.ts) | #5235:56 checks at7d3a4654; #5239:40-field regression/31-target browser proof,5-page synthetic PDF | v1/v2 export and imported illustrated guide are drafts. Browser print/save PDF reuses existing renderer. #5239 fixes fields/sources missing from human output. No human-verified instruction or full automatic step assembly. |
| Technician observations | [store](../../mira-hub/src/capabilities/observations/store.ts), [projection](../../mira-hub/src/capabilities/observations/project.ts), [turn context](../../mira-hub/src/capabilities/observations/turn-context.ts) | Projection/route/real-PG and observed-state chat tests; follow-up [#5104](https://github.com/Mikecranesync/MIRA/pull/5104) | Main implementation, default-off flag. Closure registry records disabled deployment and promotion owner missing. IDs, observed/recorded times, uncertainty and contested state already exist. |
| Viewer-owned notebook memory | [listTurns / recordTurn](../../mira-hub/src/lib/equipment-notebooks.ts), [report context](../../mira-hub/src/lib/notebook-query.ts) | Field-report scope/context, turn-ownership, idempotent request tests | Main. Private viewer/thread rules; report recall also checks saved/current equipment. Ownerless legacy history remains a separate compatibility rule. Do not share private Q/A by asset automatically. |
| Job context in chat | [F18 seam](../../mira-hub/src/app/api/equipment-notebooks/[id]/chat/route.ts), `renderLivingSheetJobSection` and `livingSheetJobId` | `chat/__tests__/living-sheet-job-context.test.ts` checks data-channel injection | Main selected-job read lacks current-asset comparison, says every job is in progress, omits done work/corrections/QC/candidate reference. Existing unbound reads must remain possible with historical labels. |
| Document bytes / source membership | [workspace-files](../../mira-hub/src/lib/workspace-files.ts), `linkedDocIdsForTarget`, [ingest](../../mira-hub/src/lib/node-knowledge-ingest.ts) | Confirmed-source, passage-route, citation-origin and notebook-isolation tests | Main tenant+SHA256 byte identity and asset/notebook/node/work-order links; page/ordinal/private chunks already materialized. No re-ingest or whole-PDF extraction needed for recall. |
| Approved retrieval / citations | [validateChatSources](../../mira-hub/src/lib/equipment-notebooks.ts), [retrieveNodeChunks](../../mira-hub/src/lib/manual-rag.ts), [citation types](../../mira-hub/src/lib/notebook-chat-types.ts) | Approved-source admission, isolation and origin-enrichment tests | Main unconditional enabled/positive-trust/non-superseded notebook admission; generic verified-chunk gate configurable. Citation has doc/file/page/quote/origin URL, not universal immutable version hash. Draft parser input admits candidates and is not approved answer evidence. |
| Materialized evidence / context | [contract](../../materialized_evidence/context_contract.py), [technician context](../../mira-bots/shared/technician_context.py), [compiler](../../materialized_evidence) |94 contract/compiler tests on Python3.12; [#3887](https://github.com/Mikecranesync/MIRA/issues/3887) | Existing producer/hash/lineage contract and adapters. Runtime augmentation is default-off/audit-only. Reuse semantics, defer universal runtime adoption. |
| Atlas work-order request / finish | [request outbox](../../mira-hub/src/capabilities/living-sheet/request-work-order-outbox.ts), [finish outbox](../../mira-hub/src/capabilities/living-sheet/finish-outbox.ts), [dispatcher](../../mira-hub/src/capabilities/cmms-dispatch/dispatcher.ts), [status](../../mira-hub/src/capabilities/cmms-dispatch/status.ts) | Outbox/dispatch PG tests; pinned receipts below | Main code. Existing tenant policy, idempotency and read-back reconciliation. Both sheet outboxes store NULL asset_uns_path. Existing Atlas/runtime owner vvmfyb3m; sync reported OFF. No write routing changes in this slice. |
| PLC / OPC UA / MQTT | [Sparkplug subscriber](../../mira-relay/mqtt_ingest/subscriber.py), [tag ingest](../../mira-relay/tag_ingest.py), [Ignition snapshot](../../ignition/webdev/FactoryLM/api/tags/gateway_live_snapshot.py), `mira-connectors/` |51 Sparkplug and79 connector tests passed in audit; no live equipment test | Existing read-only Ignition HTTP/relay and opt-in MQTT subscribe, command rejection and allowlist. Generic registry has five mocks; no live generic OPC UA implementation found. Modbus driver deferred. |
| ISA-95 / UNS / i3X | [UNS helpers](../../mira-crawler/ingest/uns.py), [i3X objects](../../mira-hub/src/lib/i3x/objects.ts), [i3X data](../../mira-hub/src/lib/i3x/data-access.ts) | Existing UNS/i3X tests and approval/read-only guards | Main semantic adapters. i3X elementId is persistent KG UUID; UNS is address metadata. Read/query subset exists; full1.0 conformance/subscriptions not established. |
| Safety / review / release | [approved context](../../mira-hub/src/lib/approved-context.ts), notebook answer/identity gates, [environment doctrine](../environments.md), [SDLC](../architecture/mira-sdlc-v1.md) | Existing hazardous-answer, source/tenant and industrial no-write tests | Preserve all gates. Source match, observation, closeout QC and later approval stay independent; none grants physical safety clearance. |

## Actual bounded flow

Current technician path: confirmed notebook → packet draft/manual parser → local
Work Packet/JobRecord → explicit durable intake (draft #5236) → job_started
snapshot → append-only execution/corrections → finish transaction and existing
outbox → existing Atlas dispatcher/status → authenticated technician closeout
candidate → same saved candidate in v2/illustrated Guide.

Current answer path: viewer/thread-scoped notebook request → server binding and
source admission → existing graph/manual/telemetry/observation context → hardened
data channel/provider → answer/citations → viewer-owned turn evidence. Selected
Living Sheet recall is a separate lossy read at present. There is no single
frozen context manifest tying all these sources together.

The KG's live `maintenanceContext` explicitly checks verified nodes/edges in its
principal queries; its nested PM-mismatch helper lacks explicit approval-state
predicates. Its aggregate omits edge/reviewer/source IDs. `graph-view` defaults
missing state/confidence to verified/1 for display. Neither is an authority-
bearing immutable evidence adapter without further admission/lineage handling.

## One existing test asset/job, without invented linkage

Existing fictional QA tenant `00000000-0000-0000-0000-000000000099`, notebook
`d36d1927-d466-4cb4-8cad-3ce8394c3201`, captured machine key `PUMP-01` (“Goulds
3196 Cooling Water Pump”). Emulator job `04bce10d-1acc-4a21-b5ba-fa06d3d14b05`
has six events and Atlas1652. [Pinned receipt](https://github.com/Mikecranesync/MIRA/blob/8129ed418b5aac362f0e768a868f028237f6715e/docs/proofs/2026-11-05-pilot-emulator/receipt.json)
and [independent read-back](https://github.com/Mikecranesync/MIRA/blob/8129ed418b5aac362f0e768a868f028237f6715e/docs/proofs/2026-11-05-pilot-emulator/atlas-independent.txt).

Physical job `0ea9256a-5989-45e7-bba8-19dc81f2c564` has five events and Atlas1653.
[Pinned receipt](https://github.com/Mikecranesync/MIRA/blob/8129ed418b5aac362f0e768a868f028237f6715e/docs/proofs/2026-11-05-pilot-pixel/receipt.json).
Receipts prove one create marker and finish comment with duplicate scans; both
orders stayed OPEN. The retained read-only delivery JSON records `source=unlinked`
and `externalAssetId=null`. The verifier's `correctMachine` checks description
text, not an Atlas asset FK. Historical UNS is absent and remains UNKNOWN.
Seed-defined CMMS/KG UUIDs cannot fill that gap. Physical cold restart lost
selection; no representative technician acceptance is established.

Existing read-only reconstruction: job GET `?atSeq=6` (or5 for Pixel) plus its
`/work-order` status route. Draft export formats are not proven deployed on the
receipt's runtime090c8e15b. This mission reuses sanitized QA inputs/receipts and
does not authorize employer data, shared writes or another Atlas order.

## Gap disposition

| Disposition | Work | First acceptance check |
|---|---|---|
| Reuse | Identity/binding, PG graph, event reducer/revisions, observation projection, document admission, turn evidence and CMMS status | No new store/schema/registry; source IDs survive the adapter. |
| Connect | Exact selected job/candidate → bounded MIRA context → shared human/guide evidence | Same prefix/candidate in all views; corrections and unresolved items present with source links. |
| Build | Missing bounded projection, candidate pin and historical/current binding guard | Later QC or A→B rebind cannot change the selected historical evidence; no silent truncation or approval. |
| Defer | Full graph/document historical version manifests and asset-wide private-Q/A sharing | Requires source/version and viewer-policy ownership, not an inferred migration or graph promotion. |
| Defer | Dedicated later reusable acceptance and automatic step-add/revision assembly | Separate policy/revision decisions, with changed-step approval and execution reset tests. |
| Defer | UNS/Atlas asset propagation, dispatcher recovery/capacity/concurrency fixes | Existing [#5209](https://github.com/Mikecranesync/MIRA/issues/5209), [#5210](https://github.com/Mikecranesync/MIRA/issues/5210), [#5216](https://github.com/Mikecranesync/MIRA/issues/5216), [#5223](https://github.com/Mikecranesync/MIRA/issues/5223) and adapter owner. |
| Defer | New generic protocols, full i3X conformance, new services, whole-plant model | No evidence of necessity for this first maintenance-history slice. |

## Verification and ownership boundaries

Audit agents ran39 focused Hub source/privacy/citation tests,94 Python evidence
contract/compiler tests (Python3.12),51 Sparkplug and79 generic connector tests.
An8-test Atlas-verifier helper attempt was blocked before logic by sandbox local
socket binding; that is not eight application regressions or a passing receipt.
The parent will bind implementation validation to its own final source revision.

The guide follow-up separately has13,085 passed/53 existing skips and actual
screen/print/PDF proof; see [guide verification](../proofs/living-guide-qc-field-completeness/verification.md).
Project typecheck retains the recorded159-line baseline, not a green typecheck.
No current production inspection, live industrial test or human acceptance was
performed by this audit. Existing Atlas1.8 upgrade evidence is linked from
[#5188](https://github.com/Mikecranesync/MIRA/issues/5188#issuecomment-6673513396);
the compose pin alone is not runtime proof. Older ADR claims about unavailable
Atlas comment APIs are historical, not current capability facts.

Open PR file/content checks preserve #5204 drawing/torque, #5104 observations,
retrieval/manual-rag/notebook-query owners, #4960/#4761 strategy/header edits,
and #3882/#3626 unified UI/restart owners. Charlie/runtime owners were contacted
through the local broker; delivery does not imply a handoff. The new slice stays
in claimed read adapters, existing job/guide seams and unclaimed docs. No source
owner or deployment state is invented where the registry leaves it unknown.

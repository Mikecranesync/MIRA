# Repo Integration Map — The 10-Stage Product Loop

**Date:** 2026-07-03 · **Worktree:** `C:/Users/hharp/Documents/GitHub/mira-integration` (clean checkout of `main` @ `9a3c6f80`) · **Method:** direct read-only verification (Bash/Grep/Read) + 7 parallel read-only fork agents, one per stage, re-checking every claim against this exact commit rather than trusting the prior discovery docs. This commit includes today's five merges: `78afef6a` (db-inspect scoreboard + KG canonicalizer, #2403), `194ca0be` (machine-memory worker + migration 040, #2404), `eceeaf66` (Hub machine-memory card, #2406), `b7c425be` (bench-to-cloud runbook + signer, #2407), `9a3c6f80` (relay bind-addr, #2408).

**Builds on, does not repeat:** `docs/discovery/2026-07-03-product-discovery-sweep.md` (the original 10-verb product map, branch `feat/litmus-bench-proof`), `docs/discovery/2026-07-03-machine-memory-buildout.md` (the discovery/decision log D1–D9 behind today's machine-memory PRs), `docs/discovery/2026-07-03-machine-memory-layer-build.md` (PR #2404 build note). Where this doc's findings differ from those docs (because today's merges changed the state, or because re-verification found the prior claim stale/wrong), it says so explicitly.

Status legend: **production** = merged, deployed, on the real data path · **prototype** = merged but bench/sandbox/mocks-only · **demo-only** = replay/seed/self-labeled shim · **in-flight** = untracked or unmerged elsewhere · **dead** = abandoned · **duplicate** = a second implementation of the same concern · **missing** = searched, not found.

---

## Stage 1 — Connect equipment

| Implementation | Files | Status | Input → Output | Owner schema | User-facing surface | Next |
|---|---|---|---|---|---|---|
| Ignition tag-stream (Gateway Timer script) | `ignition/gateway-scripts/tag-stream.py` (216L), `collector.py`, `signing.py`, `allowlist.py` | **production-grade code, zero live deployment** — self-documented "customer-deployable collector" (`tag-stream.py:1`), HMAC contract (`:9-24`), read-only guarantee cites ADR-0021 + `.claude/rules/fieldbus-readonly.md` (`:19-21`) | Ignition tag folder (`system.tag.browseTags`/`readBlocking`, default `[default]Mira_Monitored`) → `POST /api/v1/tags/ingest` (HMAC) | `tag_events` (mig 033) via relay | none yet installed on any gateway | Stage 2 ingest via the runbook below |
| Sparkplug B MQTT subscriber | `mira-relay/mqtt_ingest/{run.py,subscriber.py(254L),decode.py,config.py,codecs/}` | **built, opt-in compose profile, undeployed** — `docker-compose.saas.yml:497-517`; runbook `docs/runbooks/2026-06-28-sparkplug-mqtt-consumer.md` | MQTT broker Sparkplug B topics → `ingest_contract`/`ingest_batch` | `tag_events` (033) | none live | needs a real broker + a customer pull (P2 per prior sweep) |
| Litmus Edge bench proof | `plc/litmus/{README.md,mira_on_litmus.py(183L),provision.py,dashboard_api.py}` | **bench-only by explicit rule** — README banner: "BENCH-ONLY... Not the mira-relay ingest path" (`README.md:1-6`) | Micro820/GS10 conveyor via Litmus collector | none (parallel proof, not a data dependency) | n/a | stays parked per prior sweep §8 |
| Bench-to-cloud runbook + signer **(TODAY, PR #2407, `b7c425be`)** | `docs/runbooks/cv101-bench-to-cloud-first-tag-row.md` (340L, corrects an earlier draft: seeding uses `apply-approved-tags.yml` not `apply-seeds.yml`), `mira-relay/tools/sign_and_post.py` (+`tools/__init__.py`, 200L standalone HMAC CLI mirroring `simlab/publishers.py`'s `RelayIngestPublisher._hmac_headers`), tested by `mira-relay/tests/test_sign_and_post.py` (zero-network HMAC round-trip vs `auth.verify_hmac`); drift-guard tests: `tests/test_{approved_tags_conveyor_seed,conveyor_allowlist_parity,cv101_ingest_e2e,cv101_relay_ingest_e2e}.py` | **in-flight/prototype** — closes the "no drift guard for CV-101" gap the buildout doc flagged, but doesn't itself land a live tag row; no changes to `auth.py`/`relay_server.py`/`tag_ingest.py` | deterministic fixtures → relay ASGI app (test-time only) | n/a | run the runbook against the real bench gateway; screenshot the first physical row (P0-4 from the sweep) |
| Bind-address fix **(TODAY, PR #2408, `9a3c6f80`)** | `docker-compose.saas.yml` (+6/-2 lines only — `VERSION` bump + this file; `relay_server.py` **not touched**, still hardcodes `host="0.0.0.0"` at `:743`) | **production, surgical** | new `RELAY_BIND_ADDR` env var (default `127.0.0.1`) at compose port-mapping level | none | ops-only | lets the bench gateway reach relay over Tailscale without public DNS (`api.factorylm.com` doesn't exist yet) |
| `mira-connectors/` — generic connector framework (found fresh this pass, **not in the prior sweep**) | `mira_connectors/{base,canonical,confirmation_gate,factory,service,store}.py` + `mocks/{maximo,sap,maintainx,pi,ignition}_mock.py` + `types/{cmms,scada,historian,document,mqtt}.py`, 79 offline tests, PRs #1684/#1707 | **prototype, mocks-only** — CMMS/SCADA/Historian/Document/MQTT → canonical model → technician confirmation gate (ADR-0017); "extends, does not replace" existing integrations (README:7-8); all 5 connectors are mocks, no real wire-up | mock vendor payloads → canonical model | none (offline framework) | none | distinct from `mira-connect/` (Modbus TCP driver, bench-only) — easy to confuse; feeds Stage 3 mapping once a real connector exists |
| `mira-connect/` | Modbus TCP/PLC drivers | **deferred** ("Config 4" post-MVP per root CLAUDE.md), bench-only per `.claude/rules/fieldbus-readonly.md` | n/a | n/a | n/a | stays parked |

**Empty searches:** none — all six areas the parent flagged exist. The one open question ("does `mira-connectors/` exist?") resolved yes, and it is distinct in purpose from `mira-connect/`.

---

## Stage 2 — Ingest live tags

| Implementation | Files | Status | Input → Output | Owner schema | Surface | Next |
|---|---|---|---|---|---|---|
| Canonical REST/HMAC ingest | `mira-relay/relay_server.py` (743L), `ingest_contract.py` (118L), `tag_ingest.py` (523L) | **production** | HMAC-signed batch → fail-closed allowlist check → `ingest_batch` | `tag_events` (mig `033_tag_events.sql` — append-only, columns incl. `source_system`, `source_connection_id`, `simulated` default false, `event_timestamp`, `ingested_at`; deliberately separate from `live_signal_events` mig 019 demo table and `live_signal_cache` mig 020 latest-value cache) | `POST /api/v1/tags/ingest`, deployed as `mira-relay` (`docker-compose.saas.yml:461-491`) | Stage 3 tag mapping consumes `approved_tags`; Stage 6 worker consumes `tag_events` |
| One-pipeline law enforcement | `tests/test_architecture.py:162-174` (Contract 5) | **production, CI-enforced** | static AST/regex scan | n/a | CI gate | keeps future transports honest |

**One-pipeline allowlist confirmed unchanged**: exactly 3 files — `ingest_contract.py`, `tag_ingest.py`, `relay_server.py`.

---

## Stage 3 — Map tags to approved context

| Implementation | Files | Status | Input → Output | Owner schema | Surface | Next |
|---|---|---|---|---|---|---|
| PLC export parser (multi-format) | `mira-plc-parser/` (`mira_plc_parser/` package + `tests/`; L5X/CSV built per prior sweep, `evals/` present as an untracked dir on the OTHER branch, not this checkout) | **production** (parser), evals dir not on `main` | L5X/CSV/PLCopen export → UNS tag proposals | `ai_suggestions` (mig `027_ai_suggestions.sql`) | CLI + Hub `/plc-import` | feeds proposals decide route (Stage 5) |
| Hub PLC import route | `mira-hub/src/app/(hub)/plc-import/`, `api/connectors/plc/import`, `lib/plc-import.ts` | **production, disconnected from the onboarding wizard** (confirmed still true — see below) | uploaded L5X/CSV → parsed tags → `ai_suggestions` rows | `ai_suggestions` (027), `tag_entities` (025) | `/plc-import` (standalone page, not reachable from onboarding) | wire into the wizard (P0-2 from the prior sweep — still open) |
| `tag_entities` table | `mira-hub/db/migrations/025_tag_entities.sql` | **production schema** | tag proposal → approved tag entity | `tag_entities` | n/a (backing table) | joined by `approved_tags` (035) once verified |
| `approved_tags` allowlist | `mira-hub/db/migrations/035_approved_tags.sql` | **production schema, seeded** (227 prod / 158 staging rows per the prior sweep's db-inspect run; `tools/seeds/approved_tags_conveyor.sql` = 58 CV-101 rows) | verified `tag_entities` → allowlist row | `approved_tags` | consumed at ingest (fail-closed gate) and by the machine-memory worker's `CV101_TAG_TOPIC_MAP` (`run_engine/snapshot.py`) | — |
| Onboarding wizard tag-import step | `mira-hub/src/app/(hub)/onboarding/page.tsx:205,896` (`TagImportStep`) | **real proposal pipeline pointed at a fixture connector — NOT a UI stub** (correction below) | button click → `mira_connectors.mocks.IgnitionMockConnector` → `import_and_propose` | writes real `ai_suggestions` rows | onboarding wizard step | swap `connector_type:"mock"` for a live-gateway-backed connector once one exists |
| "VFD Analyzer" | No standalone code module found. Closest artifacts: `docs/specs/vfd-analyzer-auto-map-spec.md`, `docs/RESUME_2026-06-14_vfd-analyzer-auto-map.md`, `docs/runbooks/vfd-analyzer-auto-map-live-test.md` (spec/runbook only); the actual tag-role classification logic that would back it lives in `ignition/webdev/FactoryLM/api/diagnose/{asset_config.py,signal_roles.py}` | **doc-only / spec stage** — no dedicated "VFD Analyzer" module exists; the concept has been absorbed into the A0–A12 signal-role classification in the diagnose webdev app. Confirmed: `signal_roles.py` catalogs `T_*` topic roles (e.g. `vfd/vfd101/freq`) matching `rules_core.py`'s consumption; the map is stored as one Ignition Document/JSON tag per asset, by design — **not** a Hub/Postgres table. | n/a | n/a | none | if resurrected, package `signal_roles.py`'s role classification as the "auto-map" step, per the spec |

**Correction (independent re-verification of this stage, done directly — the fork dispatched for this stage did not return before the document below was first drafted, so this section is the follow-up correction pass the original note flagged):**

The wizard's `TagImportStep` is **not** a dead-end stub. Reading the full chain — `onboarding/page.tsx:915-918` (`fetch('/api/connectors/ignition/import/', {body: {connector_type:"mock"}})`) → `mira-hub/src/app/api/connectors/ignition/import/route.ts` (proxies to `mira-pipeline`, docstring: "→ ai_suggestions rows in NeonDB") → `mira-pipeline/connector_import.py:46-125` (`connector_ignition_import`, uses `IgnitionMockConnector` + `PostgresProposalStore(NEON_DATABASE_URL)` + `import_and_propose`, ADR-0017: "every import-originated mapping lands as `pending` for human review") — confirms this **does write real, tenant-scoped `ai_suggestions` rows** when `mira-pipeline` is deployed with `NEON_DATABASE_URL` set and `mira-connectors` installed. It is real production code exercising a **fixture** data source (`IgnitionMockConnector`'s mock tag set), not a UI stub that goes nowhere. The gap is narrower than "the button does nothing": it is "the only live-gateway-shaped input wired into the wizard today is a mock connector, and no real one has been built yet." `mira-plc-parser`'s package (`detect.py`, `parsers/`, `ir.py`, `pipeline.py`, `uns.py`, `i3x.py`, `analyze.py`, `coverage.py`) is confirmed present and production-grade; its `evals/` directory is confirmed absent from `main` (present only on the other branch). `ai_suggestions` (`027_ai_suggestions.sql`) confirmed to define exactly 6 `suggestion_type` values (`kg_edge`, `kg_entity`, `tag_mapping`, `component_profile`, `uns_confirmation`, `namespace_move`); `tag_entities` (`025_tag_entities.sql`) and `approved_tags` (`035_approved_tags.sql`) confirmed with the schemas already described in the buildout docs — re-read in full this pass, no discrepancies found.

**Empty search:** no dedicated VFD Analyzer code module (only specs/runbooks + the diagnose webdev signal-role files).

---

## Stage 4 — Attach manuals/prints/evidence

| Implementation | Files | Status | Input → Output | Owner schema | Surface | Next |
|---|---|---|---|---|---|---|
| Real per-tenant upload path | `api/uploads/local/route.ts` (browser, session auth), `api/uploads/folder/route.ts` (service-token, MiraDrop watcher) → both call `handleLocalUpload` in `lib/local-upload.ts:160-201` (`runLocalIngest`) → PDF path calls `writePdfChunksForNode` (`node-knowledge-ingest.ts`) | **production** — write path verified correct: `node-knowledge-ingest.ts:262-266` sets `is_private = true` as a literal, citing `.claude/rules/knowledge-entries-tenant-scoping.md` #1833 | uploaded PDF/photo → per-tenant Inbox node | `knowledge_entries` (mig `001_knowledge_entries.sql`), `ingest_route='v2'` | `api/uploads/local`, `api/uploads/folder` | citable via `manual-rag.ts` hybrid read filter |
| Demo shim upload | `api/documents/upload/route.ts:20-34` | **demo-only, confirmed unchanged** — docstring still self-labels "NOT the full ingest pipeline" | single inline chunk | `knowledge_entries` (no `is_private` discipline applied the same way) | `/api/documents/upload` | retire or delegate to real pipeline (P2-7, prior sweep) |
| mira-ingest / mira-core backing service | `mira-core/mira-ingest/db/neon.py:382-461` (batch insert honors `is_private`/`verified`); `mira-crawler/ingest/store.py:106` (separate writer, shared OEM corpus, `is_private` default false) | **production**, correctly separated (per-tenant vs shared corpus) | OCR/chunk/embed | `knowledge_entries` | internal service | — |
| Electrical print package | `plc/conv_simple_electrical/sheets/{E-005_plc_inputs,E-007_rs485_modbus}.{pdf,png,svg}`, `model/*.yaml`, `render_sheet.py` (531L) | **prototype, dead-end confirmed again** — zero references to `conv_simple_electrical`/`E-005`/`E-007` in `engine.py` or `manual-rag.ts` | model YAML → rendered sheet | none (not in `knowledge_entries`) | static files only | needs a wiring-print *reader* (extraction into citable chunks), not a renderer — P2-5 in prior sweep, still open |
| `mira-bots/shared/wiring_diagram/` | — | **CONFIRMED ABSENT from `main`** — directory does not exist on this checkout; remains untracked WIP on `feat/litmus-bench-proof` only, not merged by any of today's 5 PRs | n/a | n/a | n/a | land or park explicitly (still P0-1 territory) |
| `docs/discovery/electrical_print_reuse_audit.md`, `conveyor_document_context_audit.md` | — | **CONFIRMED ABSENT from `main`** — not in `docs/discovery/` on this checkout (which has only the 3 machine-memory docs + a handful of others); still untracked elsewhere | n/a | n/a | n/a | same as above |

---

## Stage 5 — Approve context

**Merge-conflict check: CLEAN.** `git status --short` in this worktree is empty, and no `<<<<<<<`/`=======`/`>>>>>>>` markers exist in any of the six files the original repo showed as `UU` (`api/proposals/[id]/decide/route.ts`, its test, `api/assets/[id]/chat/route.ts`, `api/namespace/node/[id]/chat/route.ts`, `manual-rag.ts`, `manual-rag.test.ts`). This worktree is a genuinely clean checkout of `main`; the `UU` state is an artifact of the *other* repo's in-progress merge, not present here.

| Implementation | Files | Status | Input → Output | Owner schema | Surface | Next |
|---|---|---|---|---|---|---|
| Proposals decide route | `mira-hub/src/app/api/proposals/[id]/decide/route.ts` (263L) | **production** | `POST {decision: verify\|reject, reason?}` (capability `proposals.decide`, admin-only, ADR-0017); two paths: `tag_mapping` (`:116-157`) or `kg_edge` (`:160-238`, never auto-verified — gated on `decision==='verify'`, `:192`) | `ai_suggestions`, `tag_entities` (approval_state), `relationship_proposals`, `kg_relationships` | `/api/proposals/[id]/decide` | feeds `approved_tags`/verified KG into Stage 6/7 |
| Asset-agent FSM | `mira-hub/src/lib/asset-agent-transition.ts` (202L) | **production** — pure state machine `draft→training→validating→approved→deployed` (+`rejected`/`deprecated`); `approved` requires non-blank `approvedBy` (`MissingActorError`, `:133`) — human-only in code, not just doctrine; threshold `citationCoverage ≥ 5`, `minGroundedness ≥ 4` (`:47-86`) | validation Q&A → transition | `asset_agent_status` (mig `046_asset_agent_status.sql`), `047_asset_validation_qa.sql`, `048_asset_agent_tenant_text.sql` (matches `.claude/rules/mira-hub-migrations.md`'s documented UUID→TEXT fix history exactly) | asset detail "validate" tab | Stage 9 deployment gate |
| Approved-context refusal gate | `mira-hub/src/lib/approved-context.ts:23`, `manual-rag.ts:58-60,62-63` | **built, CONFIRMED STILL DEFAULT OFF** — `approvalGateEnabled()` = `env.MIRA_ENFORCE_APPROVED_ASK==="true" \|\| env.MIRA_ENFORCE_APPROVED_RETRIEVAL==="true"`, false unless explicitly set | when on: appends `AND verified=true` to BM25 filter | n/a (env flag) | wired into `api/assets/[id]/chat/route.ts:352` and `api/namespace/node/[id]/chat/route.ts:305`, both returning HTTP 412 `buildApprovedContextRefusal()` when tripped | P0-3 from the prior sweep is UNCHANGED — no code on `main` has flipped this default |

---

## Stage 6 — Persist machine memory

| Implementation | Files | Status | Input → Output | Owner schema | Surface | Next |
|---|---|---|---|---|---|---|
| Run-centric worker (PR #2351, extended today by PR #2404) | `mira-crawler/run_engine/{segmentation,baseline,diff,pipeline,store,machine_memory,anomaly_rules,state_windows,next_check,models,snapshot}.py` (8+ modules, `machine_memory.py`/`anomaly_rules.py`/`state_windows.py`/`next_check.py` new since the buildout doc's discovery phase) | **production code, flag default-off** | `tag_events` (033) + `approved_tags` allowlist (via `CV101_TAG_TOPIC_MAP` in `snapshot.py`) → runs/windows/diffs | `machine_run`/`run_step`/`run_baseline`/`run_diff` (mig `038_machine_runs.sql`) + `machine_state_window`/`run_diff` typed columns (mig `040_machine_memory_windows.sql`, adds `diff_type TEXT`, `window_id UUID`, `from_event_id UUID`, `to_event_id UUID`, drops `run_id` NOT NULL, adds `run_diff_parent_check` CHECK) | Celery beat task `mira-crawler/tasks/historize_runs.py` (flag `MIRA_RUN_DIFF_ENABLED`, default off, confirmed at `:53`; extra `MIRA_MACHINE_MEMORY_UNS_PATHS` config, `:153-157`) + deterministic CLI `python -m run_engine.machine_memory --fixture <path> [--dry-run]` | Stage 7 evaluation (same module) → Stage 9 Hub surface (built, PR #2406) once flag enabled |
| Historian read-side | `mira-crawler/.../historian.py:264-266` | **missing (NotImplementedError)** | n/a | n/a | n/a | `PostgresHistorianAdapter.list_runs()` wiring, issue #2339 — `machine_run` is already shaped 1:1 onto the Historian Query API's `Run` DTO per `run_engine/models.py` header |

**Known limitation (unchanged from the layer-build doc):** `NeonRunStore` SQL is structurally reviewed but not CI-executed against a live Postgres — the `ON CONFLICT ... WHERE ...` partial-index upsert should be eyeballed the first time the flag is enabled in staging.

---

## Stage 7 — Detect diffs/anomalies

| Implementation | Files | Status | Input → Output | Owner schema | Surface | Next |
|---|---|---|---|---|---|---|
| A0–A12 anomaly rules (canonical) | `plc/conv_simple_anomaly/rules_core.py` | **production-grade logic** | tag snapshot → `Anomaly(severity, evidence, components)` | n/a (pure function) | vendored into Ignition gateway + bench scripts | — |
| Vendored copy for the cloud worker | `mira-crawler/run_engine/anomaly_rules.py` (byte-identical, parity-tested) + `next_check.py` (vendored `NEXT_CHECK` map, drift-guarded by `tests/test_anomaly_rules_parity.py` which AST-parses `anomaly_log.py`'s source dict — confirmed 12 rules incl. `A0_OFFLINE` through `A12_PHOTOEYE_JAM`, no A11) | **production, wired into the flag-gated worker** | rule snapshot per state window → typed `run_diff` row | `run_diff` (038+040, `diff_type='anomaly_<RULE_ID>'`, `from_event_id`/`to_event_id` evidence pointers, `metadata.severity_raw`/`metadata.next_check`) | none direct (backend) | Stage 8 — **confirmed NOT consumed yet** (see below) |
| `tag_diff_logger.py` / `flaky_detector.py` | `mira-relay/tag_diff_logger.py` (`TagDiffLogger`, `NeonDiffStore` classes confirmed present), `flaky_detector.py` (`run()` at `:353`) | **production (diff logger); flaky detection shipped, runtime trigger still not built** (unchanged from prior sweep — no worker/cron calls `flaky_detector.run()`) | edge/threshold diffs | `tag_event_diffs` (mig `037_tag_event_diffs.sql`) | none | P2-3 in prior sweep, still open |
| Baseline learner / difference detectors | `plc/conv_simple_anomaly/{baseline_learner,difference_detectors}.py` | **merged, not wired into the cloud tables** — now functionally *overlapping* with the 038/040 statistical-baseline logic (`run_engine/baseline.py`/`diff.py`) rather than complementary; worth a duplication check in a future pass | n/a | none (no `signal_baselines` table exists) | none | if the run_engine baseline covers this need, consider retiring/merging rather than wiring separately |

**This is the sharpest new finding this pass:** typed A0–A12 anomalies **now persist** (Stage 7 is functionally closed for CV-101), but **no answer surface reads them** (see Stage 8) — the cut has moved one stage downstream from where the prior sweep found it.

---

## Stage 8 — Explain with cited evidence

| Implementation | Files | Status | Input → Output | Owner schema | Surface | Next |
|---|---|---|---|---|---|---|
| Supervisor engine | `mira-bots/shared/engine.py` (5951L) | **production** — citation compliance wired at `:19-21` (imports `check_citation_compliance`/`citation_enforce_enabled`/`enforce_citation_via_rewrite`), invoked `:2792,3752`; direct-connection UNS certification present (`:1187,1788,5736,5747`) | chat turn → grounded/refusal-aware reply | n/a | Slack/Telegram/Ignition chat | — |
| Hybrid RAG (bots) | `mira-bots/shared/neon_recall.py` (1104L) | **production** — `_recall_bm25` (`:491`), RRF fusion (`:138,589-659`), `recall_knowledge` entrypoint (`:730`); fault-code hits bypass RRF deterministically (`:13,905`) | query → ranked KB chunks | `knowledge_entries` (~83k OEM chunks) | bot backend | — |
| Hub RAG | `mira-hub/src/lib/manual-rag.ts` (573L) | **production**, hybrid tenant filter `(is_private=false OR tenant_id=$1)` at `:322` matches doctrine; `approvalGateEnabled()` confirmed still env-gated, no default-on | query → cited chunks | `knowledge_entries` | asset/node chat | — |
| Citation compliance | `mira-bots/shared/citation_compliance.py` (375L) | **production** — `check_citation_compliance` (`:144`), `strip_conflicting_citations` (`:111`), `enforce_citation_via_rewrite` (`:315`), `valid_source_labels` (`:267`) | reply text → compliant reply | n/a | internal | — |
| Groundedness 1–5 scoring | searched `engine.py` for `def score_groundedness`/`GROUNDEDNESS_SCORE` | **NOT confirmed as a named symbol this pass** — only a log-line literal `SELF_CRITIQUE_GROUNDEDNESS_ACCEPT` at `:2671`; the scoring mechanism referenced in root `CLAUDE.md` may live under a different symbol name | — | — | — | worth a targeted follow-up if groundedness scoring is load-bearing for a near-term claim |
| Fault dictionary / `demo/factory_difference_engine/` | — | **CONFIRMED ABSENT from `main`** — `ls demo/` → no such directory; `git ls-files demo/` → empty; `tests/simlab/test_fault_bundle.py`/`test_fault_dictionary.py` also not tracked on `main`. None of today's 5 merges landed it. | n/a | n/a | n/a | still in-flight/untracked exactly as the prior sweep found it (P0-1) |
| Machine-memory (038/040) → chat wiring | grepped `run_diff\|machine_state_window\|machine_memory` across `mira-bots/`, `mira-pipeline/`, `mira-hub/src/app/api/` | **CONFIRMED STILL CUT** — the only hits are the machine-memory route itself and its test; **zero references** in `engine.py`, `ignition_chat.py`, asset/node chat routes, `neon_recall.py`, `manual-rag.ts`, or `context/route.ts` (the "optional +5-line freebie" the buildout doc proposed for `context/route.ts` was **not implemented**) | typed anomalies exist in `run_diff` but no chat surface reads them | `run_diff`, `machine_state_window` | — | wire a `machine_memory` block into `api/assets/[id]/context` (the freebie) or directly into the chat routes — this is now the single sharpest Stage 7→8 gap |

---

## Stage 9 — Surface in Hub/HMI/bots

| Implementation | Files | Status | Input → Output | Owner schema | Surface | Next |
|---|---|---|---|---|---|---|
| Hub machine-memory card **(TODAY, PR #2406, `eceeaf66`)** | Route: `mira-hub/src/app/api/assets/[id]/machine-memory/route.ts`. Component: `mira-hub/src/components/MachineMemoryCard.tsx` (+`.test.tsx`). Embedded directly in `mira-hub/src/app/(hub)/assets/[id]/page.tsx:14,304` (not tab-gated) | **production surface code, will render empty until the Stage 6/7 flag is enabled** | resolves `uns_path` from `kg_entities` (deliberately NOT joined to `cmms_equipment` — comment at `route.ts:50-52` warns of the uuid=text mismatch) → `{uns_path, latest_run, latest_window, latest_diffs[≤5], evidence_window}` (read from source, confirmed) | `machine_run`/`run_diff` (038), `machine_state_window` (040) — degrades gracefully via Postgres error codes `42P01`/`42703` when 040 isn't applied in an env (`route.ts:12-18,86-104`) | asset detail page, Overview | Stage 10 "Create work order" button is a **literal placeholder** — see Stage 10 |
| Command Center | `/command-center` | **prototype**, read-only (PR-1) | whole-plant tree | n/a | `/command-center` | — |
| Ignition Perspective panels | `plc/ignition-project/` (ConvSimpleLive, NorthwindBottling CV-200, MaintenancePanel/MiraAsk) | **prototype**, undeployed | n/a | n/a | bench gateway (once deployed) | — |
| Ask MIRA kiosk | `mira-bots/ask_api/` + `machine_context.py` | **production** (garage conveyor) — but confirmed **no reference to `machine_event_id`/`run_diff`/`machine_memory`** in `mira-bots/ask_api/*.py` this pass (empty grep) | kiosk question → grounded answer | n/a | kiosk | same Stage 8 wiring gap applies here too |
| Telegram/Slack bots | `mira-bots/telegram/bot.py`, `mira-bots/slack/bot.py` | **production** — `/faults` still reads the `faults` table, not conveyor anomalies (mismatch unchanged from prior sweep) | chat → grounded reply | `faults` (mig 002) vs `run_diff`/`conveyor_events` (different tables, never joined) | Telegram/Slack | unify on the 038/040 event store (P1-6) |

---

## Stage 10 — Create work order

| Implementation | Files | Status | Input → Output | Owner schema | Surface | Next |
|---|---|---|---|---|---|---|
| `cmms_create_work_order` | `mira-mcp/server.py:304-323`, dispatched via `rest_cmms_create_work_order` (`server.py:894,1289` → `POST /api/cmms/work-orders`) → `mira-mcp/cmms/{atlas,maintainx,limble,fiix}.py` adapters or internal `diagnostic_record_case` fallback | **production**, human/chat-triggered only | title/description/priority/asset_id/category → CMMS WO or internal record | none in mira-hub schema (mira-mcp's own store/external API) | MCP tool + REST route | — |
| `wo_outbox` | `mira-bots/shared/integrations/wo_outbox.py` (SQLite), schema also in `mira-bridge/migrations/004_add_wo_outbox.sql` | **production** (reliability hardening, CRA-17) | failed Atlas payload → retry/drain → eventual WO or 3h admin alert | SQLite `wo_outbox` table | internal only | — |
| Hub `/workorders` | `mira-hub/src/app/(hub)/workorders/{page.tsx,new/page.tsx,[id]/page.tsx}` | **production** (human-driven multi-step form: asset search, description, priority, photo) | manual form fill → WO | Hub WO tables | `/workorders/new` | — |
| `/workorders/new?prefill=` | grepped `prefill\|searchParams` across the whole `workorders/` dir | **CONFIRMED NOT WIRED** — zero matches; the machine-memory buildout doc's claim that this query param is read is **not currently true** | n/a | n/a | n/a | implement prefill-from-anomaly if the WO button is to work |
| Anomaly/diff → WO linkage | grepped `create_work_order\|cmms_create_work_order\|wo_outbox\|work.?order` across `mira-crawler/run_engine/`, `mira-relay/`, `plc/conv_simple_anomaly/` | **CONFIRMED STILL MISSING** — zero matches in all three; broken link 4 from the prior sweep is unchanged by any of today's 5 merges | n/a | n/a | n/a | P1-1 from prior sweep, still open |
| `MachineMemoryCard`'s WO button | `mira-hub/src/components/MachineMemoryCard.tsx:154-156` | **literal placeholder** — renders `<Link href="/workorders/new">Create work order (soon)</Link>`, no asset/prefill query string passed | n/a | n/a | asset page card | wire this exact button once prefill + the WO API accept an anomaly reference |

**Loop-back gap:** Stage 10 has no Stage 11. A created WO should reference the `run_diff`/`machine_state_window` row that triggered it — no FK or reference field exists anywhere in migrations 038/040 or the WO tables for this.

---

## One-page loop integrity summary

**LIVE (data actually flows through code that runs against real state, today):**
- Proposals decide → `ai_suggestions`/`tag_entities`/`relationship_proposals`/`kg_relationships` (Stage 5) — production, no gate issues.
- Asset-agent train→validate→approve FSM (Stage 5) — production, server-enforced human-approval gate.
- Real per-tenant document upload → `knowledge_entries` (Stage 4) — production, correct `is_private` discipline.
- Hybrid cited chat (bots + Hub) reading `knowledge_entries` (Stage 8) — production.
- REST/HMAC ingest → `tag_events` (Stage 2) — production code path, though volume is near-zero in prod (28 rows ever, per the prior sweep's db-inspect run — not re-run this pass).
- Run-centric worker: `tag_events` → `machine_run`/`run_step`/`run_baseline`/`run_diff`/`machine_state_window` (Stages 6–7) — production code, parity-tested A0–A12 rules, evidence pointers — **but gated behind `MIRA_RUN_DIFF_ENABLED`, default OFF.**
- Hub machine-memory read surface (Stage 9) — production code, degrades gracefully, but will show only empty states until the Stage 6/7 flag is on and a real gateway is streaming.

**MANUAL (works, but requires a human to operate a CLI/console/runbook step — no product affordance connects it automatically):**
- Installing the Ignition tag-stream on a real gateway (Stage 1) — runbook exists (`cv101-bench-to-cloud-first-tag-row.md`), no Hub "connect live data" button.
- Enabling `MIRA_ENFORCE_APPROVED_RETRIEVAL` (Stage 5) — an env var, not a product default or per-tenant toggle.
- Enabling `MIRA_RUN_DIFF_ENABLED` in staging (Stages 6–7) — an ops step per the runbook, not automatic.
- PLC-export import via `/plc-import` (Stage 3) — real and working, but not reachable from the onboarding wizard (still requires knowing the standalone URL).

**CUT (no code path connects two adjacent stages — the sharpest findings this pass):**
1. **Stage 3 wizard middle** (narrower than the prior sweep's P0-2 framing — see the Stage 3 correction note): the wizard's `TagImportStep` IS a real proposal pipeline (`onboarding/page.tsx:915-918` → `api/connectors/ignition/import` → `mira-pipeline/connector_import.py` → real `ai_suggestions` rows), but its only data source is `IgnitionMockConnector` fixture tags — no live-gateway connector exists — and the real PLC-export flow (`/plc-import`) is still not reachable from the wizard. The cut is "no real connector + two disconnected import doors," not "the button does nothing."
2. **Stage 4 evidence never cited**: electrical prints (E-005/E-007) and the vendored `wiring_diagram` module are either narrative-only or absent from `main` — zero references in any citation path.
3. **Stage 7→8 (the loop's newest and now-sharpest cut)**: typed A0–A12 anomalies persist into `run_diff` (Stage 7 is functionally done for CV-101), but **no chat/answer surface reads them** — zero references to `run_diff`/`machine_state_window`/`machine_memory` outside the machine-memory route itself, confirmed across `engine.py`, `ignition_chat.py`, `neon_recall.py`, `manual-rag.ts`, every chat route, and even `context/route.ts` (the buildout doc's proposed "freebie" wiring was not implemented). Today's four PRs moved the cut from "nothing persists" (prior sweep) to "it persists but nothing explains it."
4. **Stage 9→10**: the `MachineMemoryCard`'s work-order button is a literal `(soon)` placeholder with no prefill wiring; `/workorders/new?prefill=` doesn't read any query param despite a prior doc claiming it does.
5. **Stage 10→(loop-back)**: no FK from any work-order table back to `run_diff`/`machine_state_window` — even if the button were wired, there'd be nothing to trace the WO back to the anomaly that caused it.
6. **Stage 1 mocks vs reality**: `mira-connectors/` is a fully-mocked framework (5 mock vendor adapters, zero real ones) — a second, parallel "connect" concept to the Ignition/Sparkplug path, currently contributing nothing live.

**Net read:** today's five merges genuinely advanced the loop — they closed the Stage 6/7 persistence gap the prior sweep called the top P0 (P0-5), and they shipped the Stage 9 read surface for it. But they did not touch Stages 3, 4, or 10, and they created a new, narrower cut at Stage 7→8 by building the anomaly persistence layer before wiring any surface to explain it. The shape of the remaining work is unchanged in kind (flip flags, wire buttons, connect one more file to one more table) but the specific seams have moved downstream.

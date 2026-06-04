# Plan — MiraDrop Auto-Splitter / Ingest v2 (CHARLIE prove-it)

**Date:** 2026-05-26
**Locked through:** 2026-06-30 (5-week build window for v2 prove-it on CHARLIE)
**Companion docs:** [ADR-0019](../adr/0019-miradrop-ingest-v2.md) · [Spec](../specs/miradrop-ingest-v2-spec.md)
**Trigger:** 2026-05-24 drop of `2080-rm001_-en-e.pdf` (33 MB Rockwell ref manual) rejected with `exceeds_20mb_limit`.

---

## Currently in-flight

_Update before claiming work in this plan. Last verified: 2026-05-26 (post-grilling design lock; nothing built yet)._

- [ ] No work started. Design lock only.
- [ ] Coordinate with: `2026-04-19-mira-90-day-mvp.md` (this work fits under Unit 9b — ingestion intelligence), `2026-05-15-maintenance-namespace-builder.md` (this consumes the namespace builder's readiness scoring + dialogue gate).
- [ ] Pre-flight: run `git fetch origin/main` and rebase before starting any phase below (per memory `feedback_fetch_origin_before_state_claims`).

---

## Goal

Drop *anything* of any size into `~/MiraDrop/inbox/`. End state: rich, page-anchored chunks in KB; tech-confirmed UNS-pathed Equipment + Manual in KG; QR PNG sidecar; readiness score moves. All proven on CHARLIE before any cloud-side deployment.

## Locked decisions (from grilling 2026-05-26)

Each one is also in ADR-0019 § Architecture summary. Anchor reference only:

| # | Decision |
|---|---|
| Q1 | Text-chunk granularity (no physical PDF split) |
| Q2 | Track 2 / mira-ingest-v2 / OW-free path |
| Q3 | Watcher → Hub (streams) → v2 |
| Q4 | Async worker (HTTP 202; phases advance off-thread) |
| Q5 | CHARLIE only, this build |
| Q6 | `hub_uploads` IS the queue (`FOR UPDATE SKIP LOCKED`) |
| Q7 | Extend `hub_uploads` in place |
| Q8 | Extend `knowledge_entries` in place |
| Q9 | Hybrid extractor: filename → rules → LLM fallback |
| Q10 | Drop opens Slack dialogue; D-hybrid seed |
| Q11 | Two-state + `verified_by` provenance |
| Q12 | Detect-and-prompt for revisions; default-on-TTL = append |
| Q13 | Per-phase checkpoints, idempotent writes |
| Q14 | Slack confirmation DM reports L0–L6 delta + next-action CTA |
| Q15 | PDFs only this build; photos stay on existing path |

## Out of scope (this build)

- Photos in v2 (deferred to v2.1)
- Cloud-side v2 deployment (deferred to when a customer channel needs it)
- Replacing OW for non-MiraDrop ingest paths (Drive/Dropbox)
- Renaming the `knowledge_entries.source_page` column wart
- Multi-tenant isolation refinements beyond what `hub_uploads.tenant_id` already provides

## Phases

Each phase is independently mergeable behind feature flags. Slice 1 must land before Slice 2 (queue depends on schema). Slices 3-7 can interleave once Slice 2 lands.

### Slice 0 — Pre-flight (~half day)

**Branch:** `feat/miradrop-v2-preflight`

- [ ] `git fetch origin/main && git rebase` from current branch baseline.
- [ ] Confirm CHARLIE has free disk for `~/MiraDrop/processing/` and a target ingest spool (e.g. `~/MIRA/var/ingest-v2/spool/`).
- [ ] Verify `tools/mira-drop-watcher/main.py` is running and processing drops on the OW path (current production state).
- [ ] Confirm the 2026-05-24 failed PDF (`~/MiraDrop/failed/2080-rm001_-en-e.pdf`) is preserved — we'll use it as the canary test case.
- [ ] Snapshot the current `hub_uploads` row count and the current `knowledge_entries` row count. Both should not change during Slice 1.
- [ ] Open a tracking issue in GitHub. Link to ADR-0019 and the spec.

**Exit criteria:** branch ready, baseline preserved, canary PDF ready.

### Slice 1 — Schema migrations (1-2 days)

**Branch:** `feat/miradrop-v2-schema`

Migrations only. No code reads or writes the new columns yet — additive surface for everything that follows.

- [ ] Write `mira-hub/db/migrations/030_hub_uploads_v2.sql` per Spec § 4.1.
- [ ] Write `docs/migrations/002_knowledge_entries_chunk_anchors.sql` per Spec § 4.2.
- [ ] Write `mira-hub/db/migrations/031_kg_relationship_provenance.sql` per Spec § 4.3.
- [ ] Local apply against dev Neon. Confirm row counts unchanged.
- [ ] PR; run `apply-migrations.yml` with `dry-run` against staging, then `apply`.
- [ ] Prod migrations: hold until Slice 2 lands and is partially verified. (Schema changes are safe to land, but no value until code uses them — bundle.)

**Tests:** `pytest tests/migrations/` (if the suite exists) + manual `psql \d hub_uploads` and `\d knowledge_entries` against dev + staging.

**Exit criteria:** all three migrations applied to dev + staging without errors. Prod hold.

### Slice 2 — v2 HTTP endpoint + worker skeleton (3-4 days)

**Branch:** `feat/miradrop-v2-worker-skeleton`

The smallest possible v2 service that accepts streamed uploads, claims rows, runs a no-op pipeline, advances status to `parsed`. No docling yet. No extraction yet. No Slack dialogue yet. Proves the queue and per-phase checkpoint model.

- [ ] New service: `mira-ingest-v2/` (FastAPI + uvicorn). Sibling of `mira-core/mira-ingest/`.
- [ ] Endpoint: `POST /v2/uploads` streams body to disk, creates a `hub_uploads` row with `ingest_route='v2'`, `status='queued'`. Returns 202.
- [ ] Worker process: `mira-ingest-v2/worker.py`. Single-process, single-concurrency. `SELECT … FOR UPDATE SKIP LOCKED LIMIT 1 WHERE ingest_route='v2' AND status='queued'`. Heartbeat every 30 s.
- [ ] No-op pipeline: `queued → parsing → embedding → kg_proposing → parsed` advances over ~5 s with sleeps. Proves the state machine, not the work.
- [ ] launchd plist: `com.factorylm.mira-ingest-v2.{api,worker}.plist`.
- [ ] Hub side: `local-upload.ts` gains a branch — when `kind === 'document'` AND the new feature flag is on, route to v2 via streamed fetch instead of `forwardToIngest`. **Stream `req.body` directly — do NOT call `await file.arrayBuffer()`**. Keep the existing OW branch as fallback when flag is off.
- [ ] Feature flag: `HUB_MIRADROP_V2_ENABLED` env var on Hub. Default off.
- [ ] Hub also drops the `MAX = 20 * 1024 * 1024` check from the v2 branch (the check stays on the OW branch).

**Tests:**
- Unit: worker claim/release under concurrent claim (use two threads).
- Integration: `curl` a 50 MB random PDF through Hub with the flag on. Expect `hub_uploads.status='parsed'` within 30 s.
- Regression: with the flag off, OW path still works for a small PDF.
- Stale-claim recovery: kill the worker mid-job, restart, confirm the row resets to `queued` after 5 min.

**Exit criteria:** the 33 MB canary PDF round-trips through v2 to `status='parsed'` without errors. OW path still works for non-MiraDrop drops.

### Slice 3 — Docling + chunker + embedder integration (3-5 days)

**Branch:** `feat/miradrop-v2-docling`

Replace the no-op pipeline phases with real work. PDFs come out the other end as chunks in `knowledge_entries`.

- [ ] New module: `mira-ingest-v2/pipeline/parse.py`. Spawns the docling subprocess.
- [ ] `mira-ingest-v2/docling_runner/__main__.py`: subprocess entrypoint. Reads a path, runs DoclingAdapter (`do_ocr` flag determined by `pypdf` text-layer detection), emits JSON-lines per chunk on stdout. Exits 0 on success.
- [ ] Worker: spawn subprocess via `subprocess.Popen`. Read stdout incrementally. Per-chunk JSON → chunker.py → batched embeddings → `INSERT INTO knowledge_entries` (50 chunks per transaction, with `ON CONFLICT (doc_id, chunk_index) DO NOTHING`).
- [ ] Use the existing `mira-crawler/ingest/chunker.py` and `mira-crawler/ingest/converter.py` — don't reinvent.
- [ ] Embedder backend: reuse the existing embedder used by `mira-core/mira-ingest/main.py`. Don't fork; the embedding dimensions must match `knowledge_entries.embedding vector(768)`.
- [ ] Fill `doc_id`, `page_start`, `page_end`, `section_path`, `ingest_route='v2'` for every row.
- [ ] No KG, no extraction, no Slack yet. Just chunks landing.

**Tests:**
- Drop the canary PDF. Expect ~500-1200 rows in `knowledge_entries WHERE doc_id=…`, all with `page_start IS NOT NULL`.
- Spot-check three random chunks: do `page_start` / `page_end` actually correspond to the PDF page? (Open the PDF, find the text, verify.)
- Memory: worker process resident memory before docling subprocess vs. during vs. after. Confirm post-job is within ~50 MB of pre-job (subprocess kill releases PyTorch pools).
- Resume: kill worker during embedding phase, restart, confirm no duplicate chunks (idempotency).

**Exit criteria:** canary PDF produces page-anchored chunks in `knowledge_entries`. Memory returns to baseline between jobs.

### Slice 4 — Extraction + KG writes (3-4 days)

**Branch:** `feat/miradrop-v2-extraction-kg`

The KG part of the pipeline. Still no Slack — the binding is auto-applied to `model_only` for this slice. Slice 5 adds the dialogue.

- [ ] New module: `mira-ingest-v2/pipeline/extract.py`. Implements the D-hybrid extractor (filename → rules → LLM fallback per Spec § 6.1, but used here only for the *candidate* binding before Slack).
- [ ] Filename heuristic: small lookup table of vendor catalog prefixes. Lives in `mira-ingest-v2/pipeline/vendor_prefixes.py`. Initial vendors: Rockwell (`2080`, `1734`, `1756`, `5069`), ABB (`ACS\d+`), Siemens (`6SL\d+`, `6ES\d+`), Allen-Bradley shared.
- [ ] Rule extractor: reuse `mira-bots/shared/uns_resolver.py`'s alias table + `_looks_like_model_number`. Run over the first 10 pages' text.
- [ ] LLM fallback: cascade `Groq → Cerebras → Gemini` (existing `mira-bots/shared/inference/router.py`). Single call per drop, JSON-mode prompt: `{manufacturer, model, equipment_type, confidence}`. **Never Anthropic.**
- [ ] Write `hub_uploads.extracted_manufacturer`, `extracted_model`, `extraction_method`, `extraction_confidence`.
- [ ] If extraction succeeds: call `kg_writer.register_equipment_and_manual` with `binding_state='model_only'`, `verified_by=NULL` (proposed).
- [ ] Run `fault_codes.extract_from_text` over all chunks. For each match, `kg_writer.register_fault_code` with confidence 0.85 → `proposed`.
- [ ] Update `hub_uploads.kg_entity_id` + `kg_relationship_count`.

**Tests:**
- Canary PDF: expect `extracted_manufacturer='Rockwell Automation'`, `extracted_model='2080'` or `Micro820`, `extraction_method='filename'` or `'rule'`.
- A PDF with no clear branding: expect `extraction_method='llm'`.
- A PDF the LLM also fails on: expect `extracted_manufacturer=NULL`, `error_class='extraction_failed'`, drop lands in `awaiting_review` admin queue (which is just a `hub_uploads` filtered query, no new UI).
- KG: confirm `kg_entities` has one new Equipment + one new Manual, and `kg_relationships` has Equipment-HAS_MANUAL with `verified_by IS NULL`.
- Fault codes: confirm at least 5 `proposed` HAS_FAULT rows for the canary.

**Exit criteria:** drop produces KG entities + proposed relationships. No facts are `verified` yet (Slice 5).

### Slice 5 — Slack dialogue (UNS gate for ingest) (4-5 days)

**Branch:** `feat/miradrop-v2-slack-dialogue`

The dialogue layer. This is where "drop opens a conversation" becomes real.

- [ ] Worker phase 4: instead of auto-binding to `model_only`, send a Slack DM via the existing `mira-bots/slack/bot.py` adapter.
- [ ] DM block-kit shape per Spec § 6.1 (defer button text wording to `slack-technician-ux-writer` skill before write).
- [ ] Seed buttons via D-hybrid:
  - Query the FSM session log for `dropping_user_id`'s active thread context.
  - Query last 48 h confirmed contexts from session log.
  - Always include "model template" and "type UNS path" buttons.
- [ ] Button taps land on a new Hub route `POST /api/v2/ingest/:upload_id/bind` with `{uns_path, source: 'tech_tap'}`. Hub validates against `uns.is_valid_path`, writes to `hub_uploads.uns_path`, fires worker continuation (publishes event to a small Redis channel or polls `hub_uploads`).
- [ ] On revision detection (Phase 4b), send the second prompt per Spec § 6.2. Write `hub_uploads.revision_handling`.
- [ ] On TTL expiry (24 h, configurable via env `MIRADROP_V2_BINDING_TTL_SECS`): default to model template; mark `binding_state='model_only'`.
- [ ] After binding, promote the Manual-HAS_EQUIPMENT relationship to `verified_by='tech'` (Spec § 4.3 promotion rules).

**Tests:**
- Drop the canary. Expect a Slack DM with 3-4 buttons.
- Tap "model template" → `hub_uploads.uns_path` becomes `enterprise.knowledge_base.rockwell_automation.micro820`. Relationship promotes to verified.
- Don't respond for 24 h (or set TTL to 60 s for the test). Confirm default-to-model fires.
- Drop a revision of the same manual. Expect the second prompt. Tap "append". Confirm both manuals exist in KG, neither superseded.
- Tap "cancel — wrong file". Confirm `status='cancelled'`, no KG writes, chunks remain in KB (debatable — see open Q below).

**Open Q for Slice 5:** what happens to chunks when the tech cancels the binding? Recommend: keep them (they're useful for retrieval), but never link them to an Equipment. Effectively orphan chunks with `doc_id` set but no KG relationship pointing at them. Surface in admin queue for cleanup.

**Exit criteria:** end-to-end drop → DM → tap → KG verified. The wedge is live.

### Slice 6 — Artifacts + readiness DM (2 days)

**Branch:** `feat/miradrop-v2-artifacts`

The visible "templated item" output the tech walks away with.

- [ ] New module: `mira-ingest-v2/pipeline/artifact.py`. Generates the QR PNG (use `qrcode[pil]`) encoding the Hub URL.
- [ ] Update sidecar shape: extend `~/MiraDrop/done/{file}.ingest.json` per Spec § 7.
- [ ] Hub route: `GET /hub/kg/[unsPath]` renders the entity page (this may already exist via the namespace-builder work — check `mira-hub/src/app/(hub)/namespace/`). If not, scaffold.
- [ ] Worker phase 6: call `recalculate_health_score(tenant_id, uns_path)` (or its equivalent — check Spec § 5.2 of the namespace-builder spec for the actual function name). Read back the new level + first item from `missing`.
- [ ] Slack `chat.update` on the original binding DM with the confirmation reply per Spec § 6.3.
- [ ] Watcher: update `tools/mira-drop-watcher/main.py` to log the QR path location to its sidecar (no behavioral change needed; v2 writes the file directly).

**Tests:**
- Drop → done folder contains `.qr.png` next to original.
- Scan the QR with a phone → opens the Hub entity page.
- Confirmation DM contains a real L_old → L_new delta and a real next-action string.
- Drop a manual for an unrelated equipment → confirm readiness score for OTHER nodes doesn't change.

**Exit criteria:** every successful drop ends with a Slack DM celebrating the level-up. Canary PDF takes us from whatever-state to whatever-next-state visibly.

### Slice 7 — Citation formatter + retrieval polish (2-3 days)

**Branch:** `feat/miradrop-v2-citations`

Make the new chunks visible in bot replies.

- [ ] Update `mira-bots/shared/citation_compliance.py`: when a retrieved chunk has `page_start IS NOT NULL` AND `ingest_route='v2'`, format citation as *"…per the {extracted_model} manual, p. {page_start}, §{section_path} ([source]({hub_url}))…"*. Legacy chunks fall through unchanged.
- [ ] Update the recall path's reply formatter (`mira-bots/shared/engine.py` or `rag_worker.py` — check current shape after PR #1385).
- [ ] Regression: existing OW-path chunks still cite the same way they do today.
- [ ] Add a v2-specific golden case to `tests/golden_factorylm.csv`: "What does the PowerFlex 525 manual say about F004?" expected reply must cite the manual + a real page number.

**Tests:**
- Run the GS-suite (`tests/golden_*.csv`) post-change; no regressions on existing cases.
- Manually ask the Slack bot about F004 after the canary is ingested. Reply should contain *"per the Rockwell Automation Micro820 manual, p. {N}, §{section}"* (or the actual extracted model).

**Exit criteria:** bot replies cite v2-route chunks with page + section. Recall stays correct for legacy chunks.

### Slice 8 — Hub admin surface for v2 (2-3 days)

**Branch:** `feat/miradrop-v2-hub-admin`

The "you have a queue of things to look at" surface.

- [ ] Hub UI page: `/hub/ingest/v2-queue`. Lists `hub_uploads` rows where:
  - `status='awaiting_confirmation'` AND `claimed_at < now() - interval '6 hours'` (long-pending dialogues).
  - `status='failed'` (with retry button).
  - `extracted_manufacturer IS NULL AND ingest_route='v2'` (extraction failures).
- [ ] Hub UI page: `/hub/proposals/from-drops`. Lists `kg_relationships WHERE status='proposed' AND source_id IN (chunks FROM v2-route)`. Admin can bulk-approve via existing approval flow (per ADR-0014 / `ai_suggestions`).
- [ ] Retry button: `POST /api/v2/ingest/:upload_id/retry`. Resets row to `queued`. Worker re-runs from last completed phase (idempotency keeps the work clean).

**Tests:**
- Force a docling failure (drop a 5 MB JPG renamed `.pdf`). Confirm row lands in `failed` with `error_class='docling_failed'`. Click retry → fails again. Confirm same row, retry count tracked (add a `retry_count INTEGER DEFAULT 0` column if it doesn't already exist).
- Confirm Hub admin queue page renders the failed row.

**Exit criteria:** Mike can see and fix stuck/failed drops in the Hub UI without touching SQL.

### Slice 9 — Cleanup, docs, smoke-test (1 day)

**Branch:** `feat/miradrop-v2-finalize`

- [ ] Flip `HUB_MIRADROP_V2_ENABLED=true` as default. Keep the OW path code paths intact but unreachable for MiraDrop drops.
- [ ] Update `tools/mira-drop-watcher/README.md` with the new pipeline.
- [ ] Update `CLAUDE.md` root § "Pointers" to mention this spec + plan.
- [ ] Update `wiki/hot.md` (per CLAUDE.md "Session start: read wiki/hot.md").
- [ ] Add to the eval-watcher set (`tests/eval/watch_set.txt`) the v2 golden case from Slice 7.
- [ ] Run `bash install/smoke_test.sh` (per CLAUDE.md verification workflow).
- [ ] Take a screenshot pair (per the Screenshot Rule):
  - `docs/promo-screenshots/{date}_miradrop-v2-drop-slack-dm_desktop.png`
  - `docs/promo-screenshots/{date}_miradrop-v2-readiness-delta_desktop.png`

**Exit criteria:** v2 is the default path for MiraDrop. OW path stays available as the legacy fallback. Docs reflect reality.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Docling subprocess still OOMs on a pathological PDF | The two levers (do_ocr=False on text PDFs, subprocess-per-job) drop expected peak to ~2 GiB. Add an explicit `resource.setrlimit(RLIMIT_AS, 4 * GiB)` in the subprocess entry as a hard ceiling — kills the subprocess instead of the worker. |
| Slack rate limits during a bulk-drop session | Batch the binding DMs ("3 of 50 manuals look like revisions — review?"). The first cut: send one DM per drop, monitor, batch only if pain materializes. |
| LLM fallback exhausts free-tier quota | Cascade Groq → Cerebras → Gemini. Each has independent quotas. Track 429s; if all three fail, drop lands in extraction-failure queue, not blocked. |
| Schema migration on prod NeonDB fails | All migrations are additive (nullable columns). Roll-forward only. `apply-migrations.yml --dry-run` precedes every prod apply. |
| Watcher polls Hub stale data during the awaiting_confirmation phase | TTL = 24 h for the dialogue. Watcher's existing `INGEST_POLL_TIMEOUT_SECS=180` is too short for v2 — bump it to 86_400 for v2 rows or change the watcher to return early on `awaiting_confirmation` and let the sidecar update later. Recommend the latter (lower friction). |
| `kg_relationships` schema drift between Hub migrations and engine migrations | Memory `project_uns_schema_canonicalization` is mandatory pre-reading before Slice 4. Hub migration `031` extends the prod-canonical column set (`source_id`/`target_id`/`relationship_type` per memory `project_kg_relationships_schema`). |

## Dependencies on other in-flight work

- **90-day MVP plan (Unit 9b — ingestion intelligence):** this work IS the implementation of Unit 9b's "drop → tech-confirmed UNS-pathed Equipment + Manual" outcome.
- **Namespace-builder plan (2026-05-15):** v2 consumes the readiness scoring + UNS gate machinery defined there. Phase 2 of that plan (decide endpoint, drag-drop, recompute worker) is shipped per memory `project_phase2_slice1` — usable from Slice 6 onward.
- **PR #1385 recall-embedding-gate fix:** required to be on `main` (it is, per memory `project_recall_embedding_gate`) before Slice 7's citation work.
- **Slack-technician-ux-writer skill:** consult before locking the block-kit shape for any DM in Slice 5 or Slice 6.

## Verification gates per slice

Each slice must, before merge:
- Pass `ruff check .` and `ruff format --check .` (per `.claude/rules/python-standards.md`).
- Pass relevant `tests/regime*/` suite for any module it touches.
- Add at least one new test that would catch the regression it's introducing.
- Run the canary drop (`2080-rm001_-en-e.pdf`) end-to-end and capture the result in the PR description.
- Update this plan's "Currently in-flight" section.

## Definition of done (overall)

All Spec § 13 acceptance criteria pass on CHARLIE with the 33 MB canary PDF and at least one revision drop. `HUB_MIRADROP_V2_ENABLED=true` is the default. OW path remains available behind the flag for non-MiraDrop ingest.

## When to revisit

- After 50 real drops through v2 (empirical data on `extraction_method` distribution, TTL ghost rate, revision-handling distribution).
- Before the first customer-channel ingest (triggers the Day-2 cloud-side deployment work).
- If the readiness L-delta feedback isn't visibly driving more drops within 2 weeks of Slice 6 shipping (UX hypothesis falsified — revise the DM, not the architecture).

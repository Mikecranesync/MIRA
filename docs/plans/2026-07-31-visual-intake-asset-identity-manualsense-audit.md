# Visual Intake, Asset Identity & ManualSense — Recovery Audit

**Date:** 2026-07-31
**Status:** AUDIT ONLY — no implementation, deployment, migration, or merge. Stop point per request.
**Scope:** Tier 2 of the unification program ("One Visual Intake, Many Capability Packs"), sitting on top of Tier 1 ("One Technician Brain, Many Evidence Producers", ADR-0033, PRD `docs/prd/2026-07-30-mira-unification-program.md`).
**Method:** 7 parallel research passes (docs/contracts, visual pipeline, drive packs, Telegram/PrintSense/photo-memory, OEM crawler/ingestion, git archaeology, tests/CI) + 4 targeted verifications (scan-monday code, PR #2703, PR #3016, beta-gate CI wiring). All file:line citations below were read directly, not inferred.

## TL;DR for the impatient

1. The technician-photo workflow the user describes was **designed in July 2026 (ADR-0027, "Visual Technician")** and **~75% of its building blocks were built and merged** — VisualSession spine, deterministic equipment resolver, an injectable manual-retrieval hook, and (as of PR #3016, now on `main`) a typed evidence adapter into the shared context contract.
2. The Telegram production fast-path (`_try_nameplate_drive_pack_reply`, `bot.py:1281–1389`) **never calls that manual-retrieval hook**. It only matches against the 3 pre-loaded Drive Packs. If the pack doesn't match, MIRA says "name the drive or scan the nameplate" — it does not try to find the OEM manual on the internet, even though the code to search for one **already exists elsewhere in this monorepo** (`mira-scan-monday/backend/manual_search.py`, OEM-domain-scoped Serper search + HEAD-validated PDF check, unused by the bot).
3. Classification is a **single scalar label** (`ELECTRICAL_PRINT | NAMEPLATE | EQUIPMENT_PHOTO | UNKNOWN`) at both the vision-worker layer and the Telegram dispatch layer. This is the literal mechanism behind Q6: a photo showing both a nameplate AND wiring can only ever be classified and routed as one or the other, never both.
4. The Tier-1 shared context contract (`materialized_evidence/context_contract.py`) is real, tested, and ready to receive a manual-discovery evidence producer — but **WS1 (runtime adoption of that contract) has zero production call sites today**. Tier 2 work should not jump that queue silently.
5. **First PR should be a port, not a build**: generalize `mira-scan-monday/backend/manual_search.py` (Serper + OEM-domain allowlist + HEAD/magic-byte validation + scoring) into a shared module, and wire it as rung 4–6 of `equipment.py`'s existing (already-shipped, already-injectable) `default_manual_retriever()` ladder. This is squarely the "Reuse Before Build" law in `~/.claude/CLAUDE.md` — a parallel manual-search feature already exists and was never promoted into the core path.

---

## 1. Current-State Map

### 1.1 Governing docs (Tier 1 — the frame Tier 2 must fit inside)

| Doc | Status | What it says about visual/manual work |
|---|---|---|
| `NORTH_STAR.md` §"Bravo runtime boundary" (lines 178–256) | Active doctrine | Bravo (vision/OCR) emits typed *candidate* evidence, never a technician answer; "common context contract is the only path — no second schema, no second evidence ledger." Vision Zero-Token Architecture: paid vision calls are explicit budgeted exceptions, not defaults. |
| `docs/adr/0033-one-technician-brain.md` | **Proposed — awaiting Mike, M1** | One conversational policy; task modes (`DRIVE_COMMANDER`, `PRINTSENSE`, …) are metadata, not personas; specialist systems (OCR, drive-pack resolution, manual lookup) stay **below the conversation** and speak only via typed evidence with provenance + confidence into the shared contract. Rule 1 forbids per-product conversational adapters absent exhaustive negative-transfer evidence. |
| `docs/prd/2026-07-30-mira-unification-program.md` | Draft, WS1–WS6 | WS1 explicitly lists "drive adoption into the live answer paths… drive-pack fast-path, PrintSense workspace follow-ups, **equipment photo memory** (#3008)" as the remaining gap — i.e., Tier 2's target surfaces are already named as WS1's unfinished business. |
| `docs/architecture/bravo-evidence-lane.md` | Active | Layer map: photo/OCR capture (Bravo edge) → ~12 specialist producers ("vision/nameplate workers", "PrintSense interpret") → adapters are "the only sanctioned door in." |
| `docs/adr/0029-materialized-evidence.md` | Accepted | The platform layer `context_contract.py` extends. New evidence kinds/producers must extend this, never fork it (Rule 15, `.claude/rules/materialized-evidence.md`). |
| `docs/adr/0027-mira-visual-technician-architecture.md` | Historical design doc, largely shipped | The **original design document for exactly this workflow** — see §3. |
| `docs/adr/0025-drive-intelligence-packs-and-drive-commander.md` | Accepted, partially shipped | Drive Pack = data, not code; 3-layer manual-intelligence model (document → extracted intelligence → diagnostic reasoning), only layer 3 shipped. |

### 1.2 Shared context contract (Tier 1 substrate)

**File:** `materialized_evidence/context_contract.py` (954 lines), `CONTEXT_CONTRACT_VERSION = "1.0"`.

- `TechnicianContext` (frozen dataclass, L203–219): `task_mode`, `tenant_id`, `asset`, `evidence: list[EvidenceItem]`, `contradictions`, `unknowns`, `allowed_actions` (read-only gate), `authorization_state`.
- `EvidenceItem` (frozen dataclass, L109–145): `kind: EvidenceKind`, `citation_id`, `payload`, `source_locator`, `confidence`, `trust` (default `"candidate"`, never auto-promoted), `producer_name`, `evidence_hash`, `page`, `bbox`, `evidence_state`.
- `EvidenceKind` (10 values, L49–59): `MANUAL_CHUNK`, `DRIVE_PACK_FACT`, `PRINT_OBSERVATION`, `KG_PATH`, `ONTOLOGY_VALIDATION`, `LIVE_TAG`, `HISTORIAN_WINDOW`, `WORK_ORDER`, `PRIOR_DECISION`, `TECHNICIAN_CORRECTION`.
- 9 adapter functions (pure, dict-in/`EvidenceItem`-out, no cross-package imports), each with a citation-ID prefix (M=manual chunk, D=drive pack, P/V=print observation, G=KG path, O=ontology, H=historian, W=work order, R=prior decision, T=technician correction).
- **`evidence_from_visual_session()`** (L839–953) is the Bravo→context seam. **Verified 2026-07-31: this landed on `main` via PR #3016 (`84c641b9`, merged; VERSION bumped to 3.235.0→3.236.0)** — the docs-research pass flagged it as "not yet merged," which was stale by the time of this verification pass. Trust discipline: model output is always `candidate`; only human `review_state ∈ {confirmed, corrected}` raises trust to `verified`. Non-goal stated explicitly in the PR body: *"No wiring into engine.py, Telegram, Hub chat routes… seam only; the central runtime migration is a later, separately-reviewed slice."* That later slice has not happened — this is the literal WS1 gap.
- **Runtime adoption gap (blocking):** `evidence_from_prior_decisions()` and the other 8 adapters have **zero production call sites** — CodeGraph and grep agree all current callers are in `tests/test_context_contract.py`. The target integration point is documented (`mira-pipeline/main.py` → `Supervisor.process_full`, `mira-bots/shared/engine.py:2305`) but not built.

### 1.3 Visual/photo pipeline (the "Visual Technician", ADR-0027)

| Component | File | Role |
|---|---|---|
| `VisualSessionService` | `mira-bots/shared/visual/session_service.py` (707 lines) | Orchestrator: quality gate → vision classification → extraction observations → conditional equipment resolution. Entry point `ingest_image()` (L239–356). |
| `VisionWorker` | `mira-bots/shared/workers/vision_worker.py` (872 lines) | `process()` (L429–558) returns `classification` (single enum: `ELECTRICAL_PRINT \| NAMEPLATE \| EQUIPMENT_PHOTO \| UNKNOWN`), `classification_confidence` (single float), OCR items, drawing type. 13-step deterministic classification hierarchy (`_classify_photo`, L659–843). |
| `NameplateWorker` | `mira-bots/shared/workers/nameplate_worker.py` (206 lines) | `extract()` (L108–155) returns 8 fixed fields: `manufacturer, model, serial, voltage, fla, hp, frequency, rpm`. **No catalog/SKU field, no revision/firmware field, no barcode/QR field** — confirmed absent by grep across this file and `equipment.py`. |
| `equipment.resolve_equipment()` | `mira-bots/shared/visual/equipment.py` (826 lines) | Deterministic, multi-signal (nameplate dict / drive_name / asset_make_model), no LLM, no network, no DB (docstring L284). Returns `EquipmentResolution(status: RESOLVED\|AMBIGUOUS\|CONFLICTING\|NONE, pack_id, candidates, evidence)`. **Never returns RESOLVED on conflicting or incomplete identifiers** (L54). |
| `equipment.default_manual_retriever()` | `equipment.py:483–549` | **Real, shipped implementation** — lazy-imports `neon_recall.recall_knowledge`, filters by vendor (`chunk_matches_vendor`), graceful-empty on failure. **Called from `answer_equipment()`** (L792–799). This is the piece a prior research pass mischaracterized as "not wired to a concrete implementation" — it *is* wired, but only to the **local KB corpus** (ManualSense rungs 1–2 in the target ladder below), never to the internet (rungs 4–6). |
| `models.py` (Observation ledger) | `mira-bots/shared/visual/models.py` | `Observation` (evidence_state: VISIBLE/LIKELY/DOCUMENTED/NEEDS_CONTEXT/CONFLICTING/RESOLVED), `AnswerEnvelope`, `QualityScore`. |
| Persistence | `mira-bots/shared/visual/store.py` | `VisualSessionStore` (NeonDB, RLS-scoped, migration 063 tables: `visual_session`, `evidence_item`, `observation`, `region_of_interest`, `answer`) or `InMemoryVisualStore` fallback. 100% durable, fail-open on every call. |

### 1.4 Drive Packs (ADR-0025)

| Component | File | Role |
|---|---|---|
| Pack schema/loader | `mira-bots/shared/drive_packs/loader.py` | `load_pack()` — pure file I/O, no network. `resolve_pack()` (L378–414) — two-pass family-alias-first, then nameplate-keyword text match. **Deterministic substring match, no fuzzy/scoring, no per-model SKU differentiation.** |
| Shipped packs | `mira-bots/shared/drive_packs/packs/{durapulse_gs10,powerflex_525,powerflex_40}/pack.json` | 3 packs, family-level only. Each pack JSON carries a `manual_url`/`manual_urls` field **that no Python code reads** (`grep -rn "manual_url" mira-bots/shared/drive_packs/*.py` → 0 hits). |
| Resolver | `mira-bots/shared/drive_packs/resolver.py::resolve_service_pack()` (L144) | Multi-signal resolution against the 3 live packs only. Failure path (L223–242) returns `PackResolution(pack_id=None, reason="no approved service pack matches — name the drive… or scan the nameplate")`. **No fallback to fetch/search for a manual when this fails.** |
| Ask endpoint | `mira-bots/ask_api/drive_pack.py::drive_pack_ask()` | Canonical fast-path pattern (`.claude/rules/fast-path-optimization.md`): read-only, reuses `answer_question()`, falls through gracefully, cites or refuses. `answer_source` is always `"drive_pack"` or `"none"`; `fallback_used` is always `False`. |
| Manual fetch (dormant) | `tools/drive-pack-extract/self_eval_scout.py::fetch_manual()` (L245–259) | **Real, working** `httpx` download + PDF-magic-byte verification + sha256. **Zero runtime callers** — only the standalone human-triggered eval harness invokes it. |
| Manufacturer web crawl (partial) | `mira-crawler/tasks/discover.py::discover_manufacturer()` (L86) | Apify-driven crawl of curated `MANUFACTURER_TARGETS`, finds PDF links, queues to `ingest_url.delay()` → **KB, not packs.** |
| Drive pack bridge (default off) | `mira-crawler/drive_pack_bridge.py::maybe_create_candidate()` (L189–276) | When a KB manual is ingested, optionally proposes a **candidate pack update** (never a shipped pack) under `~/.mira/drive-pack-candidates/`. Gated by `MIRA_DRIVE_PACK_BRIDGE=1` (default off). Human-gated promotion. |
| **Universal VFD manual compiler** | PR #2703, branch `feat/universal-vfd-manual-compiler` | **OPEN since 2026-07-14, explicitly "Leave open for review — do not merge."** Table-extraction generalizer for turning *any* unseen-vendor manual into structured fault/parameter records. Precision measured at ~65% vs 98% target, recall "poor." **Relevant prior art for any future auto-pack-generation step — do not duplicate this effort; it is mid-flight and known-imperfect.** |

### 1.5 Manual discovery — the one piece hiding in plain sight

**`mira-scan-monday/backend/manual_search.py`** (on `main`, `git ls-files` confirms full backend+frontend tree present) is a **separate, shipped, tested service** implementing almost exactly ManualSense rungs 4–6:

- `_OEM_DOMAINS` dict (manufacturer → allowlisted domains, e.g. Rockwell → `literature.rockwellautomation.com`).
- 3-pass Serper (`google.serper.dev`) search: (1) `site:`-scoped high-precision, (2) `filetype:pdf` broader, (3) wide net — "multi-pass to beat SEO spam."
- `_validate_pdf()` (L298) — **HEAD-request Content-Type + magic-byte validation before promoting a candidate.**
- `_score()` (L210) — ranks candidates; `_is_denied()` — denylist for junk domains.
- `run_search_and_update()` (L426) — explicit state machine `pending → searching → found/candidate/no_match/failed` via `scan_queue.py`.
- **Promotion discipline is already correct for ManualSense's requirements:** "Promote to `manual_url` ONLY when the candidate is a direct PDF AND HEAD-validated. Anything else is flagged `candidate` for [human] review" (comment, `manual_search.py:438–441`).
- `crawler_bridge.py::upsert_manual_cache()` writes into the **existing** NeonDB `manual_cache` table (`ON CONFLICT (manufacturer, model)`) and the **existing** `mira-crawler/cron/manual_queue.json` operator queue drained daily by `kb_growth_cron.py` — explicitly built per "Mike's correction: all scrapers already exist, find them and use them" (docstring, `crawler_bridge.py:1–19`). **This already reuses the canonical ingestion path — it does not fork it.**

This service was built 2026-05-05 (commit `8fa3dce3`) for a `monday.com` marketplace app, not for the Telegram bot. It was never promoted to or referenced from `mira-bots/`. **It is the single highest-value reuse target in this entire audit.**

### 1.6 OEM crawler / manual ingestion / materialized evidence

| Component | File | Role |
|---|---|---|
| Curated sources | `mira-crawler/sources.yaml` | Human-reviewed OEM PDF URLs, tiered. Public-only, license-gated, robots.txt-respecting, rate-limited. |
| Crawler | `mira-crawler/crawler/manufacturer.py::ManufacturerCrawler` | `oem_trusted = True` (L30) — trust is per-crawler-class, gated by human curation of `sources.yaml`, not per-chunk review (`.claude/rules/oem-crawler-trusted.md`). |
| Download + validate | `mira-crawler/tasks/full_ingest_pipeline.py::_download()` (L165–195) | 50MB cap, magic-byte (`%PDF`) validation **post-hoc only** — **no HEAD request, no Content-Type check before streaming.** Weaker than `manual_search.py`'s validation (§1.5). |
| Write path | `mira-crawler/ingest/store.py::insert_chunk()` (L63–137) | `is_private` hardcoded `False` for OEM writes (shared corpus); `verified=True` only for OEM-trusted crawlers. Dedup on `(tenant_id, source_url, chunk_index)`. |
| Materialized evidence receipt | `materialized_evidence/document_compiler.py::compile_document_evidence()` + `mira-crawler/tasks/full_ingest_pipeline.py::step_document_evidence()` (L888–1025) | Content-addressed (SHA256 of PDF bytes, not URL), typed `EvidenceManifest`, fail-open with a redacted repair journal (`.repair.jsonl`) for offline replay. Recently hardened (commits `858da586`, `2b6e7a2f`, `6dacd5ef` on this branch — evidence tests now actually run in CI, URL redaction now catches quoted/wrapped URLs). |
| Session/document attachment | — | **Does not exist.** No `session_documents` table, no `attach_document(session_id, doc_id)` API. The closest analog is `mira-bots/shared/print_recall.py`, which caches an electrical print's *interpretation* (not the document itself) keyed by photo SHA + session context — proves the *pattern* (recall-first, zero re-inference on follow-up) but not the *object* (a manual attached to a session, citable by page). |

### 1.7 Telegram dispatch, PrintSense, equipment photo memory

**File:** `mira-bots/telegram/bot.py`. Single-photo dispatch is `_dispatch_single_photo()` (L1923–2036), a **strict first-match-wins chain**:

```
1. Admin test mode           (L1944) → printsense_testkit.try_printsense_grade_reply()
2. Nameplate → drive pack    (L1954) → _try_nameplate_drive_pack_reply()      [bot.py:1281–1389]
3. Wiring intake             (L1972) → _try_wiring_intake_reply()             [bot.py:1392–1444]
4. Print translator          (L1980) → _try_print_translator_reply()         [bot.py:1718–1871]
5. Commercial PrintSense     (L1988) → printsense_commercial.try_printsense_commercial_reply()
6. Engine fallback (FSM/RAG) (L1993) → dispatcher.dispatch(normalized)
```

Every rung returns `True` (claim + stop) or `False` (fall through). **The first `True` ends the chain.** Rung 2 (`_try_nameplate_drive_pack_reply`) is the literal answer to audit Q5: it calls `resolve_service_pack(nameplate=fields)` and, on failure, **returns `False` and falls through to the engine — it never calls `equipment.default_manual_retriever()` or any internet search.** The Phase-2 manual-retrieval hook that *does* exist (§1.3) is simply never reached from this path.

**Equipment photo memory (PR #3008, v3.231.0, stacked on PR #2798's print workspace, v3.230.0):** every photo's extracted evidence (nameplate fields via a `memo` dict stashed at L1314–1315 and L1779–1780) is persisted to a per-chat ledger — SQLite `telegram_print_workspace` table (`print_workspace.py:116–125`) pointing at a NeonDB `VisualSession`. Text follow-ups (`_try_equipment_photo_followup`, L937–1065; `_try_print_workspace_followup`, L633–878) recall deterministically from that ledger — **zero re-vision calls, zero re-LLM calls when deterministic evidence suffices.** This is the exact "continued conversation" pattern PrintSense already proves and that ManualSense must replicate for attached manuals.

**Surfaces:** Telegram — full coverage (photo handler, memory, print workspace). Slack — photo handler exists, equipment-photo memory **not confirmed present** (out of scope for this pass, flagged as open). Hub — background best-effort upload to `/api/uploads/folder` only, no bot-side classification or memory. Ignition — direct-connection UNS-certified turns, no visual-intake surface found. mira-pipeline API — not surveyed (separate service).

### 1.8 Tests and CI

- **~220+ test files touch this workflow** across `mira-bots/tests/` (79 files, directory-wide `pytest mira-bots/tests/`, CI-collected), `tests/printsense/` (129 files, directory-wide, CI-collected), `tests/simlab/` + `tests/beta/test_simlab_beta_gate.py` (explicitly enumerated in `ci.yml`).
- **`tests/test_nameplate_e2e.py` is explicitly `--ignore`d** in `ci.yml` (line 728) due to a chromadb import-shadowing conflict with `mira-bots/shared/` — **the one true end-to-end nameplate→asset→chat test does not run in CI.**
- **The beta gate is NOT a CI gap** (a prior research pass flagged this as unresolved — resolved by direct verification): `tests/beta/beta_ready_upload_retrieval_citation.py` contains `def test_beta_ready_upload_retrieval_citation()` and is run by its **own dedicated workflow**, `.github/workflows/beta-gate.yml` (triggered on PRs touching `tests/beta/**` + weekly cron + manual dispatch), which provisions a real stranger tenant against staging Neon. It does not rely on `ci.yml`'s glob at all — this is by design, not an accident.
- No test exercises `default_manual_retriever()`'s internet-search rungs, because those rungs don't exist yet. No test exercises `manual_search.py` being called from the bot, because it isn't called from the bot.

---

## 2. Gap Matrix

Legend: **SHIPPED** (live, tested, has real callers) · **PARTIAL** (exists, wired to *something*, not the full path) · **DORMANT** (exists, zero runtime callers) · **DUPLICATED** (two implementations of the same capability that never merged) · **MISSING** (described in a doc, no code) · **UNSAFE** (exists but violates a stated invariant).

| # | Capability | Status | Evidence |
|---|---|---|---|
| 1 | Photo quality gate | **SHIPPED** | `session_service.py` quality gate before classification |
| 2 | Vision classification (single label) | **SHIPPED** | `vision_worker.py::_classify_photo`, 13-step deterministic hierarchy |
| 3 | OCR extraction (Tesseract + model) | **PARTIAL** | Tesseract floor is Telegram-only; `vision_worker.py:459` explicitly logs "OCR floor off" outside Telegram image context (Slack/mira-pipeline get model-lane OCR only) |
| 4 | OCR bounding boxes | **PARTIAL** | `ocr_tokens` carries `{text, bbox, line}` from Tesseract, but the *structured* nameplate-field extraction (`NameplateWorker`) does not carry per-field bbox — only raw OCR tokens do |
| 5 | Nameplate structured field extraction | **PARTIAL** | 8 fields shipped (mfr/model/serial/voltage/fla/hp/frequency/rpm); **catalog/SKU, revision/firmware, barcode/QR all MISSING** from the schema |
| 6 | Barcode / QR decode | **MISSING** | No decode path anywhere in `mira-bots/shared/visual/` or `workers/` |
| 7 | Multi-region / multi-object detection | **MISSING** | Vision worker returns one classification + one description for the whole image; no per-region bounding-box object list |
| 8 | Equipment identity resolution (deterministic, multi-signal, conflict-safe) | **SHIPPED** | `equipment.py::resolve_equipment()`, never RESOLVED on conflict, tested |
| 9 | Asset Identity Packet (raw OCR kept separate from interpreted fields, SKU-prefix derivation) | **SHIPPED** | `drive_packs/asset_identity.py` — conservative regex, never fabricates a prefix |
| 10 | Drive Pack resolution (family-level) | **SHIPPED** | `resolver.py::resolve_service_pack`, 3 live packs |
| 11 | Drive Pack per-model/SKU applicability | **MISSING** | Schema seams exist (`knowledge.kb_document_ids`, `component_template_id`) but are empty in every shipped pack; no per-model differentiation logic |
| 12 | Manual retrieval from local KB corpus | **SHIPPED** | `equipment.py::default_manual_retriever()`, called from `answer_equipment()` — this is real, contrary to one research pass's initial read |
| 13 | Manual retrieval from OEM internet (rungs 4–6 of the target ladder) | **DUPLICATED / DORMANT** | `manual_search.py` (mira-scan-monday) implements it fully but is isolated to a different product; `fetch_manual()` (self_eval_scout.py) implements raw download but only for an offline eval harness; **neither is reachable from the Telegram/engine runtime path** |
| 14 | URL verification (HEAD + Content-Type + PDF magic) before trusting a manual link | **DUPLICATED** | `manual_search.py::_validate_pdf()` does this correctly; `full_ingest_pipeline.py::_download()` (the path actually used by production OEM ingestion) does **not** — magic-byte check only, post-hoc, no HEAD request |
| 15 | Manual applicability verification (does this manual actually cover this model) | **MISSING** | No code cross-checks a discovered/ingested manual's stated model coverage against the photographed identity; `test_manual_applicability_parity.py` exists but tests corpus-side parity, not photo-to-manual applicability |
| 16 | Session/document attachment (attach a specific manual to a session for citable follow-up) | **MISSING** | No `session_documents` concept; closest analog (`print_recall.py`) caches an *interpretation*, not a *document reference* |
| 17 | Persistent multi-turn chat over an attached document | **PARTIAL** | Proven pattern exists for PrintSense (`print_recall.py`, `print_workspace.py`) and for equipment-photo fields (PR #3008); **not extended to an attached manual document** |
| 18 | Materialized evidence receipts for ingested manuals | **SHIPPED** | `materialized_evidence/document_compiler.py`, content-addressed, fail-open repair journal, recently hardened (last 5 commits on this branch) |
| 19 | Shared context contract + evidence producer pattern (Tier 1 substrate) | **SHIPPED (contract) / MISSING (runtime adoption)** | `context_contract.py` v1.0, 9 adapters, all tests pass, **zero production call sites** — this is WS1's stated gap, not a Tier-2 gap, but Tier 2 depends on it |
| 20 | Visual evidence → context contract adapter | **SHIPPED** | `evidence_from_visual_session()`, merged via PR #3016 (verified on `main`, not merely "designed") |
| 21 | Many-of capability dispatch from one photo | **UNSAFE / MISSING** (by the audit's own definition of "many-of") | Single scalar `classification` at both `vision_worker.py` and the Telegram dispatch layer (`_SOURCE_TYPE_BY_CLASSIFICATION`, `session_service.py:70–74`, and the first-match-wins chain, `bot.py:1923–2036`) structurally prevents concurrent capability firing — see §4 for the precise mechanism |
| 22 | Fault-code / display reader as an independent capability | **PARTIAL** | Fault-code extraction exists (`ask.py::extract_pack_fault_codes`) but only reachable *after* a pack is already resolved — not an independent producer a photo can invoke on its own |
| 23 | Panel/terminal reader as independent capability | **PARTIAL** | Wiring intake (`_try_wiring_intake_reply`) exists but is intent-gated on caption text ("add this wiring"), not photo-content-gated; a bare panel photo with no caption does not trigger it |
| 24 | Live-state/UNS/CMMS context fused with visual evidence | **MISSING** (for photo flows specifically) | The Tier-1 contract supports `LIVE_TAG`/`WORK_ORDER` evidence kinds, but nothing in the visual pipeline currently queries live state or CMMS from a photographed asset |
| 25 | Tenant isolation on visual sessions | **SHIPPED** | `VisualSessionStore` sets `app.current_tenant_id` per call (RLS-scoped), per migration 063 |
| 26 | Read-only / no-control-write posture | **SHIPPED** | `equipment.py` docstring "no LLM, no network, no DB"; `ask.py` "read_only: bool = True"; contract-level `FORBIDDEN_ACTION_SUBSTRINGS` |
| 27 | Test coverage of the full photo→pack→answer path | **SHIPPED** | ~200+ tests, directory-wide CI collection |
| 28 | Test coverage of the end-to-end nameplate→asset→chat path | **UNSAFE (gap in the safety net, not the product)** | `test_nameplate_e2e.py` is `--ignore`d in CI due to chromadb import shadowing — the one file most likely to catch a Tier-2 regression doesn't run |
| 29 | Universal (unseen-vendor) manual table extraction | **DUPLICATED (open, unmerged)** | PR #2703 — do not build a second one; it exists, is explicitly marked "do not merge yet," and has a documented precision/recall gap |

---

## 3. Recovered Original Intent vs. Current Behavior

### 3.1 What ADR-0027 ("MIRA Visual Technician") actually asked for

The original PRD (`docs/prd/mira-visual-technician.md`, preserved 2026-07-11 as commit `65f75028`) §5.6 "Real-equipment interpretation":

> "detect visible manufacturer/model/rating/terminal+wire labels/device tag/condition; **match against Drive Commander packs, manuals, approved asset records, machine-pack components**; compare field photo vs expected print/BOM and surface mismatches"

and §3 "Product Boundary": "match against … **manual match, machine-context match**."

ADR-0027's own six-scout inventory (same commit) found **"~75% of the required building blocks already exist and are production-tested (VisionWorker/NameplateWorker/PrintWorker, print_translator, resolve_service_pack + DrivePack, BM25 manual retrieval, the wiring_connections + WiringRow seam)."** The intended resolution order was: (1) resolve to a Drive Pack, (2) query approved machine/manual records if no pack matches, (3) — implicit in "recover missing documentation" and the systems-integrator job-to-be-done, never made explicit as a numbered step — search further afield when neither exists.

### 3.2 What was actually built, chronologically

| Date | Commit | What shipped |
|---|---|---|
| 2026-07-11/12 | `65f75028` | ADR-0027 + PRD preserved. Design only. |
| 2026-07-12 | `8235aa74` | **Phase 1**: VisualSession spine, 9-state evidence model, safety-deterministic answer composer. |
| 2026-07-11→12 | `77fe9992` | **Phase 2**: `equipment.resolve_equipment()` (RESOLVED/AMBIGUOUS/CONFLICTING/NONE) + `default_manual_retriever()` as an **injectable seam**, wired to the local KB (`neon_recall.recall_knowledge`) with vendor filtering. |
| 2026-07-08 | `7b1160db` | Drive-pack Phase 2: Asset Identity Packet, catalog-prefix derivation, additive/audit-only. |
| 2026-05-05 | `8fa3dce3` | **Parallel, unrelated surface**: `mira-scan-monday` ships a full Serper-backed, OEM-domain-restricted, HEAD-validated manual search with a `pending→searching→found/candidate/no_match/failed` state machine — built for a monday.com marketplace app, never connected to the Telegram bot. |
| 2026-07-18 | `f4851f19` | **Telegram fast-path router ships** — `_try_nameplate_drive_pack_reply` calls `resolve_service_pack()` directly. **It does not call `default_manual_retriever()` and does not call anything resembling `manual_search.py`.** On no-match, it returns `False` and the engine's general FSM takes over. |
| 2026-07-29→30 | `f8614f29`, `84b334bb` | Equipment-photo memory (PR #3008) — persists and recalls photo evidence across turns. **Still no manual search on a pack miss** — it makes the *existing* gap more visible (the bot now remembers it couldn't identify your drive) rather than closing it. |
| 2026-07-14 | PR #2703 (open) | Universal VFD manual **parsing** generalizer (post-download table extraction) — a different link in the chain (structuring an already-acquired manual), not manual *discovery*. Left open, imprecise, explicitly not for merge. |
| 2026-07-30 | PR #3016 (merged) | `evidence_from_visual_session()` — the Tier-1 evidence seam for visual observations lands on `main`. |

### 3.3 The corrected diagnosis

A first-pass read of this history concluded "this is a deliberate scope decision, not a regression" — **that conclusion does not survive verification and is rejected here.** No ADR, no PRD, no entry in `docs/known-issues.md`, and no PR description records a decision to leave `default_manual_retriever()`'s internet rungs unbuilt or to leave `manual_search.py` unpromoted. What actually happened:

1. **Phases 1–2 (ADR-0027) shipped a real, injectable manual-retrieval seam** — but only wired it to the local corpus (rungs 1–2 of the target ladder in §5), because that was the cheapest thing that could prove the seam worked.
2. **The Telegram fast-path (2026-07-18) was built directly against `resolve_service_pack()`**, six days after Phase 2 shipped its hook — and simply didn't call it. There is no comment, ADR note, or PR discussion explaining why; the fast-path's own PR description does not mention the Phase-2 hook at all.
3. **A second, independent team effort (`mira-scan-monday`, 2026-05-05) had already solved the harder half of the problem** — OEM-scoped web search with real verification — for a different product surface, and it was never noticed or ported when the Telegram fast-path needed exactly that capability two months later.

This is the textbook shape of **unwired drift**, not strategy: three good pieces (a seam, a searcher, a router) built independently, never connected, with no record anyone ever decided not to connect them. The corrective is not "invent manual search" — it is "connect three things that already exist."

### 3.4 Where the flow incorrectly stops at "match an existing Drive Pack" (Q5, precise answer)

`mira-bots/telegram/bot.py:1281–1389`, function `_try_nameplate_drive_pack_reply`:

```
fields = await engine.nameplate.extract(photo_b64)          # NameplateWorker
resolution = resolve_service_pack(nameplate=fields)          # matches against 3 live packs ONLY
if resolution.pack_id is not None:
    ... return True                                          # identified — answer + stop
# else: falls through, returns False
```

There is no branch here that calls `equipment.default_manual_retriever()`, no branch that calls anything in `mira-scan-monday/backend/manual_search.py`, and no branch that surfaces "let me look for the official manual" to the technician. On a miss, control returns to `_dispatch_single_photo`, which tries wiring-intake, print-translator, and commercial-PrintSense (none of which apply to a bare unmatched nameplate), and finally falls through to the general engine FSM — which has no visual-manual capability at all. **The technician gets a generic troubleshooting reply for a photo of a drive nameplate MIRA could not identify, instead of an offer to search for the manual.**

### 3.5 Whether single-label classification prevents multi-capability dispatch (Q6, precise answer)

**Yes — at both layers, same root cause: a scalar classification field.**

- **Vision-worker layer:** `VisionWorker.process()` returns exactly one `classification` string (`vision_worker.py:429–558`). `session_service.py:70–74` maps it through `_SOURCE_TYPE_BY_CLASSIFICATION`, a **scalar** dict (`ELECTRICAL_PRINT→"print"`, `NAMEPLATE→"nameplate"`, `EQUIPMENT_PHOTO→"component"`). The gate at `session_service.py:338` (`if source_type in _EQUIPMENT_SOURCE_TYPES`) means a photo classified `ELECTRICAL_PRINT` can **never** reach equipment/nameplate resolution, and a photo classified `NAMEPLATE` can **never** reach schematic extraction — even when both classes of evidence are visibly present in the same frame (e.g., a nameplate riveted to a panel door with visible wiring behind it, or a VFD keypad showing a fault code next to its own nameplate). A first-pass research pass characterized "OCR always runs, vision-description always runs" as evidence of many-of dispatch; that is a miscategorization — OCR and the holistic vision description are **extractors that feed the single classification decision**, not independent capabilities a technician would recognize as separate answers.
- **Telegram dispatch layer:** independently, `_dispatch_single_photo` (`bot.py:1923–2036`) is a literal early-return chain — the first rung to return `True` stops every rung after it. Even if the vision layer somehow produced two classes of evidence, the dispatch layer would still only let one downstream capability answer.
- **Confirming detail:** `_EQUIPMENT_SOURCE_TYPES` (`session_service.py:83`) is defined as `frozenset({"nameplate", "drive", "panel", "component"})` — but the classification map can only ever emit `print | nameplate | component` (plus `unknown`). `"drive"` and `"panel"` are **dead entries that can never be produced by the classifier** — further evidence that the single-label bottleneck, not a deliberate policy, is what's constraining dispatch today.

Both mechanisms must be addressed for Tier 2's "many-of, not one-of" requirement — fixing only the vision-worker layer would still leave the Telegram early-return chain enforcing one-of at the surface.

---

## 4. Proposed Tier-2 Architecture

### 4.1 Naming (per explicit constraint: no "TagSense")

| Name | Layer | Scope |
|---|---|---|
| **Visual Intake** | Runtime layer | The one entry point that turns a photo into structured, multi-field, multi-region evidence. Not a product name — a pipeline stage, same register as "VisionWorker" today. |
| **Asset Identity Resolver** | Internal contract | The deterministic, multi-signal identity-resolution contract (extends today's `equipment.resolve_equipment()`). Internal name only — never user-facing. |
| **NameplateSense** | Technician-facing capability label | What the technician sees when the identity resolver's output is surfaced ("NameplateSense identified this as a PowerFlex 525"). |
| **ManualSense** | Technician-facing capability label | What the technician sees when a manual is found, verified, and attached. |

Per ADR-0033 Rule 2 (task modes are metadata, not personas) and the existing producer-naming convention (`recall_knowledge`, `drive_pack_ask`, `visual_session`, all snake_case, none capitalized-as-a-brand in code), **internal producer function/module names stay snake_case** — e.g. `manual_resolver`, `asset_identity_resolver` — never `NameplateSense`/`ManualSense` as Python identifiers. Those two names are UI copy only, exactly as `PRINTSENSE` is a `TaskMode` enum value but "PrintSense" is what the technician reads.

### 4.2 The many-of routing fix

Replace the scalar `classification` with a **multi-label evidence set** at the point closest to the actual signal, without discarding the existing (working, tested) scalar path used by `_dispatch_single_photo`'s Telegram-specific rungs:

1. `VisionWorker.process()` gains an *additive* field: `detected_classes: list[dict]` — e.g. `[{"class": "NAMEPLATE", "confidence": 0.9, "region": [...]}, {"class": "ELECTRICAL_PRINT", "confidence": 0.4, "region": [...]}]`. The existing scalar `classification`/`classification_confidence` fields **remain** (top-ranked class, unchanged shape) so nothing that reads them today breaks — this is additive, not a breaking schema change, matching the discipline `context_contract.py` itself follows (new optional fields, contract version unchanged).
2. `session_service.ingest_image()` iterates `detected_classes` and invokes **each** gated capability whose threshold is met, instead of branching on one `source_type`. `_EQUIPMENT_SOURCE_TYPES` becomes a per-class gate evaluated per detected class, not a single `if`.
3. At the Telegram surface, `_dispatch_single_photo`'s rungs stop being mutually exclusive early-returns for *evidence production* — every rung that would have claimed the turn instead **contributes evidence to the turn**, and exactly one rung (chosen by priority, same order as today) **owns the reply text**. This preserves today's UX (one coherent answer, not five competing bot messages) while allowing, e.g., a nameplate + partial wiring signal on the same photo to both persist evidence, even though only the nameplate reply is shown.
4. **Do not attempt this as a big-bang rewrite.** Ship the additive `detected_classes` field and the `session_service` gate change as one narrow PR; ship the Telegram "many evidence, one reply" refactor as a second, separate PR once the first is proven.

### 4.3 Capability producers (all "below the conversation" per ADR-0033)

```
                            ┌─────────────────────────┐
                            │   Photo (any surface)    │
                            └────────────┬─────────────┘
                                         ▼
                    ┌────────────────────────────────────────┐
                    │        Visual Intake (extended)          │
                    │  VisionWorker.process()                  │
                    │  → detected_classes: list[{class, conf,  │
                    │     region}]  (additive, scalar kept)    │
                    │  → OCR tokens + bboxes                   │
                    │  → holistic scene description             │
                    └────────────────────┬─────────────────────┘
                                         │  (fan-out, gated per detected class)
        ┌───────────────┬───────────────┼───────────────┬────────────────┬───────────────┐
        ▼               ▼               ▼               ▼                ▼               ▼
  PrintSense    Asset Identity    Fault/display   Panel/terminal   Parts/BOM      Live-state/
  (existing)    Resolver (Name-   reader          reader (existing  lookup        UNS/CMMS
                plateSense)       (existing, gate  wiring_intake,   (MISSING —    context
                (extends          on fault-code    caption-gated    future work)  (MISSING —
                equipment.py)     regex today)     today → gate on               future work)
        │               │               │          detected class)
        │               ▼               │
        │      ┌──────────────────┐     │
        │      │  ManualSense      │     │
        │      │  (NEW — §5 ladder)│     │
        │      └──────────────────┘     │
        │               │               │
        ▼               ▼               ▼
  ┌─────────────────────────────────────────────────────────────┐
  │      Each producer emits EvidenceItem(s) into the shared      │
  │      context contract (materialized_evidence/context_        │
  │      contract.py) — PRINT_OBSERVATION, existing kinds, or     │
  │      the one new kind proposed in §5.3                        │
  └──────────────────────────┬──────────────────────────────────┘
                             ▼
                  ┌─────────────────────────┐
                  │  TechnicianContext        │
                  │  (assembled by the        │
                  │   Supervisor — WS1 slice) │
                  └────────────┬──────────────┘
                               ▼
                  ┌─────────────────────────┐
                  │  ONE conversational      │
                  │  policy (ADR-0033)        │
                  │  produces the answer,     │
                  │  cites evidence, asks for │
                  │  clarification if         │
                  │  contradictions/unknowns  │
                  │  are non-empty            │
                  └─────────────────────────┘
```

**Non-negotiables carried forward from the audit's constraints:**
- No specialist producer becomes a second conversational agent — each returns typed evidence, exactly like `evidence_from_drive_pack_answer` does today.
- No second context schema, no second evidence ledger — every producer's output lands in `EvidenceItem`/`TechnicianContext`.
- Manual discovery reuses the **existing** `manual_cache` NeonDB table and `manual_queue.json` cron queue (`mira-scan-monday/backend/crawler_bridge.py` already does this) — no new ingestion pipeline.

### 4.4 Sequence diagram — first vertical slice ("photo → identity → official manual link → attached → cited follow-up")

```
Technician         Telegram bot           Asset Identity        ManualSense           Manual         Context      One
(photo + Q)         (adapter)              Resolver              (new producer)        Ingest         Contract     Policy
    │                    │                       │                     │                  │              │           │
    │──photo──────────►  │                       │                     │                  │              │           │
    │                    │──extract nameplate──► │                     │                  │              │           │
    │                    │  (NameplateWorker)     │                     │                  │              │           │
    │                    │◄──fields───────────── │                     │                  │              │           │
    │                    │──resolve_equipment()─►│                     │                  │              │           │
    │                    │◄─RESOLVED/NONE/AMBIG──│                     │                  │              │           │
    │                    │                       │                     │                  │              │           │
    │              [if RESOLVED to a pack:]      │                     │                  │              │           │
    │                    │──(existing) pack Q&A──────────────────────────────────────────────────────────────────►  │
    │                    │                       │                     │                  │              │           │
    │              [if NONE/AMBIG — the gap this slice closes:]        │                  │              │           │
    │                    │──ask ManualSense(manufacturer, model)──────►│                  │              │           │
    │                    │                       │                     │──rung 1: session's own attached manual──►  │
    │                    │                       │                     │  (none yet, first turn)                    │
    │                    │                       │                     │──rung 2: local KB corpus (existing         │
    │                    │                       │                     │  default_manual_retriever)──────────────► │
    │                    │                       │                     │  (miss — not yet ingested)                 │
    │                    │                       │                     │──rung 3: Drive/Capability Pack registry──► │
    │                    │                       │                     │  (miss — unknown model)                    │
    │                    │                       │                     │──rung 4: OEM domain search (ported         │
    │                    │                       │                     │  manual_search.py) — Serper, OEM-scoped──► │
    │                    │                       │                     │◄─candidate URL, HEAD-validated PDF──────── │
    │                    │                       │                     │──verify: resolves, is PDF, sane size,      │
    │                    │                       │                     │  manufacturer match, applicability check── │
    │                    │                       │                     │──ingest via EXISTING pipeline             │
    │                    │                       │                     │  (full_ingest_pipeline.py → knowledge_     │
    │                    │                       │                     │  entries + materialized evidence receipt)─►│
    │                    │                       │                     │◄─chunk ids + evidence manifest──────────── │
    │                    │                       │                     │──attach to VisualSession (NEW:            │
    │                    │                       │                     │  session_documents-equivalent link)        │
    │                    │                       │                     │──emit EvidenceItem(MANUAL_CHUNK or new     │
    │                    │                       │                     │  kind, trust=candidate, citation)─────────────────►│
    │                    │◄──verified manual link + citation───────────│                                            │      │
    │◄──"Found the official PowerFlex 525 manual (Rockwell literature site) — attached. Here's what it says about…"─┤      │
    │                    │                       │                     │                                            │      │
    │──follow-up Q (no photo)──────────────────► │                     │                                            │      │
    │                    │──load session's attached manual (recall-first, NO re-search)────────────────────────────►│      │
    │                    │◄──cited answer from already-attached manual, page reference─────────────────────────────┤      │
```

**Key discipline shown above:** rungs 1–3 (session, local KB, pack registry) always run before rung 4 (OEM web). Rung 4 only fires on a genuine miss. Once attached, follow-up turns never re-search — same recall-first law PrintSense already enforces.

### 4.5 ManualSense's strict lookup ladder — mapped to existing code

| Rung | Source | Existing code to reuse | Status |
|---|---|---|---|
| 1 | Exact previously-attached manual for this asset/session | **NEW** — needs a session-document link (§5.2); the *recall* pattern already exists (`print_recall.py`) | To build |
| 2 | Approved MIRA manual corpus (local KB) | `equipment.py::default_manual_retriever()` → `neon_recall.recall_knowledge` | **Already shipped** — just needs to be reachable from the Telegram fast-path |
| 3 | Drive/Machine/Capability Pack registry | `drive_packs/loader.py::list_packs()`, `resolver.py::resolve_service_pack()` | **Already shipped** |
| 4 | Official OEM website / approved OEM domain | `mira-scan-monday/backend/manual_search.py` (`_OEM_DOMAINS`, 3-pass Serper, `_validate_pdf` HEAD check) | **Exists, isolated — port, don't rebuild** |
| 5 | Approved distributor/reference source (only when OEM unavailable) | Extend `_OEM_DOMAINS`-style allowlist with a second, explicitly lower-trust tier (e.g. `_DISTRIBUTOR_DOMAINS`) — same scoring/validation machinery | Extend existing pattern |
| 6 | General web results — candidates only, never auto-trusted | `manual_search.py`'s wide-net pass (query 3) already produces exactly this — un-validated hits are held as `status="candidate"`, never promoted | **Already correct** — the discipline this rung requires is already implemented, just not connected |

For every discovered manual, the required checks map onto existing primitives:

| Requirement | Existing primitive | Gap |
|---|---|---|
| URL resolves | `manual_search.py::_validate_pdf()` (HEAD request) | None — reuse directly |
| Prefer official OEM domain | `_OEM_DOMAINS` allowlist + `_score()` | None — reuse directly |
| Verify PDF / sane size | `_validate_pdf()` (Content-Type + magic bytes); `full_ingest_pipeline.py::_download()` has a 50MB cap | Combine: use `manual_search.py`'s pre-download HEAD validation, then `full_ingest_pipeline.py`'s existing size cap + post-download magic-byte check as defense in depth |
| Record manufacturer/title/doc-number/revision/date/language/source URL/hash | `materialized_evidence/document_compiler.py::compile_document_evidence()` (SHA256, source URI) + `store.py::insert_chunk()` (manufacturer, source_url) | Doc-number/revision/date/language are **not currently extracted fields** — new, small extension to the compiler's input, not a new system |
| Verify model/catalog applicability from the manual itself | — | **MISSING** — needs a new deterministic check: does the manual's own text (title page, "applies to" table) mention the photographed model/catalog string? Cheapest version: a substring/regex check against extracted text before promoting a manual from `candidate` to `attached`. This is new, narrow logic — not a new system. |
| Distinguish family manuals from exact-model manuals | Drive Pack schema already distinguishes `family.aliases` from a specific pack; extend the same distinction to a `manual_scope: "family" \| "model"` tag on the evidence item | Small addition |
| Detect conflicts between photographed identity and manual applicability | `equipment.py`'s `CONFLICTING` status already exists as a pattern for cross-signal conflict | Extend the same enum/logic to manual-vs-identity conflicts |
| Never silently substitute a similar model or neighboring OEM | `resolver.py::_matching_live_packs()` already refuses to guess sideways ("GS20 not found" does not fall back to GS10) — same discipline, apply to manual matching | None — reuse the existing refusal discipline |
| Ask for a clearer photo / complete catalog number when ambiguous | `equipment.py`'s `AMBIGUOUS` status + `needs_context` field already produce exactly this kind of prompt | None — reuse directly |

### 4.6 Serial number handling

Per the constraint ("serial identifies the physical asset but should not normally select a manual unless the OEM provides serial-range applicability"): `NameplateWorker` already extracts `serial` as a field distinct from `model` (`nameplate_worker.py:27–36`), and `equipment.resolve_equipment()` already treats each nameplate field as an **independent signal** rather than concatenating them into one search string (`equipment.py:217–247`). The ladder in §4.5 should key rungs 2–6 on `manufacturer + model/catalog`, never on `serial` alone, and should only use `serial` when a specific OEM's manual explicitly publishes serial-range tables (a rare, per-manufacturer exception — not a general rule, and not something to build speculatively before an OEM is found that needs it).

---

## 5. Minimum Schemas / Contracts

**Principle carried from the audit's constraints: extend, don't fork.** Every addition below is additive to an existing schema or reuses an existing table.

### 5.1 `EvidenceItem` / `EvidenceKind` — extend, one open decision to flag for Mike

The 10 existing `EvidenceKind` values do not cleanly express "a specific document was found, verified (URL resolves, is PDF, sane size, applicability confirmed), and attached to this session." `MANUAL_CHUNK` is post-ingest (a retrieved chunk from an already-indexed corpus) — it does not carry "this document's identity was just verified against a photographed nameplate."

**Recommendation (not a decision — flag for Mike/ADR review, per Rule 15 and ADR-0029's extend-don't-fork law):** either

- (a) add one new `EvidenceKind.MANUAL_APPLICABILITY` value carrying `{document_id, source_url, verified_at, applicability: "exact_model"|"family"|"unverified", oem_domain: bool}` as its `payload`, distinct from the `MANUAL_CHUNK` items that follow once the document is actually chunked and indexed; or
- (b) reuse `MANUAL_CHUNK` with `payload.chunk_index = None` / a `payload.applicability` field marking it as a "document-level" citation rather than a chunk-level one.

(a) keeps kinds single-purpose (consistent with the other 9); (b) avoids growing the enum. This audit recommends (a) but explicitly leaves it open — it is exactly the kind of platform-schema decision ADR-0029/0033 reserve for deliberate review, not a unilateral implementation choice.

### 5.2 Session-document attachment — new, narrow addition

No existing table does this. Minimum addition, sized to reuse everything else:

```
visual_session_document (NEW table, migration TBD — same family as migration 063's
                          visual_session/evidence_item/observation/region_of_interest)
  session_id          UUID  FK → visual_session.session_id
  tenant_id           <matches visual_session.tenant_id type — RLS-scoped identically>
  knowledge_entry_ids UUID[] or JSONB list  -- the knowledge_entries rows this document produced
  document_sha256     TEXT  -- ties to materialized_evidence's content-addressed identity
  source_url          TEXT  -- redacted per materialized_evidence.redact_uri() conventions
  manufacturer        TEXT
  model_or_family     TEXT
  applicability        TEXT CHECK (applicability IN ('exact_model','family','unverified'))
  attached_at         TIMESTAMPTZ
  attached_by         TEXT  -- 'manual_sense' | technician confirmation id
```

This is the **only new table** this audit proposes. It plays the same role for ManualSense that `telegram_print_workspace` (SQLite) + `visual_session` (NeonDB) already play for PrintSense — a pointer, not a second copy of the document or its chunks. Recall reads `visual_session_document` first (rung 1 of the ladder), then falls through to rungs 2–6 only when empty or stale.

### 5.3 `VisionWorker` output — additive fields only

```python
# ADDITIVE to the existing dict shape (vision_worker.py:429-558) — no field removed,
# no existing field's type changed.
{
    # ... existing fields unchanged (classification, classification_confidence,
    #     vision_ok, ocr_items, ocr_tokens, drawing_type, ...) ...
    "detected_classes": [                      # NEW, optional, defaults to
        {                                       # [{"class": classification,
            "class": "NAMEPLATE",               #   "confidence": classification_confidence,
            "confidence": 0.87,                 #   "region": None}] when unchanged —
            "region": [x0, y0, x1, y1] | None,  # i.e. old callers see identical behavior.
        },
        ...
    ],
    "barcode_qr": [                             # NEW, optional, empty list if absent
        {"type": "qr"|"code128"|..., "value": str, "region": [...] }
    ],
}
```

`NameplateWorker` gains two additive fields to its existing 8: `catalog` (distinct from `model` — nameplates routinely print both), and a nullable `revision_or_firmware`. Both default to `None`, matching the existing normalization discipline (`nameplate_worker.py:54–56`).

### 5.4 `TechnicianContext` / adapters — no change required beyond the new adapter

`materialized_evidence/context_contract.py`'s `TechnicianContext` and `EvidenceItem` shapes need **zero structural changes** to carry ManualSense evidence — only a new adapter function (`evidence_from_manual_resolution()`, mirroring the shape of `evidence_from_drive_pack_answer()`) and, per §5.1, possibly one new `EvidenceKind` value. This is the cheapest possible extension — exactly what ADR-0029's "extend, never fork" law is for.

---

## 6. Phased Implementation Plan

**Sequencing constraint, stated explicitly rather than silently assumed:** WS1 (runtime adoption of the shared context contract into a live serving path) is the unification program's stated critical path, and it currently has zero production call sites. Tier 2 adds both a new evidence producer *and* a routing-layer change downstream of that same contract. Phases 0–2 below can proceed independently (they touch `mira-scan-monday`→shared-module porting, the ladder wiring, and the Telegram surface — none of which require the contract to be adopted). **Phase 3 (emitting ManualSense evidence through `evidence_from_manual_resolution()` into `TechnicianContext`) should not land until WS1's first live call site exists, or should land behind a flag that only activates once it does** — otherwise Tier 2 becomes the second thing (after PrintSense's existing `evidence_from_printsense_graph`) racing to be the first real consumer of a contract nobody has wired into a serving path yet, which risks discovering integration problems in the wrong order. This tension should be surfaced to Mike explicitly, not resolved unilaterally by sequencing around it.

| Phase | PR scope | Depends on | Ships |
|---|---|---|---|
| **0** | Add `docs/known-issues.md` entry documenting the current gap (no ADR/known-issues record exists today — §3.3) | Nothing | A paper trail, so the next person doesn't repeat the "deliberate decision" misreading |
| **1** | Port `mira-scan-monday/backend/manual_search.py` + `crawler_bridge.py` into a shared, product-agnostic module (e.g. `mira-bots/shared/manual_search/`), preserving its `_OEM_DOMAINS`, scoring, and HEAD-validation logic verbatim where possible. No behavior change to `mira-scan-monday` itself (it keeps its own copy or imports the shared one — a separate, smaller decision). | Nothing | A reusable, tested manual-search primitive with no new runtime callers yet |
| **2** | Wire the ported module into `equipment.py::default_manual_retriever()` as rungs 4–6 (§4.5), gated behind an explicit env flag (matching the `MIRA_DRIVE_PACK_BRIDGE=1`-style default-off pattern already used for the drive-pack candidate bridge) | Phase 1 | `default_manual_retriever()` can now find a manual on the open OEM web, still off by default in production |
| **3** | Connect `_try_nameplate_drive_pack_reply`'s miss path (`bot.py:1281–1389`) to call the extended `default_manual_retriever()` instead of falling straight through to the engine FSM | Phase 2 | The literal gap in §3.4 closes — a nameplate photo MIRA can't match to a pack now triggers a manual search instead of a generic reply |
| **4** | `visual_session_document` table (§5.2) + attach-on-discovery + recall-on-followup, following the exact pattern `print_workspace.py` already uses for print sessions | Phase 3 | Multi-turn citable chat over an attached manual — the "continued conversation" requirement |
| **5** | Additive `detected_classes` field on `VisionWorker.process()` + per-class gating in `session_service.ingest_image()` (§4.2, step 1–2) | Nothing (parallel to 1–4) | Multi-region/multi-class evidence production, still single-reply UX |
| **6** | Telegram "many evidence, one reply" dispatch refactor (§4.2, step 3) | Phase 5 | True many-of dispatch at the surface layer |
| **7** | `evidence_from_manual_resolution()` adapter + `EvidenceKind` decision from §5.1 | WS1's first live serving-path call site (external dependency — flag to Mike, don't silently wait or silently skip) | ManualSense evidence flows through the same contract every other producer uses |
| **8** | Fix `tests/test_nameplate_e2e.py`'s chromadb-shadowing CI exclusion (either isolate it into its own job, per the tests-agent's recommendation, or resolve the import conflict directly) | Nothing | Closes the one real safety-net gap found in §1.8/§2 item 28 — should probably move earlier if reviewers want CI protection during phases 1–6 |

Each phase is sized to be independently revertable and independently reviewable — no phase requires a prior phase's PR to still be "in flight" to make sense on its own, except where marked.

---

## 7. First Vertical Slice

**Goal:** prove "photo → identity → official manual link → manual attached → cited follow-up answer" end-to-end, on the narrowest possible surface, before any of the broader many-of/routing work.

**Scope = Phases 0–4 above, restricted to ONE manufacturer already in `_OEM_DOMAINS` (Rockwell) and ONE currently-unmatched model** (anything not in the 3 shipped Drive Packs — e.g. a PowerFlex 4 or a PowerFlex 750, which Rockwell publishes at `literature.rockwellautomation.com`).

**Explicit non-goals for the slice:** no `detected_classes` multi-label work (Phases 5–6), no contract adoption (Phase 7 stays behind its WS1 dependency and is simulated with a direct function call in the slice's own test, not a real contract emission), no distributor-tier rung 5, no barcode/QR, no fault-code-reader concurrency.

**Steps:**
1. Technician sends a photo of a PowerFlex 750 nameplate to the Telegram bot.
2. `_try_nameplate_drive_pack_reply` extracts fields, calls `resolve_service_pack()`, gets `pack_id=None` (no PF750 pack exists).
3. **New behavior:** instead of returning `False`, it calls `default_manual_retriever(manufacturer="Rockwell Automation", model="PowerFlex 750")`.
4. Rung 2 (local KB) misses. Rung 3 (pack registry) misses. Rung 4 (ported `manual_search.py`) runs: `site:literature.rockwellautomation.com "PowerFlex 750" manual filetype:pdf` → candidate → HEAD-validated.
5. Applicability check: does the PDF's own extracted title/first-page text mention "PowerFlex 750"? If yes, promote; if no, refuse and ask for a clearer photo/catalog number (per §4.5's ladder discipline).
6. Ingest through the **existing** `full_ingest_pipeline.py` path (no new ingestion code) → `knowledge_entries` + materialized evidence receipt.
7. Write one `visual_session_document` row linking this session to the new document.
8. Reply to the technician with the verified link + a citation from the manual's opening section (e.g. "PowerFlex 750 is a member of the PowerFlex 7-Class…" per literature.rockwellautomation.com/…).
9. Technician asks a follow-up ("what's the max HP rating?") with no photo. Bot loads `visual_session_document` for this session, recalls the already-ingested chunks (rung 1 of the ladder — no re-search), answers with a page citation.

This slice deliberately excludes the many-of routing work because it does not depend on it — the manual-discovery gap and the single-label-classification gap are independent defects (confirmed in §3–4), and closing the higher-value one (§3.4's literal dead end) first delivers the user's described workflow without waiting on the harder architectural change.

---

## 8. Acceptance Tests

All tests below are **new** hermetic/fixture-based tests, following the existing repo convention (deterministic graders, no live network calls in CI, `httpx`/`recall_knowledge` mocked at the boundary — same pattern as `test_drive_pack_ask.py` and `manual_search.py`'s own existing test suite).

| # | Scenario | Expected behavior | Where it fails today |
|---|---|---|---|
| 1 | Known supported drive (GS10 nameplate) | Existing pack Q&A path, unchanged — regression guard that Phase 2–3 didn't touch the happy path | N/A — should stay green throughout |
| 2 | Unknown but identifiable non-drive component (e.g. a contactor nameplate, not a VFD) | ManualSense ladder still runs (it is not drive-specific); manual found via OEM domain if the manufacturer is in the allowlist, else honest "can't find an official manual" | Fails today — falls through to generic FSM reply with no manual-search attempt |
| 3 | Existing manual already in MIRA (already in `knowledge_entries`) | Rung 2 hit, no internet call made, answer cites the existing chunk | Ladder rung 2 already works (`default_manual_retriever`) — passes today for the local-KB half; fails for the "never re-search when local hit exists" ordering unless the ladder explicitly short-circuits at rung 2 |
| 4 | Official OEM manual newly discovered (the vertical slice scenario, §7) | Full ladder rung 4 fires, verified, ingested, attached, cited | Fails today — no code path reaches rung 4 |
| 5 | Ambiguous model (nameplate reads "Schneider" with no legible model) | `AMBIGUOUS` status, `needs_context` message asking for a clearer photo/catalog number — **never** guesses a manual for one of the 5 candidate Schneider drives | `equipment.resolve_equipment()` already produces `AMBIGUOUS` correctly (§1.3) — the new ladder must preserve this and not "helpfully" search anyway |
| 6 | Conflicting manufacturer/model signals (nameplate says PowerFlex 525, caption says "GS10") | `CONFLICTING` status, refuses to pick one, asks for one clear photo | Already correctly handled by `equipment.resolve_equipment()` (§1.3) — regression guard that ManualSense doesn't bypass this by searching on the caption alone |
| 7 | Wrong-family manual (a search returns a PowerFlex 4 manual for a photographed PowerFlex 525) | Applicability check (§4.5) rejects it — family manual is not silently substituted for an exact-model requirement; either flags `applicability="family"` explicitly to the technician or refuses per "never silently substitute" | New behavior — no applicability check exists today (§2 item 15), so this test would fail against the naive implementation and must guard the applicability-check requirement specifically |
| 8 | Cross-OEM contamination (search for "Rockwell PowerFlex 525" accidentally surfaces a Siemens manual due to SEO spam) | `_OEM_DOMAINS` allowlist + manufacturer-match check in the applicability verification rejects it | `manual_search.py`'s existing `_score()` and `_is_denied()` already substantially guard against this — test should confirm the ported module keeps that guarantee |
| 9 | Dead or non-PDF URL (a search result 404s or serves an HTML redirect page) | `_validate_pdf()` (HEAD + Content-Type + magic bytes) rejects before promotion; falls through to the next candidate or refuses cleanly | `manual_search.py::_validate_pdf()` already does this — test guards it survives the port |
| 10 | Blurry nameplate (NameplateWorker returns `parse_error` or mostly-null fields) | Equipment resolution returns `NONE` with `needs_context="couldn't read identity — send a clearer photo"`; ManualSense ladder does not run at all (no identity to search on) | `session_service.py:498–535`'s fail-open contract already handles the extraction failure; test guards that a `None`/degenerate identity never reaches rung 4 |
| 11 | One photo containing multiple evidence types (nameplate + visible wiring in the same frame) | Both `NAMEPLATE` and (if wiring is legible) a lower-confidence `ELECTRICAL_PRINT`-adjacent signal are captured in `detected_classes`; at minimum the nameplate capability fires and the photo is not mis-classified into a worse label by the single-max-confidence pick | **Fails today by construction** (§3.5) — this is the direct test for the Phase 5–6 many-of fix, and should be written to fail red against current `main` before Phase 5 lands |
| 12 | Follow-up question without resending the photo | `visual_session_document`/`print_workspace`-style recall answers from the already-attached manual, page-cited, zero re-search, zero re-vision call | New — depends on Phase 4; should assert (via a mock/spy) that no HTTP call to the manual-search module happens on the follow-up turn |
| 13 | Tenant isolation | A manual attached in tenant A's session is not visible/citable from tenant B's session, even for the identical manufacturer+model; `visual_session_document` reads are RLS-scoped exactly like `visual_session` today | New table, must inherit the existing RLS pattern from migration 063 — test should attempt a cross-tenant read and assert it returns nothing, mirroring `test_visual_session_migration.py`'s RLS assertions |
| 14 | Zero fabricated URLs or citations | Every manual link in a reply resolves (rung-4 discipline) and every page citation traces to actual extracted text from that document (materialized evidence's content-addressed identity); property-based/fuzz test that no reply contains a URL not present in an `EvidenceItem.source_locator` | New — this is the hard invariant the whole design serves; should be the single highest-priority test to write first, even before the vertical slice's happy-path test, per Karpathy principle 4 ("evidence beats assertion") |

---

## 9. Recommended Amendments to ADR-0033 and the Unification Program PRD

These are **proposals for Mike's review**, written as amendments, not as though Tier 2 is already authorized — ADR-0033 itself is Proposed/awaiting Mike at M1, and nothing in this audit changes that.

1. **ADR-0033 — add an explicit "Tier 2: One Visual Intake, Many Capability Packs" section** stating that visual/photo capability producers (Asset Identity Resolver, ManualSense, PrintSense, fault-code reader, panel reader) are governed by exactly the same Rule 3 ("evidence producers emit, they do not speak") as every other producer in the ADR — closing the risk that a future contributor treats "photo workflows" as a special case exempt from the one-conversational-policy rule. This audit found no evidence anyone currently intends to violate this, but the ADR is currently silent on visual intake specifically, and silence invites drift (as §3.3 documents already happened once).

2. **ADR-0033 — record the naming decision from §4.1** (Asset Identity Resolver = internal contract, NameplateSense/ManualSense = technician-facing labels only, snake_case producer names in code) as a worked example alongside the existing `TaskMode` naming table, so the next capability (a fault-code reader, a panel reader) has a template to follow instead of inventing its own convention.

3. **PRD (`docs/prd/2026-07-30-mira-unification-program.md`) — add Tier 2 as an explicit follow-on workstream (WS7?) sequenced behind WS1's runtime-adoption gate**, per §6's sequencing note. Currently the PRD's WS1 description already lists "equipment photo memory" and "drive-pack fast-path" as target integration surfaces for contract adoption — this audit's Phase 7 (§6) is the concrete instance of that generic statement, and should be linked from the PRD rather than left as a future rediscovery.

4. **PRD — add an explicit line item for the `EvidenceKind` decision in §5.1 of this audit**, since ADR-0029's evidence-kind enum is exactly the kind of "extend, never fork" decision the PRD's governance rules (Rule 6: "governance non-negotiable... lineage splits") already anticipate needing a deliberate review step for.

5. **`docs/known-issues.md` — add the Phase 0 entry from §6** regardless of what happens to the rest of this plan. This is the cheapest, lowest-risk action this audit recommends, and it directly prevents the specific failure mode found in §3.3 (an unwired seam with no decision record, later misread as intentional).

6. **Do not amend anything to authorize training spend, corpus changes, or the PR #2703 manual-compiler merge.** None of this audit's findings bear on those decisions; they remain gated exactly as the PRD/ADR already specify (signed authorization, sitting, packing proof).

---

## 10. Novice-Level Explanation for Mike

**What you asked for:** a technician takes a photo of a nameplate/label, MIRA figures out what it is, finds the real manual on the internet, and lets the technician keep asking questions about it — the same way PrintSense already lets someone keep asking questions about an electrical print they photographed.

**What already exists (the good news — most of the hard parts are built):**
- MIRA can already look at a photo and tell whether it's a nameplate, an electrical print, or something else, and pull the text off it (manufacturer, model, serial number, voltage, etc.).
- MIRA can already match that against 3 drives it knows well (a couple of Rockwell PowerFlex models and an AutomationDirect GS10) and answer detailed questions about those.
- MIRA already remembers a photo across a conversation — if you send a print or a nameplate and then ask a follow-up question five minutes later without resending the photo, it remembers. This is the exact "keep chatting" behavior you described, and it already works for PrintSense.
- There's even a **separate piece of code, built months ago for a different product experiment, that already knows how to search the internet for the right OEM manual, check that the link is real and is actually a PDF, and avoid grabbing the wrong manufacturer's manual by mistake.** It's just never been connected to the main bot.

**What's actually missing (the one real gap):** when MIRA photographs a nameplate for a drive it doesn't already know (anything other than those 3), it just says "I don't recognize that" and starts a generic conversation instead of trying to find the manual. The code that *could* search the internet for the manual exists — it's sitting in a different part of the codebase, unused. Nobody decided not to connect it; it just never got connected.

**A second, smaller issue:** right now MIRA looks at a photo and picks exactly one thing it is ("this is a nameplate" OR "this is a wiring diagram") — never both. So a photo that shows a nameplate riveted next to some visible wiring only gets treated as one or the other. This matters less than the first gap and can be fixed separately, later.

**Recommended next step (small, safe, high-value):** take the internet-manual-search code that already exists and works (built for that other product experiment) and connect it to the main bot's "I don't recognize this drive" moment. That one connection — not a from-scratch build — turns "I don't know that drive" into "let me find the official manual for you," which is the core of what you asked for. Everything else in this document (multi-capability photos, a new database table to remember which manual is attached to which conversation, formal citation checks) builds on top of that first connection, in small, separately-reviewable steps.

**What I did NOT do:** I did not write or ship any of this code. This document is the map; nothing has been built, deployed, or merged. The next step is picking which phase to start with (this audit recommends starting with Phase 0 — a two-line documentation note — and Phase 1 — moving the existing search code into a shared location — since both are essentially risk-free and unblock everything else).

---

## Appendix: Research Provenance

This audit was compiled from 7 parallel research passes plus 4 targeted verifications, all against the live `MIRA` repository on branch `codex/charlie-document-evidence-compiler` as of 2026-07-31. Full raw findings (more exhaustive file:line detail than fits in this synthesis) are preserved in the session scratchpad and available on request:
- `audit-docs-contracts.md` — governing docs, shared context contract, ADR-0033/PRD status
- `audit-visual-pipeline.md` — VisualSession, VisionWorker, NameplateWorker, equipment resolver
- `audit-drive-packs-manuals.md` — Drive Pack architecture, manual-retrieval dormant code
- `audit-telegram-printsense-photomemory.md` — Telegram dispatch, PrintSense, photo memory
- `audit-oem-crawler-ingestion.md` — OEM crawler, knowledge_entries, materialized evidence
- `audit-git-archaeology.md` — original PRD/ADR-0027 history, chronological drift analysis
- `audit-tests-ci.md` — test coverage and CI collection status

Corrections applied after an advisor review of the initial synthesis (documented inline where relevant): the one-of/many-of finding (§3.5) was sharpened from an initial "many-of" mischaracterization; the "deliberate scope decision" framing (§3.3) was downgraded to "unwired drift" after checking for (and not finding) any decision record; the two-part manual-retrieval gap (local-corpus hook vs. internet search, §1.3/§3.4) was disambiguated after an initial pass conflated them; `mira-scan-monday/backend/manual_search.py`, PR #2703's open/do-not-merge status, PR #3016's merged status, and the beta-gate's dedicated-workflow (non-)gap were all confirmed by direct repository inspection rather than taken from the initial research passes.

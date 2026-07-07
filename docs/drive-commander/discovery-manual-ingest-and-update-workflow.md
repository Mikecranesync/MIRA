# DriveSense — Manual/Document Ingest Discovery + Trust-Preserving Update Workflow (Plan)

**Status:** Phase 1 discovery + Phase 9 report + smallest-safe-slice recommendation. **No implementation in this doc.**
**Date:** 2026-07-06 · **Against:** `origin/main` @ `fe2ae714` (VERSION 3.78.0)
**Brief:** "Repo Discovery and Automation Strategy" — turn one-off drive-manual extraction into a repeatable, trust-preserving pipeline **without weakening the anti-fabrication trust model**.
**Doctrine honored:** *Do not create a second ingestion product. Find, reuse, repair, document the existing pipeline first.* A changed manual creates a **candidate**, never an automatic trusted replacement.

---

## 0. Premise correction (verify-before-building)

The brief says "PR-A #2503 introduced the extractor; PR-B is *supposed to* generate the PowerFlex 525 pack." **Both are already merged** on `origin/main`, along with the full DriveSense/Drive-Commander line (#2481→#2505):

| Brief assumed | Reality on main |
|---|---|
| PR-A extractor exists | ✅ `#2503` — `tools/drive-pack-extract/` |
| PR-B *to do* | ✅ **merged** `#2505` — PF525 candidate pack + 5-layer grading + trust statuses |

So the extractor, cite-integrity gate, grading harness, and a graded PF525 candidate all exist. **The remaining, still-unbuilt work is the *update* workflow** (keeping manuals/packs current) — which is what this discovery scopes.

---

## 1. Phase 1 Discovery Record

Four parallel read-only sweeps (document/KB ingest · KG/proposal/trust · extractor/grading · update-detection). Discovery-Recorder format: question → files → observed → conclusion.

### 1a. Document / manual / PDF ingest → KB chunks

Six pipelines exist. Only **one** writes *citable* chunks to `knowledge_entries` with page anchors.

| # | Pipeline | Entry point | PDFs | Writes citable chunks? | Update detection | Verdict |
|---|---|---|---|---|---|---|
| 1 | mira-crawler ingest (OEM corpus) | `mira-crawler/ingest/store.py:63` | ✅ | `knowledge_entries` (shared, `is_private=false`) + MD5 dedup | MD5 bytes (`dedup.py:27`) — skips re-ingest, no *change* re-process | repair |
| 2 | mira-ingest document-kb | `mira-core/mira-ingest/main.py:888` | ✅ | ❌ Open WebUI KB only — **not citable from Hub** | SHA-256 `tenant_ingested_files` | **avoid** |
| 3 | Hub upload-pipeline (Drive/Dropbox) | `mira-hub/src/app/api/uploads/route.ts:34` | ✅ | delegates → mira-ingest → OW KB | idempotent by `externalFileId` | repair |
| 4 | **Hub node-knowledge-ingest (v2)** | `mira-hub/src/lib/node-knowledge-ingest.ts:207` | ✅ | ✅ **`knowledge_entries`** `doc_id`+`page_start/end`, `is_private=true`, BM25-live | ⚠️ ON CONFLICT(chunk_index) only — **no file-hash change detection** | **reuse** |
| 5 | mira-drop-watcher (desktop) | `tools/mira-drop-watcher/main.py:280` | ✅ | chains to #3/#4 | ✅ SHA-256 ledger | reuse |
| 6 | full_ingest_pipeline (cron) | `mira-crawler/tasks/full_ingest_pipeline.py:16` | ✅ | `knowledge_entries` via #1 | download cache only | avoid |

- **Best citable RAG path:** #4 node-ingest v2 — full citation model (`doc_id`, `page_start/end`, `metadata.filename`), RLS-safe per `.claude/rules/knowledge-entries-tenant-scoping.md` (`is_private=true`), tested (`node-knowledge-ingest-{batching,concurrency,is-private,embed}.test.ts`). Retrieval + citation assembly already handle it (`manual-rag.ts:224 / :553`).
- **Note the two lanes are distinct:** RAG chunks (`knowledge_entries`, for grounded chat) ≠ **drive packs** (`pack.json`, structured fault/param cards). The DriveSense update workflow is about the **pack** lane; the RAG lane is complementary (a manual can feed both).

### 1b. Proposal / approval / trust machinery (reusable for "update candidate" review)

One logical state machine, three projections, **propose-by-default**, admin-only promotion (ADR-0017).

- Tables: `ai_suggestions` (broad Hub queue; 6 `suggestion_type`s) `027_ai_suggestions.sql:24` · `relationship_proposals`+`relationship_evidence` `018_…:15/:70` · `kg_{entities,relationships}.approval_state` `029_…`.
- Transition helpers (only legal status writers): **TS** `mira-hub/src/lib/proposal-transition.ts:84` · **Py** `mira-bots/shared/proposal_transition.py:62`. Direct `UPDATE … status` is a bug (ADR-0017).
- Approval surfaces: list `mira-hub/src/app/api/proposals/route.ts:122` · decide `…/proposals/[id]/decide/route.ts:82` (admin-gated `proposals.decide`), with per-type handlers (`kg_edge`, `tag_mapping`).
- Auto-verify is forbidden and gated off (`MIRA_KG_INGEST_AUTOVERIFY` default off; canary `tests/canary/proposal_state_drift.sql`).
- **Verdict:** a "drive-pack update candidate" review item **reuses `ai_suggestions`** — add a 7th `suggestion_type` (e.g. `drive_pack_update`) + one decide-handler branch. ~80 LoC, no new proposal table.

### 1c. Extractor + cite-integrity + grading + trust (already built — the reuse core)

- **Extractor:** `tools/drive-pack-extract/extractor.py` — position-aware PDF parse → pack fragment (`fault_codes`, `parameters[]`, `keypad_navigation[]`). Every entry passes cite-integrity **before emission** (`verify_and_filter_entries`).
- **Cite-integrity gate:** `cite_integrity.py:40` — re-opens PDF, confirms each `excerpt` appears verbatim on cited `page`; empty excerpt = unverifiable = dropped. **A fact with no verifiable citation cannot pass.**
- **Grading (5 layers):** `grading/grade.py` → schema (`schema_check.py`) · cite (`cite_check.py`) · gold-set precision-over-recall (`gold_score.py`) · deterministic domain rules (`domain_rules.py`, incl. "parameter IDs must never appear in `related_faults`" `:55-67`) · report (`report.py`).
- **Trust statuses (fail-closed, worst-wins):** `rejected` / `internal_only` / `beta` — **automated harness never emits `trusted`**; `trusted` requires recorded human sign-off (`runbook-pr-b-acceptance.md`). Matches the brief's status vocabulary (candidate/internal_only/beta/trusted/rejected/superseded).
- **Provenance today:** `candidates/powerflex_525/PROVENANCE.md` captures source PDF **SHA-256**, extractor git sha, page ranges, exact extraction command, sanitized fields. Schema in `mira-bots/shared/drive_packs/schema.py:106-182`.
- **Local commands (from the workflow docs):**
  - Generate: `python generate_pf525_pack.py --manual "<abs path.pdf>"` → `candidates/<pack>/pack.json` + `PROVENANCE.md`
  - Grade: `python grading/grade.py --pack <name> --gold ../gold/<name>/gold.json --manual "<path>" --out grading_out` (exit 1 iff `rejected`; omit `--manual` → cite layer skipped, capped at `internal_only`)
- **Doctrine:** `docs/drive-commander/drive-pack-trust-doctrine.md` — "not trusted because the extractor ran; trusted only when open reproducible checks prove JSON matches the PDF within declared limits."

### 1d. Update-detection / crawler / feeds / registry / scheduled refresh

- **Hash primitives already present:** MD5 `mira-crawler/ingest/dedup.py:27` · **SHA-256** `tools/mira-drop-watcher/main.py:147` (reuse this exact fn).
- **Scheduled refresh already present:** hourly KB-growth cron `mira-crawler/cron/kb_growth_cron.py` (reads `manual_queue.json`, hydrates from `manual_cache`); Celery-beat tasks; RSS `tasks/rss.py` + sitemaps `tasks/sitemaps.py` (lastmod) + freshness TTL `tasks/freshness.py` — all **generic**, none is "manual-changed for a known drive."
- **Manual seed/registry today:** flat `manual_cache` table + `manual_queue.json`. A real **source registry** (`source_systems`/`source_objects` with `content_hash`+`mapping_status`) is **proposed but NOT migrated** (`docs/mira/source-record-preservation.md:42-178`, slots 040-042).
- **OEM vendor auto-discovery:** **dormant** (`manual_scrape_targets.csv`, no active scraper); bulk crawler **disabled** after VPS incidents #1318/#1336.
- **Verdict:** **stage behind a source registry first** — do NOT build a scraper fleet. No manual-*identity* (`vendor+model+revision`) tracking exists anywhere; that's the missing spine.

---

## 2. Gap report — what's missing for trust-preserving updates

Everything to *make* and *grade* a pack exists. What's missing is the thin **update spine** around it:

| Gap | Evidence | Consequence |
|---|---|---|
| **G1. No manual-source registry / manual identity** | only flat `manual_cache`; registry proposed-not-migrated | can't answer "which vetted PDF/revision backs pack X" |
| **G2. No PDF-hash *change* detection tied to a pack** | provenance stores a hash but nothing compares a *new* PDF against the pack's recorded hash | a revised manual is invisible; nothing flags "regenerate" |
| **G3. No update-candidate concept / review item** | proposal machinery exists but no `drive_pack_update` type | no propose-by-default path for "manual changed → re-grade → human approves" |
| **G4. Provenance lacks source URL + retrieved-date + revision** | `PROVENANCE.md` has filename+hash only | weak audit trail for acceptance |
| **G5. node-ingest v2 orphans old chunks on re-upload** | ON CONFLICT(chunk_index) only, new `doc_id` | RAG lane keeps stale chunks (secondary; not the pack lane) |

**None require weakening trust** — they add a gate *before* the existing gate. The trust model (cite-or-drop, grade, human sign-off for `trusted`) is untouched.

---

## 3. Target lifecycle (Phases 2–4, condensed design)

Reuses existing components at every step; the only new pieces are the **registry** and the **candidate coordinator**.

```
source registered (vendor/model/manual identity, hash, retrieved-date, URL?)
      │  [NEW: registry]
new/updated PDF placed locally ──► SHA-256 ──► compare to registry
      │  unchanged → no-op          [REUSE mira-drop-watcher _sha256]
      │  changed/new → CANDIDATE
      ▼
extractor.extract() ──► cite-integrity ──► grading (schema/cite/gold/domain) ──► report+trust status
      │  [REUSE tools/drive-pack-extract/* — zero change]
      ▼
create review item  (ai_suggestions: suggestion_type='drive_pack_update')
      │  [REUSE proposal machinery; propose-by-default]
      ▼
human approves in Hub /proposals ──► pack promoted (old pack retained until replaced)
      │  [REUSE /api/proposals/[id]/decide + transition helper]
```

Trust-preserving invariants (all already enforced by the reused grading core): a changed manual **never auto-overwrites** a trusted pack; candidate must pass schema+cite+domain; unverifiable claims dropped or fail; `trusted` still needs recorded human sign-off; old pack stays available until replacement approved.

---

## 4. Smallest safe slice (Phase 5 recommendation) — **build this first, in this order**

The brief's Options A–D map cleanly. Recommend **A + D as one PR**, everything else staged:

**PR-1 (recommended slice): Manual source registry + local update-candidate command.** *(Option A + Option D; local-only, zero runtime change.)*
- **Registry file** (not a DB migration yet): `tools/drive-pack-extract/manuals/registry.json` — array of `{pack_id, vendor, model, manual_title, publication, revision, source_url?, sha256, retrieved_date, trust_status, gold_path}`. Human-curated, committed, no proprietary PDF committed.
- **`check` command:** `python manuals/check.py --manual "<path.pdf>"` → SHA-256, look up in registry:
  - hash matches recorded → `up-to-date` (no-op, exit 0)
  - hash differs / not found → `candidate` — print what changed vs registry, exit 0 (non-gating).
- **`update-candidate` command** (thin coordinator, reuses existing tools verbatim): `python manuals/update_candidate.py --manual "<path.pdf>" --pack <id>` → runs extractor → grade → writes `candidates/<pack>/{pack.json,PROVENANCE.md,grading_report.md}` + a `candidate.json` summary `{sha256, extractor_sha, trust_status, residuals}`. **Does NOT promote.** Prints the trust status and the human-review checklist.
- **Provenance extension (G4):** add `source_url`, `retrieved_date`, `revision` fields to the provenance writer.
- **Tests (Phase 8, CI-safe, synthetic fixtures only):** registry parse; duplicate-identity detection; unchanged-hash no-op; changed-hash → candidate; candidate never auto-promotes; provenance+trust-status present in output. Reuse `fixtures/pf_sample.pdf`; **no large manuals in CI** (document local full-manual verify).

**Why this slice:** delivers the whole "detect → candidate → graded report → human decides" arc with **only new coordinator + registry code** on top of the already-tested extractor/grader — no runtime/Hub/DB change, fully reproducible locally, propose-by-default by construction (it literally cannot promote).

**Staged for later PRs (do NOT build now):**
- **PR-2 (Hub review surface, Option B-adjacent):** add `drive_pack_update` to `ai_suggestions` (`027` CHECK) + one `/api/proposals/[id]/decide` handler branch → the candidate becomes a Hub review item, approval promotes. ~80 LoC + tests (mock `FakeConn` pattern).
- **PR-3 (scheduled refresh):** extend the hourly `kb_growth_cron` (or a MIRA Routine) to run `check` across registered manuals and open candidates automatically. Reuse existing scheduler; no new daemon.
- **Deferred (needs justification):** DB-backed `source_systems`/`source_objects` registry (migrate proposals 040-042) only when JSON registry outgrows a file; **OEM vendor scrapers/RSS-per-vendor** — explicitly staged behind the registry (brief's guidance; crawler already burned the VPS twice).

---

## 5. What NOT to do (guardrails from the brief + repo rules)

- ❌ No second ingestion pipeline — reuse node-ingest v2 (RAG) + the extractor/grader (packs).
- ❌ No duplicate approval queue — reuse `ai_suggestions` + `/proposals` + the transition helpers.
- ❌ No auto-promotion — a changed manual makes a **candidate**; `trusted` needs human sign-off.
- ❌ No fragile vendor scraper fleet as the first move — registry + hash first.
- ❌ No large proprietary manuals in git/CI — synthetic fixtures in CI, full-manual verify documented as local.
- ❌ No control/write behavior; read-only, propose-by-default (`.claude/rules/fieldbus-readonly.md`, `train-before-deploy.md`).
- ❌ Docs stay in `docs/drive-commander/` / `docs/runbooks/` — **not** `docs/superpowers/specs/`.

---

## 6. Phase 9 final report (summary)

- **Existing systems found:** extractor+cite-integrity (#2503), 5-layer grader+trust statuses (#2505), 6 doc-ingest pipelines (node-ingest v2 is the citable one), full proposal/approval state machine (ADR-0017), hash primitives (MD5/SHA-256), generic scheduled refresh (KB cron, RSS, sitemaps, freshness), flat `manual_cache`.
- **Active/partial/dead:** *active* — extractor/grader, node-ingest v2, proposal machinery, KB cron, RSS/sitemaps; *partial* — crawler ingest (repair), drop-watcher (redirect to v2); *proposed-not-built* — source registry; *dormant/dead* — OEM auto-discovery, bulk crawler (disabled).
- **Recommended reuse path:** extractor+grader as-is for packs; node-ingest v2 for RAG; `ai_suggestions` for review; `mira-drop-watcher._sha256` for change detection; KB cron for scheduling.
- **Automation now possible:** local "detect changed manual → generate candidate pack → grade → emit review report," fully reproducible, no promotion.
- **Still requires human:** promotion to `trusted` (sign-off), gold-set curation, source-registry curation.
- **RSS/product-update automation:** **stage behind the registry** — not now.
- **Follow-up PRs:** PR-1 (registry + local candidate command, above) → PR-2 (Hub review type) → PR-3 (scheduled check). DB registry + vendor feeds deferred.

**Expected outcome:** DriveSense manual ingestion becomes *documented, repeatable, trust-preserving* — "automatic discovery + candidate generation + deterministic grading + human approval before trust," never "fully automatic."

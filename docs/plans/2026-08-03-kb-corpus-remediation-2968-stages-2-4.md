# KB Corpus Remediation — #2968 Stages 2–4 (measured, gated)

**Status:** PLAN (not yet executed). Prevention (Stage 1) is **already shipped** — see below.
**Owner:** unassigned. **Tracking issue:** #2968. **Related:** #1596/#2263 (manufacturer/document dedup), #2910/#2967 (render-side page-label guard).
**Hard boundary:** this plan performs **no** corpus deletion, dedup, re-ingestion, or database writes. Every stage is a separate, gated PR (dev → staging → prod), verified read-only on staging first, and **never** via prod `psql`.

---

## Where we are (evidence)

### Stage 1 — prevention — DONE ✅ (do not redo)
The recurrence-prevention code fix is merged and CI-enforced:

- **PR #2976** (`4fa24ac2a`, v3.224.4) — *"fix(ingest): stop stamping the chunk ordinal into source_page (#2968 step 1)"*.
  - `mira-core/scripts/ingest_manuals.py` (both write sites) and `mira-core/mira-ingest/db/neon.py` now stamp the **real page** (`chunk.get("page_num")` / `page_num`) or **NULL** — never the chunk ordinal.
  - `chunk_index` is retained in `metadata` (dedup key only), matching the correct crawler model in `mira-crawler/ingest/store.py`.
  - **Contract 6** in `tests/test_architecture.py` (`test_kb_writes_never_stamp_chunk_ordinal_as_source_page` + `test_source_page_checker_catches_violations`) is an AST guard that scans the whole KB write surface (`mira-core/scripts/*.py`, `mira-core/mira-ingest/db/*.py`, `mira-crawler/ingest/*.py`, `mira-bots/tools/*.py`) and is itself validated against bad/good fixtures. 5 tests pass on `main`.

**Consequence:** new ingests can no longer reintroduce the `source_page == chunk_index` defect. What remains is the **existing** mis-paginated + duplicated data — Stages 2–4 below.

### The data defect (read-only staging inspection, from #2968, 2026-07-28)
- `source_page == (metadata->>'chunk_index')::int` for **61,791 / 84,088** rows (~73%). Only **20,130** carry a real page (crawler-ingested; `sp != cidx`).
- Real page is **not** recoverable from metadata on the legacy rows (`metadata->>'page_num'` is uniformly `1` on gdrive/legacy copies) → **re-ingest required**, no metadata backfill.
- Heavy document duplication under different `source_url` schemes:
  - `520-um001` (PowerFlex 525): **5 copies**.
  - `gs10_fault_codes.pdf`: **158 distinct source_urls**.
  - `100-td013_-en-p.pdf`: 3 copies / 4,414 chunks.
- **33,410** rows are `gdrive://…` ingests (main mis-paginated + duplicated source).
- Render-side symptom already contained: PR #2967 suppresses the fabricated `p.N` label when `source_page == chunk_index`, so the trust bug is off the money path while this runs.

---

## Guiding constraints (apply to every stage)

1. **Read-before-write, staging-first.** Each stage opens with a read-only staging measurement (row counts, affected `source_url` sets, retrieval spot-checks) captured in the PR before any write.
2. **Gated promotion.** dev → staging → prod via the sanctioned workflows only (`apply-migrations.yml` / `apply-seeds.yml` / the crawler re-ingest task). Never prod `psql`; never hand-edit prod schema.
3. **Retrieval must be proven, not assumed.** After any corpus change on staging, re-run the BM25/recall spot-checks (per `.claude/rules/knowledge-entries-tenant-scoping.md` + `tests/eval/`) and confirm no regression **before** promoting. Report p50/p95 retrieval and citation-page-correctness before→after.
4. **Reversible, one slice per PR.** Prefer soft-retire (mark superseded) over hard `DELETE`; keep a rollback path. Each stage is independently revertible.
5. **Tenant law.** `knowledge_entries` is the hybrid corpus — obey `.claude/rules/knowledge-entries-tenant-scoping.md`: OEM corpus is the system tenant + `is_private=false`; never privatize it, never leak per-tenant uploads.

---

## Stage 2 — Deduplicate the N-copy documents

**Goal:** collapse each physically-identical manual to **one canonical copy**, preferring the page-aware crawler ingest (real `page_num`, public `https://…` URL) over the legacy `gdrive://` / bare-filename copies.

**Approach (proposed, to be confirmed against live staging counts):**
1. **Identify duplicate groups** read-only: group by a content key (normalized document identity — e.g. OEM doc number like `520-um001`, plus a content hash of the chunk set), not by `source_url` (which is exactly what fragmented them). Produce a dry-run report: group → member `source_url`s → chunk counts → which member is the page-aware canonical.
2. **Pick the canonical** deterministically: crawler `https://literature…` copy with real `page_num` wins; ties broken by most-complete page coverage.
3. **Soft-retire the non-canonical copies** (a `superseded_by` / `is_active=false` provenance flag — additive migration, not a `DELETE`), so retrieval stops returning duplicates but the rows remain auditable and reversible.
4. **Overlap check with #1596/#2263:** manufacturer-fragment collapse (`PF525` vs `PowerFlex 525`) must be coordinated — run the existing `manufacturer_normalize` path; do not fork a second normalizer.

**Acceptance:** on staging, each targeted doc resolves to one active copy; retrieval spot-checks for `PowerFlex 525` / `GS10` return the canonical page-aware chunks; no drop in recall coverage; report duplicate-group count before→after.

**Risk:** wrong canonical selection hides the good copy. Mitigation: soft-retire + spot-check retrieval before promote; reversible flag.

## Stage 3 — Re-ingest the mis-paginated OEM manuals (page-aware)

**Goal:** replace the legacy mis-paginated chunks with page-aware crawler ingests carrying correct `page_num` + public URLs, then retire the legacy `gdrive://` / bare-filename copies.

**Approach:**
1. Enumerate the mis-paginated OEM manuals (the `gdrive://` set intersected with known OEM docs) read-only; produce the re-ingest worklist with target public `source_url`s.
2. Re-ingest each via the **page-aware crawler** (`mira-crawler/ingest/store.py`, which already stamps real `page_num`) into staging. One manual (or a small batch) per PR — never a bulk prod-first insert (#1385 lesson: retrieval proven on staging-shape data first).
3. Verify: the re-ingested doc's `source_page` values are real pages (spot-check against the PDF); retrieval returns correct `p.N`; then soft-retire the legacy copy (Stage 2 mechanism).
4. Promote to prod via `apply-seeds.yml` only after staging retrieval is proven.

**Acceptance:** targeted OEM manuals show real `source_page` on staging + prod; the render guard (#2967) becomes a no-op for these docs because pages are now real; citation-page-correctness measured before→after on a fixed eval set.

**Risk:** re-ingest cost + partial coverage. Mitigation: batch small, measure per batch, `log()` anything skipped (no silent truncation).

## Stage 4 — Provenance / page-confidence flag

**Goal:** let retrieval + citation **prefer** real-page copies during the (possibly long) transition, and make page trustworthiness explicit.

**Approach:**
1. Additive migration: a `page_confidence` (or `page_provenance` enum: `real` | `unknown`) column/metadata field on `knowledge_entries`, defaulted from the Stage-1 truth (`source_page IS NOT NULL AND source_page != chunk_index` → `real`).
2. Retrieval ranker + citation renderer prefer `page_confidence='real'` copies when duplicates coexist; the #2967 render guard keys off this flag instead of the `source_page == chunk_index` heuristic.
3. Guard: a test asserting the flag is derived, never hand-set to `real` without a real page.

**Acceptance:** citations prefer real-page copies; the render guard is driven by an explicit provenance flag; no retrieval regression.

---

## Sequencing & exit

- Order: **Stage 2 → Stage 3 → Stage 4** (dedup first shrinks the re-ingest surface; provenance flag last codifies the end-state).
- Each stage: one PR, staging-proven, full CI, retrieval before→after reported, reversible.
- **Stop-for-review gates:** after Stage 2's dry-run report (before any write); after Stage 3's first re-ingest batch (validate the loop before scaling); before any prod promotion.
- Prevention (Stage 1) needs **no further work** — it is merged and Contract 6 keeps it from regressing.

## Cross-references
- Issue #2968 (this remediation); PR #2976 (Stage 1 prevention, merged); PR #2967/#2910 (render guard).
- `.claude/rules/knowledge-entries-tenant-scoping.md` — hybrid-corpus read/write law.
- `.claude/rules/one-pipeline-ingest.md` — all ingest goes through the one contract.
- `docs/environments.md` — dev → staging → prod promotion; no prod psql.
- `tests/test_architecture.py` — Contract 6 (prevention guard).

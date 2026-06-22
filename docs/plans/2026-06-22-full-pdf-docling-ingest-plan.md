# Plan — Full-PDF OEM manual ingest into the shared corpus (docling, validated)

**Date:** 2026-06-22
**Branch:** `feat/full-pdf-docling-ingest`
**Owner:** this session

## Goal

Expand the shared KB corpus (`knowledge_entries`, `is_private=false`, system tenant
`78917b56-…`) from the curated `chunks.jsonl` gap-fills to **full OEM manual coverage**, WITHOUT
polluting retrieval. Prove clean extraction + good retrieval on staging before any prod write.

## Why this plan exists

The quick path (raw pdfplumber full-PDF → `ingest_local_pdf.py`) was tested on staging 2026-06-21
and is **not prod-ready**: TOC dot-leaders → `� � �`, bold headers tripled (`CCChhh…`), and the
22 GS10 chunks didn't retrieve for a natural query. pdfplumber is the *fallback* extractor.
The sanctioned extractor is **docling** (`mira-core/scripts/docling_adapter.py`, used by
`ingest_manuals.py`): layout-aware, TableFormer → Markdown tables, OCR for scans. Returns the
exact block schema (`{text, page_num, section}`) the chunker + ingester already consume.

## Hard rules (carried from prior work)

- Embed/write from **Charlie** (localhost Ollama `nomic-embed-text` 768). Bravo `:11434` is dead.
- NEON URL injected from Windows Doppler over SSH stdin (`read -r NEON`). Staging first, then prod.
- Prod KB write = outward-facing → **explicit OK** before Phase 4.
- Reuse `docling_adapter.DoclingAdapter` — do NOT reinvent extraction.
- Evidence before proceeding past each phase gate. Stop if a gate fails.

## Phases

### Phase 0 — docling feasibility on Charlie  ⟶ GATE: docling extracts GS10 cleanly
- Install docling on Charlie (`pip install --user docling`). ~1.2 GB models, lazy-loaded on first
  call; this is the linchpin risk (RAM/time on a Mac Mini).
- Smoke test: `DoclingAdapter().extract_from_pdf(gs10_bytes)` returns blocks; eyeball first pages.
- **Gate:** docling loads + extracts the GS10 PDF with no `�`/tripled-char noise. If infeasible on
  Charlie → fall back to a pdfplumber-cleanup gate (Phase 1 alt) and note the limitation.

### Phase 1 — wire docling into the ingester + quality gate  ⟶ GATE: unit-level clean output
- `ingest_local_pdf.py`: add `--use-docling` that calls `DoclingAdapter.extract_from_pdf` instead
  of the inline pdfplumber loop (keep pdfplumber as fallback). Reuse the adapter from
  `mira-core/scripts/docling_adapter.py`.
- Add a chunk quality gate (belt-and-suspenders, applies to both extractors): drop chunks that are
  mostly non-alphanumeric (`�`/dot-leaders), repeated-char artifacts, or below real-word density.
- **Gate:** GS10 re-extract via docling → previews clean, tables readable, garbage chunks dropped.

### Phase 2 — re-extract GS10 + Micro820, compare quality  ⟶ GATE: docling ≫ pdfplumber
- Dry-run both PDFs through docling on Charlie. Compare chunk count + sample previews vs the
  pdfplumber run (which gave `�`/`CCChhh`).
- **Gate:** no extraction noise; tables present as markdown; chunk count sane.

### Phase 3 — staging load + retrieval validation  ⟶ GATE: retrieves + no regression
- Load docling chunks for GS10 + Micro820 into **staging** shared corpus.
- Run a query battery: (a) natural troubleshooting queries the full manual should answer,
  (b) the 8 curated-gap queries (must not regress), (c) secret-shopper-style asks.
- Measure: do full-manual chunks now surface for natural queries (the pdfplumber failure case)?
  Does existing curated retrieval degrade?
- **Gate:** full-manual chunks retrieve for the relevant queries AND the 8 curated still rank.
  **If extraction-alone doesn't lift retrieval, STOP** — the page-picking work dominates; report
  that finding rather than loading marginal content to prod.

### Phase 4 — prod promotion (explicit OK)  ⟶ GATE: human approval + prod verify
- Only if Phase 3 passes. Load docling chunks to prod, verify present + retrievable.
- Clean up any staging test residue if it would skew evals.

### Phase 5 — generalize + document
- Extend to the other on-disk manuals (Siemens S7, maintenance handbooks) as warranted.
- Flip runbook section B from "staging-tested-not-prod-ready" to the prod-ready docling procedure.
- Optional: fold into the `ab_manual_hunter` capped cadence.

## Checkpoints
Commit after each phase (durable). Record gate evidence in this file's "Progress" section.

## Progress
- **Phase 0 — docling feasibility: PASS.** docling 2.69.1 + torch 2.8.0 installed on Charlie;
  runs on Metal (`mps`). GS10 (16pp) extracted in ~100s, 18 tables rendered as Markdown, models
  cached after first call.
- **Phase 1 — docling + quality gate: DONE** (commit 78f23d38). `--use-docling` + noise filter
  (low-alnum / repeated-char / low-word-density). GS10: 60 chunks → gate dropped 3 → 57.
- **Phase 2 — quality: PASS.** docling content is clean readable prose with real parameter/Modbus
  data (`P09.00 … Modbus Address Hex=0900`); no `�`/`CCChhh`. Minor table-cell duplication only.
  ≫ pdfplumber.
- **Phase 3 — staging retrieval: GS10 PASS (partial gate).** 57 docling GS10 chunks loaded to
  staging; surfaced in BM25 top-3 for a natural query; curated chunks unaffected (no regression).
  Caveat: the `retrieval_battery.py` test is BM25-only and understates the prod hybrid
  (vector+BM25+fault/product) path — several queries returned 0 BM25 hits (lexical mismatch =
  the deferred page-picking work, not a load failure). Coverage: GS10 already had some chapter
  chunks; **Micro820 was sparse** → real value.
  - Micro820 docling staging load: IN PROGRESS (~80 min — 683 pages).
- **Phase 4 — prod promotion:** pending Micro820 staging validation + explicit OK.
- **Phase 5 — generalize/docs:** pending.
